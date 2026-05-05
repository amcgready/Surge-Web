import React from 'react';
import {
  Box, Typography, Button, Stack, Chip,
} from '@mui/material';
import { serviceMeta } from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';

/**
 * PangolinRoutePreview — render a copyable list of (subdomain → target)
 * entries that the user should configure as resources inside their
 * Pangolin instance.
 *
 * Pangolin's model: a Site (the user's Surge home network, connected
 * via Newt) hosts Resources, each of which is "subdomain.parent →
 * internal-address:port". Surge can derive every internal address
 * from the schema (container name + first published port). The
 * subdomain is the service key by default — the user can rename
 * inside Pangolin.
 *
 * Routes are intentionally NOT configured by Surge itself: Pangolin's
 * UI is the source of truth there (auth policies, custom subdomains,
 * etc. all live on the Pangolin side). This panel just gives the user
 * a checklist they can paste in.
 */

// Pull (containerName, port) for each enabled service that publishes
// a port. Multi-container services emit one row per sub-container
// that has a port.
function gatherRoutes(enabledKeys, mediaServer) {
  const allMeta = { ...serviceMeta, ...mediaServerMeta };
  const keys = [...new Set([
    ...(mediaServer ? [mediaServer] : []),
    ...enabledKeys,
  ])];
  // Skip the networking add-ons themselves — neither newt nor
  // gluetun runs a UI we'd want to publicly expose.
  const SKIP = new Set(['newt', 'gluetun']);

  const out = [];
  for (const key of keys) {
    if (SKIP.has(key)) continue;
    const meta    = allMeta[key];
    const compose = meta?.compose;
    if (!compose) continue;

    const single = (containerName, ports) => {
      const port = firstHostPort(ports);
      if (!port) return null;
      return { subdomain: containerName, target: `${containerName}:${port}` };
    };

    if (compose.image) {
      const row = single(key, compose.ports || []);
      if (row) out.push(row);
    }
    if (compose.services) {
      for (const [subKey, sub] of Object.entries(compose.services)) {
        if (sub?.image) {
          const cname = subKey === key ? key : `${key}-${subKey}`;
          const row = single(cname, sub.ports || []);
          if (row) out.push(row);
        }
      }
    }
  }
  return out;
}

// "8989:8989" → "8989"; "0.0.0.0:32400:32400" → "32400". We want the
// container-side port (after the LAST colon) since the route target
// is the container's listen port, not the host bind.
function firstHostPort(ports) {
  if (!ports || ports.length === 0) return null;
  const first = String(ports[0]);
  const segs = first.split(':');
  const last = segs[segs.length - 1];
  // Strip optional /tcp /udp suffix.
  return last.split('/')[0];
}


function RouteRow({ route, parentDomain }) {
  const subdomain   = route.subdomain;
  const fullDomain  = parentDomain
    ? `${subdomain}.${parentDomain}`
    : `${subdomain}.<your-domain>`;
  const target = `http://${route.target}`;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, py: 0.5, flexWrap: 'wrap',
    }}>
      <Typography style={{
        color: 'var(--surge-text-primary)', fontFamily: 'monospace', fontSize: 12,
        minWidth: 200,
      }}>
        {fullDomain}
      </Typography>
      <Box component="span" sx={{ color: 'var(--surge-text-dim)' }}>→</Box>
      <Typography style={{
        color: 'var(--surge-accent)', fontFamily: 'monospace', fontSize: 12,
      }}>
        {target}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        onClick={() => navigator.clipboard?.writeText(`${fullDomain} -> ${target}`)}
        sx={{
          color: 'var(--surge-text-muted)',
          textTransform: 'none',
          fontSize: 11,
          minWidth: 0,
          px: 1,
        }}
      >
        copy
      </Button>
    </Box>
  );
}


export default function PangolinRoutePreview({ enabled, mediaServer, pangolinEndpoint }) {
  const routes = React.useMemo(
    () => gatherRoutes(enabled, mediaServer),
    [enabled, mediaServer],
  );

  // Best-effort: pull a parent domain out of the Pangolin endpoint.
  // pangolin.example.com → example.com so the preview can suggest
  // "sonarr.example.com" instead of "<your-domain>".
  const parentDomain = React.useMemo(() => {
    if (!pangolinEndpoint) return null;
    try {
      const url = new URL(pangolinEndpoint);
      const host = url.hostname;
      const parts = host.split('.');
      // pangolin.example.com → example.com (drop the first label).
      // example.com → example.com (no change — likely already root).
      return parts.length > 2 ? parts.slice(1).join('.') : host;
    } catch (err) {
      return null;
    }
  }, [pangolinEndpoint]);

  if (routes.length === 0) {
    return (
      <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13 }}>
        Enable services that publish ports to see Pangolin routes.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
        Configure these as resources inside your Pangolin instance.
        Each row maps a public subdomain to an internal{' '}
        <code style={{ color: 'var(--surge-accent)' }}>container:port</code>.
        Pangolin UI: <em>Sites → your site → Resources → Add resource</em>.
      </Typography>

      {!parentDomain && (
        <Chip
          size="small"
          label="Add Pangolin endpoint above to see fully-qualified subdomains"
          sx={{
            mb: 1.5,
            background: 'transparent',
            color: 'var(--surge-warning)',
            border: '1px solid var(--surge-warning)',
          }}
        />
      )}

      <Stack spacing={0.25} sx={{
        background: 'var(--surge-card-bg-inner)',
        border: '1px solid var(--surge-border-subtle)',
        borderRadius: 1,
        p: 1.5,
      }}>
        {routes.map((r) => (
          <RouteRow key={r.subdomain} route={r} parentDomain={parentDomain} />
        ))}
      </Stack>

      <Box sx={{
        mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1,
      }}>
        <Button
          size="small"
          onClick={() => {
            const lines = routes.map((r) => {
              const fqdn = parentDomain
                ? `${r.subdomain}.${parentDomain}`
                : `${r.subdomain}.<your-domain>`;
              return `${fqdn} -> http://${r.target}`;
            });
            navigator.clipboard?.writeText(lines.join('\n'));
          }}
          variant="outlined"
          sx={{
            color: 'var(--surge-brand)',
            borderColor: 'var(--surge-brand)',
            textTransform: 'none',
            fontSize: 12,
            '&:hover': { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
          }}
        >
          Copy all routes
        </Button>
      </Box>
    </Box>
  );
}

// Exported for tests.
export const __testables = { gatherRoutes, firstHostPort };
