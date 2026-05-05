import React from 'react';
import { Box, Typography, Chip, Stack, Button, Alert, TextField, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import HealthcheckPanel from './HealthcheckPanel';
import TagUpgradePanel from './TagUpgradePanel';
import PangolinRoutePreview from './PangolinRoutePreview';
import { generateComposePreview, previewToYaml } from './composePreview';
import { buildDeployBundle, triggerDownload } from './deployBundle';
import BundleInspector from './BundleInspector';

/**
 * ComposePreviewPanel — renders the read-only output of
 * generateComposePreview() so the user can see exactly what their
 * wizard choices would deploy.
 *
 * Sections:
 *   - Summary stat chips (containers, files, secrets, scripts).
 *   - Per-section JSON dumps in scrollable code blocks.
 *   - Warnings, when any.
 *
 * The preview is purely derived from `config` — no side effects, no
 * network calls, no actual deployment.
 */

// Build a Mermaid graph string from the compose preview's
// fetchScripts + postDeployScripts. Each entry's env declarations
// reference other services via fromService / fromServiceSecret /
// whenService — those are the directed edges we render.
//
// Returns null if there's nothing connected (no scripts referencing
// peers) — Mermaid would render an awkward empty graph otherwise.
function buildMermaidGraph(preview) {
  if (!preview) return null;
  const edges = new Set(); // "from-->to" entries, deduped
  const nodes = new Set();

  const addEdge = (from, to) => {
    if (!from || !to || from === to) return;
    nodes.add(from);
    nodes.add(to);
    edges.add(`${from}-->${to}`);
  };

  // Walk the resolved env values from the preview's scripts. Each
  // entry's value is a placeholder string like "<GENERATED:sonarr.apiKey>"
  // or "<RUNTIME-FETCH:plex.plexToken>" — we extract the target service.
  const scanScripts = (scripts, consumerKey) => {
    if (!scripts) return;
    for (const s of scripts) {
      const consumer = s.service;
      const env = s.env || {};
      for (const v of Object.values(env)) {
        if (typeof v !== 'string') continue;
        const generated = v.match(/^<GENERATED:([a-z0-9-]+)\./);
        if (generated && generated[1] !== consumer) addEdge(consumer, generated[1]);
        const runtime = v.match(/^<RUNTIME-FETCH:([a-z0-9-]+)\./);
        if (runtime && runtime[1] !== consumer) addEdge(consumer, runtime[1]);
      }
    }
    // referenced even if no env shape — note we have an entry for it
    if (scripts) for (const s of scripts) nodes.add(s.service);
  };
  scanScripts(preview.fetchScripts);
  scanScripts(preview.postDeployScripts);

  // Also capture container-env cross-references (e.g. Episeerr's env
  // block has SONARR_API_KEY=<GENERATED:sonarr.apiKey>).
  for (const [containerName, svc] of Object.entries(preview.services || {})) {
    const consumer = containerName.split('-')[0]; // strip any -postgres etc
    if (!svc.environment) continue;
    for (const line of svc.environment) {
      const m1 = line.match(/=<GENERATED:([a-z0-9-]+)\./);
      if (m1 && m1[1] !== consumer) addEdge(consumer, m1[1]);
      const m2 = line.match(/=<RUNTIME-FETCH:([a-z0-9-]+)\./);
      if (m2 && m2[1] !== consumer) addEdge(consumer, m2[1]);
    }
    nodes.add(consumer);
  }

  if (edges.size === 0) return null;

  // Build the Mermaid graph. flowchart LR (left-to-right) reads cleanly
  // for service dependency graphs. Nodes are auto-shaped to rounded
  // rectangles via the [text] syntax.
  const lines = ['flowchart LR'];
  for (const n of [...nodes].sort()) {
    lines.push(`  ${n}["${n}"]`);
  }
  for (const e of [...edges].sort()) {
    lines.push(`  ${e}`);
  }
  return lines.join('\n');
}


// Lazy-load Mermaid from CDN exactly once. Returns a promise that
// resolves to the global mermaid object. Subsequent calls return the
// cached promise so the script tag is never injected twice.
let mermaidLoadPromise = null;
function loadMermaid() {
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('No window — running in non-browser context'));
      return;
    }
    if (window.mermaid) {
      resolve(window.mermaid);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.async = true;
    script.onload = () => {
      window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
      resolve(window.mermaid);
    };
    script.onerror = () => reject(new Error('Failed to load Mermaid from CDN'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}


// Component that renders a Mermaid diagram. Dynamically loads Mermaid
// on first mount (only when the user opens the panel that contains
// this), so users who never expand the connection-graph section don't
// pay the ~2MB script cost.
function MermaidDiagram({ source, onNodeClick }) {
  const [svg, setSvg] = React.useState('');
  const [error, setError] = React.useState(null);
  const idRef = React.useRef(`mermaid-${Math.random().toString(36).slice(2)}`);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(idRef.current, source))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      });
    return () => { cancelled = true; };
  }, [source]);

  // Post-render: attach click handlers to each node so clicking a
  // service jumps the wizard to that service's tile. We can't use
  // React onClick because the SVG comes via dangerouslySetInnerHTML;
  // instead we walk g.node elements and bind native handlers. Match
  // the service key by reading the rendered node label (which equals
  // the source node ID by construction).
  React.useEffect(() => {
    if (!svg || !onNodeClick) return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    const nodes = root.querySelectorAll('g.node');
    const cleanups = [];
    nodes.forEach((g) => {
      const label = g.querySelector('.nodeLabel, span.nodeLabel');
      const key   = (label?.textContent || '').trim();
      if (!key) return;
      g.style.cursor = 'pointer';
      const handler = (e) => {
        e.stopPropagation();
        onNodeClick(key);
      };
      g.addEventListener('click', handler);
      // Keyboard: focus + Enter activates. SVG <g> isn't focusable
      // by default; tabindex makes it.
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Open ${key} in Service Selection`);
      const keyHandler = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNodeClick(key);
        }
      };
      g.addEventListener('keydown', keyHandler);
      cleanups.push(() => {
        g.removeEventListener('click', handler);
        g.removeEventListener('keydown', keyHandler);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [svg, onNodeClick]);

  if (error) {
    return (
      <Typography style={{ color: 'var(--surge-error)', fontSize: 12 }}>
        Couldn't render the diagram: {error}. (Likely a CDN connectivity
        issue — Mermaid loads from cdn.jsdelivr.net.)
      </Typography>
    );
  }
  if (!svg) {
    return (
      <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, fontStyle: 'italic' }}>
        Loading graph…
      </Typography>
    );
  }
  return (
    <Box
      ref={containerRef}
      sx={{
        '& svg': { maxWidth: '100%', height: 'auto' },
        // Hover affordance — node text gets a teal underline so users
        // know nodes are clickable.
        '& g.node:hover .nodeLabel': onNodeClick
          ? { textDecoration: 'underline', textDecorationColor: 'var(--surge-brand)' }
          : {},
        '& g.node:focus-visible': {
          outline: '2px solid var(--surge-brand)',
          outlineOffset: 2,
          borderRadius: 4,
        },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}


// Compute a bundle-diff between the user's last-downloaded config and
// the current wizard state. Used by the "What's changed since your
// last download?" panel above the Generate button.
//
// Returns null when no prior bundle is recorded (first download) or
// when nothing user-visible has changed. Otherwise returns:
//   { addedServices, removedServices, mediaServerChanged,
//     platformChanged, apiKeysAdded, apiKeysRemoved, ownershipChanged,
//     cinesyncTogglesChanged }
function computeBundleDiff(lastConfig, currentConfig) {
  if (!lastConfig) return null;

  const lastEnabled = new Set(
    Object.entries(lastConfig.contentEnhancement || {})
      .filter(([, v]) => v).map(([k]) => k),
  );
  const currentEnabled = new Set(
    Object.entries(currentConfig.contentEnhancement || {})
      .filter(([, v]) => v).map(([k]) => k),
  );

  const addedServices   = [...currentEnabled].filter((s) => !lastEnabled.has(s)).sort();
  const removedServices = [...lastEnabled].filter((s) => !currentEnabled.has(s)).sort();

  const mediaServerChanged =
    (lastConfig.mediaServer || '') !== (currentConfig.mediaServer || '');
  const platformChanged =
    (lastConfig.platform || '') !== (currentConfig.platform || '');
  const ownershipChanged =
    String(lastConfig.userId  || '') !== String(currentConfig.userId  || '') ||
    String(lastConfig.groupId || '') !== String(currentConfig.groupId || '') ||
    String(lastConfig.umask   || '') !== String(currentConfig.umask   || '');

  // Track only WHICH api keys went from empty → set or set → empty,
  // never the values themselves (sensitive).
  const apiKeyFields = [
    'tmdbApiKey', 'rdApiToken', 'adApiToken', 'premiumizeApiToken',
    'fanartApiKey', 'tvdbApiKey', 'mdblistApiKey', 'discordWebhook',
  ];
  const apiKeysAdded   = [];
  const apiKeysRemoved = [];
  for (const k of apiKeyFields) {
    const before = !!lastConfig[k];
    const after  = !!currentConfig[k];
    if (!before && after) apiKeysAdded.push(k);
    if (before && !after) apiKeysRemoved.push(k);
  }

  // CineSync settings toggles.
  const cinesyncTogglesChanged = [];
  for (const k of ['animeSeparation', 'fourKSeparation']) {
    const before = !!lastConfig.cinesyncSettings?.[k];
    const after  = !!currentConfig.cinesyncSettings?.[k];
    if (before !== after) {
      cinesyncTogglesChanged.push({ key: k, from: before, to: after });
    }
  }

  const hasChanges =
    addedServices.length > 0 ||
    removedServices.length > 0 ||
    mediaServerChanged ||
    platformChanged ||
    ownershipChanged ||
    apiKeysAdded.length > 0 ||
    apiKeysRemoved.length > 0 ||
    cinesyncTogglesChanged.length > 0;

  if (!hasChanges) return null;

  return {
    addedServices,
    removedServices,
    mediaServerChanged,
    platformChanged,
    ownershipChanged,
    apiKeysAdded,
    apiKeysRemoved,
    cinesyncTogglesChanged,
    lastMediaServer:    lastConfig.mediaServer || '',
    currentMediaServer: currentConfig.mediaServer || '',
    lastPlatform:       lastConfig.platform || '',
    currentPlatform:    currentConfig.platform || '',
  };
}


// Compute a re-deploy diff between a prior state.json and the current
// wizard config. Shows the user what will change and what stays put
// when they re-run the orchestrator with the new bundle.
//
// Returns { addedServices, removedServices, preservedSecrets,
//           preservedRuntimeValues }. Service names are derived from
// state.json's "secrets" key prefixes (format "<service>.<secretName>")
// since the prior config isn't in state.json.
function computeRedeployDiff(priorState, currentConfig) {
  if (!priorState) return null;
  const priorServices = new Set();
  for (const key of Object.keys(priorState.secrets || {})) {
    priorServices.add(key.split('.')[0]);
  }
  for (const key of Object.keys(priorState.runtimeValues || {})) {
    priorServices.add(key.split('.')[0]);
  }

  const enabled = new Set();
  if (currentConfig?.mediaServer) enabled.add(currentConfig.mediaServer);
  for (const [k, v] of Object.entries(currentConfig?.contentEnhancement || {})) {
    if (v) enabled.add(k);
  }

  const addedServices    = [...enabled].filter((s) => !priorServices.has(s)).sort();
  const removedServices  = [...priorServices].filter((s) => !enabled.has(s)).sort();
  const preservedSecrets = Object.keys(priorState.secrets || {})
    .filter((k) => enabled.has(k.split('.')[0]))
    .sort();
  const preservedRuntime = Object.keys(priorState.runtimeValues || {})
    .filter((k) => enabled.has(k.split('.')[0]))
    .sort();

  return {
    addedServices,
    removedServices,
    preservedSecrets,
    preservedRuntimeValues: preservedRuntime,
    hasChanges: addedServices.length + removedServices.length > 0,
  };
}


// Extracts a flat list of service URLs from the compose preview's
// resolved `services` map. Each entry: { container, port, label }.
// Multi-container services produce one row per port-mapped container
// (sub-containers without ports are skipped — they're not user-facing).
function extractServiceUrls(preview) {
  const urls = [];
  for (const [containerName, svc] of Object.entries(preview.services || {})) {
    if (!svc.ports || svc.ports.length === 0) continue;
    for (const portSpec of svc.ports) {
      // ports entries are strings of the form "HOST:CONTAINER" (sometimes
      // just "PORT" for same-port shorthand). Take the host side.
      const hostPort = String(portSpec).split(':')[0];
      if (!/^\d+$/.test(hostPort)) continue;
      urls.push({ container: containerName, port: hostPort });
    }
  }
  // Stable sort by port — matches what users see when scanning.
  urls.sort((a, b) => Number(a.port) - Number(b.port));
  return urls;
}


function StatChip({ label, value }) {
  return (
    <Chip
      label={`${value} ${label}`}
      size="small"
      sx={{
        background: 'var(--surge-panel-bg)',
        color: 'var(--surge-text-primary)',
        border: '1px solid #07938f',
        fontWeight: 500,
      }}
    />
  );
}

function CodeBlock({ children, maxHeight = 360 }) {
  return (
    <Box
      component="pre"
      sx={{
        background: '#0a0a0a',
        color: 'var(--surge-text-secondary)',
        border: '1px solid var(--surge-border-subtle)',
        borderRadius: 1,
        padding: 1.5,
        margin: 0,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        overflow: 'auto',
        maxHeight,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </Box>
  );
}

function Section({ title, count, children }) {
  if (count === 0) return null;
  return (
    <Box mt={3}>
      <Typography
        style={{
          color: 'var(--surge-text-primary)',
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 8,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        }}
      >
        {title} <span style={{ color: '#07938f' }}>({count})</span>
      </Typography>
      {children}
    </Box>
  );
}

function fmt(obj) {
  return JSON.stringify(obj, null, 2);
}

// "Copy compose YAML" button. Renders the preview to a YAML string
// client-side and pushes it to the clipboard. Confirms with a brief
// "Copied ✓" state so the user knows the click registered.
function CopyComposeButton({ preview, disabled }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef(null);

  const handleCopy = React.useCallback(async () => {
    try {
      const yaml = previewToYaml(preview);
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Clipboard API can fail in some browser contexts (no HTTPS,
      // no user gesture, denied permission). Fall back to a plain
      // alert with the YAML so the user can copy it manually.
      // eslint-disable-next-line no-alert
      window.prompt('Copy compose YAML (Ctrl/Cmd-C):', previewToYaml(preview));
    }
  }, [preview]);

  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <Button
      variant="outlined"
      onClick={handleCopy}
      disabled={disabled}
      sx={{
        color:       'var(--surge-brand)',
        borderColor: 'var(--surge-brand)',
        textTransform: 'none',
        '&:hover':   { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
      }}
    >
      {copied ? 'Copied ✓' : 'Copy compose YAML'}
    </Button>
  );
}


export default function ComposePreviewPanel({
  config, setConfig, setContentEnhancement, onJumpToService,
}) {
  // Compute the preview synchronously from config. No useEffect needed —
  // generateComposePreview is pure.
  const preview = React.useMemo(() => generateComposePreview(config), [config]);

  // Deploy bundle generation state.
  const [building, setBuilding] = React.useState(false);
  const [error, setError]       = React.useState(null);
  const [priorState, setPriorState] = React.useState(null);
  const stateInputRef = React.useRef(null);

  // Hostname/IP the user enters for the URL panel — informational only,
  // doesn't affect the bundle. Defaults to `localhost` so the URLs are
  // valid when the user runs the orchestrator on the deploy target and
  // checks the page from the same machine.
  const [host, setHost] = React.useState('localhost');
  const serviceUrls = React.useMemo(() => extractServiceUrls(preview), [preview]);
  const redeployDiff = React.useMemo(
    () => computeRedeployDiff(priorState, config),
    [priorState, config],
  );

  // Track the user's last-downloaded bundle config so we can show a
  // "what changed since last time?" diff above the Generate button.
  const [lastBundleConfig, setLastBundleConfig] = React.useState(null);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('surge-last-bundle-config');
      if (raw) setLastBundleConfig(JSON.parse(raw));
    } catch (err) {
      // Bad JSON or storage unavailable — silently skip the diff.
    }
  }, []);
  const bundleDiff = React.useMemo(
    () => computeBundleDiff(lastBundleConfig, config),
    [lastBundleConfig, config],
  );
  const mermaidGraph = React.useMemo(
    () => buildMermaidGraph(preview),
    [preview],
  );
  const [graphOpen, setGraphOpen] = React.useState(false);

  const handleStateUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Light shape validation — orchestrator's State.load is forgiving.
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('state.json must be a JSON object');
      }
      setPriorState(parsed);
    } catch (err) {
      setError(`Couldn't parse state.json: ${err.message}`);
      setPriorState(null);
      if (stateInputRef.current) stateInputRef.current.value = '';
    }
  };

  const clearPriorState = () => {
    setPriorState(null);
    if (stateInputRef.current) stateInputRef.current.value = '';
  };

  // Inspector "Load into wizard" callback. Replaces config +
  // contentEnhancement with the bundle's. Also pre-loads priorState
  // when the bundle had one (so the next download can preserve secrets).
  const handleLoadFromBundle = (bundleConfig, bundleState) => {
    if (setConfig && bundleConfig) {
      // Preserve any keys the bundle's config doesn't have so we don't
      // wipe out fields the wizard added since the bundle was made.
      setConfig((prev) => ({ ...prev, ...bundleConfig }));
      if (setContentEnhancement && bundleConfig.contentEnhancement) {
        setContentEnhancement((prev) => ({
          ...prev,
          ...bundleConfig.contentEnhancement,
        }));
      }
    }
    if (bundleState) setPriorState(bundleState);
  };

  const handleDownload = async () => {
    setError(null);
    setBuilding(true);
    try {
      const blob = await buildDeployBundle({ config, priorState });
      triggerDownload(blob, 'surge-deploy.zip');
      // Snapshot this config for next time's bundle-diff. localStorage
      // failures (quota / incognito) are non-fatal — the diff just
      // won't render on the next download.
      try {
        const snapshot = JSON.parse(JSON.stringify(config));
        localStorage.setItem('surge-last-bundle-config', JSON.stringify(snapshot));
        setLastBundleConfig(snapshot);
      } catch (err) {
        console.warn('Could not persist last-bundle-config:', err);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBuilding(false);
    }
  };

  const containerCount = Object.keys(preview.services).length;
  const fileCount = preview.files.length;
  const secretCount = Object.keys(preview.secrets).length;
  const scriptCount = preview.fetchScripts.length + preview.postDeployScripts.length;
  const networkCount = Object.keys(preview.networks).length;

  const isEmpty = containerCount === 0;

  return (
    <Box>
      <Typography
        variant="h6"
        style={{ color: 'var(--surge-text-primary)', marginBottom: 4 }}
      >
        Deploy Preview
      </Typography>
      <Typography
        style={{ color: 'var(--surge-text-muted)', fontSize: 13, marginBottom: 16 }}
      >
        Summary of what Surge will deploy with your current wizard
        selections. Click <em>Generate deploy bundle</em> below to
        download a tarball you can run on your target host (Unraid via
        SSH or User Scripts; Docker host via <code>./run.sh</code>).
      </Typography>

      {/* Deploy bundle controls */}
      <Box
        sx={{
          mb: 3,
          p: 2,
          background: '#0d1f1e',
          border: '1px solid #07938f',
          borderRadius: 1,
        }}
      >
        <Typography
          style={{ color: 'var(--surge-text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 8 }}
        >
          Generate deploy bundle
        </Typography>
        <Typography
          style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}
        >
          The bundle is a self-contained ZIP with the orchestrator,
          configure scripts, manifest, and your config — everything
          needed to run a deploy on your target host. The orchestrator
          handles secret generation, cross-service wiring, and
          docker-compose start-up. Re-running the bundle is idempotent.
        </Typography>

        {/* Bundle diff — what's changed since the user's last
            download. Helps catch accidental config drift before
            re-deploying. */}
        {bundleDiff && (
          <Box sx={{
            mb: 2,
            p: 1.5,
            background: 'var(--surge-panel-bg)',
            border: '1px solid var(--surge-border-subtle)',
            borderRadius: 1,
          }}>
            <Typography style={{
              color: 'var(--surge-warning)', fontSize: 12, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              Changes since your last download
            </Typography>
            <Box sx={{ fontSize: 12, color: 'var(--surge-text-secondary)', lineHeight: 1.6 }}>
              {bundleDiff.platformChanged && (
                <Box>
                  ↻ platform: {bundleDiff.lastPlatform || '(none)'} →{' '}
                  <strong>{bundleDiff.currentPlatform || '(none)'}</strong>
                </Box>
              )}
              {bundleDiff.mediaServerChanged && (
                <Box>
                  ↻ media server: {bundleDiff.lastMediaServer || '(none)'} →{' '}
                  <strong>{bundleDiff.currentMediaServer || '(none)'}</strong>
                </Box>
              )}
              {bundleDiff.addedServices.length > 0 && (
                <Box>
                  <span style={{ color: 'var(--surge-success)', fontWeight: 700 }}>+</span>{' '}
                  added: {bundleDiff.addedServices.join(', ')}
                </Box>
              )}
              {bundleDiff.removedServices.length > 0 && (
                <Box>
                  <span style={{ color: 'var(--surge-error)', fontWeight: 700 }}>−</span>{' '}
                  removed: {bundleDiff.removedServices.join(', ')}
                </Box>
              )}
              {bundleDiff.apiKeysAdded.length > 0 && (
                <Box>
                  <span style={{ color: 'var(--surge-success)', fontWeight: 700 }}>+</span>{' '}
                  filled in: {bundleDiff.apiKeysAdded.join(', ')}
                </Box>
              )}
              {bundleDiff.apiKeysRemoved.length > 0 && (
                <Box>
                  <span style={{ color: 'var(--surge-error)', fontWeight: 700 }}>−</span>{' '}
                  cleared: {bundleDiff.apiKeysRemoved.join(', ')}
                </Box>
              )}
              {bundleDiff.ownershipChanged && (
                <Box>↻ PUID/PGID/UMASK changed</Box>
              )}
              {bundleDiff.cinesyncTogglesChanged.length > 0 && (
                <Box>
                  ↻ CineSync toggles:{' '}
                  {bundleDiff.cinesyncTogglesChanged
                    .map((t) => `${t.key}: ${t.from} → ${t.to}`)
                    .join(', ')}
                </Box>
              )}
            </Box>
          </Box>
        )}

        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            disabled={building || isEmpty}
            onClick={handleDownload}
            sx={{
              background: '#07938f',
              color:      'var(--surge-text-primary)',
              fontWeight: 600,
              '&:hover':  { background: '#065a57' },
              '&.Mui-disabled': { background: 'var(--surge-border)', color: 'var(--surge-text-dim)' },
            }}
          >
            {building ? 'Building bundle…' : 'Generate deploy bundle'}
          </Button>

          {/* Copy compose YAML — quicker iteration loop than the full
              bundle download when the user just wants to eyeball or
              hand-edit the compose document. Output is a best-effort
              client-side render of what the orchestrator would write. */}
          <CopyComposeButton preview={preview} disabled={isEmpty} />

          <Button
            variant="outlined"
            component="label"
            sx={{
              color:        '#07938f',
              borderColor:  '#07938f',
              '&:hover':    { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
            }}
          >
            {priorState ? 'state.json loaded ✓' : 'Upload prior state.json (optional)'}
            <input
              ref={stateInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={handleStateUpload}
            />
          </Button>

          {priorState && (
            <Button
              size="small"
              onClick={clearPriorState}
              sx={{ color: 'var(--surge-text-muted)', textTransform: 'none' }}
            >
              clear
            </Button>
          )}
          <BundleInspector onLoadIntoWizard={handleLoadFromBundle} />
        </Stack>

        {priorState && redeployDiff && (
          <Box sx={{ mt: 2 }}>
            <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 8 }}>
              Re-using {redeployDiff.preservedSecrets.length} secret(s) and
              {' '}{redeployDiff.preservedRuntimeValues.length} runtime
              value(s) from your uploaded state.json — already-running
              services keep their credentials.
            </Typography>
            {redeployDiff.hasChanges ? (
              <Box sx={{
                background: 'var(--surge-panel-bg)',
                border: '1px solid var(--surge-border-subtle)',
                borderRadius: 1,
                p: 1.5,
              }}>
                <Typography style={{
                  color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                  letterSpacing: 0.3, textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  Re-deploy diff vs uploaded state
                </Typography>
                {redeployDiff.addedServices.length > 0 && (
                  <Box sx={{ mb: 0.5 }}>
                    <Typography
                      component="span"
                      style={{ color: 'var(--surge-success)', fontSize: 12,
                               fontWeight: 700, marginRight: 6 }}
                    >
                      +
                    </Typography>
                    <Typography
                      component="span"
                      style={{ color: 'var(--surge-text-secondary)', fontSize: 12 }}
                    >
                      adding: {redeployDiff.addedServices.join(', ')}
                    </Typography>
                  </Box>
                )}
                {redeployDiff.removedServices.length > 0 && (
                  <Box>
                    <Typography
                      component="span"
                      style={{ color: 'var(--surge-error)', fontSize: 12,
                               fontWeight: 700, marginRight: 6 }}
                    >
                      −
                    </Typography>
                    <Typography
                      component="span"
                      style={{ color: 'var(--surge-text-secondary)', fontSize: 12 }}
                    >
                      removing: {redeployDiff.removedServices.join(', ')}
                    </Typography>
                    <Typography
                      style={{ color: 'var(--surge-text-dim)', fontSize: 11, marginTop: 4,
                               marginLeft: 18 }}
                    >
                      (stopped containers; their persisted state.json
                      entries stay archived in case you re-add later)
                    </Typography>
                  </Box>
                )}
              </Box>
            ) : (
              <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 12, fontStyle: 'italic' }}>
                Same set of services as your uploaded state — re-deploy
                will just refresh containers with any config edits.
              </Typography>
            )}
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Box>

      {/* Service URLs — where to visit each service after the bundle
          deploys. Updates live as the user enters their host. Stays
          hidden until the user has at least one port-mapped service. */}
      {serviceUrls.length > 0 && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            background: 'var(--surge-panel-bg)',
            border: '1px solid var(--surge-border-subtle)',
            borderRadius: 1,
          }}
        >
          <Typography
            style={{
              color: 'var(--surge-text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 4,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}
          >
            Service URLs after deploy
          </Typography>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
            Where to point your browser once the orchestrator finishes.
            Set the hostname / IP of your deploy target below and the
            links update.
          </Typography>
          <TextField
            value={host}
            onChange={(e) => setHost(e.target.value || 'localhost')}
            placeholder="hostname or IP"
            size="small"
            label="Host"
            sx={{
              mb: 1.5,
              minWidth: 240,
              '& .MuiInputBase-root':   { background: '#0a0a0a', color: 'var(--surge-text-primary)' },
              '& .MuiInputLabel-root':  { color: 'var(--surge-text-dim)' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--surge-border-subtle)' },
              '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#07938f !important',
              },
            }}
          />
          <Box
            component="ul"
            sx={{ m: 0, pl: 2, color: 'var(--surge-text-secondary)', fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
          >
            {serviceUrls.map(({ container, port }) => {
              const url = `http://${host}:${port}`;
              return (
                <li key={`${container}-${port}`} style={{ padding: '2px 0' }}>
                  <span style={{ color: 'var(--surge-text-dim)', minWidth: 120, display: 'inline-block' }}>
                    {container}
                  </span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#07938f', textDecoration: 'none' }}
                  >
                    {url}
                  </a>
                </li>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Summary chips */}
      <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
        <StatChip value={containerCount} label="containers" />
        <StatChip value={networkCount} label="networks" />
        <StatChip value={fileCount} label="config files" />
        <StatChip value={secretCount} label="secrets" />
        <StatChip value={scriptCount} label="scripts" />
      </Stack>

      {/* Plain-English deploy plan — expandable so it doesn't crowd the
          Deploy step but is one click away if the user wants to know
          exactly what `./run.sh` will do on their target host. */}
      {!isEmpty && (
        <Accordion
          sx={{
            mt: 3,
            background: '#0d1f1e',
            border: '1px solid var(--surge-border-subtle)',
            color: 'var(--surge-text-secondary)',
            '&::before': { display: 'none' },
            '& .MuiAccordionSummary-root': {
              minHeight: 48,
              '&.Mui-expanded': { minHeight: 48 },
            },
          }}
        >
          <AccordionSummary
            expandIcon={<Box sx={{ color: '#07938f', fontSize: 16 }}>▾</Box>}
          >
            <Typography style={{
              color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              What will the orchestrator do?
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13, marginBottom: 12 }}>
              When you run <code style={{ color: 'var(--surge-accent)' }}>./run.sh</code> from
              the bundle on your target host, the orchestrator will:
            </Typography>
            <Box component="ol" sx={{
              m: 0, pl: 3, color: 'var(--surge-text-secondary)', fontSize: 13, lineHeight: 1.7,
              '& code': { color: 'var(--surge-accent)', fontSize: 12 },
            }}>
              {secretCount > 0 && (
                <li>
                  Generate {secretCount} random secret{secretCount === 1 ? '' : 's'}{' '}
                  (apiKeys, JWT keys, admin passwords) and persist them to{' '}
                  <code>.surge/state.json</code>.
                </li>
              )}
              {fileCount > 0 && (
                <li>
                  Write {fileCount} pre-seeded config file{fileCount === 1 ? '' : 's'}{' '}
                  (Servarr <code>config.xml</code>, CineSync <code>.env</code>, etc.)
                  with secrets and your wizard values substituted in.
                </li>
              )}
              <li>
                Render <code>compose.yaml</code> from the schema, resolving every
                cross-service reference (Bazarr's Sonarr key, Plex's library paths,
                CineSync's source/destination, etc.).
              </li>
              <li>
                Run <code>docker compose up -d</code> to start{' '}
                {containerCount} container{containerCount === 1 ? '' : 's'}
                {networkCount > 0 ? ` on ${networkCount} private network${networkCount === 1 ? '' : 's'}` : ''}.
              </li>
              {preview.fetchScripts.length > 0 && (
                <li>
                  Run {preview.fetchScripts.length} fetchScript{preview.fetchScripts.length === 1 ? '' : 's'}{' '}
                  to capture runtime values that don't exist until after first launch
                  (e.g. Plex's X-Plex-Token, Jellyfin's autogenerated apiKey + userId).
                </li>
              )}
              {preview.postDeployScripts.length > 0 && (
                <li>
                  Run {preview.postDeployScripts.length} configure script{preview.postDeployScripts.length === 1 ? '' : 's'}{' '}
                  to wire cross-service connections via each service's API
                  (Sonarr ↔ SABnzbd, Bazarr ↔ Sonarr/Radarr, Plex library
                  auto-creation, Tautulli ↔ Plex, etc.).
                </li>
              )}
              <li>
                Save the final state to <code>.surge/state.json</code> so re-runs
                reuse secrets without rotating them.
              </li>
            </Box>
            <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 11, marginTop: 12 }}>
              All of this is idempotent — re-running <code style={{ color: 'var(--surge-accent)' }}>./run.sh</code>{' '}
              after editing <code style={{ color: 'var(--surge-accent)' }}>config.json</code> picks up
              what changed and skips the rest.
            </Typography>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Cross-service connection graph — Mermaid renders the directed
          graph of "who references whose secrets/runtime values". Lazy-
          loaded: Mermaid (~2MB) only fetches when the user opens this. */}
      {mermaidGraph && (
        <Accordion
          expanded={graphOpen}
          onChange={(_, exp) => setGraphOpen(exp)}
          sx={{
            mt: 1,
            background: '#0d1f1e',
            border: '1px solid var(--surge-border-subtle)',
            color: 'var(--surge-text-secondary)',
            '&::before': { display: 'none' },
            '& .MuiAccordionSummary-root': {
              minHeight: 48,
              '&.Mui-expanded': { minHeight: 48 },
            },
          }}
        >
          <AccordionSummary
            expandIcon={<Box sx={{ color: '#07938f', fontSize: 16 }}>▾</Box>}
          >
            <Typography style={{
              color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Cross-service connection graph
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
              Each arrow shows a service consuming another service's secret
              or runtime-fetched value (e.g. <code style={{ color: 'var(--surge-accent)' }}>bazarr → sonarr</code>{' '}
              means Bazarr's configure script reads Sonarr's apiKey).
              Built directly from the schema's marker resolution.
            </Typography>
            {/* Only mount MermaidDiagram once the accordion has been
                opened — that way users who never expand it pay zero
                bytes for Mermaid. */}
            {graphOpen && (
              <MermaidDiagram
                source={mermaidGraph}
                onNodeClick={onJumpToService}
              />
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Post-deploy healthcheck reference + live-status uploader. Always
          available (we know the healthcheck shape from the schema even
          before the user has deployed); upgrades to a live status panel
          when the user uploads .surge/status.json from a deploy host. */}
      {!isEmpty && (
        <Accordion
          sx={{
            mt: 1,
            background: '#0d1f1e',
            border: '1px solid var(--surge-border-subtle)',
            color: 'var(--surge-text-secondary)',
            '&::before': { display: 'none' },
            '& .MuiAccordionSummary-root': {
              minHeight: 48,
              '&.Mui-expanded': { minHeight: 48 },
            },
          }}
        >
          <AccordionSummary
            expandIcon={<Box sx={{ color: '#07938f', fontSize: 16 }}>▾</Box>}
          >
            <Typography style={{
              color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Healthcheck reference + live status
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
              Each enabled service ships with a healthcheck that Docker
              runs every 30s by default. Below are the actual probe
              commands — run them yourself if a service looks stuck. Drop
              a <code style={{ color: 'var(--surge-accent)' }}>status.json</code>{' '}
              produced by <code style={{ color: 'var(--surge-accent)' }}>
                surge_orchestrator.py --status
              </code> to see live state.
            </Typography>
            <HealthcheckPanel
              enabled={Object.keys(preview.services)}
              mediaServer={config.mediaServer}
            />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Pangolin route preview — only meaningful when Newt is
          enabled. Rendered as a copy-paste checklist for the user to
          configure inside their Pangolin instance's UI. */}
      {!isEmpty && config?.contentEnhancement?.newt && (
        <Accordion
          sx={{
            mt: 1,
            background: '#0d1f1e',
            border: '1px solid var(--surge-border-subtle)',
            color: 'var(--surge-text-secondary)',
            '&::before': { display: 'none' },
            '& .MuiAccordionSummary-root': {
              minHeight: 48,
              '&.Mui-expanded': { minHeight: 48 },
            },
          }}
        >
          <AccordionSummary
            expandIcon={<Box sx={{ color: '#07938f', fontSize: 16 }}>▾</Box>}
          >
            <Typography style={{
              color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Pangolin route preview
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <PangolinRoutePreview
              enabled={Object.keys(preview.services)}
              mediaServer={config.mediaServer}
              pangolinEndpoint={config.pangolinEndpoint}
            />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Image-tag upgrade panel — checks Docker Hub for newer
          semver-style tags so users can pin away from `:latest`. */}
      {!isEmpty && (
        <Accordion
          sx={{
            mt: 1,
            background: '#0d1f1e',
            border: '1px solid var(--surge-border-subtle)',
            color: 'var(--surge-text-secondary)',
            '&::before': { display: 'none' },
            '& .MuiAccordionSummary-root': {
              minHeight: 48,
              '&.Mui-expanded': { minHeight: 48 },
            },
          }}
        >
          <AccordionSummary
            expandIcon={<Box sx={{ color: '#07938f', fontSize: 16 }}>▾</Box>}
          >
            <Typography style={{
              color: 'var(--surge-text-primary)', fontSize: 13, fontWeight: 600,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Image tags + pin suggestions
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TagUpgradePanel
              enabled={Object.keys(preview.services)}
              mediaServer={config.mediaServer}
            />
          </AccordionDetails>
        </Accordion>
      )}

      {isEmpty && (
        <Box
          mt={3}
          p={2}
          sx={{
            background: 'rgba(255,179,0,0.08)',
            border: '1px solid rgba(255,179,0,0.4)',
            borderRadius: 1,
          }}
        >
          <Typography style={{ color: 'var(--surge-warning)', fontSize: 14, fontWeight: 600 }}>
            Nothing selected to deploy
          </Typography>
          <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13, marginTop: 4 }}>
            Pick a Media Server and / or enable services on the
            Additional Services step. The preview will populate once
            your config has at least one service to deploy.
          </Typography>
        </Box>
      )}

      <Section title="Containers" count={containerCount}>
        <CodeBlock>{fmt(preview.services)}</CodeBlock>
      </Section>

      <Section title="Networks" count={networkCount}>
        <CodeBlock maxHeight={140}>{fmt(preview.networks)}</CodeBlock>
      </Section>

      <Section title="Generated config files" count={fileCount}>
        <CodeBlock>{fmt(preview.files)}</CodeBlock>
      </Section>

      <Section title="Generated secrets" count={secretCount}>
        <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 6 }}>
          Each name below will be backed by a unique random value the
          backend generates at install time and persists across redeploys.
        </Typography>
        <CodeBlock maxHeight={200}>{fmt(preview.secrets)}</CodeBlock>
      </Section>

      <Section
        title="Post-deploy scripts"
        count={preview.postDeployScripts.length}
      >
        <CodeBlock maxHeight={240}>{fmt(preview.postDeployScripts)}</CodeBlock>
      </Section>

      <Section title="Fetch scripts" count={preview.fetchScripts.length}>
        <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 6 }}>
          Scripts that read runtime values out of services that
          generate their own credentials (Plex token, Jellyfin / Emby
          API keys). Output gets injected into downstream services'
          env via the <code>fromService</code> marker.
        </Typography>
        <CodeBlock maxHeight={240}>{fmt(preview.fetchScripts)}</CodeBlock>
      </Section>

      {preview.warnings.length > 0 && (
        <Section title="Warnings" count={preview.warnings.length}>
          <CodeBlock maxHeight={200}>{fmt(preview.warnings)}</CodeBlock>
        </Section>
      )}
    </Box>
  );
}
