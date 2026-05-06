/**
 * composePreview.js — read-only compose preview generator.
 *
 * Given a user's wizard config, walks serviceMeta + mediaServerMeta and
 * returns the structured artifacts Surge would deploy:
 *
 *   {
 *     services:           { <containerName>: { image, environment, volumes, ... } },
 *     networks:           { <name>: { driver } },
 *     files:              [{ path, content, mode? }],
 *     secrets:            { <serviceKey>.<secretName>: '<placeholder>' },
 *     fetchScripts:       [{ service, path, env }],
 *     postDeployScripts:  [{ service, path, env, blocks }],
 *     warnings:           [<string>...],
 *   }
 *
 * Read-only: all "to be resolved at deploy time" values become stable
 * placeholder strings so the output is deterministic (snapshot-friendly).
 *
 *   <GENERATED:<service>.<secret>>     A Surge-managed random secret.
 *   <RUNTIME-FETCH:<service>.<field>>  A value the fetchScript will produce.
 *   <FROM-CONFIG:<dotted.key>>         A user-config value not yet provided
 *                                      (defaultValue used when present).
 *
 * The same logic is what the eventual backend will run to *materialize*
 * these artifacts (it'd replace the placeholders with real values:
 * crypto.randomBytes for secrets, HTTP fetches for fromUpstream content,
 * runtime API/file reads for fromService, etc).
 */

import {
  serviceMeta,
  resolveMount,
  containerNameFor,
  SURGE_ENV_DEFAULTS,
  SURGE_COMPOSE_DEFAULTS,
} from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';


// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export function generateComposePreview(config) {
  const result = {
    services: {},
    networks: {},
    files: [],
    secrets: {},
    fetchScripts: [],
    postDeployScripts: [],
    warnings: [],
  };

  for (const { key, meta } of enumerateEnabledServices(config)) {
    addServiceToPreview(result, key, meta, config);
  }

  // Post-process: when Gluetun is enabled and one or more services
  // have vpnRoute=true, hoist their ports onto gluetun and swap them
  // to network_mode=service:gluetun. Compose doesn't let a service
  // both share a network namespace AND publish its own ports — the
  // wrapped service's port mappings must live on the network owner
  // (gluetun) instead. We do this after the per-service render so we
  // don't have to thread the routing flag through every code path.
  applyVpnRouting(result, config);

  // Sort outputs for deterministic snapshots.
  result.services = sortObjectKeys(result.services);
  result.networks = sortObjectKeys(result.networks);
  result.secrets = sortObjectKeys(result.secrets);
  result.files.sort((a, b) => a.path.localeCompare(b.path));
  result.fetchScripts.sort((a, b) => a.service.localeCompare(b.service));
  result.postDeployScripts.sort((a, b) => a.service.localeCompare(b.service));

  return result;
}


// ---------------------------------------------------------------------
// Service enumeration
// ---------------------------------------------------------------------

function enumerateEnabledServices(config) {
  const out = [];
  const ext = config?.externalServices || {};

  // Helper: services flagged as external aren't deployed by Surge
  // (the user has them running already). Skip emitting a container,
  // skip generating secrets, skip running fetch/configure scripts.
  // Cross-references TO them still work — the marker resolver above
  // turns fromService(ext-key).url into the user-provided URL.
  const isExternal = (key) => !!ext?.[key]?.external;

  // Media server (one-of, picked from the wizard's Media Server step).
  if (config?.mediaServer && mediaServerMeta[config.mediaServer]
      && !isExternal(config.mediaServer)) {
    out.push({
      key: config.mediaServer,
      meta: mediaServerMeta[config.mediaServer],
    });
  }

  // Additional services (many-of, picked via the contentEnhancement
  // tile grid on the Additional Services step).
  const enhance = config?.contentEnhancement || {};
  for (const [key, enabled] of Object.entries(enhance)) {
    if (enabled && serviceMeta[key] && !isExternal(key)) {
      out.push({ key, meta: serviceMeta[key] });
    }
  }

  return out;
}


// ---------------------------------------------------------------------
// VPN routing post-process
// ---------------------------------------------------------------------

// When gluetun is enabled AND config.vpnRoutedServices[key] is true:
//   1. Move the routed service's `ports` onto gluetun's `ports`
//   2. Set the routed service's `networkMode` to 'service:gluetun'
//   3. Drop the routed service's `networks` (mutually exclusive with
//      networkMode)
//   4. Make the routed service `dependsOn` gluetun (healthy), so it
//      doesn't try to send traffic before the tunnel is up
//
// Multi-container services (services.* sub-containers) are routed as
// a unit if any of their sub-containers has the flag — Surge's
// vpnRoutedServices is keyed at the parent level. Sub-container
// ports are hoisted; sub-container networkMode is set.
//
// If gluetun isn't enabled, vpnRoute flags are silently ignored
// (the user might be staging an upcoming deploy). We don't add
// gluetun on its own behalf.
export function applyVpnRouting(result, config) {
  const enhance = config?.contentEnhancement || {};
  if (!enhance.gluetun) return;
  const routed = config?.vpnRoutedServices || {};
  const routedKeys = Object.keys(routed).filter((k) => routed[k]);
  if (routedKeys.length === 0) return;

  const gluetun = result.services.gluetun;
  if (!gluetun) return;  // Gluetun toggled on but not yet rendered

  // Hoisted ports from all routed services land here. Use a Set to
  // dedupe in case two services try to publish the same host port
  // (the user will see the conflict in the preview's warnings).
  const hoistedPorts = new Set(gluetun.ports || []);

  for (const key of routedKeys) {
    const svc = result.services[key];
    if (!svc) continue;  // Service not enabled — flag has no effect

    // Top-level container ports.
    for (const p of svc.ports || []) hoistedPorts.add(p);
    svc.ports = [];
    svc.networkMode = 'service:gluetun';
    delete svc.networks;
    svc.dependsOn = {
      ...(svc.dependsOn || {}),
      gluetun: { condition: 'service_healthy' },
    };

    // Multi-container services (zurg, zilean, nzbdav).
    if (svc.services) {
      for (const sub of Object.values(svc.services)) {
        for (const p of sub.ports || []) hoistedPorts.add(p);
        sub.ports = [];
        sub.networkMode = 'service:gluetun';
        delete sub.networks;
      }
    }
  }

  gluetun.ports = [...hoistedPorts];
}


// ---------------------------------------------------------------------
// Per-service rendering
// ---------------------------------------------------------------------

function addServiceToPreview(result, serviceKey, meta, config) {
  const compose = meta.compose;
  if (!compose) return;

  // -- Containers ----
  if (compose.services) {
    // Multi-container: each sub-container becomes a separate entry.
    for (const [subKey, sub] of Object.entries(compose.services)) {
      const containerName = subKey === serviceKey
        ? containerNameFor(serviceKey)
        : `${containerNameFor(serviceKey)}-${subKey}`;
      result.services[containerName] = renderContainer({
        serviceKey, subKey, sub, meta, config, isSub: true,
      });
    }
    // Auto-emit a private bridge network if any sub uses bridge mode —
    // the sub-containers reach each other via service name on this net.
    const usesBridge = Object.values(compose.services)
      .some(s => s.networkMode === 'bridge');
    if (usesBridge) {
      result.networks[`${containerNameFor(serviceKey)}-internal`] = {
        driver: 'bridge',
      };
    }
  } else {
    // Single-container.
    result.services[containerNameFor(serviceKey)] = renderContainer({
      serviceKey, sub: compose, meta, config, isSub: false,
    });
  }

  // -- Secrets ----
  if (compose.secrets) {
    for (const secretName of Object.keys(compose.secrets)) {
      result.secrets[`${serviceKey}.${secretName}`] =
        `<GENERATED:${serviceKey}.${secretName}>`;
    }
  }

  // -- Files (config.xml, rclone.conf, etc.) ----
  if (compose.files) {
    for (const [_name, file] of Object.entries(compose.files)) {
      const hostPath = resolveMount(file.hostPath, { config, serviceKey });
      const content = renderFileContent(
        file.content, serviceKey, meta, config, result.warnings,
      );
      result.files.push({
        path: hostPath,
        content,
        ...(file.mode != null ? { mode: file.mode } : {}),
      });
    }
  }

  // -- Scripts ----
  if (compose.fetchScript) {
    result.fetchScripts.push({
      service: serviceKey,
      path: compose.fetchScript.path,
      env: resolveScriptEnv(
        compose.fetchScript.env, serviceKey, meta, config, result.warnings,
      ),
    });
  }
  if (compose.postDeployScript) {
    result.postDeployScripts.push({
      service: serviceKey,
      path: compose.postDeployScript.path,
      env: resolveScriptEnv(
        compose.postDeployScript.env, serviceKey, meta, config, result.warnings,
      ),
      blocks: compose.postDeployScript.blocks || [],
    });
  }
}


function renderContainer({ serviceKey, subKey, sub, meta, config, isSub }) {
  const out = {
    image: sub.image,
  };

  // Network mode: per-container > Surge default.
  out.networkMode = sub.networkMode || SURGE_COMPOSE_DEFAULTS.networkMode;
  out.restart = SURGE_COMPOSE_DEFAULTS.restart;

  if (sub.ports && sub.ports.length) {
    out.ports = [...sub.ports];
  }

  if (sub.mounts && sub.mounts.length) {
    out.volumes = sub.mounts.map(m => ({
      host: resolveMount(m.src, { config, serviceKey }),
      container: m.dst,
      ...(m.options ? { options: m.options } : {}),
    }));
  }

  // Environment: SURGE_ENV_DEFAULTS as a base, then user overrides
  // for PUID/PGID/UMASK from the wizard's Storage Config step, then
  // per-container env overrides. Resolved env-markers replace their
  // structured form.
  const envMap = { ...SURGE_ENV_DEFAULTS };
  if (config?.userId)  envMap.PUID  = String(config.userId);
  if (config?.groupId) envMap.PGID  = String(config.groupId);
  if (config?.umask)   envMap.UMASK = String(config.umask);
  if (sub.env) {
    const rendered = {};
    for (const [name, marker] of Object.entries(sub.env)) {
      const resolved = renderEnvMarker(marker, serviceKey, meta, config);
      if (resolved !== OMIT) {
        rendered[name] = resolved;
      }
    }
    Object.assign(envMap, rendered);
  }
  out.environment = Object.entries(envMap).map(
    ([k, v]) => `${k}=${v}`,
  );

  // FUSE-flavored fields (only some services).
  if (sub.capAdd) out.capAdd = sub.capAdd;
  if (sub.securityOpt) out.securityOpt = sub.securityOpt;
  if (sub.devices) out.devices = sub.devices;
  if (sub.sysctls) out.sysctls = sub.sysctls;
  if (sub.command) out.command = sub.command;
  if (sub.tty) out.tty = sub.tty;
  if (sub.shmSize) out.shmSize = sub.shmSize;

  // Multi-container glue.
  if (sub.healthcheck) out.healthcheck = sub.healthcheck;
  if (sub.dependsOn && Object.keys(sub.dependsOn).length) {
    // Translate sub-container key into the emitted container name.
    const translatedDeps = {};
    for (const [depSubKey, condition] of Object.entries(sub.dependsOn)) {
      const depContainerName = depSubKey === serviceKey
        ? containerNameFor(serviceKey)
        : `${containerNameFor(serviceKey)}-${depSubKey}`;
      translatedDeps[depContainerName] = condition;
    }
    out.dependsOn = translatedDeps;
  }

  // If multi-container with bridge mode, attach the internal network.
  if (isSub && (sub.networkMode === 'bridge')) {
    out.networks = [`${containerNameFor(serviceKey)}-internal`];
  }

  return out;
}


// ---------------------------------------------------------------------
// Env / file / script-env marker resolution
// ---------------------------------------------------------------------

const OMIT = Symbol('omit-this-env-var');

function renderEnvMarker(marker, serviceKey, meta, config) {
  // Plain literal — pass through, with ${name} substitution.
  if (typeof marker === 'string') {
    return substituteTemplateRefs(marker, serviceKey, meta, config);
  }
  if (typeof marker === 'number' || typeof marker === 'boolean') {
    return String(marker);
  }
  if (!marker || typeof marker !== 'object') {
    return '';
  }

  // Conditional gate: only emit when the user picked this media server.
  if ('whenMediaServer' in marker) {
    if (config?.mediaServer !== marker.whenMediaServer) {
      return OMIT;
    }
    // Strip the gate and resolve the inner shape.
    const inner = { ...marker };
    delete inner.whenMediaServer;
    return renderEnvMarker(inner, serviceKey, meta, config);
  }

  // Conditional gate: only emit when the named service is enabled in
  // contentEnhancement. Mirrors whenMediaServer but for the many-of
  // service grid. Lets cross-service references (fromServiceSecret,
  // fromService, literal URLs pointing at a sibling) declaratively
  // skip themselves when their target isn't part of this deploy —
  // the consuming script then sees an absent env var and can choose
  // to skip gracefully or error, depending on how essential the
  // dependency is.
  if ('whenService' in marker) {
    if (!config?.contentEnhancement?.[marker.whenService]) {
      return OMIT;
    }
    const inner = { ...marker };
    delete inner.whenService;
    return renderEnvMarker(inner, serviceKey, meta, config);
  }

  // Literal value (sometimes paired with whenMediaServer above).
  if ('value' in marker) {
    return substituteTemplateRefs(String(marker.value), serviceKey, meta, config);
  }

  // Same-service secret reference.
  if ('fromSecret' in marker) {
    return `<GENERATED:${serviceKey}.${marker.fromSecret}>`;
  }

  // Cross-service secret reference. When the target is marked
  // external (user has it running outside Surge), bypass the in-
  // bundle secret pipeline and use the user-provided apiKey.
  if ('fromServiceSecret' in marker) {
    const target = marker.fromServiceSecret;
    const ext = config?.externalServices?.[target];
    if (ext?.external) {
      // For "apiKey"-shaped secrets the external apiKey IS the
      // secret. Other secret fields aren't supported externally —
      // fall through to the placeholder so the user notices.
      if ((marker.secret || '').toLowerCase().includes('key')
          || (marker.secret || '').toLowerCase().includes('token')) {
        return ext.apiKey || `<FROM-EXTERNAL:${target}.apiKey>`;
      }
    }
    return `<GENERATED:${marker.fromServiceSecret}.${marker.secret}>`;
  }

  // Runtime-fetched value from another service's fetchScript.
  // External target → resolve to the user-provided URL or apiKey
  // directly. Field set actually used in the schema today:
  //   plex.plexToken, jellyfin.apiKey, jellyfin.userId,
  //   emby.apiKey, emby.userId. Plus implicit .url everywhere.
  // .apiKey and .token aliases both map to ext.apiKey since users
  // pasting "API key" into the wizard wouldn't know which.
  if ('fromService' in marker) {
    const target = marker.fromService;
    const ext    = config?.externalServices?.[target];
    if (ext?.external) {
      const field = (marker.field || '').toLowerCase();
      if (field === 'url' && ext.url)              return ext.url;
      if (field === 'apikey' && ext.apiKey)        return ext.apiKey;
      if (field === 'token' && ext.apiKey)         return ext.apiKey;
      if (field === 'plextoken' && ext.apiKey)     return ext.apiKey;
      if (field === 'userid' && ext.userId)        return ext.userId;
      // Unknown field on an external — surface placeholder so the
      // user notices we couldn't fill it in.
      return `<FROM-EXTERNAL:${target}.${marker.field}>`;
    }
    return `<RUNTIME-FETCH:${marker.fromService}.${marker.field}>`;
  }

  // User-config lookup (supports dot-notation).
  if ('fromConfig' in marker) {
    const value = readDottedPath(config, marker.fromConfig);
    if (value !== undefined && value !== '') return String(value);
    if (marker.defaultValue !== undefined) return String(marker.defaultValue);
    return `<FROM-CONFIG:${marker.fromConfig}>`;
  }

  // generate marker shouldn't appear directly in env (it's a secret-
  // declaration shape) but handle defensively.
  if ('generate' in marker) {
    return `<GENERATED:${serviceKey}.${marker.length}-char>`;
  }

  return '';
}


function substituteTemplateRefs(literal, serviceKey, meta, config) {
  // Replaces ${name} or ${dotted.path} with: same-service secret >
  // user-config (dotted-path traversal) > placeholder. Dotted paths
  // let templates pull deeply-nested wizard values like
  // ${cinesyncSettings.animeSeparation} without needing every config
  // field flattened to top-level.
  return literal.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (whole, name) => {
    // TZ is a docker-compose env-default expression — leave it for the
    // shell to expand at deploy time.
    if (name === 'TZ') return whole;

    // Same-service secrets are single-segment names only.
    if (!name.includes('.')) {
      const declaredSecrets = Object.keys(meta?.compose?.secrets || {});
      if (declaredSecrets.includes(name)) {
        return `<GENERATED:${serviceKey}.${name}>`;
      }
    }

    const fromConfig = readDottedPath(config, name);
    // Treat boolean false / numeric 0 as resolved values, not "missing"
    // — the dotted-path branch needs strict undefined-check rather than
    // truthiness so toggles can render as "false".
    if (fromConfig !== undefined && fromConfig !== '') {
      return String(fromConfig);
    }

    return `<UNRESOLVED:${name}>`;
  });
}


function renderFileContent(content, serviceKey, meta, config, warnings) {
  if (typeof content === 'string') {
    return substituteTemplateRefs(content, serviceKey, meta, config);
  }
  if (content && typeof content === 'object') {
    if (content.fromUpstream) {
      const note = content.fallback
        ? `<UPSTREAM-FETCH-OR-FALLBACK:${content.fromUpstream}>`
        : `<UPSTREAM-FETCH:${content.fromUpstream}>`;
      warnings.push(`${serviceKey}: file content fetched from ${content.fromUpstream}`);
      return note;
    }
  }
  return '';
}


function resolveScriptEnv(envSpec, serviceKey, meta, config, warnings) {
  if (!envSpec) return {};
  const out = {};
  for (const [name, marker] of Object.entries(envSpec)) {
    const resolved = renderEnvMarker(marker, serviceKey, meta, config);
    if (resolved !== OMIT) out[name] = resolved;
  }
  return out;
}


// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------

function readDottedPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function sortObjectKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}


// ---------------------------------------------------------------------
// YAML serialization — best-effort port of the orchestrator's `to_yaml`
// so users can preview/copy the compose document directly from the
// browser. Output should be byte-identical (modulo the `<…>` placeholders
// for unresolved markers) to what the orchestrator writes at deploy time.
//
// We translate the in-memory camelCase keys to the snake_case keys
// docker-compose expects (capAdd → cap_add, networkMode → network_mode,
// etc.) before emitting.
// ---------------------------------------------------------------------

const KEY_TRANSLATIONS = {
  capAdd:      'cap_add',
  securityOpt: 'security_opt',
  networkMode: 'network_mode',
  shmSize:     'shm_size',
  dependsOn:   'depends_on',
  containerName: 'container_name',
};

// Drop schema-only keys that don't belong in the emitted compose
// document. `services` (sub-containers), `files`, `secrets`,
// `fetchScript`, `postDeployScript` are Surge-internal — they get
// expanded by the renderer, not passed through.
const SCHEMA_ONLY_KEYS = new Set([
  'services', 'files', 'secrets', 'fetchScript', 'postDeployScript',
]);

function translateKeysForYaml(obj) {
  if (Array.isArray(obj)) return obj.map(translateKeysForYaml);
  if (obj === null || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SCHEMA_ONLY_KEYS.has(k)) continue;
    if (v === undefined) continue;
    const translatedKey = KEY_TRANSLATIONS[k] || k;
    out[translatedKey] = translateKeysForYaml(v);
  }
  return out;
}

function yamlScalar(v) {
  if (v === true)  return 'true';
  if (v === false) return 'false';
  if (v === null)  return 'null';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  const reserved = new Set(['true', 'false', 'yes', 'no', 'null', '~']);
  const needsQuote = (
    s === ''
    || reserved.has(s.toLowerCase())
    || /^[!&*[\]{}|>'"%@`#,?:\- ]/.test(s)
    || s.includes('\n')
    || s.includes(': ')
    || s.includes(' #')
  );
  if (needsQuote) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function toYaml(doc, indent = 0) {
  const pad = '  '.repeat(indent);
  if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
    if (Object.keys(doc).length === 0) return '{}';
    const lines = [];
    for (const [k, v] of Object.entries(doc)) {
      const isContainer = v !== null && typeof v === 'object';
      const isNonEmpty  = isContainer && (
        Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0
      );
      if (isNonEmpty) {
        lines.push(`${pad}${k}:`);
        lines.push(toYaml(v, indent + 1));
      } else if (isContainer) {
        lines.push(`${pad}${k}: ${toYaml(v, 0)}`);
      } else {
        lines.push(`${pad}${k}: ${yamlScalar(v)}`);
      }
    }
    return lines.join('\n');
  }
  if (Array.isArray(doc)) {
    if (doc.length === 0) return '[]';
    const lines = [];
    for (const item of doc) {
      const isNonEmptyContainer = item !== null
        && typeof item === 'object'
        && (Array.isArray(item) ? item.length > 0 : Object.keys(item).length > 0);
      if (isNonEmptyContainer) {
        const rendered = toYaml(item, indent + 1);
        const [first, ...rest] = rendered.split('\n');
        lines.push(`${pad}- ${first.trimStart()}`);
        if (rest.length) lines.push(rest.join('\n'));
      } else {
        lines.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return lines.join('\n');
  }
  return `${pad}${yamlScalar(doc)}`;
}

/**
 * Render a generated preview to a docker-compose.yaml string. Useful
 * for the "Copy compose" button on the Deploy step. The output mirrors
 * what `surge_orchestrator.py` would write at deploy time, with
 * unresolved markers shown as `<GENERATED:…>` / `<RUNTIME-FETCH:…>` /
 * `<FROM-CONFIG:…>` placeholders.
 */
export function previewToYaml(preview) {
  const doc = {
    services: translateKeysForYaml(preview.services || {}),
  };
  if (preview.networks && Object.keys(preview.networks).length > 0) {
    doc.networks = translateKeysForYaml(preview.networks);
  }
  return toYaml(doc) + '\n';
}
