import React from 'react';
import { Box, Typography, Tooltip, Chip, Stack, Switch, Checkbox, FormControlLabel, TextField, InputAdornment, Button, Dialog, DialogTitle, DialogContent, DialogActions, Alert } from '@mui/material';
import { generateComposePreview } from './composePreview';
import { mediaServerMeta } from './mediaServerMeta';
import {
  loadPresets, savePresets, buildPresetFromCurrent, upsertPreset, deletePreset,
} from './userPresets';
import bazarrLogo from './assets/service-logos/bazarr.png';
import boxarrLogo from './assets/service-logos/boxarr.png';
import cinesyncLogo from './assets/service-logos/cinesync.png';
import flaresolverrLogo from './assets/service-logos/flaresolverr.svg';
import decypharrLogo from './assets/service-logos/decypharr.png';
import gapsLogo from './assets/service-logos/gaps.png';
import gluetunLogo from './assets/service-logos/gluetun.png';
import pangolinLogo from './assets/service-logos/pangolin.png';
import kometaLogo from './assets/service-logos/kometa.png';
import mdblistarrLogo from './assets/service-logos/mdblistarr.png';
import nzbdavLogo from './assets/service-logos/nzbdav.png';
import posterizarrLogo from './assets/service-logos/posterizarr.png';
import pulsarrLogo from './assets/service-logos/pulsarr.webp';
import prowlarrLogo from './assets/service-logos/prowlarr.png';
import radarrLogo from './assets/service-logos/radarr.png';
import sonarrLogo from './assets/service-logos/sonarr.png';
import tautulliLogo from './assets/service-logos/tautulli.png';
import rdtClientLogo from './assets/service-logos/RDT-Client.png';
import sabnzbdLogo from './assets/service-logos/sabnzbd.png';
import seasonarrLogo from './assets/service-logos/seasonarr.png';
import seerrLogo from './assets/service-logos/overseerr.png';
import zileanLogo from './assets/service-logos/zilean.jpg';
import zurgLogo from './assets/service-logos/zurg.png';

// Walk every env block on a compose entry (top-level env, every
// sub-container's env, fetchScript.env, postDeployScript.env), invoking
// the visitor for each marker value. Used by the dependency-warning
// computation in the Service Selection step.
function walkEnvBlocks(compose, visit) {
  const visitDict = (env) => {
    if (!env) return;
    for (const v of Object.values(env)) visit(v);
  };
  visitDict(compose.env);
  visitDict(compose.fetchScript?.env);
  visitDict(compose.postDeployScript?.env);
  if (compose.services) {
    for (const sub of Object.values(compose.services)) visitDict(sub.env);
  }
}

// Collect whenService / whenMediaServer gate values out of a marker
// (handles arbitrary nesting since whenService gates wrap inner
// markers). Idempotent — adds to the provided sets.
function collectGates(marker, peerSet, mediaServerSet) {
  if (!marker || typeof marker !== 'object') return;
  if (typeof marker.whenService === 'string') peerSet.add(marker.whenService);
  if (typeof marker.whenMediaServer === 'string') {
    mediaServerSet.add(marker.whenMediaServer);
  }
}

// Preset deployment stacks — one-click "common bundles" for users who
// don't want to think through 22 individual service tiles. Each preset
// sets:
//   - mediaServer (or null to leave the user's current choice alone)
//   - contentEnhancement: { service: bool } overrides applied on top
//     of whatever the user already had selected
// Presets are additive on the contentEnhancement side: enabling
// "Plex + *arr starter" turns ON the listed services, but doesn't turn
// off anything the user had already enabled. Users who want a clean
// starting point can hit "Reset wizard" first.
const PRESETS = [
  {
    key:   'plex-arr-starter',
    name:  'Plex + *arr starter',
    desc:  'Common Plex media stack: Plex + Sonarr + Radarr + Bazarr + Prowlarr + SABnzbd + Tautulli',
    mediaServer: 'plex',
    services: {
      sonarr:   true,
      radarr:   true,
      bazarr:   true,
      prowlarr: true,
      sabnzbd:  true,
      tautulli: true,
    },
  },
  {
    key:   'jellyfin-minimalist',
    name:  'Jellyfin minimalist',
    desc:  'Lean open-source stack: Jellyfin + Sonarr + Radarr + Prowlarr + SABnzbd',
    mediaServer: 'jellyfin',
    services: {
      sonarr:   true,
      radarr:   true,
      prowlarr: true,
      sabnzbd:  true,
    },
  },
  {
    key:   'debrid-power-user',
    name:  'Debrid power user',
    desc:  'Real-Debrid streaming stack: Plex + Sonarr + Radarr + Prowlarr + zurg + zilean + rdt-client',
    mediaServer: 'plex',
    services: {
      sonarr:     true,
      radarr:     true,
      prowlarr:   true,
      zurg:       true,
      zilean:     true,
      'rdt-client': true,
    },
  },
  {
    key:   'requests-monitoring',
    name:  'Just requests + monitoring',
    desc:  'Light stack focused on request management: Plex + Tautulli + Seerr',
    mediaServer: 'plex',
    services: {
      tautulli: true,
      seerr:    true,
    },
  },
];

// External-API config keys collected on the External APIs wizard step.
// Used by the dependency-warning logic to flag enabled services that
// reference an API key the user hasn't filled in.
const EXTERNAL_API_KEYS = new Set([
  'tmdbApiKey',
  'rdApiToken',
  'adApiToken',
  'premiumizeApiToken',
  'fanartApiKey',
  'tvdbApiKey',
  'mdblistApiKey',
  'discordWebhook',
]);

// Recursively collect every fromConfig key referenced by a marker.
// Handles whenService/whenMediaServer wrappers since the inner marker
// may carry the fromConfig reference.
function collectFromConfigKeys(marker, keySet) {
  if (!marker || typeof marker !== 'object') return;
  if (typeof marker.fromConfig === 'string') keySet.add(marker.fromConfig);
  for (const wrap of ['whenService', 'whenMediaServer']) {
    if (wrap in marker) {
      const inner = { ...marker };
      delete inner[wrap];
      collectFromConfigKeys(inner, keySet);
    }
  }
}

// Walk every compose.files.content string for ${name} substitutions —
// these consume same-service secrets OR user-config keys (resolution
// fall-through in composePreview's substituteTemplateRefs). For our
// warning purposes we just want the config keys that fell through to
// the user-config branch.
function collectFileTemplateRefs(compose, refSet) {
  if (!compose.files) return;
  for (const file of Object.values(compose.files)) {
    if (typeof file.content !== 'string') continue;
    const matches = file.content.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g);
    for (const m of matches) refSet.add(m[1]);
  }
}

// Maps the External APIs step's config keys to human-readable labels
// for tooltip text. Keep in sync with EXTERNAL_API_KEYS.
const API_KEY_LABELS = {
  tmdbApiKey:         'TMDB API key',
  rdApiToken:         'Real-Debrid token',
  adApiToken:         'AllDebrid token',
  premiumizeApiToken: 'Premiumize token',
  fanartApiKey:       'FanArt.tv API key',
  tvdbApiKey:         'TVDB API key',
  mdblistApiKey:      'MDBList API key',
  discordWebhook:     'Discord webhook',
};

// Format the dependency-warning text as a human-readable tooltip.
// `warnings` is { peers, mediaServers, apiKeys } — all string arrays.
function formatWarningTooltip(meta, warnings) {
  const parts = [];
  if (warnings.peers.length > 0) {
    const list = warnings.peers
      .map((p) => serviceMeta[p]?.name || p)
      .join(', ');
    parts.push(`needs ${list}`);
  }
  if (warnings.mediaServers.length > 0) {
    const list = warnings.mediaServers
      .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
      .join(' or ');
    parts.push(`only auto-wires when media server is ${list}`);
  }
  if (warnings.apiKeys && warnings.apiKeys.length > 0) {
    const list = warnings.apiKeys
      .map((k) => API_KEY_LABELS[k] || k)
      .join(', ');
    parts.push(`missing ${list} (External APIs step)`);
  }
  return `${meta.name} — ${parts.join(' · ')}`;
}


// Placeholder rendered when a service doesn't yet have a logo asset.
// Drop a PNG into ./assets/service-logos/ and add a logo: import to
// replace the tile.
function LogoPlaceholder({ name }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: '#07938f',
        color: 'var(--surge-text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 600,
        margin: '0 auto',
      }}
    >
      {letter}
    </Box>
  );
}

// Universal environment variables applied to every Surge-deployed
// container. PUID/PGID match Unraid's nobody:users convention and have
// been approved for cross-platform use. TZ pulls from the user's
// environment via the standard compose-time substitution.
export const SURGE_ENV_DEFAULTS = {
  PUID: 99,
  PGID: 100,
  UMASK: '022',
  TZ: '${TZ:-UTC}',
};

// Universal compose-level defaults applied to every Surge-deployed
// container. Host networking is the default because services reach
// each other via http://localhost:<port>.
//
// A service may override any of these by setting the same field on
// its compose template (e.g. compose.networkMode = 'bridge' for
// Seasonarr, which can't share a host port with Posterizarr). When
// a service uses bridge mode, its `ports` list becomes a real
// host:container mapping and sibling-service URLs need different
// addresses than localhost.
export const SURGE_COMPOSE_DEFAULTS = {
  networkMode: 'host',
  restart: 'unless-stopped',
};

// Service keys in `serviceMeta` MUST be lowercase. The compose
// generator uses them verbatim for: container_name, the `services:`
// YAML key, the <service> token in mount paths (so volume folders are
// also lowercase), and any cross-service reference. Display names
// (meta.name) keep their natural casing — only identifiers are
// lowercased. This helper is the canonical accessor; call it instead
// of using the raw key directly.
export function containerNameFor(serviceKey) {
  return String(serviceKey || '').toLowerCase();
}

// Resolve a mount source token to an absolute host path using the
// user's platform config. Returns '' when called without a platform.
//
// Tokens recognized inside `src`:
//   mediaRoot       Unraid: U2 (cache mount when toggle on, else /mnt/user).
//                   Docker: config.docker.rootPath.
//   configRoot      Unraid: U1 (/mnt/user/appdata; fixed).
//                   Docker: config.docker.rootPath.
//   userSharesRoot  Unraid: /mnt/user always — independent of cache toggle.
//                   Use for paths that need the FUSE-merged library view
//                   so services see files regardless of cache vs array.
//                   Docker: config.docker.rootPath.
//   <service>       Replaced with the service key being resolved.
export function resolveMount(src, { config, serviceKey }) {
  if (!src) return '';

  let mediaRoot = '';
  let configRoot = '';
  let userSharesRoot = '';

  if (config?.platform === 'unraid') {
    const u = config.unraid || {};
    configRoot = '/mnt/user/appdata'; // U1, fixed
    mediaRoot = u.useCacheDrive
      ? (u.cachePath?.trim() || '/mnt/cache') // U2 with cache
      : '/mnt/user';                          // U2 falls back to user shares
    userSharesRoot = '/mnt/user';             // Always merged user-shares root
  } else if (config?.platform === 'docker') {
    const root = config.docker?.rootPath?.trim() || '/opt/surge';
    mediaRoot = root;
    configRoot = root;
    userSharesRoot = root;
  }

  return src
    .replace(/^mediaRoot(?=\/|$)/, mediaRoot)
    .replace(/^configRoot(?=\/|$)/, configRoot)
    .replace(/^userSharesRoot(?=\/|$)/, userSharesRoot)
    .replace(/<service>/g, serviceKey || '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

// Category filter buttons shown above the service grid. Order matters —
// it controls the chip display order. 'all' is always first.
// Categories with monochrome unicode icons. Picking unicode over
// @mui/icons-material to avoid the bundle bloat — these are 1-2KB
// characters versus 3-5KB SVG components, and the wizard already has
// a tight visual budget on the Service Selection step.
export const categories = [
  { key: 'all',        label: 'All',                  icon: '◯' },
  { key: 'media',      label: 'Media Management',     icon: '🎬' },
  { key: 'indexers',   label: 'Indexers',             icon: '🔎' },
  { key: 'downloads',  label: 'Download Clients',     icon: '⬇' },
  { key: 'debrid',     label: 'Debrid & Storage',     icon: '☁' },
  { key: 'requests',   label: 'Requests',             icon: '✉' },
  { key: 'metadata',   label: 'Metadata & Posters',   icon: '🖼' },
  { key: 'monitoring', label: 'Monitoring',           icon: '📊' },
  { key: 'networking', label: 'Networking & VPN',     icon: '🌐' },
];

// ---------------------------------------------------------------------
// Existing-services panel
// ---------------------------------------------------------------------
//
// Sits at the top of the Service Selection step so users with an
// existing stack can declare what they already have running BEFORE
// picking new services. Each entry stores:
//   { external: true, url, apiKey }
// in config.externalServices.<key>. The compose renderer skips
// services flagged external (no container, no secrets) and the
// fromService / fromServiceSecret marker resolvers fall back to the
// user-provided url/apiKey for any new service that depends on them.
//
// Services eligible to be marked external. Built dynamically from the
// schema so any service the user might already have running can be
// declared — even ones without HTTP APIs (Kometa, Posterizarr) can
// be marked external if the user has them scheduled elsewhere.
//
// Two services are intentionally excluded:
//   - newt: it's the Pangolin tunnel agent itself; "external Newt"
//     would mean running Pangolin against another tunnel, which
//     defeats the point.
//   - gluetun: it wraps other containers' network namespaces, so
//     "external Gluetun" doesn't fit the model.
//
// kind drives placeholder hints + the userId field for Jellyfin/Emby:
//   - 'media' → token-shaped auth (Plex token / Jellyfin/Emby API key + userId)
//   - 'service' → standard URL + API key
//   - 'task' → no HTTP API by default; user can still supply a URL/key
//     if they've configured one (Kometa /webhooks etc.)
const SERVICES_WITH_HTTP_API = new Set([
  // *arr family + downloaders + indexers + requests
  'bazarr', 'boxarr', 'cinesync', 'decypharr', 'episeerr',
  'flaresolverr', 'mdblistarr', 'nzbdav', 'prowlarr', 'pulsarr',
  'radarr', 'rdt-client', 'sabnzbd', 'seasonarr', 'seerr',
  'sonarr', 'tautulli', 'zilean', 'zurg',
]);
const SCHEDULED_TASKS = new Set([
  // One-shot / scheduled-task services without persistent HTTP APIs.
  // Marking them external is mostly informational; URL/key fields are
  // still shown but optional.
  'kometa', 'posterizarr', 'gaps',
]);

function buildEligibleList(serviceMeta, mediaServerMeta) {
  const out = [];
  // Media servers first.
  for (const [key, meta] of Object.entries(mediaServerMeta || {})) {
    out.push({ key, name: meta.name || key, kind: 'media',
               category: 'mediaServer' });
  }
  // Additional services, grouped by their schema category.
  for (const [key, meta] of Object.entries(serviceMeta || {})) {
    if (key === 'newt' || key === 'gluetun') continue;
    let kind = 'service';
    if (SCHEDULED_TASKS.has(key)) kind = 'task';
    else if (!SERVICES_WITH_HTTP_API.has(key)) kind = 'task';
    out.push({
      key,
      name: meta.name || key,
      kind,
      category: meta.category || 'other',
    });
  }
  return out;
}

// Display label + order for the category headers in the panel.
const EXTERNAL_CATEGORY_ORDER = [
  { key: 'mediaServer', label: 'Media servers' },
  { key: 'media',       label: 'Media management' },
  { key: 'indexers',    label: 'Indexers' },
  { key: 'downloads',   label: 'Download clients' },
  { key: 'debrid',      label: 'Debrid & storage' },
  { key: 'requests',    label: 'Requests' },
  { key: 'metadata',    label: 'Metadata & posters' },
  { key: 'monitoring',  label: 'Monitoring' },
  { key: 'other',       label: 'Other' },
];

function ExistingServicesPanel({ config, setConfig }) {
  const [open, setOpen] = React.useState(false);
  const ext = config?.externalServices || {};
  const enabledCount = Object.values(ext).filter((e) => e?.external).length;
  // Build the eligible list lazily — serviceMeta is exported later in
  // this same module, so we read it via the closure rather than at
  // module-load time.
  const eligible = React.useMemo(
    () => buildEligibleList(serviceMeta, mediaServerMeta),
    [],
  );
  const groupedEligible = React.useMemo(() => {
    const byCat = {};
    for (const svc of eligible) {
      if (!byCat[svc.category]) byCat[svc.category] = [];
      byCat[svc.category].push(svc);
    }
    // Sort within each category by name.
    for (const cat of Object.keys(byCat)) {
      byCat[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return byCat;
  }, [eligible]);

  const update = (key, patch) => {
    setConfig((prev) => ({
      ...prev,
      externalServices: {
        ...(prev?.externalServices || {}),
        [key]: {
          ...(prev?.externalServices?.[key] || {}),
          ...patch,
        },
      },
    }));
  };

  return (
    <Box sx={{
      mb: 2,
      border: '1px solid var(--surge-border-subtle)',
      borderRadius: 2,
      background: 'var(--surge-card-bg-inner)',
    }}>
      {/* Header — always visible, clickable to expand */}
      <Box
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2, py: 1.25,
          cursor: 'pointer',
          '&:hover': { background: 'rgba(7,147,143,0.05)' },
          '&:focus-visible': {
            outline: '2px solid var(--surge-brand)',
            outlineOffset: -2,
          },
        }}
      >
        <Box sx={{ color: 'var(--surge-brand)', fontSize: 16 }}>
          {open ? '▾' : '▸'}
        </Box>
        <Typography style={{
          color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
          letterSpacing: 0.3, textTransform: 'uppercase',
        }}>
          Existing infrastructure
        </Typography>
        {enabledCount > 0 && (
          <Chip
            size="small"
            label={`${enabledCount} marked external`}
            sx={{
              ml: 1,
              background: 'transparent',
              color: 'var(--surge-accent)',
              border: '1px solid var(--surge-accent)',
              fontSize: 11,
            }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography style={{
          color: 'var(--surge-text-dim)', fontSize: 12, fontStyle: 'italic',
        }}>
          {open ? '' : 'Already running these? Click to declare them.'}
        </Typography>
      </Box>

      {open && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Typography style={{
            color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12,
          }}>
            Mark any service you already have running outside Surge. The
            wizard will exclude it from the deploy bundle and wire any
            new services you add (Bazarr, Episeerr, etc.) to your existing
            instance using the URL and API key you provide here.
          </Typography>

          {/* Step 1: dense checkbox grid grouped by category. Pick
              what you have running — that's it. Connection details
              for the marked services live in their own section
              below, so the picker stays compact. */}
          {EXTERNAL_CATEGORY_ORDER.map((cat) => {
            const services = groupedEligible[cat.key];
            if (!services || services.length === 0) return null;
            return (
              <Box key={cat.key} sx={{ mb: 1.25 }}>
                <Typography style={{
                  color: 'var(--surge-text-muted)', fontSize: 11,
                  fontWeight: 600, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}>
                  {cat.label}
                </Typography>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                  gap: 0.25,
                }}>
                  {services.map((svc) => {
                    const isExt = !!ext[svc.key]?.external;
                    return (
                      <FormControlLabel
                        key={svc.key}
                        sx={{
                          m: 0,
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 0.5,
                          background: isExt ? 'rgba(121,234,255,0.08)' : 'transparent',
                          '&:hover': {
                            background: isExt
                              ? 'rgba(121,234,255,0.14)'
                              : 'rgba(7,147,143,0.06)',
                          },
                        }}
                        control={
                          <Checkbox
                            checked={isExt}
                            onChange={(e) => update(svc.key, { external: e.target.checked })}
                            size="small"
                            sx={{
                              p: 0.5,
                              color: 'var(--surge-text-muted)',
                              '&.Mui-checked': { color: 'var(--surge-brand)' },
                            }}
                          />
                        }
                        label={
                          <Typography style={{
                            color: 'var(--surge-text-primary)', fontSize: 13,
                          }}>
                            {svc.name}
                          </Typography>
                        }
                      />
                    );
                  })}
                </Box>
              </Box>
            );
          })}

          {/* Step 2: connection details — only rendered for the
              services the user actually checked, so this section
              stays empty (and short) until needed. Each row is a
              single horizontal flex strip: name + URL + API key
              (+ userId for Jellyfin/Emby) + test button. */}
          {eligible.some((svc) => ext[svc.key]?.external) && (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid var(--surge-border-subtle)' }}>
              <Typography style={{
                color: 'var(--surge-text-muted)', fontSize: 11,
                fontWeight: 600, letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                Connection details
              </Typography>
              <Stack spacing={1}>
                {eligible.filter((svc) => ext[svc.key]?.external).map((svc) => {
                  const entry = ext[svc.key] || {};
                  return (
                    <Box
                      key={svc.key}
                      sx={{
                        border: '1px solid var(--surge-border-subtle)',
                        borderRadius: 1,
                        p: 1,
                        background: 'rgba(121,234,255,0.04)',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Typography style={{
                          color: 'var(--surge-text-primary)', fontSize: 13,
                          fontWeight: 600,
                          minWidth: 110,
                        }}>
                          {svc.name}
                        </Typography>
                        <Box sx={{ flex: '1 1 220px' }}>
                          <input
                            aria-label={`${svc.name} external URL`}
                            value={entry.url || ''}
                            onChange={(e) => update(svc.key, { url: e.target.value })}
                            placeholder={
                              svc.kind === 'media'
                                ? 'http://192.168.1.10:32400'
                                : 'http://192.168.1.10:8989'
                            }
                            style={{
                              width: '100%',
                              background: 'var(--surge-input-bg)',
                              color: 'var(--surge-text-primary)',
                              border: '1px solid var(--surge-border)',
                              borderRadius: 4,
                              padding: 6,
                              fontSize: 12,
                              fontFamily: 'monospace',
                            }}
                          />
                        </Box>
                        <Box sx={{ flex: '1 1 200px' }}>
                          <input
                            aria-label={`${svc.name} external API key`}
                            type="password"
                            value={entry.apiKey || ''}
                            onChange={(e) => update(svc.key, { apiKey: e.target.value })}
                            placeholder={
                              svc.kind === 'media'
                                ? 'API token / Plex token'
                                : 'API key (Settings → General)'
                            }
                            style={{
                              width: '100%',
                              background: 'var(--surge-input-bg)',
                              color: 'var(--surge-text-primary)',
                              border: '1px solid var(--surge-border)',
                              borderRadius: 4,
                              padding: 6,
                              fontSize: 12,
                              fontFamily: 'monospace',
                            }}
                          />
                        </Box>
                        {(svc.key === 'jellyfin' || svc.key === 'emby') && (
                          <Box sx={{ flex: '1 1 160px' }}>
                            <input
                              aria-label={`${svc.name} external user ID`}
                              value={entry.userId || ''}
                              onChange={(e) => update(svc.key, { userId: e.target.value })}
                              placeholder="User ID (auto on test)"
                              style={{
                                width: '100%',
                                background: 'var(--surge-input-bg)',
                                color: 'var(--surge-text-primary)',
                                border: '1px solid var(--surge-border)',
                                borderRadius: 4,
                                padding: 6,
                                fontSize: 12,
                                fontFamily: 'monospace',
                              }}
                            />
                          </Box>
                        )}
                        <Box sx={{ flex: '0 0 auto' }}>
                          <ExternalConnectionTester
                            svcKey={svc.key}
                            kind={svc.kind}
                            entry={entry}
                            onUserIdDiscovered={(uid) => update(svc.key, { userId: uid })}
                          />
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          )}

          {/* Auto-detect — probes common LAN URLs for the eligible
              services. Only Plex/Jellyfin/Emby return readable
              responses (they serve CORS); *arr apps fail with CORS
              but at least confirm "something is listening on this
              port", which is the most useful signal we can get
              from a static SPA without a backend. */}
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed var(--surge-border-subtle)' }}>
            <ExternalAutoDetect config={config} setConfig={setConfig} />
          </Box>
        </Box>
      )}
    </Box>
  );
}


// ---------------------------------------------------------------------
// Test connection — per-service browser-side reachability check.
//
// Plex / Jellyfin / Emby allow CORS for their auth endpoints, so we
// can authenticate and surface a real "key works" / "rejected" result.
// Plus we read the userId for Jellyfin/Emby and bubble it back up to
// the parent so the field auto-fills.
//
// *arr apps (Sonarr / Radarr / Prowlarr / Bazarr / Tautulli /
// SABnzbd) reject browser CORS for /api/* — the auth check has to
// happen on the deploy host. We do a `mode: 'no-cors'` GET as a
// liveness probe; "opaque response" → port is open, server is
// listening, but we can't tell whether auth succeeded. Better than
// nothing.
// ---------------------------------------------------------------------
function ExternalConnectionTester({ svcKey, kind, entry, onUserIdDiscovered }) {
  const [status, setStatus] = React.useState(null); // null|testing|ok|warn|fail
  const [message, setMessage] = React.useState('');

  const handleTest = async () => {
    if (!entry?.url || !entry?.apiKey) {
      setStatus('fail');
      setMessage('Fill in URL and API key first.');
      return;
    }
    setStatus('testing');
    setMessage('');
    const url = entry.url.replace(/\/+$/, '');
    try {
      // Plex: /identity returns server info; auth via X-Plex-Token.
      if (svcKey === 'plex') {
        const res = await fetch(`${url}/identity?X-Plex-Token=${encodeURIComponent(entry.apiKey)}`,
                                { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          setStatus('fail');
          setMessage(`Plex rejected: HTTP ${res.status}`);
          return;
        }
        setStatus('ok');
        setMessage('Plex token works.');
        return;
      }
      // Jellyfin / Emby: /Users with X-Emby-Token returns the user list.
      if (svcKey === 'jellyfin' || svcKey === 'emby') {
        const tokenHeader = svcKey === 'jellyfin'
          ? { 'X-Emby-Token': entry.apiKey }
          : { 'X-Emby-Token': entry.apiKey };
        const res = await fetch(`${url}/Users`, { headers: { ...tokenHeader, Accept: 'application/json' } });
        if (!res.ok) {
          setStatus('fail');
          setMessage(`${svcKey} rejected: HTTP ${res.status}`);
          return;
        }
        const users = await res.json();
        // Pick the first admin (or just the first user) as the working userId.
        const admin = users.find?.((u) => u?.Policy?.IsAdministrator) || users[0];
        if (admin?.Id) {
          onUserIdDiscovered?.(admin.Id);
          setStatus('ok');
          setMessage(`Connected. Auto-filled user ID: ${admin.Id.slice(0, 8)}…`);
        } else {
          setStatus('warn');
          setMessage('Connected but no users returned — check the API key has admin access.');
        }
        return;
      }
      // *arr apps + SABnzbd + Tautulli: CORS blocks reading the
      // response, so we can't validate auth. Fall back to a reach-
      // ability probe in no-cors mode — if it doesn't throw, the
      // server is responding on that URL.
      try {
        await fetch(url, { mode: 'no-cors' });
        setStatus('warn');
        setMessage(
          `Server reachable, but ${kind === 'arr' ? '*arr' : svcKey} APIs ` +
          `block browser CORS so we can't verify the key from here. ` +
          `Auth will be checked at deploy time.`,
        );
      } catch (err) {
        setStatus('fail');
        setMessage(`Couldn't reach ${url} — ${err.message || 'network error'}`);
      }
    } catch (err) {
      setStatus('fail');
      setMessage(`Test failed: ${err.message || String(err)}`);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
      <Button
        size="small"
        onClick={handleTest}
        disabled={status === 'testing'}
        variant="outlined"
        sx={{
          color:        'var(--surge-brand)',
          borderColor:  'var(--surge-brand)',
          textTransform: 'none',
          fontSize: 12,
        }}
      >
        {status === 'testing' ? 'Testing…' : 'Test connection'}
      </Button>
      {status === 'ok' && (
        <Typography style={{ color: 'var(--surge-success)', fontSize: 11 }}>
          ✓ {message}
        </Typography>
      )}
      {status === 'warn' && (
        <Typography style={{ color: 'var(--surge-warning)', fontSize: 11 }}>
          ⚠ {message}
        </Typography>
      )}
      {status === 'fail' && (
        <Typography style={{ color: 'var(--surge-error)', fontSize: 11 }}>
          ✗ {message}
        </Typography>
      )}
    </Box>
  );
}


// ---------------------------------------------------------------------
// Auto-detect — probe common URLs for each eligible service.
//
// Tries a small list of high-likelihood URLs per service (localhost
// + the page's hostname on each service's standard port). For Plex/
// Jellyfin/Emby we can read the response and confirm it's actually
// that service. For *arr apps we just check whether the connection
// resolves; CORS prevents reading the body. The user still has to
// paste the API key — discovery only fills in URL.
// ---------------------------------------------------------------------
const PROBE_PORTS = {
  plex:     [32400],
  jellyfin: [8096],
  emby:     [8096, 8920],
  sonarr:   [8989],
  radarr:   [7878],
  prowlarr: [9696],
  sabnzbd:  [8080],
  tautulli: [8181],
};

function ExternalAutoDetect({ config, setConfig }) {
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState(null);
  const [errors, setErrors]   = React.useState(null);
  // User-supplied host. Defaults to "localhost" but the meaningful
  // case is "my-nas.local", "192.168.1.50", or whatever the user's
  // existing media server is actually reachable as. We can't auto-
  // discover that from the browser — the browser doesn't know the
  // user's LAN topology and Chrome's Private Network Access protections
  // would block scanning anyway.
  const [host, setHost] = React.useState('localhost');

  const probe = async () => {
    if (!host.trim()) return;
    setRunning(true);
    setResults(null);
    setErrors(null);
    const cleanHost = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const found = {};
    const tried = {};

    for (const [svc, ports] of Object.entries(PROBE_PORTS)) {
      tried[svc] = [];
      for (const port of ports) {
        const candidate = `http://${cleanHost}:${port}`;
        tried[svc].push(candidate);
        try {
          // 3-second timeout per probe.
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 3000);
          // no-cors: opaque response; resolves on any HTTP reply
          // (including 401/403/404 from a real service), rejects on
          // network-level failures (ECONNREFUSED, DNS, timeout).
          await fetch(candidate, { mode: 'no-cors', signal: ctrl.signal });
          clearTimeout(t);
          found[svc] = candidate;
          break;
        } catch (_) {
          // unreachable — try the next port for this service.
        }
      }
    }
    setResults(found);
    if (Object.keys(found).length === 0) setErrors(tried);
    setRunning(false);
  };

  const applyAll = () => {
    if (!results) return;
    setConfig((prev) => {
      const next = { ...(prev?.externalServices || {}) };
      for (const [svc, url] of Object.entries(results)) {
        next[svc] = { ...(next[svc] || {}), external: true, url };
      }
      return { ...prev, externalServices: next };
    });
  };

  const isHttpsContext = typeof window !== 'undefined'
    && window.location.protocol === 'https:';

  // Auto-detect is fundamentally incompatible with HTTPS pages —
  // browsers block all http:// fetches as mixed content, and we'd
  // need a backend proxy (with the privacy/security tradeoffs that
  // come with it) to work around that. Show an explainer in place
  // of the scan UI when running on https://surge.video so users
  // understand why the button isn't there rather than concluding
  // the feature is broken.
  if (isHttpsContext) {
    return (
      <Alert severity="info" sx={{ fontSize: 12 }}>
        <strong>Auto-detect isn't available on the hosted site.</strong>
        <Box component="span" sx={{ display: 'block', mt: 0.5, color: 'var(--surge-text-secondary)' }}>
          Browsers block HTTPS pages from probing plain <code>http://</code>{' '}
          URLs on your LAN (mixed-content protection), so we can't reach
          your services from here. Two options:
        </Box>
        <Box component="ul" sx={{
          color: 'var(--surge-text-secondary)', m: 0, pl: 2.5, mt: 0.75, lineHeight: 1.7,
          fontSize: 12,
        }}>
          <li>
            <strong>Manual entry</strong> — flip the switches above for
            each service you have running and paste the URL + API key.
            Takes ~30 seconds per service.
          </li>
          <li>
            <strong>Run the wizard locally</strong> for auto-detect:{' '}
            <code>git clone</code> the repo,{' '}
            <code>cd frontend &amp;&amp; npm install &amp;&amp; npm start</code>, then open{' '}
            <code>http://localhost:3000</code>. Auto-detect works there
            because it's an HTTP page. Generate the bundle locally and
            run it on your deploy host as usual.
          </li>
        </Box>
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 220px', minWidth: 200 }}>
          <Typography style={{
            color: 'var(--surge-text-muted)', fontSize: 11, marginBottom: 4,
          }}>
            Host to scan (LAN IP, hostname, or "localhost")
          </Typography>
          <input
            aria-label="Host to scan for services"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) probe(); }}
            placeholder="192.168.1.50 or nas.local"
            style={{
              width: '100%',
              background: 'var(--surge-input-bg)',
              color: 'var(--surge-text-primary)',
              border: '1px solid var(--surge-border)',
              borderRadius: 4,
              padding: 6,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
        </Box>
        <Button
          size="small"
          onClick={probe}
          disabled={running || !host.trim()}
          variant="outlined"
          sx={{
            color: 'var(--surge-accent)',
            borderColor: 'var(--surge-accent)',
            textTransform: 'none',
            fontSize: 12,
            mt: 2,
          }}
        >
          {running ? 'Scanning…' : '🔍 Scan host'}
        </Button>
      </Box>
      <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 11, marginTop: 6 }}>
        Tries each service on its standard port (Plex 32400, Sonarr 8989,
        Radarr 7878, Prowlarr 9696, Jellyfin/Emby 8096, SABnzbd 8080,
        Tautulli 8181). Doesn't validate API keys — paste those manually.
      </Typography>

      {results && (
        <Box sx={{ mt: 1.5 }}>
          {Object.keys(results).length === 0 ? (
            <Box>
              <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 8 }}>
                Nothing reachable at <code>{host}</code> on any standard
                service port. Common reasons:
              </Typography>
              <Box component="ul" sx={{
                color: 'var(--surge-text-dim)', fontSize: 11,
                m: 0, pl: 2, lineHeight: 1.7,
              }}>
                <li>Wrong host — try a LAN IP like <code>192.168.1.50</code></li>
                <li>Services run on non-standard ports (mark them manually above)</li>
                <li>Firewall blocking from this machine</li>
                <li>Browser's Private Network Access blocking cross-network fetch</li>
              </Box>
              {errors && (
                <Typography style={{
                  color: 'var(--surge-text-dim)', fontSize: 10, marginTop: 8,
                  fontFamily: 'monospace',
                }}>
                  Tried: {Object.values(errors).flat().join(', ')}
                </Typography>
              )}
            </Box>
          ) : (
            <Box>
              <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 12, marginBottom: 8 }}>
                Found {Object.keys(results).length} reachable
                {Object.keys(results).length === 1 ? ' service' : ' services'} on{' '}
                <code>{host}</code>:
              </Typography>
              <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                {Object.entries(results).map(([svc, url]) => (
                  <Typography key={svc} style={{
                    color: 'var(--surge-text-primary)', fontSize: 12,
                    fontFamily: 'monospace',
                  }}>
                    {svc} → {url}
                  </Typography>
                ))}
              </Stack>
              <Button
                size="small"
                onClick={applyAll}
                variant="contained"
                sx={{
                  background: 'var(--surge-brand)',
                  color: '#fff',
                  textTransform: 'none',
                  fontSize: 12,
                  '&:hover': { background: '#065a57' },
                }}
              >
                Mark all as external + fill URLs
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}


// Service metadata. Keys are lowercase identifiers used in
// contentEnhancement state. logo is null when no asset exists yet.
// repo is the canonical upstream git URL — the new backend will use
// these to clone whatever the user enables.
export const serviceMeta = {
  bazarr: {
    name: 'Bazarr',
    desc: 'Subtitle manager',
    logo: bazarrLogo,
    category: 'media',
    repo: 'https://github.com/morpheus65535/bazarr',
    compose: {
      image: 'linuxserver/bazarr:latest',
      ports: ['6767:6767'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:6767/ || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      // Same upfront-secret pattern as Servarr / Tautulli. Bazarr
      // accepts a pre-seeded apikey in [general] of config.ini and
      // skips auto-generating one. The configure script below uses
      // this same apiKey to authenticate when registering Sonarr /
      // Radarr connections via the API.
      //
      // Note Bazarr's nested config dir: the file lives at
      // /config/config/config.ini inside the container (LSIO's init
      // script puts data under /config/config/), hence the doubled
      // "config" segment in the host path token.
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configIni: {
          hostPath: 'configRoot/<service>/config/config.ini',
          // Bazarr autogenerates everything else missing; we only
          // need to pin the apikey so the configure script can
          // authenticate post-deploy.
          content:
            '[general]\n' +
            'apikey = ${apiKey}\n',
        },
      },
      mounts: [
        { src: 'mediaRoot/media',      dst: '/media' },
        { src: 'configRoot/<service>', dst: '/config' },
      ],
      postDeployScript: {
        // scripts/configure-bazarr.py registers Sonarr + Radarr
        // connections via Bazarr's /api/system/settings endpoint
        // using each *arr's apiKey secret. Idempotent.
        //
        // When the user picked Plex as the media server, the script
        // also wires Plex as a notification target (Apprise URL of
        // the form plex://?token=<X-Plex-Token>...). Bazarr fires
        // these notifications after subtitle download so Plex
        // refreshes the affected library item — keeps the on-screen
        // subtitle list in sync without the user manually rescanning.
        // PLEX_TOKEN comes from Plex's fetchScript output (plexToken
        // field), so this script is gated behind that fetch in the
        // backend's deploy-ordering graph.
        path: 'scripts/configure-bazarr.py',
        blocks: [],
        env: {
          // Same-service secret — Bazarr's apikey baked into config.ini.
          BAZARR_API_KEY: { fromSecret: 'apiKey' },
          // Cross-service secrets — Servarr apiKeys baked into their
          // own config.xml at deploy time. whenService gates each var
          // on the matching *arr being part of this deploy; the
          // configure-bazarr.py script already treats absent
          // *_API_KEY as "skip this *arr" so this is the right
          // declarative way to express the same thing.
          SONARR_API_KEY: {
            whenService:       'sonarr',
            fromServiceSecret: 'sonarr',
            secret:            'apiKey',
          },
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
          // Plex token comes from Plex's fetchScript output. Gated
          // behind whenMediaServer so the var is omitted entirely
          // (and the script skips the Plex notifier registration)
          // when the user picked Jellyfin or Emby instead.
          PLEX_TOKEN: {
            whenMediaServer: 'plex',
            fromService: 'plex',
            field: 'plexToken',
          },
        },
      },
    },
  },
  boxarr: {
    name: 'Boxarr',
    desc: 'Automatically track and add trending box office movies to your Radarr library',
    logo: boxarrLogo,
    category: 'metadata',
    repo: 'https://github.com/iongpt/boxarr',
    compose: {
      image: 'ghcr.io/iongpt/boxarr:latest',
      ports: ['8888:8888'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8888/api/health || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      mounts: [
        { src: 'configRoot/<service>', dst: '/config' },
      ],
      // Boxarr has no env-var support for Radarr config (only TZ +
      // BOXARR_URL_BASE). Connection is normally entered via the
      // setup wizard at /setup. The post-deploy script POSTs to
      // /api/config/save instead — same shape as Bazarr / Seerr.
      //
      // Idempotent via /api/health.radarr_configured. The whenService
      // gate omits both env vars entirely when Radarr isn't part of
      // this deploy; the script then sees an absent RADARR_API_KEY
      // and exits 0 with a "skipping — no Radarr to wire" log line.
      // Boxarr itself still comes up, user can wire a target via
      // /setup at their leisure.
      postDeployScript: {
        path: 'scripts/configure-boxarr.py',
        blocks: [],
        env: {
          // Static URL — Boxarr reaches sibling containers via host
          // networking, so localhost works for both reads (Radarr's
          // /api/v3/rootfolder lookups) and Boxarr's own internal
          // test-connection step. Gated on Radarr because there's no
          // point passing a URL the script can't authenticate against.
          RADARR_URL:     { whenService: 'radarr', value: 'http://localhost:7878' },
          // Cross-service secret. Surge generates Radarr's apiKey
          // upfront and bakes it into Radarr's config.xml, so it's
          // already-known by the time this script runs. The
          // whenService gate ensures the marker resolution doesn't
          // emit a placeholder for a service that isn't deployed.
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
        },
      },
    },
  },
  cinesync: {
    name: 'CineSync',
    desc: 'Media folder manager',
    logo: cinesyncLogo,
    category: 'media',
    repo: 'https://github.com/sureshfizzy/CineSync',
    compose: {
      image: 'sureshfizzy/cinesync:latest',
      ports: ['5173:5173', '8082:8082'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8082/api/config-status || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      // Pre-seed CineSync's dotenv config at /app/db/.env so the
      // container skips its first-launch web wizard and starts
      // organizing immediately. CineSync reads SOURCE_DIR and
      // DESTINATION_DIR from this file via godotenv at startup
      // (WebDavHub/pkg/config/config.go); when DESTINATION_DIR is
      // already set, the API's /api/config-status reports
      // needsConfiguration:false and the UI no longer demands setup.
      files: {
        envFile: {
          hostPath: 'configRoot/<service>/.env',
          content:
            '# Seeded by Surge — see AdditionalServicesStep.js cinesync entry.\n' +
            '# CineSync re-reads this on container start; edit and restart\n' +
            '# the container if you change paths or toggles post-deploy.\n' +
            '\n' +
            '# Sources to watch (comma-separated). /media/Intake is the\n' +
            '# parent of every Surge-managed downloader Intake folder\n' +
            '# (zurg, nzbdav, decypharr, sabnzbd, etc.). CineSync walks\n' +
            '# recursively so any enabled downloader gets discovered\n' +
            '# without needing to retemplate this file per deploy.\n' +
            'SOURCE_DIR=/media/Intake\n' +
            '\n' +
            '# Destination root. CineSync creates Movies/ and Shows/\n' +
            '# (always) plus AnimeMovies/AnimeShows/4KMovies/4KShows\n' +
            '# (only when the corresponding toggle below is true).\n' +
            '# Kept in its own tree (host: mediaRoot/media/output/CineSync,\n' +
            '# container: /media/output/CineSync) so it doesn\'t collide\n' +
            '# with Sonarr/Radarr-managed library paths (/media/tv,\n' +
            '# /media/movies). The *arrs continue to own their library\n' +
            '# trees; CineSync runs in parallel as an auto-organizer for\n' +
            '# downloaded content.\n' +
            'DESTINATION_DIR=/media/output/CineSync\n' +
            '\n' +
            '# Category-separation toggles, driven by the wizard\'s\n' +
            '# "CineSync settings" panel (Service Selection step). Both\n' +
            '# default off so the only folders CineSync creates by\n' +
            '# default are Movies/ and Shows/, which matches the two\n' +
            '# Plex libraries configure-plex.py auto-creates on the\n' +
            '# CineSync side. The same toggles drive Plex\'s library\n' +
            '# auto-creation — flipping a toggle on in the wizard adds\n' +
            '# both the CineSync subfolder AND the matching Plex\n' +
            '# library on next deploy.\n' +
            '#\n' +
            '# Pinned explicitly here because CineSync\'s upstream\n' +
            '# defaults are inconsistent between its Go service\n' +
            '# (defaults true) and Python service (defaults false for\n' +
            '# ANIME_SEPARATION); leaving these unset would leak that\n' +
            '# ambiguity into the deploy.\n' +
            'ANIME_SEPARATION=${cinesyncSettings.animeSeparation}\n' +
            '4K_SEPARATION=${cinesyncSettings.fourKSeparation}\n',
        },
      },
      mounts: [
        // /app/db holds both CineSync's persistent database AND the
        // seeded .env above. Mounting it from configRoot/<service>
        // lets the .env land where godotenv expects to read it
        // (CineSync's .env-resolution path is hardcoded to /app/db/).
        // Replaces the prior /app/data mount — that path isn't
        // CineSync's persistence root and the database was getting
        // wiped on every container restart.
        { src: 'configRoot/<service>', dst: '/app/db' },
        // Library + intake root — mediaRoot/media is the cross-service
        // shared media tree. CineSync sees /media/Intake/* as sources
        // and writes organized output to /media/output/CineSync/*.
        { src: 'mediaRoot/media',      dst: '/media'  },
        // Upstream's docker-compose example mounts $HOME → /home so
        // CineSync can index torrent downloads in the user's home
        // directory. Surge's download targets all live under
        // /media/Intake (zurg, nzbdav, sabnzbd, etc.), so the /home
        // mount is dropped here — it'd just be dead surface area.
      ],
    },
  },
  decypharr: {
    name: 'Decypharr',
    desc: 'qBittorrent-API w/ Debrid support',
    logo: decypharrLogo,
    category: 'downloads',
    repo: 'https://github.com/sirrobot01/decypharr',
    compose: {
      image: 'cy01/blackhole:latest',
      ports: ['8282:8282'],
      // Pre-seed /app/config.json with the user's debrid tokens from
      // the External APIs step. Decypharr reads this file at startup
      // (internal/config/config.go); the schema is `{ debrids: [...] }`
      // where each entry is `{ provider, name, api_key, ... }`. We
      // emit one entry per token the user actually entered — empty
      // tokens get skipped via JSON conditionals (writing an entry
      // with api_key: "" would cause Decypharr to fail auth on every
      // poll).
      //
      // Decypharr's supported providers (per the upstream README +
      // verified in debrid.go): realdebrid, alldebrid, debridlink,
      // torbox. Premiumize is NOT supported, so the wizard's
      // premiumizeApiToken doesn't apply here.
      files: {
        configJson: {
          hostPath: 'configRoot/<service>/config.json',
          // We can't use plain ${rdApiToken} substitution to "skip
          // empty entries" — template substitution always emits SOMETHING.
          // Instead we lean on Decypharr's config tolerance: an entry
          // with empty api_key just generates auth errors in its logs
          // until the user fills it in via the UI. That's noisier than
          // ideal but works as a starting config. Users with no debrid
          // accounts can delete the entries from /app/config.json.
          content:
            '{\n' +
            '  "debrids": [\n' +
            '    {\n' +
            '      "provider": "realdebrid",\n' +
            '      "name": "RealDebrid",\n' +
            '      "api_key": "${rdApiToken}",\n' +
            '      "folder": "/mnt/Intake/decypharr/realdebrid"\n' +
            '    },\n' +
            '    {\n' +
            '      "provider": "alldebrid",\n' +
            '      "name": "AllDebrid",\n' +
            '      "api_key": "${adApiToken}",\n' +
            '      "folder": "/mnt/Intake/decypharr/alldebrid"\n' +
            '    }\n' +
            '  ],\n' +
            '  "log_level": "info",\n' +
            '  "use_auth": false\n' +
            '}\n',
        },
      },
      mounts: [
        // /mnt is where Decypharr writes downloads (folder field above).
        // Surge maps it to mediaRoot/media so the *arrs see the same
        // tree at /media/Intake/decypharr/<provider>/.
        { src: 'mediaRoot/media',      dst: '/mnt' },
        { src: 'configRoot/<service>', dst: '/app' },
      ],
    },
  },
  episeerr: {
    name: 'Episeerr',
    desc: 'Per-episode request handling',
    logo: null,
    category: 'media',
    repo: 'https://github.com/Vansmak/episeerr',
    compose: {
      image: 'vansmak/episeerr:latest',
      ports: ['5002:5002'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:5002/ || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      mounts: [
        { src: 'configRoot/<service>',      dst: '/app/config' },
        { src: 'configRoot/<service>/logs', dst: '/app/logs'   },
        { src: 'configRoot/<service>/data', dst: '/app/data'   },
        { src: 'configRoot/<service>/temp', dst: '/app/temp'   },
      ],
      env: {
        // ---------------- External APIs ----------------
        // From the External APIs step. Empty string when user leaves
        // it blank — Episeerr handles that gracefully (TMDB lookups
        // fail back to TVDB and other fallbacks).
        TMDB_API_KEY:     { fromConfig: 'tmdbApiKey', defaultValue: '' },

        // ---------------- Sonarr ----------------
        // Static URL — host networking puts every Surge container on
        // localhost. whenService gates the var off entirely when
        // Sonarr isn't part of this deploy.
        SONARR_URL:       { whenService: 'sonarr', value: 'http://localhost:8989' },
        // apiKey baked into Sonarr's config.xml upfront via Surge's
        // upfront-secret pattern. No runtime fetching.
        SONARR_API_KEY: {
          whenService:       'sonarr',
          fromServiceSecret: 'sonarr',
          secret:            'apiKey',
        },

        // ---------------- Radarr ----------------
        // Same shape as Sonarr — Episeerr's per-episode model also
        // includes movie request handling that wires through Radarr.
        RADARR_URL:       { whenService: 'radarr', value: 'http://localhost:7878' },
        RADARR_API_KEY: {
          whenService:       'radarr',
          fromServiceSecret: 'radarr',
          secret:            'apiKey',
        },

        // ---------------- Tautulli ----------------
        // Watch progress / play activity. Episeerr uses Tautulli to
        // detect when an episode finishes so it can prefetch the next
        // one. Surge upfront-generates Tautulli's apikey into config.ini.
        TAUTULLI_URL:     { whenService: 'tautulli', value: 'http://localhost:8181' },
        TAUTULLI_API_KEY: {
          whenService:       'tautulli',
          fromServiceSecret: 'tautulli',
          secret:            'apiKey',
        },

        // ---------------- Plex ----------------
        // PLEX_TOKEN comes from Plex's fetchScript (fetch-plex-secrets.py
        // reads PlexOnlineToken from Preferences.xml after first launch)
        // — a runtime-fetch handoff, not an upfront secret. Episeerr
        // accepts PLEX_TOKEN as the X-Plex-Token API auth value;
        // upstream also accepts PLEX_API_KEY as a fallback alias.
        PLEX_URL:         { whenMediaServer: 'plex', value: 'http://localhost:32400' },
        PLEX_TOKEN: {
          whenMediaServer: 'plex',
          fromService:     'plex',
          field:           'plexToken',
        },

        // ---------------- Jellyfin ----------------
        // Both apiKey and userId come from Jellyfin's fetchScript
        // output — Jellyfin generates its own credentials at first run.
        JELLYFIN_URL:     { whenMediaServer: 'jellyfin', value: 'http://localhost:8096' },
        JELLYFIN_API_KEY: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'apiKey' },
        JELLYFIN_USER_ID: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'userId' },

        // ---------------- Emby ----------------
        // Same shape as Jellyfin — Emby is Jellyfin's progenitor,
        // same default port (8096), same {apiKey, userId} fetchScript
        // output shape from fetch-emby-secrets.py.
        EMBY_URL:         { whenMediaServer: 'emby', value: 'http://localhost:8096' },
        EMBY_API_KEY:     { whenMediaServer: 'emby', fromService: 'emby', field: 'apiKey' },
        EMBY_USER_ID:     { whenMediaServer: 'emby', fromService: 'emby', field: 'userId' },

        // ---------------- Prowlarr / SABnzbd ----------------
        // Episeerr loads these as plugin integrations but doesn't
        // accept their config via env vars (upstream
        // settings_db.py — env-var loading is hardcoded to
        // Sonarr/Tautulli/Plex/Jellyfin/Emby only). Wired instead by
        // postDeployScript below, which POSTs to Episeerr's
        // /api/save-service/<plugin> endpoint.
      },
      postDeployScript: {
        // scripts/configure-episeerr.py registers Prowlarr + SABnzbd
        // via Episeerr's REST API (POST /api/test-connection then
        // POST /api/save-service). Idempotent — Episeerr's settings.db
        // uses ON CONFLICT ... DO UPDATE so re-runs just refresh the
        // same record. Skips a service entirely when its API_KEY env
        // var isn't set (whenService gating below means each KEY is
        // only emitted when the matching service is part of the deploy).
        path: 'scripts/configure-episeerr.py',
        blocks: [],
        env: {
          // Prowlarr — Surge upfront-generates apiKey into Prowlarr's
          // config.xml; we reach the live Prowlarr instance via host
          // networking on its standard port.
          PROWLARR_URL:     { whenService: 'prowlarr', value: 'http://localhost:9696' },
          PROWLARR_API_KEY: {
            whenService:       'prowlarr',
            fromServiceSecret: 'prowlarr',
            secret:            'apiKey',
          },
          // SABnzbd — Surge now upfront-seeds api_key into
          // sabnzbd.ini (compose.secrets.apiKey + compose.files.configIni
          // on the sabnzbd entry above). configure-episeerr.py reads
          // it here via the same fromServiceSecret pattern.
          SABNZBD_URL:      { whenService: 'sabnzbd', value: 'http://localhost:8080' },
          SABNZBD_API_KEY: {
            whenService:       'sabnzbd',
            fromServiceSecret: 'sabnzbd',
            secret:            'apiKey',
          },
        },
      },
    },
  },
  flaresolverr: {
    name: 'Flaresolverr',
    desc: 'Cloudflare bypass proxy',
    logo: flaresolverrLogo,
    category: 'indexers',
    repo: 'https://github.com/FlareSolverr/FlareSolverr',
    compose: {
      image: 'flaresolverr/flaresolverr:latest',
      ports: ['8191:8191'],
      mounts: [],
      env: {
        LOG_LEVEL: 'info',
      },
    },
  },
  gaps: {
    name: 'GAPS',
    desc: 'Missing movies finder',
    logo: gapsLogo,
    category: 'media',
    repo: 'https://github.com/JasonHHouse/gaps',
    compose: {
      image: 'housewrecker/gaps:latest',
      ports: ['8484:8484'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/usr/data' },
      ],
      // NOTE on automation: GAPS is a Java/Spring Boot app whose
      // settings live in a SQLite-backed JPA repository (Plex
      // server tokens, Radarr instance configs, TMDB API key). The
      // first-run flow is fully UI-driven — the user logs in,
      // adds Plex servers via OAuth-style claim flow, adds Radarr
      // instances by URL+key. Surge doesn't automate this because
      // (a) the Plex flow needs the user's plex.tv credentials we
      // don't ask for, and (b) GAPS's REST endpoints aren't well-
      // documented enough to script against without per-version
      // drift risk.
      //
      // After this container starts, point your browser at
      // http://your-server:8484, sign in with the default admin
      // credentials, paste your TMDB API key, and add Plex +
      // Radarr connections via the Settings page. ~5 minutes of
      // UI clicks.
      env: {
        ENABLE_SSL:   'false',
        ENABLE_LOGIN: 'false',
        BASE_URL:     '/',
      },
    },
  },
  kometa: {
    name: 'Kometa',
    desc: 'Collection and metadata manager',
    logo: kometaLogo,
    category: 'metadata',
    repo: 'https://github.com/kometa-team/kometa',
    compose: {
      image: 'lscr.io/linuxserver/kometa:latest',
      // Kometa runs scheduled CLI passes — no web UI, no exposed port.
      ports: [],
      mounts: [
        { src: 'mediaRoot/media/assets',                                          dst: '/assets' },
        { src: 'configRoot/plex/Library/Application Support/Plex Media Server/', dst: '/plex'   },
        { src: 'configRoot/radarr',                                               dst: '/radarr' },
        { src: 'configRoot/sonarr',                                               dst: '/sonarr' },
        { src: 'mediaRoot/media/movies',                                          dst: '/movies' },
        { src: 'configRoot/<service>',                                            dst: '/config' },
      ],
      env: {
        KOMETA_TIMES:      '00:00',
        KOMETA_RUN:        'False',
        KOMETA_TESTS:      'False',
        KOMETA_NO_MISSING: 'True',
      },
      postDeployScript: {
        // scripts/configure-kometa.py builds /config/config.yml from
        // env vars after Plex's fetchScript has captured the token.
        // Atomic write (temp file + rename) so a partial write can't
        // corrupt the file mid-replace. Idempotent — re-runs overwrite
        // the same file with the same content.
        //
        // Kometa is Plex-only (no Jellyfin/Emby). When the user picked
        // a non-Plex media server, PLEX_TOKEN is gated off and the
        // script exits 0 without writing config.yml. Kometa will boot
        // but its scheduled passes fail loudly until the user either
        // provides config.yml manually or switches to Plex.
        path: 'scripts/configure-kometa.py',
        blocks: [],
        env: {
          // Resolved by the orchestrator to the host path of
          // configRoot/kometa/config.yml. Same path-token-resolution
          // pattern as configure-nzbdav.py's RCLONE_CONF_PATH.
          KOMETA_CONFIG_PATH: 'configRoot/<service>/config.yml',
          // Plex — required for Kometa.
          PLEX_URL:   { whenMediaServer: 'plex', value: 'http://localhost:32400' },
          PLEX_TOKEN: {
            whenMediaServer: 'plex',
            fromService:     'plex',
            field:           'plexToken',
          },
          // TMDB — from the External APIs step. Required for Kometa
          // metadata operations to work.
          TMDB_API_KEY: { fromConfig: 'tmdbApiKey', defaultValue: '' },
          // Optional Sonarr/Radarr — Kometa uses these for collection
          // operations like "add missing" or library cleanup. Gated on
          // each *arr being part of this deploy.
          SONARR_URL: { whenService: 'sonarr', value: 'http://localhost:8989' },
          SONARR_API_KEY: {
            whenService:       'sonarr',
            fromServiceSecret: 'sonarr',
            secret:            'apiKey',
          },
          RADARR_URL: { whenService: 'radarr', value: 'http://localhost:7878' },
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
        },
      },
    },
  },
  mdblistarr: {
    name: 'mdblistarr',
    desc: 'MDBList integration',
    logo: mdblistarrLogo,
    category: 'metadata',
    repo: 'https://github.com/linaspurinis/mdblistarr',
    compose: {
      image: 'linaspurinis/mdblistarr:latest',
      ports: ['5353:5353'],
      mounts: [
        { src: 'configRoot/<service>/db', dst: '/usr/src/db' },
      ],
      env: {
        CA_TS_FALLBACK_DIR: '/usr/src/db',
        // Best-effort env-var pass-through. mdblistarr's upstream
        // README is sparse on documented env vars; these match the
        // common Python-app convention. If the upstream service
        // doesn't read them, no harm done — vars just sit unused
        // and the user falls back to UI configuration via /settings
        // on the running container at port 5353.
        MDBLIST_API_KEY: { fromConfig: 'mdblistApiKey', defaultValue: '' },
        SONARR_URL:     { whenService: 'sonarr', value: 'http://localhost:8989' },
        SONARR_API_KEY: {
          whenService:       'sonarr',
          fromServiceSecret: 'sonarr',
          secret:            'apiKey',
        },
        RADARR_URL:     { whenService: 'radarr', value: 'http://localhost:7878' },
        RADARR_API_KEY: {
          whenService:       'radarr',
          fromServiceSecret: 'radarr',
          secret:            'apiKey',
        },
      },
    },
  },
  nzbdav: {
    name: 'NzbDAV',
    desc: 'WebDAV layer for usenet content',
    logo: nzbdavLogo,
    category: 'downloads',
    repo: 'https://github.com/nzbdav-dev/nzbdav',
    // Multi-container service mirroring zurg's structure: nzbdav serves
    // the WebDAV; rclone FUSE-mounts it so *arr containers see the
    // library as a regular directory tree. NzbDAV doesn't support env-
    // var credential bootstrap (creds are stored in db.sqlite from the
    // first-run UI), so a post-deploy configure script automates the
    // setup form using the generated webdavPassword secret, then runs
    // `rclone obscure` and writes rclone.conf. The rclone sub-container
    // is blocked from starting until the configure script succeeds.
    compose: {
      secrets: {
        // Admin account password (web UI login + WebDAV auth for rclone).
        // configure-nzbdav.py uses this to create the admin account; the
        // generated rclone.conf references it in obscured form (rclone
        // obscure runs in the script).
        webdavPassword: { generate: 'random', length: 32 },
        // FRONTEND_BACKEND_API_KEY env var that nzbdav reads at startup.
        // Every /api/* call must send this back as the X-Api-Key header
        // (or `?apikey=`). configure-nzbdav.py uses it to authenticate
        // when calling /api/create-account.
        frontendBackendApiKey: { generate: 'random', length: 64 },
      },
      services: {
        nzbdav: {
          // Pre-release tag per upstream — bump when a stable image lands.
          image: 'nzbdav/nzbdav:alpha',
          // Bridge networking required so rclone reaches nzbdav by
          // service name (http://nzbdav:3000) on the internal network.
          networkMode: 'bridge',
          ports: ['3000:3000'],
          mounts: [
            { src: 'configRoot/<service>', dst: '/config' },
          ],
          env: {
            // Required by nzbdav's BaseApiController auth check —
            // every /api/* request must echo this value back as the
            // X-Api-Key header. Surge generates the secret at install
            // and passes the same value to configure-nzbdav.py.
            FRONTEND_BACKEND_API_KEY: { fromSecret: 'frontendBackendApiKey' },
          },
        },
        rclone: {
          image: 'rclone/rclone:latest',
          networkMode: 'bridge',
          capAdd:      ['SYS_ADMIN'],
          securityOpt: ['apparmor:unconfined'],
          devices:     ['/dev/fuse:/dev/fuse:rwm'],
          command:
            'mount nzbdav: /nzbdav --allow-other --allow-non-empty ' +
            '--dir-cache-time 10s ' +
            '--vfs-cache-mode full --vfs-cache-max-size 50G --vfs-cache-max-age 1h ' +
            '--buffer-size 64M --vfs-read-ahead 256M',
          mounts: [
            { src: 'mediaRoot/media/Intake/nzbdav',    dst: '/nzbdav', options: 'rshared' },
            // rclone.conf is written by configure-nzbdav.py (not by
            // compose.files) because it needs the obscured form of the
            // password, which only `rclone obscure` can compute.
            { src: 'configRoot/<service>/rclone.conf', dst: '/config/rclone/rclone.conf' },
            { src: 'mediaRoot/<service>/rclone-cache', dst: '/cache' },
          ],
          dependsOn: { nzbdav: {} },
        },
      },
      postDeployScript: {
        // scripts/configure-nzbdav.py implements the post-deploy flow:
        //   1. Polls /api/is-onboarding (with X-Api-Key header) until
        //      nzbdav's listener is ready.
        //   2. POSTs /api/create-account (form-encoded) with
        //      username=admin, password=${webdavPassword}, type=Admin.
        //   3. Runs `docker run --rm rclone/rclone obscure <password>`
        //      to compute the obscured password rclone.conf wants.
        //   4. Writes rclone.conf to configRoot/<service>/rclone.conf
        //      so the rclone sub-container can mount the WebDAV.
        //   5. Exits 0 to unblock the rclone sub-container (named in
        //      the blocks array — the orchestrator defers
        //      `docker compose up rclone` until this script returns).
        path: 'scripts/configure-nzbdav.py',
        blocks: ['rclone'],
        env: {
          NZBDAV_PASSWORD:  { fromSecret: 'webdavPassword' },
          NZBDAV_API_KEY:   { fromSecret: 'frontendBackendApiKey' },
          // Resolved by the orchestrator to a host path. Token-prefixed
          // values get token-substituted at script-invoke time
          // (orchestrator's ScriptRunner handles this).
          RCLONE_CONF_PATH: 'configRoot/<service>/rclone.conf',
        },
      },
    },
  },
  posterizarr: {
    name: 'Posterizarr',
    desc: 'Poster automation',
    logo: posterizarrLogo,
    category: 'metadata',
    repo: 'https://github.com/fscorrupt/posterizarr',
    compose: {
      image: 'ghcr.io/fscorrupt/posterizarr:latest',
      ports: ['8000:8000'],
      mounts: [
        { src: 'mediaRoot/media',                dst: '/media'        },
        { src: 'configRoot/<service>',           dst: '/config'       },
        // /assets and /manualassets intentionally share the same host
        // path so the app's auto-generated and user-supplied assets
        // sit in one directory.
        { src: 'mediaRoot/media/assets',         dst: '/assets'       },
        { src: 'mediaRoot/media/assets',         dst: '/manualassets' },
        { src: 'mediaRoot/media/assetsbackup',   dst: '/assetsbackup' },
      ],
      env: {
        RUN_TIME: '22:00',
        TERM:     'xterm',
      },
      postDeployScript: {
        // scripts/configure-posterizarr.py builds /config/config.json
        // from env vars after Plex's fetchScript has captured the
        // X-Plex-Token. Atomic write (temp + rename). Same pattern as
        // configure-kometa.py — Posterizarr is Plex-only, no web UI,
        // config-file driven.
        path: 'scripts/configure-posterizarr.py',
        blocks: [],
        env: {
          POSTERIZARR_CONFIG_PATH: 'configRoot/<service>/config.json',
          PLEX_URL:   { whenMediaServer: 'plex', value: 'http://localhost:32400' },
          PLEX_TOKEN: {
            whenMediaServer: 'plex',
            fromService:     'plex',
            field:           'plexToken',
          },
          TMDB_API_KEY:   { fromConfig: 'tmdbApiKey',   defaultValue: '' },
          FANART_API_KEY: { fromConfig: 'fanartApiKey', defaultValue: '' },
          TVDB_API_KEY:   { fromConfig: 'tvdbApiKey',   defaultValue: '' },
        },
      },
    },
  },
  prowlarr: {
    name: 'Prowlarr',
    desc: 'Indexer manager',
    logo: prowlarrLogo,
    category: 'indexers',
    repo: 'https://github.com/prowlarr/prowlarr',
    compose: {
      image: 'lscr.io/linuxserver/prowlarr:latest',
      ports: ['9696:9696'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:9696/ping || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '90s',
      },
      // Secret-driven config.xml — Surge generates apiKey, writes a
      // starter config.xml before container start, and passes the same
      // value to configure-prowlarr.py for API auth. Same pattern as
      // every Surge-deployed *arr.
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configXml: {
          hostPath: 'configRoot/<service>/config.xml',
          // Servarr config.xml — minimal but enough to stop Prowlarr
          // from auto-generating its own ApiKey on first run.
          // AuthenticationRequired=DisabledForLocalAddresses lets LAN
          // users access the UI without a login while still requiring
          // auth for any non-local request.
          content:
            '<Config>\n' +
            '  <ApiKey>${apiKey}</ApiKey>\n' +
            '  <AuthenticationMethod>External</AuthenticationMethod>\n' +
            '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>\n' +
            '  <UpdateMechanism>Docker</UpdateMechanism>\n' +
            '  <LogLevel>info</LogLevel>\n' +
            '</Config>\n',
        },
      },
      mounts: [
        { src: 'mediaRoot/media',                          dst: '/media'                     },
        // Nested mount: shared community indexer-defs folder shows
        // through at /config/Definitions/Custom, overriding that
        // subdirectory of the broader /config mount below.
        // configure-prowlarr.py git-clones dreulavelle/Prowlarr-Indexers
        // into the parent of this path post-deploy.
        { src: 'configRoot/Prowlarr-Indexers/Custom',      dst: '/config/Definitions/Custom' },
        { src: 'configRoot/<service>',                     dst: '/config'                    },
      ],
      postDeployScript: {
        // scripts/configure-prowlarr.py:
        //   1. Waits for /api/v1/system/status (X-Api-Key auth).
        //   2. Clones dreulavelle/Prowlarr-Indexers into
        //      configRoot/Prowlarr-Indexers/ so /config/Definitions/Custom
        //      is populated. Pulls instead if already present.
        //   3. Registers each enabled *arr (sonarr/radarr) as a Prowlarr
        //      Application via POST /api/v1/applications, using each
        //      *arr's own apiKey secret.
        //   4. If zilean is enabled, registers it as a Torznab indexer.
        path: 'scripts/configure-prowlarr.py',
        blocks: [],
        env: {
          PROWLARR_API_KEY: { fromSecret: 'apiKey' },
          // Sonarr / Radarr cross-service refs — gated on each *arr
          // being part of this deploy. configure-prowlarr.py's
          // `if sonarr_url and sonarr_api_key:` checks let it skip
          // either *arr cleanly when its env is absent.
          SONARR_URL: { whenService: 'sonarr', value: 'http://localhost:8989' },
          SONARR_API_KEY: {
            whenService:       'sonarr',
            fromServiceSecret: 'sonarr',
            secret:            'apiKey',
          },
          RADARR_URL: { whenService: 'radarr', value: 'http://localhost:7878' },
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
          // Zilean Torznab indexer registration — Zilean has no API
          // key (Torznab indexers don't need one), so URL is enough.
          ZILEAN_URL: { whenService: 'zilean', value: 'http://localhost:8181' },
          // Resolved by the orchestrator to a host path. The
          // git-clone destination for dreulavelle/Prowlarr-Indexers.
          INDEXERS_DEST: 'configRoot/Prowlarr-Indexers',
        },
      },
    },
  },
  pulsarr: {
    name: 'Pulsarr',
    desc: 'Plex watchlist sync to *arr',
    logo: pulsarrLogo,
    category: 'requests',
    repo: 'https://github.com/jamcalli/pulsarr',
    compose: {
      image: 'lakker/pulsarr:latest',
      ports: ['3003:3003'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:3003/api/v1/config || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/data' },
      ],
      env: {
        // camelCase per Pulsarr's own config schema (upstream docs).
        // Service-integration env vars (sonarrBaseUrl, plexTokens, etc.)
        // are NOT set here — they're wired post-deploy via the REST
        // API (see postDeployScript below). Reason: plexTokens needs
        // to be a JSON array string and Plex's X-Plex-Token is
        // runtime-fetched, so wrapping it inside a literal env var
        // doesn't fit the schema. The API path handles all three
        // integrations with a single source of truth (Pulsarr's DB).
        cookieSecured:         'false',
        basePath:              '/',
        authenticationMethod:  'required',
        allowIframes:          'false',
        enableRequestLogging:  'false',
        dbType:                'sqlite',
        dbHost:                'localhost',
        dbPort:                '5432',
        dbName:                'pulsarr',
        dbUser:                'postgres',
        dbPassword:            'pulsarrdb',
        CA_TS_FALLBACK_DIR:    '/app/data',
      },
      postDeployScript: {
        // scripts/configure-pulsarr.py:
        //   1. Polls /api/v1/config until Pulsarr is up.
        //   2. GETs current config (idempotency + merge baseline).
        //   3. PUTs back with plexTokens (JSON array), sonarrBaseUrl,
        //      sonarrApiKey, radarrBaseUrl, radarrApiKey — only the
        //      fields the env passes in. Skips entirely when none of
        //      the three integrations are part of this deploy.
        path: 'scripts/configure-pulsarr.py',
        blocks: [],
        env: {
          // Plex token — Pulsarr only supports Plex watchlist sync
          // (no Jellyfin/Emby equivalent), so gated on the user
          // having picked Plex. The token is the plex.tv account
          // token (same value Plex's fetchScript captures from
          // Preferences.xml — Plex stores the user's account token
          // there after server claim).
          PLEX_TOKEN: {
            whenMediaServer: 'plex',
            fromService:     'plex',
            field:           'plexToken',
          },
          // Sonarr — Pulsarr creates show requests in Sonarr from
          // the watchlist. Gated on Sonarr being enabled.
          SONARR_URL:     { whenService: 'sonarr', value: 'http://localhost:8989' },
          SONARR_API_KEY: {
            whenService:       'sonarr',
            fromServiceSecret: 'sonarr',
            secret:            'apiKey',
          },
          // Radarr — Pulsarr creates movie requests in Radarr from
          // the watchlist. Gated on Radarr being enabled.
          RADARR_URL:     { whenService: 'radarr', value: 'http://localhost:7878' },
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
        },
      },
    },
  },
  radarr: {
    name: 'Radarr',
    desc: 'Movie manager',
    logo: radarrLogo,
    category: 'media',
    repo: 'https://github.com/Radarr/Radarr',
    compose: {
      image: 'lscr.io/linuxserver/radarr:latest',
      ports: ['7878:7878'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:7878/ping || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '90s',
      },
      // Same secret-driven config.xml pattern as Prowlarr — the apiKey
      // is referenced by configure-prowlarr.py (Radarr → Prowlarr
      // app registration), configure-bazarr.py (Radarr → Bazarr poll),
      // configure-boxarr.py (Boxarr → Radarr movie adding), and by
      // configure-radarr.py for the cross-service wiring below.
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configXml: {
          hostPath: 'configRoot/<service>/config.xml',
          content:
            '<Config>\n' +
            '  <ApiKey>${apiKey}</ApiKey>\n' +
            '  <AuthenticationMethod>External</AuthenticationMethod>\n' +
            '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>\n' +
            '  <UpdateMechanism>Docker</UpdateMechanism>\n' +
            '  <LogLevel>info</LogLevel>\n' +
            '</Config>\n',
        },
      },
      postDeployScript: {
        // scripts/configure-radarr.py — same shape as
        // configure-sonarr.py but for the movie side. Adds
        // /media/movies root folder + SABnzbd download client
        // (category=movies) + remote path mapping. See
        // configure-sonarr.py docstring for the why-of-everything.
        path: 'scripts/configure-radarr.py',
        blocks: [],
        env: {
          RADARR_API_KEY: { fromSecret: 'apiKey' },
          SABNZBD_URL: { whenService: 'sabnzbd', value: 'http://localhost:8080' },
          SABNZBD_API_KEY: {
            whenService:       'sabnzbd',
            fromServiceSecret: 'sabnzbd',
            secret:            'apiKey',
          },
        },
      },
      mounts: [
        // Library — same root as every other /media mount across Surge.
        { src: 'mediaRoot/media',          dst: '/media'        },
        // Cache-side intake folder, nested under /media.
        { src: 'mediaRoot/media/Intake',   dst: '/media/Intake' },
        // Direct cache-pool path for hardlink-safe staging.
        { src: 'mediaRoot/media',          dst: '/cache'        },
        { src: 'configRoot/<service>',     dst: '/config'       },
      ],
    },
  },
  'rdt-client': {
    name: 'rdt-client',
    desc: 'Real-Debrid torrent client',
    logo: rdtClientLogo,
    category: 'downloads',
    repo: 'https://github.com/rogerfar/rdt-client',
    compose: {
      image: 'rogerfar/rdtclient:latest',
      ports: ['6500:6500'],
      // NOTE on automation: rdt-client's settings live in SQLite
      // (/data/db) and its REST API requires admin auth, which means
      // registering a user via the UI first. Surge doesn't automate
      // that flow — it'd require generating an admin password the
      // user doesn't know and then communicating it to them, plus
      // navigating cross-version drift in the auth + settings
      // endpoints. After this container starts, point your browser
      // at http://your-server:6500, register an admin account, and
      // paste your Real-Debrid token (External APIs step) into the
      // Settings page. Two clicks. Decypharr's config.json IS
      // automated above — most users use one or the other; if you
      // already have RD wired through Decypharr you don't need this.
      mounts: [
        { src: 'configRoot/<service>/db',                   dst: '/data/db'        },
        // Capital Intake to align with Radarr's intake folder; rdt-client
        // drops debrid-pulled torrents into a zurg/__all__ subtree there.
        { src: 'mediaRoot/media/Intake/zurg/__all__',       dst: '/data/downloads' },
      ],
    },
  },
  sabnzbd: {
    name: 'SABnzbd',
    desc: 'Usenet downloader',
    logo: sabnzbdLogo,
    category: 'downloads',
    repo: 'https://github.com/sabnzbd/sabnzbd',
    compose: {
      image: 'lscr.io/linuxserver/sabnzbd:latest',
      ports: ['8080:8080'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8080/ || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      // Same upfront-secret pattern as Tautulli / Bazarr / Prowlarr.
      // SABnzbd auto-generates its own api_key on first launch into
      // /config/sabnzbd.ini under [misc]; pre-seeding it lets every
      // Surge consumer (Episeerr, future Sonarr/Radarr download-client
      // wiring, configure-episeerr.py, etc.) reference SABnzbd's apiKey
      // via fromServiceSecret without runtime fetching.
      //
      // host_whitelist allows the *arrs and Episeerr to reach SABnzbd
      // by container name as well as localhost — required because
      // SABnzbd's default config rejects requests from non-localhost
      // hostnames as a security measure (CVE-class issue if disabled
      // on a public-facing instance, but Surge containers are on a
      // private host network).
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configIni: {
          hostPath: 'configRoot/<service>/sabnzbd.ini',
          content:
            '[misc]\n' +
            'api_key = ${apiKey}\n' +
            'host_whitelist = sabnzbd, localhost\n' +
            'disable_api_key = 0\n' +
            'host = 0.0.0.0\n' +
            'port = 8080\n',
        },
      },
      mounts: [
        { src: 'mediaRoot/media/Intake/incomplete', dst: '/incomplete-downloads' },
        { src: 'mediaRoot/media/Intake/downloads',  dst: '/downloads'            },
        { src: 'configRoot/<service>',              dst: '/config'               },
      ],
    },
  },
  seasonarr: {
    name: 'Seasonarr',
    desc: 'Season-pack management for Sonarr',
    logo: seasonarrLogo,
    category: 'media',
    repo: 'https://github.com/d3v1l1989/seasonarr',
    compose: {
      image: 'ghcr.io/d3v1l1989/seasonarr:latest',
      // Bridge mode overrides the Surge-wide host networking default —
      // Seasonarr's listen port (8000) collides with Posterizarr under
      // host networking, so we remap to host port 8500 via bridge.
      networkMode: 'bridge',
      ports: ['8500:8000'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/data' },
      ],
      // NOTE on automation: Seasonarr stores Sonarr instance
      // configurations in its SQLite database (/app/data/seasonarr.db)
      // and exposes a JWT-protected REST API for managing them.
      // First-run flow expects the user to register an admin account,
      // log in, and add their Sonarr instance via the UI — same auth-
      // flow gauntlet as rdt-client (and per-version drift risk on
      // the API endpoints). Surge doesn't automate this; user adds
      // Sonarr at http://your-server:8500 after deploy. The Sonarr
      // apiKey is available in your saved state.json under
      // `secrets["sonarr.apiKey"]`.
      env: {
        DATABASE_URL: 'sqlite:///./data/seasonarr.db',
        // Backend's compose generator emits a unique 64-char crypto-random
        // string per Surge install and persists it so it survives restarts.
        // See SURGE_COMPOSE_DEFAULTS comment for the full env-marker schema.
        JWT_SECRET_KEY: { generate: 'random', length: 64 },
      },
    },
  },
  seerr: {
    name: 'Seerr',
    desc: 'Media requests (formerly Overseerr)',
    logo: seerrLogo,
    category: 'requests',
    repo: 'https://github.com/seerr-team/seerr',
    compose: {
      image: 'ghcr.io/seerr-team/seerr:latest',
      ports: ['5055:5055'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:5055/api/v1/status || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      // Same upfront-secret pattern as Servarr / Bazarr / Tautulli.
      // Seerr (Overseerr fork) reads apiKey from /app/config/settings.json
      // on startup. Pre-seeding it lets configure-seerr.py authenticate
      // against Seerr's API immediately to register *arr connections.
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        settingsJson: {
          hostPath: 'configRoot/<service>/settings.json',
          // Seerr writes the rest of settings.json on first run; only
          // apiKey needs to be pinned. Stored in two places (root and
          // main.apiKey) because different Overseerr versions have
          // moved it around — both are read with fallback.
          content:
            '{\n' +
            '  "apiKey": "${apiKey}",\n' +
            '  "main": {\n' +
            '    "apiKey": "${apiKey}"\n' +
            '  }\n' +
            '}\n',
        },
      },
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/config' },
      ],
      env: {
        LOG_LEVEL:          'debug',
        CA_TS_FALLBACK_DIR: '/app/config',
      },
      postDeployScript: {
        // scripts/configure-seerr.py registers Sonarr + Radarr
        // connections via /api/v1/settings/sonarr and /radarr.
        // Plex/Jellyfin/Emby server config is left for the user to
        // complete via the UI on first visit (it requires Plex SSO
        // or library-discovery flows that don't fit a one-shot
        // post-deploy script).
        path: 'scripts/configure-seerr.py',
        blocks: [],
        env: {
          SEERR_API_KEY: { fromSecret: 'apiKey' },
          SONARR_URL: { whenService: 'sonarr', value: 'http://localhost:8989' },
          SONARR_API_KEY: {
            whenService:       'sonarr',
            fromServiceSecret: 'sonarr',
            secret:            'apiKey',
          },
          RADARR_URL: { whenService: 'radarr', value: 'http://localhost:7878' },
          RADARR_API_KEY: {
            whenService:       'radarr',
            fromServiceSecret: 'radarr',
            secret:            'apiKey',
          },
        },
      },
    },
  },
  sonarr: {
    name: 'Sonarr',
    desc: 'TV series manager',
    logo: sonarrLogo,
    category: 'media',
    repo: 'https://github.com/Sonarr/Sonarr',
    compose: {
      image: 'lscr.io/linuxserver/sonarr:latest',
      ports: ['8989:8989'],
      // /ping is unauthenticated and returns 200 OK once Sonarr's
      // listener is up. wget is in every linuxserver/* image. The 90s
      // start_period gives Sonarr's first-run init time to seed the
      // database before docker compose flags it unhealthy.
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8989/ping || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '90s',
      },
      // Same secret-driven config.xml pattern as Prowlarr — the apiKey
      // is referenced by configure-prowlarr.py to register Sonarr as a
      // Prowlarr Application AND by configure-sonarr.py for cross-service
      // wiring (download client, remote path mapping).
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configXml: {
          hostPath: 'configRoot/<service>/config.xml',
          content:
            '<Config>\n' +
            '  <ApiKey>${apiKey}</ApiKey>\n' +
            '  <AuthenticationMethod>External</AuthenticationMethod>\n' +
            '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>\n' +
            '  <UpdateMechanism>Docker</UpdateMechanism>\n' +
            '  <LogLevel>info</LogLevel>\n' +
            '</Config>\n',
        },
      },
      postDeployScript: {
        // scripts/configure-sonarr.py:
        //   1. Adds /media/tv as a root folder so the user can add shows.
        //   2. When SABnzbd is enabled: registers it as a download
        //      client (category=tv) AND adds a remote path mapping
        //      from SABnzbd's /downloads/ to Sonarr's /media/Intake/
        //      downloads/. Same host folder via different in-container
        //      paths — Sonarr won't import without the mapping.
        //   3. Idempotent on all three.
        path: 'scripts/configure-sonarr.py',
        blocks: [],
        env: {
          SONARR_API_KEY: { fromSecret: 'apiKey' },
          // SABnzbd download client wiring — gated on SABnzbd being
          // enabled. Both URL and KEY get omitted via whenService when
          // it isn't, and the script's "if SABNZBD_API_KEY" branch
          // skips the download-client + remote-path-mapping steps.
          SABNZBD_URL: { whenService: 'sabnzbd', value: 'http://localhost:8080' },
          SABNZBD_API_KEY: {
            whenService:       'sabnzbd',
            fromServiceSecret: 'sabnzbd',
            secret:            'apiKey',
          },
        },
      },
      mounts: [
        // Library — same root as every other /media mount across Surge.
        { src: 'mediaRoot/media',          dst: '/media'        },
        // Cache-side intake folder, nested under /media.
        { src: 'mediaRoot/media/Intake',   dst: '/media/Intake' },
        // Direct cache-pool path for hardlink-safe staging.
        { src: 'mediaRoot/media',          dst: '/cache'        },
        { src: 'configRoot/<service>',     dst: '/config'       },
      ],
    },
  },
  tautulli: {
    name: 'Tautulli',
    desc: 'Plex analytics',
    logo: tautulliLogo,
    category: 'monitoring',
    repo: 'https://github.com/tautulli/tautulli',
    compose: {
      image: 'lscr.io/linuxserver/tautulli:latest',
      ports: ['8181:8181'],
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8181/ || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
      // Same upfront-secret pattern as Servarr services. Tautulli
      // accepts a pre-seeded api_key in [General] of config.ini —
      // it only auto-generates one when the field is missing or
      // doesn't pass its 32-char-length sanity check. By writing the
      // file before first launch, Surge skips the runtime-fetch step
      // that previously lived in scripts/fetch-tautulli-secrets.py.
      //
      // The Plex server connection is wired post-deploy by
      // configure-tautulli.py — that runs after Plex's fetchScript
      // has captured the X-Plex-Token, so it has everything needed
      // to set the [PMS] section via Tautulli's API. See the
      // postDeployScript block below.
      secrets: {
        apiKey: { generate: 'random', length: 32 },
      },
      files: {
        configIni: {
          hostPath: 'configRoot/<service>/config.ini',
          // Minimal: Tautulli auto-fills every field it expects but
          // doesn't see, so we only need to set api_key. Any user
          // changes via the UI later are preserved.
          content:
            '[General]\n' +
            'api_key = ${apiKey}\n',
        },
      },
      mounts: [
        { src: 'configRoot/<service>', dst: '/config' },
      ],
      postDeployScript: {
        // scripts/configure-tautulli.py:
        //   1. Waits for Tautulli (poll /api/v2?cmd=arnold).
        //   2. Fetches Plex's machineIdentifier from /identity.
        //   3. POSTs cmd=set_settings with the [PMS] section fields
        //      (pms_ip, pms_port, pms_token, pms_url, pms_identifier).
        //   Idempotent — set_settings is upsert-style.
        //
        // PLEX_TOKEN's whenMediaServer:'plex' gate means the script
        // gets called only when the user picked Plex. With Jellyfin
        // or Emby selected, PLEX_TOKEN is omitted and the script
        // exits 0 with a "no Plex to wire" log line. (Tautulli does
        // support Jellyfin and Emby, but their wizard flow is
        // different enough that we'd need a separate code path —
        // those connections are left to the user to wire via the UI
        // for now.)
        path: 'scripts/configure-tautulli.py',
        blocks: [],
        env: {
          TAUTULLI_API_KEY: { fromSecret: 'apiKey' },
          PLEX_URL:   { whenMediaServer: 'plex', value: 'http://localhost:32400' },
          PLEX_TOKEN: { whenMediaServer: 'plex', fromService: 'plex', field: 'plexToken' },
        },
      },
    },
  },
  zilean: {
    name: 'Zilean',
    desc: 'DMM scraper for debrid stacks',
    logo: zileanLogo,
    category: 'debrid',
    repo: 'https://github.com/iPromKnight/zilean',
    // ====================================================================
    // First multi-container service. Introduces several schema fields used
    // here for the first time — the backend's compose generator interprets:
    //
    //   compose.services         Object of sub-container definitions. Each
    //                            value has the same shape as a single-
    //                            container compose template (image, ports,
    //                            mounts, env, networkMode, etc).
    //                            Sub-container names are emitted as
    //                            <serviceKey>-<subKey>; the special case
    //                            where subKey === serviceKey emits as just
    //                            <serviceKey> (so the primary container
    //                            keeps the user-facing name).
    //
    //   compose.secrets          Service-scoped named secrets. Each entry
    //                            is { generate: 'random', length: N }.
    //                            Backend creates the value once per
    //                            install, persists it across redeploys,
    //                            and substitutes it wherever referenced.
    //
    //   env: { fromSecret: '<name>' }
    //                            Direct reference — the env value becomes
    //                            the secret's value verbatim. Looks up
    //                            the secret on THIS service's
    //                            compose.secrets.
    //
    //   env: { fromServiceSecret: '<service>', secret: '<name>' }
    //                            Cross-service reference — fetch the
    //                            named secret from ANOTHER service's
    //                            compose.secrets. Used to pass apiKeys
    //                            between services that the backend has
    //                            generated upfront (e.g. Episeerr's
    //                            SONARR_API_KEY references sonarr's
    //                            apiKey secret). Distinct from
    //                            `fromService` which fetches a value
    //                            from a sibling's runtime config file
    //                            after deploy — use this when the
    //                            target service ships a Surge-generated
    //                            secret, fromService when the target
    //                            generates its own at first run.
    //
    //   env: { whenService: '<key>', ...rest }
    //                            Conditional gate — only emit this env
    //                            var when the named service is enabled
    //                            in contentEnhancement. Wrap any of
    //                            the marker shapes above (literal,
    //                            fromSecret, fromServiceSecret,
    //                            fromService, fromConfig). When the
    //                            target isn't part of this deploy,
    //                            the var is omitted entirely from the
    //                            container's environment / script's
    //                            process env — the consumer sees an
    //                            absent var and decides whether to
    //                            skip gracefully or error. Mirrors
    //                            whenMediaServer but for the many-of
    //                            service grid. Pairs naturally with
    //                            fromServiceSecret on the same marker
    //                            (the gate skips the env, the inner
    //                            shape resolves the value when the
    //                            gate passes).
    //
    //   env: { whenMediaServer: '<plex|jellyfin|emby>', ...rest }
    //                            Same as whenService but for the
    //                            one-of media-server choice. Used to
    //                            wire Plex-specific env vars (e.g.
    //                            Bazarr's PLEX_TOKEN) only when the
    //                            user actually picked Plex.
    //
    //   env literals with ${name}
    //                            Template substitution — the backend
    //                            replaces ${name} inside the literal
    //                            string with the secret's value at
    //                            compose-gen time. Same-service scope
    //                            (matches fromSecret).
    //
    //   per-container fields:
    //     healthcheck:   { test: [...], interval, timeout, retries }
    //     dependsOn:     { <subKey>: { condition: 'service_healthy' } }
    //     tty:           true → allocate pseudo-TTY
    //     shmSize:       '2G' → /dev/shm size override
    //
    // When compose.services is present and any sub-container uses
    // networkMode='bridge', the backend auto-emits a private compose
    // network named <serviceKey>-internal so the sub-containers can
    // reach each other by name.
    // ====================================================================
    compose: {
      secrets: {
        // 32-char random per Surge install. Used by both sub-containers
        // (declared by postgres, consumed by zilean's connection string).
        postgresPassword: { generate: 'random', length: 32 },
      },
      services: {
        postgres: {
          image: 'postgres:17.2-alpine',
          networkMode: 'bridge',
          shmSize: '2G',
          // No ports: postgres reachable only via the internal bridge.
          mounts: [
            { src: 'configRoot/<service>/postgres/pgdata',
              dst: '/var/lib/postgresql/data/pgdata' },
          ],
          env: {
            PGDATA:            '/var/lib/postgresql/data/pgdata',
            POSTGRES_USER:     'postgres',
            POSTGRES_PASSWORD: { fromSecret: 'postgresPassword' },
            POSTGRES_DB:       'zilean',
          },
          healthcheck: {
            test:     ['CMD-SHELL', 'pg_isready -U postgres -d zilean'],
            interval: '10s',
            timeout:  '5s',
            retries:  10,
          },
        },
        zilean: {
          image: 'ipromknight/zilean:latest',
          networkMode: 'bridge',
          tty: true,
          ports: ['8192:8181'],
          mounts: [
            { src: 'configRoot/<service>/data', dst: '/app/data' },
            { src: 'configRoot/<service>/tmp',  dst: '/tmp'      },
          ],
          env: {
            // ${postgresPassword} substituted at compose-gen.
            // 'zilean-postgres' is the emitted name of the sibling
            // sub-container (sub-key 'postgres' prefixed with the
            // service key).
            'Zilean__Database__ConnectionString':
              'Host=zilean-postgres;Port=5432;Database=zilean;Username=postgres;Password=${postgresPassword}',
            'Zilean__Dmm__SyncInterval':            '00:30:00',
            'Zilean__Scraper__MaxParallelRequests': 2,
            'Zilean__Dmm__Enabled':                 'false',
          },
          dependsOn: {
            postgres: { condition: 'service_healthy' },
          },
          healthcheck: {
            test:     ['CMD-SHELL', 'wget -qO- http://localhost:8181/healthchecks/ping >/dev/null 2>&1'],
            interval: '30s',
            timeout:  '10s',
            retries:  10,
          },
        },
      },
    },
  },
  zurg: {
    name: 'zurg',
    desc: 'Real-Debrid filesystem mount (rclone bundled)',
    logo: zurgLogo,
    category: 'debrid',
    repo: 'https://github.com/debridmediamanager/zurg-testing',
    // ====================================================================
    // Second multi-container service (after zilean). Two sub-containers:
    //   - zurg     The WebDAV server exposing Real-Debrid content. Listens
    //              on 9999. Reachable from rclone via the internal network
    //              at http://zurg:9999.
    //   - rclone   FUSE-mounts zurg's WebDAV at /data inside the container,
    //              propagating that mount to the host at
    //              mediaRoot/media/Intake/zurg via :rshared so the *arr
    //              services see the debrid library as a regular directory.
    //
    // Introduces these new schema fields (the backend's compose generator
    // interprets them; forward-documented for the implementer):
    //
    //   compose.files
    //     Object of templated config files Surge writes to host paths
    //     before launching containers. Each entry has:
    //       hostPath  Token-resolvable destination on the host.
    //       content   One of:
    //                   - String literal (with ${name} substitution from
    //                     service secrets and user config).
    //                   - { fromUpstream: '<URL>' } — fetch file contents
    //                     from a URL at install time.
    //                   - { fromUpstream: '<URL>', fallback: '<literal>' }
    //                     — try upstream first, fall back to the literal
    //                     when the URL is unreachable. The fallback is
    //                     a snapshot, not auto-updated against upstream.
    //       mode      Optional octal file mode (e.g. 0o755 for an
    //                 executable script).
    //     Files declared here MUST be written before docker-compose up,
    //     since they're typically referenced by mount entries on the
    //     same service (e.g. zurg's config.yml mount points to a file
    //     that compose.files generated).
    //
    //   per-container fields (in addition to those zilean introduced):
    //     capAdd       Array of Linux capabilities (e.g. ['SYS_ADMIN'])
    //     securityOpt  Array of security options (e.g. ['apparmor:unconfined'])
    //     devices      Array of host:container[:perms] device mappings
    //     command      String overriding the image's default CMD
    //
    //   mount entry option:
    //     options      String mount-option flag (e.g. 'rshared' for the
    //                  mount propagation needed by FUSE).
    //
    //   dependsOn (simple form):
    //     dependsOn: { <subKey>: {} }
    //                  Plain dependency without a health condition.
    //                  Compare with zilean's healthcheck-gated form:
    //                  dependsOn: { <subKey>: { condition: 'service_healthy' } }
    //
    //   compose.postDeployScript
    //     Per-service post-deploy automation, mirroring the original
    //     terminal Surge's configure-<service>.py pattern. After the
    //     non-blocked containers come up healthy, the backend runs:
    //       path:    Path to a Python/shell script Surge ships,
    //                relative to a Surge-managed scripts directory.
    //                The script reads the service's secrets/config from
    //                Surge's persistence and configures the live
    //                container via its HTTP API or filesystem (e.g.
    //                creating an admin account, copying API keys).
    //       blocks:  Optional array of sub-container keys that should
    //                NOT be brought up until the script succeeds.
    //                Used when a sibling container's config (like
    //                rclone.conf) depends on values the script
    //                generates from the primary container.
    //       env:     Optional dict of env-var declarations to pass
    //                into the script's process environment. Same
    //                marker schema as compose.env (literals,
    //                ${name}, fromConfig, fromSecret,
    //                fromServiceSecret, fromService, whenMediaServer).
    //                The backend resolves these at deploy time and
    //                exports them before exec'ing the script. This
    //                is how cross-service automation that depends on
    //                a runtime-fetched value (e.g. Bazarr needing
    //                Plex's X-Plex-Token to configure notifications)
    //                gets wired declaratively rather than hardcoded
    //                inside each script.
    //                Standard names (BAZARR_URL, SONARR_API_KEY, etc)
    //                that the configure scripts already expect can
    //                still be supplied by the backend without an
    //                explicit declaration here — env is for the
    //                additional, conditional, or cross-service vars.
    //
    //   compose.fetchScript
    //     Counterpart to postDeployScript for *reading* runtime-
    //     generated values out of a service. Used when the service
    //     creates its own API key/credentials on first launch and we
    //     can't seed them upfront via config files. The script:
    //       1. Waits for the value(s) to be available (polls a config
    //          file or hits an API).
    //       2. Outputs a single JSON object to stdout, keyed by field
    //          name: { "apiKey": "<value>", "userId": "<value>", ... }
    //       3. Exits 0 on success, non-zero on failure.
    //     Backend captures the JSON and stores those values as the
    //     service's "fetched fields," reachable from any other
    //     service's env via the cross-service marker:
    //       { fromService: '<this-service>', field: '<field-name>' }
    //     The compose generator builds a deploy-ordering graph from
    //     these markers — any consumer of fetchScript output is
    //     deferred until this fetchScript has succeeded.
    //     Schema:
    //       path: Path to script (relative to Surge scripts dir).
    //       env:  Optional env-var overrides (same marker schema as
    //             compose.env). Backend always sets CONFIG_PATH to
    //             the resolved configRoot/<service> for convenience.
    // ====================================================================
    compose: {
      files: {
        rcloneConf: {
          hostPath: 'configRoot/<service>/rclone.conf',
          content:
            '[zurg]\n' +
            'type = webdav\n' +
            'url = http://zurg:9999/dav\n' +
            'vendor = other\n' +
            'pacer_min_sleep = 0\n',
        },
        configYml: {
          hostPath: 'configRoot/<service>/config.yml',
          // ${rdApiToken} substituted from the user's External APIs entry.
          content:
            'zurg: v1\n' +
            'token: ${rdApiToken}\n',
        },
        plexUpdateSh: {
          hostPath: 'configRoot/<service>/scripts/plex_update.sh',
          // Try upstream first; if the fetch fails (offline install,
          // GitHub unreachable, etc.) fall back to the inline snapshot
          // below. The snapshot is a verbatim copy of the canonical
          // script — refresh manually if upstream meaningfully changes.
          //
          // Note: the script ships with three placeholder values
          // (plex_url, token, zurg_mount) that the user must edit
          // before zurg can trigger Plex refreshes. Templating these
          // automatically is a future improvement (would need
          // plex_url + plex_token added to the wizard's config).
          content: {
            fromUpstream:
              'https://raw.githubusercontent.com/debridmediamanager/zurg-testing/main/scripts/plex_update.sh',
            fallback: [
              "#!/bin/bash",
              "",
              "# PLEX PARTIAL SCAN script or PLEX UPDATE script",
              "# When zurg detects changes, it can trigger this script IF your config.yml contains",
              "# on_library_update: sh plex_update.sh \"$@\"",
              "",
              "# docker compose exec zurg apk add libxml2-utils",
              "# sudo apt install libxml2-utils",
              "",
              "plex_url=\"http://<url>\" # If you're using zurg inside a Docker container, by default it is 172.17.0.1:32400",
              "token=\"<token>\" # open Plex in a browser, open dev console and copy-paste this: window.localStorage.getItem(\"myPlexAccessToken\")",
              "zurg_mount=\"/mnt/zurg\" # replace with your zurg mount path, ensure this is what Plex sees",
              "",
              "# Get the list of section IDs",
              "section_ids=$(curl -sLX GET \"$plex_url/library/sections\" -H \"X-Plex-Token: $token\" | xmllint --xpath \"//Directory/@key\" - | grep -o 'key=\"[^\"]*\"' | awk -F'\"' '{print $2}')",
              "",
              "for arg in \"$@\"",
              "do",
              "    parsed_arg=\"${arg//\\\\}\"",
              "    echo $parsed_arg",
              "    modified_arg=\"$zurg_mount/$parsed_arg\"",
              "    echo \"Detected update on: $arg\"",
              "    echo \"Absolute path: $modified_arg\"",
              "",
              "    for section_id in $section_ids",
              "    do",
              "        echo \"Section ID: $section_id\"",
              "",
              "        curl -G -H \"X-Plex-Token: $token\" --data-urlencode \"path=$modified_arg\" $plex_url/library/sections/$section_id/refresh",
              "    done",
              "done",
              "",
              "echo \"All updated sections refreshed\"",
              "",
              "# credits to godver3, wasabipls",
            ].join("\n"),
          },
          mode: 0o755,
        },
      },
      services: {
        zurg: {
          image: 'ghcr.io/debridmediamanager/zurg-testing:latest',
          networkMode: 'bridge',
          ports: ['9999:9999'],
          mounts: [
            { src: 'configRoot/<service>/scripts/plex_update.sh', dst: '/app/plex_update.sh' },
            { src: 'configRoot/<service>/config.yml',             dst: '/app/config.yml'    },
            { src: 'configRoot/<service>/data',                   dst: '/app/data'          },
            { src: 'mediaRoot/media',                             dst: '/media'             },
          ],
        },
        rclone: {
          image: 'rclone/rclone:latest',
          networkMode: 'bridge',
          capAdd:      ['SYS_ADMIN'],
          securityOpt: ['apparmor:unconfined'],
          devices:     ['/dev/fuse:/dev/fuse:rwm'],
          // Long single-line `mount` invocation (rclone's image has no
          // useful default CMD).
          command:
            'mount zurg: /data ' +
            '--allow-other --allow-non-empty ' +
            '--dir-cache-time 10s ' +
            '--vfs-cache-mode full --vfs-cache-max-size 50G --vfs-cache-max-age 1h ' +
            '--buffer-size 64M --vfs-read-ahead 256M',
          mounts: [
            // FUSE target. :rshared propagation makes the mount visible
            // to the host (and to *arr containers binding from the same
            // host path) once rclone populates /data.
            { src: 'mediaRoot/media/Intake/zurg',      dst: '/data',
              options: 'rshared' },
            // Surge-generated rclone.conf with the [zurg] WebDAV remote.
            { src: 'configRoot/<service>/rclone.conf', dst: '/config/rclone/rclone.conf' },
            // VFS cache directory on the cache pool for fast reads.
            { src: 'mediaRoot/<service>/rclone-cache', dst: '/cache' },
          ],
          // Plain dependency: rclone won't start until zurg's container is up.
          dependsOn: { zurg: {} },
        },
      },
    },
  },

  // ---------------------------------------------------------------
  // Networking add-ons. These don't host their own UIs — they
  // wire up tunneling/VPN around the rest of the stack.
  //   - newt: outbound WireGuard tunnel to a Pangolin control
  //     plane. Public access without opening home-network ports;
  //     routes are configured inside Pangolin, not Surge.
  //   - gluetun: per-container outbound VPN. Other services opt
  //     into routing via the wizard's "Route through VPN"
  //     checkbox, which makes the compose renderer move their
  //     ports onto gluetun and set network_mode: service:gluetun.
  // ---------------------------------------------------------------
  newt: {
    name: 'Pangolin (Newt)',
    desc: 'Tunnel to Pangolin reverse proxy — no port forwarding',
    logo: pangolinLogo,
    category: 'networking',
    repo: 'https://github.com/fosrl/newt',
    compose: {
      image: 'fosrl/newt:latest',
      // Newt is outbound-only — connects out to the Pangolin control
      // plane, accepts tunnel traffic from there. No host ports.
      ports: [],
      mounts: [],
      // WireGuard requires NET_ADMIN to set up the tunnel and
      // SYS_MODULE in case the wireguard kernel module needs loading
      // on hosts where it's not already present (newer kernels have
      // it built-in; older ones need the module loaded). Safe to
      // include either way — capability is granted only when used.
      capAdd: ['NET_ADMIN', 'SYS_MODULE'],
      sysctls: {
        'net.ipv4.conf.all.src_valid_mark': 1,
      },
      env: {
        // The user gets all three of these from their Pangolin
        // instance: PANGOLIN_ENDPOINT is the URL of the control
        // plane (e.g. https://pangolin.example.com). NEWT_ID +
        // NEWT_SECRET are issued by Pangolin's "Add site" flow and
        // copy-pasted in here.
        PANGOLIN_ENDPOINT: { fromConfig: 'pangolinEndpoint' },
        NEWT_ID:           { fromConfig: 'newtId' },
        NEWT_SECRET:       { fromConfig: 'newtSecret' },
      },
      // No healthcheck — Newt logs to stdout and the Pangolin
      // dashboard shows tunnel status; the standard Docker
      // restart policy handles recovery.
    },
  },

  gluetun: {
    name: 'Gluetun',
    desc: 'Per-container VPN routing (Mullvad/ProtonVPN/etc.)',
    logo: gluetunLogo,
    category: 'networking',
    repo: 'https://github.com/qdm12/gluetun',
    compose: {
      image: 'qmcgaw/gluetun:latest',
      // Container ports here are seeds — the compose renderer
      // hoists ports from any service that opts into VPN routing
      // onto this gluetun service automatically (since they share
      // the network namespace). Don't add manual mappings; let the
      // wizard's "Route through VPN" checkbox drive it.
      ports: [],
      mounts: [
        // Gluetun persists its servers.json + auth state here.
        { src: 'configRoot/<service>', dst: '/gluetun' },
      ],
      // VPN tunnel kernel hooks — same NET_ADMIN + tun device pair
      // every Linux VPN client wants.
      capAdd: ['NET_ADMIN'],
      devices: ['/dev/net/tun:/dev/net/tun'],
      env: {
        // Provider + transport. Both required. Surge's wizard
        // narrows VPN_TYPE to wireguard|openvpn and surfaces
        // provider-appropriate fields downstream.
        VPN_SERVICE_PROVIDER: { fromConfig: 'vpnProvider' },
        VPN_TYPE:             { fromConfig: 'vpnType' },
        // Wireguard creds — the user pastes these from their VPN
        // provider's wireguard config download. defaultValue '' so
        // openvpn-only deploys don't choke on missing fields.
        WIREGUARD_PRIVATE_KEY: { fromConfig: 'vpnWireguardPrivateKey', defaultValue: '' },
        WIREGUARD_ADDRESSES:   { fromConfig: 'vpnWireguardAddresses',  defaultValue: '' },
        WIREGUARD_PRESHARED_KEY: { fromConfig: 'vpnWireguardPresharedKey', defaultValue: '' },
        // OpenVPN creds — username/password style.
        OPENVPN_USER:     { fromConfig: 'vpnOpenvpnUser',     defaultValue: '' },
        OPENVPN_PASSWORD: { fromConfig: 'vpnOpenvpnPassword', defaultValue: '' },
        // Optional location pinning. Most users leave blank
        // (provider picks closest); pin when you want a specific
        // exit, e.g. for region-locked content.
        SERVER_COUNTRIES: { fromConfig: 'vpnServerCountries', defaultValue: '' },
        SERVER_CITIES:    { fromConfig: 'vpnServerCities',    defaultValue: '' },
      },
      healthcheck: {
        // Gluetun's built-in health endpoint runs on 9999 and
        // returns 200 when the tunnel is up + leaktest passes.
        test:        ['CMD', 'wget', '-qO-', 'http://localhost:9999/v1/openvpn/status'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '60s',
      },
    },
  },
};

// Display order on the page (case-insensitive alphabetical).
export const allServices = [
  'bazarr',
  'boxarr',
  'cinesync',
  'decypharr',
  'episeerr',
  'flaresolverr',
  'gaps',
  'gluetun',
  'kometa',
  'mdblistarr',
  'newt',
  'nzbdav',
  'posterizarr',
  'prowlarr',
  'pulsarr',
  'radarr',
  'rdt-client',
  'sabnzbd',
  'seasonarr',
  'seerr',
  'sonarr',
  'tautulli',
  'zilean',
  'zurg',
];

// Sensible defaults for which services start enabled. Common *arr-suite
// staples default on; niche/optional services default off so users
// opt-in rather than discover them later.
const defaultSelected = {
  bazarr: true,
  boxarr: false,
  cinesync: true,
  decypharr: false,
  episeerr: false,
  flaresolverr: false,
  gaps: true,
  gluetun: false,
  kometa: true,
  mdblistarr: false,
  newt: false,
  nzbdav: false,
  posterizarr: true,
  prowlarr: true,
  pulsarr: false,
  radarr: true,
  'rdt-client': false,
  sabnzbd: false,
  seasonarr: false,
  seerr: true,
  sonarr: true,
  tautulli: true,
  zilean: false,
  zurg: false,
};

// Public map of upstream repo URLs, keyed by service. NOT used for
// deployment — Surge runs services from their published Docker images
// (compose.image), never by cloning source. This map exists for two
// purposes:
//   1. Documentation / linking out — the UI can surface a service's
//      upstream from its tile.
//   2. Base URL for compose.files entries that use the `fromUpstream`
//      content marker, so file URLs can be derived from the repo
//      rather than duplicated as raw GitHub URLs.
export const serviceRepos = Object.fromEntries(
  Object.entries(serviceMeta).map(([key, meta]) => [key, meta.repo])
);

export default function AdditionalServicesStep(props) {
  const { contentEnhancement, setContentEnhancement, config, setConfig } = props;
  const [selectedCategory, setSelectedCategory] = React.useState('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  // Service key whose details modal is currently open, or null.
  const [detailsKey, setDetailsKey] = React.useState(null);
  const detailsMeta = detailsKey ? serviceMeta[detailsKey] : null;

  // Inline updater for nested cinesyncSettings booleans. Reads through
  // setConfig's functional form so concurrent edits don't clobber each
  // other; nests under the existing cinesyncSettings object.
  const setCinesyncSetting = React.useCallback((key, value) => {
    setConfig((prev) => ({
      ...prev,
      cinesyncSettings: {
        ...(prev?.cinesyncSettings || {}),
        [key]: value,
      },
    }));
  }, [setConfig]);

  const cinesyncEnabled        = !!contentEnhancement.cinesync;
  const cinesyncAnime          = !!config?.cinesyncSettings?.animeSeparation;
  const cinesync4k             = !!config?.cinesyncSettings?.fourKSeparation;
  // Gluetun being enabled unlocks the per-tile "Route through VPN"
  // shield. We hide the shield on gluetun's own tile (it can't route
  // itself) and on services with no outbound traffic worth routing
  // (Pangolin's newt is itself a tunnel; metadata-only tools like
  // Kometa/Posterizarr don't move enough traffic to matter).
  const vpnEnabled = !!contentEnhancement.gluetun;
  const VPN_ROUTABLE = new Set([
    // High-value: torrent / debrid clients, downloaders, torrent
    // search proxies. Anything that touches public swarms benefits
    // from VPN routing.
    'rdt-client', 'decypharr', 'sabnzbd', 'nzbget', 'nzbdav',
    'prowlarr', 'flaresolverr', 'zilean', 'zurg',
  ]);
  const toggleVpnRoute = React.useCallback((key) => {
    setConfig((prev) => ({
      ...prev,
      vpnRoutedServices: {
        ...(prev?.vpnRoutedServices || {}),
        [key]: !prev?.vpnRoutedServices?.[key],
      },
    }));
  }, [setConfig]);

  // Apply a preset: overlay its services on top of the current
  // contentEnhancement, and set the media server. Doesn't turn off
  // anything already-enabled — additive only.
  const applyPreset = React.useCallback((preset) => {
    if (preset.mediaServer) {
      setConfig((prev) => ({ ...prev, mediaServer: preset.mediaServer }));
    }
    setContentEnhancement((prev) => ({ ...prev, ...preset.services }));
  }, [setConfig, setContentEnhancement]);

  // Service key to scroll-into-view + flash on render. Driven by the
  // 'surge:focus-service' event the connection graph dispatches when
  // a node is clicked. Cleared after the highlight animation runs so
  // the same tile can be highlighted again later.
  const [focusedKey, setFocusedKey] = React.useState(null);
  const tileRefs = React.useRef({});

  React.useEffect(() => {
    const handler = (e) => {
      const key = e?.detail?.serviceKey;
      if (key) setFocusedKey(key);
    };
    window.addEventListener('surge:focus-service', handler);
    return () => window.removeEventListener('surge:focus-service', handler);
  }, []);

  // When focusedKey changes, scroll its tile into view and clear the
  // flag after the flash animation completes.
  React.useEffect(() => {
    if (!focusedKey) return undefined;
    const el = tileRefs.current[focusedKey];
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const id = setTimeout(() => setFocusedKey(null), 1800);
    return () => clearTimeout(id);
  }, [focusedKey]);

  // User-defined presets, loaded from localStorage. Surfaced alongside
  // PRESETS in the same row but rendered with a slightly different
  // chip style (and a delete X) so users can tell them apart.
  const [userPresets, setUserPresets] = React.useState(() => loadPresets());
  const [savePresetOpen, setSavePresetOpen] = React.useState(false);
  const [savePresetName, setSavePresetName] = React.useState('');
  const [savePresetError, setSavePresetError] = React.useState(null);

  const handleSaveCurrentAsPreset = () => {
    setSavePresetError(null);
    const trimmed = savePresetName.trim();
    if (!trimmed) {
      setSavePresetError('Name is required.');
      return;
    }
    const preset = buildPresetFromCurrent({
      name: trimmed,
      mediaServer: config?.mediaServer || '',
      contentEnhancement,
    });
    const next = upsertPreset(userPresets, preset);
    try {
      savePresets(next);
      setUserPresets(next);
      setSavePresetOpen(false);
      setSavePresetName('');
    } catch (err) {
      setSavePresetError(err.message || String(err));
    }
  };

  const handleDeleteUserPreset = (key) => {
    const next = deletePreset(userPresets, key);
    try {
      savePresets(next);
      setUserPresets(next);
    } catch (err) {
      // Swallow — at worst the state is in-memory only until reload.
    }
  };

  // Live deploy stats — recomputes whenever the user toggles a tile or
  // changes any wizard config field. Same composePreview that drives
  // the Deploy step's preview panel, so the numbers stay consistent.
  const previewStats = React.useMemo(() => {
    const preview = generateComposePreview({
      ...(config || {}),
      contentEnhancement,
    });
    return {
      containers: Object.keys(preview.services || {}).length,
      secrets:    Object.keys(preview.secrets  || {}).length,
      files:      (preview.files || []).length,
      scripts:    (preview.fetchScripts?.length || 0)
                + (preview.postDeployScripts?.length || 0),
      networks:   Object.keys(preview.networks || {}).length,
    };
  }, [config, contentEnhancement]);

  // Seed defaults on first render only; preserve any prior selections.
  React.useEffect(() => {
    setContentEnhancement((prev) => ({ ...defaultSelected, ...prev }));
  }, [setContentEnhancement]);

  const visibleServices = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allServices.filter((key) => {
      const meta = serviceMeta[key];
      if (selectedCategory !== 'all' && meta?.category !== selectedCategory) {
        return false;
      }
      if (q) {
        const haystack = `${key} ${meta?.name || ''} ${meta?.desc || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  // Compute per-service dependency warnings. For each service, extract
  // the set of peer services it has gated-env-var references to (via
  // `whenService` markers in compose.env / postDeployScript.env /
  // fetchScript.env), plus any whenMediaServer gates. If a peer or the
  // expected media server isn't enabled, render a yellow badge on the
  // tile so the user knows they're deploying a half-functional service.
  // Returns null when no warnings, or { peers: [...], mediaServers: [...] }
  // otherwise.
  const warningsFor = React.useCallback((serviceKey) => {
    const meta = serviceMeta[serviceKey];
    if (!meta?.compose) return null;

    const peerSet = new Set();
    const mediaServerSet = new Set();
    const configKeySet = new Set();
    walkEnvBlocks(meta.compose, (marker) => {
      collectGates(marker, peerSet, mediaServerSet);
      collectFromConfigKeys(marker, configKeySet);
    });
    collectFileTemplateRefs(meta.compose, configKeySet);

    const missingPeers = [...peerSet].filter(
      (p) => p !== serviceKey && !contentEnhancement[p],
    );
    const missingMediaServers = [...mediaServerSet].filter(
      (m) => m !== config?.mediaServer,
    );
    // Filter the config-key references down to the External APIs step's
    // keys (others are nested settings, secrets, runtime fetched values),
    // then keep only the empty / unset ones.
    const missingApiKeys = [...configKeySet]
      .filter((k) => EXTERNAL_API_KEYS.has(k))
      .filter((k) => !config?.[k]);

    if (missingPeers.length === 0
        && missingMediaServers.length === 0
        && missingApiKeys.length === 0) {
      return null;
    }
    return {
      peers:        missingPeers,
      mediaServers: missingMediaServers,
      apiKeys:      missingApiKeys,
    };
  }, [contentEnhancement, config]);

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h6" align="center" style={{ color: 'var(--surge-text-primary)', marginBottom: 16 }}>
        Service Selection
      </Typography>

      {/* Existing-infrastructure declaration. Shown first so users
          who already have services running can declare them up-front
          before picking what to add. Each service listed here is
          excluded from the deploy bundle and its URL/API key is
          plumbed into any new service that depends on it. */}
      <ExistingServicesPanel config={config} setConfig={setConfig} />

      {/* Quick-start presets — one-click bundles of services for the
          common deploy shapes. Additive: doesn't turn off anything the
          user already had enabled. Users who want a clean slate can
          hit "Reset wizard" in the page header. */}
      <Box sx={{ mb: 2 }}>
        <Typography
          align="center"
          style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 8 }}
        >
          Quick-start presets
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          justifyContent="center"
          rowGap={1}
        >
          {PRESETS.map((preset) => (
            <Tooltip key={preset.key} title={preset.desc} placement="top">
              <Button
                onClick={() => applyPreset(preset)}
                size="small"
                variant="outlined"
                sx={{
                  color: 'var(--surge-text-primary)',
                  borderColor: '#07938f',
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: '#0bbab5',
                    background: 'rgba(7,147,143,0.15)',
                  },
                }}
              >
                {preset.name}
              </Button>
            </Tooltip>
          ))}
          {userPresets.map((preset) => (
            <Tooltip key={preset.key} title={preset.desc} placement="top">
              <Box sx={{ display: 'inline-flex' }}>
                <Button
                  onClick={() => applyPreset(preset)}
                  size="small"
                  variant="outlined"
                  sx={{
                    color: 'var(--surge-text-primary)',
                    borderColor: 'var(--surge-accent)',
                    borderRightColor: 'transparent',
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    textTransform: 'none',
                    '&:hover': {
                      borderColor: 'var(--surge-accent)',
                      borderRightColor: 'transparent',
                      background: 'rgba(121,234,255,0.1)',
                    },
                  }}
                >
                  💾 {preset.name}
                </Button>
                <Button
                  onClick={() => handleDeleteUserPreset(preset.key)}
                  aria-label={`Delete preset ${preset.name}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    minWidth: 0,
                    px: 0.75,
                    color: 'var(--surge-text-muted)',
                    borderColor: 'var(--surge-accent)',
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    fontSize: 12,
                    '&:hover': {
                      color: 'var(--surge-error)',
                      borderColor: 'var(--surge-error)',
                      background: 'rgba(244,67,54,0.1)',
                    },
                  }}
                >
                  ✕
                </Button>
              </Box>
            </Tooltip>
          ))}
          <Tooltip title="Save the current selections as a named preset" placement="top">
            <Button
              onClick={() => { setSavePresetName(''); setSavePresetError(null); setSavePresetOpen(true); }}
              size="small"
              variant="outlined"
              sx={{
                color: 'var(--surge-text-muted)',
                borderColor: 'var(--surge-border)',
                borderStyle: 'dashed',
                textTransform: 'none',
                '&:hover': {
                  color: 'var(--surge-accent)',
                  borderColor: 'var(--surge-accent)',
                  background: 'rgba(121,234,255,0.1)',
                },
              }}
            >
              + Save current
            </Button>
          </Tooltip>
        </Stack>
      </Box>

      {/* Save-current-as-preset dialog. Single-input modal — name only;
          the preset captures the active media server + contentEnhancement
          flags. Existing user presets with the same slugged key get
          overwritten (handled in upsertPreset). */}
      <Dialog
        open={savePresetOpen}
        onClose={() => setSavePresetOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            background: 'var(--surge-panel-bg)',
            color:      'var(--surge-text-primary)',
            border:     '1px solid var(--surge-border-subtle)',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid var(--surge-border-subtle)' }}>
          Save preset
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13, marginBottom: 12 }}>
            Captures the current media server and enabled services — not
            API keys, paths, or wizard state. Saved presets sync via
            Settings → Export.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            value={savePresetName}
            onChange={(e) => setSavePresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCurrentAsPreset(); }}
            placeholder="e.g. Home server"
            inputProps={{ 'aria-label': 'Preset name' }}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'var(--surge-text-primary)',
                background: 'var(--surge-input-bg)',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'var(--surge-border)',
              },
            }}
          />
          {savePresetError && (
            <Typography style={{ color: 'var(--surge-error)', fontSize: 12, marginTop: 8 }}>
              {savePresetError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)' }}>
          <Button
            onClick={() => setSavePresetOpen(false)}
            sx={{ color: 'var(--surge-text-muted)', textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveCurrentAsPreset}
            variant="contained"
            sx={{
              background: 'var(--surge-brand)',
              color: '#fff',
              textTransform: 'none',
              '&:hover': { background: '#065a57' },
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Live stats strip — updates as the user toggles tiles. */}
      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        justifyContent="center"
        rowGap={1}
        sx={{ mb: 2 }}
      >
        {[
          ['containers', previewStats.containers],
          ['secrets',    previewStats.secrets],
          ['scripts',    previewStats.scripts],
          ['config files', previewStats.files],
          ['networks',   previewStats.networks],
        ].map(([label, value]) => (
          <Chip
            key={label}
            label={`${value} ${label}`}
            size="small"
            sx={{
              background:    '#0d1f1e',
              color:         value === 0 ? '#666' : 'var(--surge-text-secondary)',
              border:        '1px solid #07938f',
              fontWeight:    500,
              opacity:       value === 0 ? 0.6 : 1,
            }}
          />
        ))}
      </Stack>

      {/* Search input — substring match against service key/name/desc. */}
      <Box display="flex" justifyContent="center" sx={{ mb: 2 }}>
        <TextField
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search services…"
          size="small"
          inputProps={{ 'aria-label': 'Search services' }}
          sx={{
            width: 280,
            '& .MuiInputBase-root':   { background: 'var(--surge-panel-bg)', color: 'var(--surge-text-primary)' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--surge-border-subtle)' },
            '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#07938f',
            },
            '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#07938f !important',
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box sx={{ color: 'var(--surge-text-dim)', fontSize: 16 }}>⌕</Box>
              </InputAdornment>
            ),
            endAdornment: searchQuery ? (
              <InputAdornment position="end">
                <Box
                  onClick={() => setSearchQuery('')}
                  sx={{ color: 'var(--surge-text-dim)', cursor: 'pointer', fontSize: 16,
                        '&:hover': { color: 'var(--surge-text-primary)' } }}
                >
                  ✕
                </Box>
              </InputAdornment>
            ) : null,
          }}
        />
      </Box>

      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        justifyContent="center"
        rowGap={1}
        sx={{ mb: 3 }}
      >
        {categories.map((cat) => {
          const active = cat.key === selectedCategory;
          return (
            <Chip
              key={cat.key}
              label={
                <span>
                  <span style={{ marginRight: 6, opacity: 0.85 }}>{cat.icon}</span>
                  {cat.label}
                </span>
              }
              clickable
              onClick={() => setSelectedCategory(cat.key)}
              variant={active ? 'filled' : 'outlined'}
              sx={{
                color: 'var(--surge-text-primary)',
                borderColor: '#07938f',
                backgroundColor: active ? '#07938f' : 'transparent',
                fontWeight: active ? 600 : 400,
                '&:hover': {
                  backgroundColor: active ? '#065a57' : 'rgba(7,147,143,0.15)',
                },
              }}
            />
          );
        })}
      </Stack>

      <Box display="flex" flexWrap="wrap" gap={2} mb={3} justifyContent="center">
        {visibleServices.map((key) => {
          const meta = serviceMeta[key] || { name: key, desc: '', logo: null };
          const enabled = !!contentEnhancement[key];
          // Only surface dependency warnings for tiles the user has
          // turned ON — warnings on disabled tiles would just be visual
          // noise (every disabled service has un-enabled peers).
          const warnings = enabled ? warningsFor(key) : null;
          // Build the tooltip text. When there are warnings, replace
          // the bare description with a fuller "Service · needs X" so
          // the user knows what's missing without clicking through.
          const tooltipText = warnings
            ? formatWarningTooltip(meta, warnings)
            : (meta.desc || meta.name);
          const toggleTile = () =>
            setContentEnhancement((prev) => ({ ...prev, [key]: !prev[key] }));
          const isFocused = focusedKey === key;
          const isExternal = !!config?.externalServices?.[key]?.external;
          return (
            <Tooltip key={key} title={tooltipText} placement="top">
              <Box
                ref={(el) => { tileRefs.current[key] = el; }}
                role="button"
                tabIndex={0}
                aria-label={`${meta.name}: ${enabled ? 'enabled' : 'disabled'}${isExternal ? ' (external)' : ''} — click to toggle`}
                aria-pressed={enabled}
                onClick={toggleTile}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleTile();
                  }
                }}
                sx={{
                  cursor: 'pointer',
                  opacity: enabled ? 1 : 0.4,
                  filter: enabled ? 'none' : 'grayscale(100%)',
                  borderRadius: 2,
                  // Dashed border for external services: signals
                  // "in your stack but not deployed by this bundle".
                  border: isExternal
                    ? '2px dashed var(--surge-accent)'
                    : '2px solid transparent',
                  p: 0.5,
                  background: 'var(--surge-panel-bg)',
                  transition: 'all 0.2s',
                  position: 'relative',
                  boxShadow: isFocused
                    ? '0 0 0 3px var(--surge-brand), 0 0 18px 4px rgba(7,147,143,0.6)'
                    : 'none',
                  transform: isFocused ? 'scale(1.04)' : 'scale(1)',
                  '&:hover': { boxShadow: 'none' },
                  '&:focus-visible': {
                    outline: '2px solid #07938f',
                    outlineOffset: 2,
                  },
                  width: 100,
                  height: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {warnings && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      backgroundColor: 'var(--surge-warning)',
                      color: 'var(--surge-card-bg)',
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: '18px',
                      textAlign: 'center',
                      zIndex: 2,
                      // Subtle ring so the badge stays readable on
                      // brighter logos (e.g. white-bg services).
                      boxShadow: '0 0 0 2px #181818',
                    }}
                  >
                    !
                  </Box>
                )}
                {isExternal && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      px: 0.5,
                      py: 0.125,
                      borderRadius: 0.5,
                      backgroundColor: 'var(--surge-accent)',
                      color: 'var(--surge-panel-bg)',
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      lineHeight: 1.4,
                      textTransform: 'uppercase',
                      fontFamily: 'monospace',
                      zIndex: 2,
                    }}
                    aria-hidden="true"
                  >
                    External
                  </Box>
                )}
                {meta.logo ? (
                  <img
                    src={meta.logo}
                    alt={meta.name}
                    style={{
                      width: 48,
                      height: 48,
                      display: 'block',
                      margin: '0 auto',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <LogoPlaceholder name={meta.name} />
                )}
                <Typography align="center" style={{ color: 'var(--surge-text-primary)', fontSize: 14, marginTop: 4 }}>
                  {meta.name}
                </Typography>
                {!enabled && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      bgcolor: 'rgba(40,40,40,0.6)',
                      borderRadius: 2,
                    }}
                  />
                )}
                {/* VPN-route shield — only rendered when Gluetun is
                    enabled AND this service does enough outbound
                    traffic to be worth routing. Click toggles the
                    config.vpnRoutedServices[key] flag, which the
                    compose renderer consumes to hoist this service's
                    ports onto gluetun + flip its network_mode. */}
                {vpnEnabled && VPN_ROUTABLE.has(key) && (
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label={`${meta.name}: ${
                      config?.vpnRoutedServices?.[key] ? 'routed' : 'not routed'
                    } through VPN — click to toggle`}
                    aria-pressed={!!config?.vpnRoutedServices?.[key]}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVpnRoute(key);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleVpnRoute(key);
                      }
                    }}
                    title={
                      config?.vpnRoutedServices?.[key]
                        ? 'Routing through Gluetun VPN — click to disable'
                        : 'Click to route this service through Gluetun VPN'
                    }
                    sx={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      width: 16, height: 16,
                      borderRadius: '50%',
                      backgroundColor: config?.vpnRoutedServices?.[key]
                        ? 'var(--surge-success)'
                        : 'rgba(7,147,143,0.4)',
                      color: 'var(--surge-text-primary)',
                      fontSize: 10,
                      lineHeight: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      zIndex: 3,
                      transition: 'background-color 0.15s',
                      '&:hover': { backgroundColor: 'var(--surge-success)' },
                      '&:focus-visible': {
                        outline: '2px solid #fff',
                        outlineOffset: 1,
                      },
                    }}
                  >
                    🛡
                  </Box>
                )}

                {/* "i" info button — opens details dialog without
                    toggling the tile's enabled state. Stops the click
                    from bubbling up to the tile's onClick handler. */}
                <Box
                  role="button"
                  tabIndex={0}
                  aria-label={`${meta.name} details`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailsKey(key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setDetailsKey(key);
                    }
                  }}
                  sx={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(7,147,143,0.4)',
                    color: 'var(--surge-text-primary)',
                    fontSize: 11,
                    fontWeight: 700,
                    fontStyle: 'italic',
                    lineHeight: '16px',
                    textAlign: 'center',
                    fontFamily: 'serif',  // crisper "i" rendering
                    cursor: 'pointer',
                    zIndex: 3,
                    transition: 'background-color 0.15s',
                    '&:hover':         { backgroundColor: '#07938f' },
                    '&:focus-visible': {
                      outline: '2px solid #fff',
                      outlineOffset: 1,
                    },
                  }}
                >
                  i
                </Box>
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      {/* CineSync settings panel — only visible when CineSync is enabled. */}
      {cinesyncEnabled && (
        <Box
          sx={{
            mt: 2,
            mx: 'auto',
            maxWidth: 720,
            background: 'var(--surge-panel-bg)',
            border: '1px solid var(--surge-border-subtle)',
            borderRadius: 2,
            p: 3,
          }}
        >
          <Typography
            style={{
              color: 'var(--surge-text-primary)',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            CineSync settings
          </Typography>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13, marginBottom: 16 }}>
            Each toggle controls both the CineSync subfolders that get
            created (via ANIME_SEPARATION / 4K_SEPARATION in CineSync's
            .env) and the matching Plex libraries Surge auto-creates.
            Defaults match what CineSync will populate — flip a toggle
            on and the next deploy adds both the folder and library.
          </Typography>

          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={cinesyncAnime}
                  onChange={(e) => setCinesyncSetting('animeSeparation', e.target.checked)}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#07938f' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                      backgroundColor: '#07938f',
                    },
                  }}
                />
              }
              label={
                <Box>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 14 }}>
                    Separate anime into its own folders + Plex libraries
                  </Typography>
                  <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12 }}>
                    Adds AnimeMovies/AnimeShows under CineSync's destination
                    and "Anime Movies (CineSync)" / "Anime Series (CineSync)"
                    libraries in Plex.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0, '& .MuiFormControlLabel-label': { mt: 0.5 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={cinesync4k}
                  onChange={(e) => setCinesyncSetting('fourKSeparation', e.target.checked)}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#07938f' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                      backgroundColor: '#07938f',
                    },
                  }}
                />
              }
              label={
                <Box>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 14 }}>
                    Separate 4K content into its own folders + Plex libraries
                  </Typography>
                  <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12 }}>
                    Adds 4KMovies/4KShows under CineSync's destination and
                    "4K Movies (CineSync)" / "4K Shows (CineSync)" libraries
                    in Plex.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0, '& .MuiFormControlLabel-label': { mt: 0.5 } }}
            />
          </Stack>
        </Box>
      )}

      {/* Service details modal — opens when user clicks the "i" icon
          on any tile. Shows the longer description, integration peers
          derived from the schema, port info, and an external link to
          the upstream repo. */}
      <Dialog
        open={!!detailsKey}
        onClose={() => setDetailsKey(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { background: 'var(--surge-panel-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border-subtle)' },
        }}
      >
        {detailsMeta && (
          <>
            <DialogTitle sx={{ color: 'var(--surge-text-primary)', borderBottom: '1px solid var(--surge-border-subtle)' }}>
              <Stack direction="row" spacing={2} alignItems="center">
                {detailsMeta.logo && (
                  <img
                    src={detailsMeta.logo}
                    alt={detailsMeta.name}
                    style={{ width: 32, height: 32, objectFit: 'contain' }}
                  />
                )}
                <Box>
                  <Typography variant="h6" style={{ color: 'var(--surge-text-primary)', lineHeight: 1.2 }}>
                    {detailsMeta.name}
                  </Typography>
                  <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12 }}>
                    {detailsMeta.category}
                  </Typography>
                </Box>
              </Stack>
            </DialogTitle>
            <DialogContent sx={{ color: 'var(--surge-text-secondary)', pt: 2 }}>
              {detailsMeta.desc && (
                <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 16 }}>
                  {detailsMeta.desc}
                </Typography>
              )}

              {/* Integrations summary — peers + media-server gates from
                  the schema. Same data the dependency-warning system
                  uses, just rendered as informational rather than as
                  warnings. */}
              {(() => {
                const peerSet = new Set();
                const mediaServerSet = new Set();
                if (detailsMeta.compose) {
                  walkEnvBlocks(detailsMeta.compose, (m) => {
                    collectGates(m, peerSet, mediaServerSet);
                  });
                }
                if (peerSet.size === 0 && mediaServerSet.size === 0) return null;
                return (
                  <Box sx={{ mb: 2 }}>
                    <Typography style={{
                      color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                      letterSpacing: 0.3, textTransform: 'uppercase',
                      marginBottom: 6,
                    }}>
                      Integrations
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
                      {[...peerSet].map((p) => (
                        <Chip key={`p-${p}`} size="small"
                          label={serviceMeta[p]?.name || p}
                          sx={{
                            background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                            border: '1px solid #07938f',
                          }}
                        />
                      ))}
                      {[...mediaServerSet].map((m) => (
                        <Chip key={`ms-${m}`} size="small"
                          label={`${m.charAt(0).toUpperCase() + m.slice(1)} (media server)`}
                          sx={{
                            background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                            border: '1px dashed #07938f',
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                );
              })()}

              {/* Ports — pulled from the compose template. Multi-container
                  services list every sub-container's port-mapped ports. */}
              {(() => {
                const ports = [];
                const c = detailsMeta.compose;
                if (c?.ports) ports.push(...c.ports);
                if (c?.services) {
                  for (const sub of Object.values(c.services)) {
                    if (sub.ports) ports.push(...sub.ports);
                  }
                }
                if (ports.length === 0) return null;
                return (
                  <Box sx={{ mb: 2 }}>
                    <Typography style={{
                      color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                      letterSpacing: 0.3, textTransform: 'uppercase',
                      marginBottom: 6,
                    }}>
                      Ports
                    </Typography>
                    <Typography style={{
                      color: 'var(--surge-text-secondary)', fontSize: 13,
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    }}>
                      {ports.join(', ')}
                    </Typography>
                  </Box>
                );
              })()}

              {/* External link to upstream repo. */}
              {detailsMeta.repo && (
                <Box>
                  <Typography style={{
                    color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                    letterSpacing: 0.3, textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    Upstream
                  </Typography>
                  <a
                    href={detailsMeta.repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#07938f', fontSize: 13 }}
                  >
                    {detailsMeta.repo}
                  </a>
                </Box>
              )}
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)' }}>
              <Button
                onClick={() => setDetailsKey(null)}
                sx={{ color: '#07938f' }}
              >
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
