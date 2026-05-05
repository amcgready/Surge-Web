import React from 'react';
import {
  Box, Typography, Button, Stack, Chip, Alert,
} from '@mui/material';
import { serviceMeta } from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';
import { parseImageRef, suggestPins } from './tagUpgradeUtils';

/**
 * TagUpgradePanel — surfaces image tag info for each enabled service
 * and lets the user check what versioned tags are available upstream.
 *
 * Why this exists: every default Surge image is `:latest`. That's fine
 * day one — the orchestrator pulls the newest stable. But after a
 * deploy is up and running, "latest" silently drifts whenever you
 * `docker compose pull`, which can break your stack on a Tuesday for
 * reasons unrelated to anything you did. The fix is to pin specific
 * tags. The README in the bundle already explains the manual edit;
 * this panel just helps with the "what version should I pin to?"
 * question by showing what's currently published.
 *
 * Mechanism:
 *   - For Docker Hub images (linuxserver/foo, vendor/foo): hit the
 *     Hub v2 tags API directly from the browser. Hub serves CORS.
 *   - For lscr.io/linuxserver/foo: same upstream as linuxserver/foo
 *     on Hub (lscr is a mirror). We strip the lscr.io/ prefix and
 *     query Hub.
 *   - For ghcr.io/* and other non-Hub registries: link out to the
 *     web UI (ghcr.io doesn't serve CORS). Browser automation only
 *     gets us so far.
 *
 * No persistence of pin choices yet — this is a one-way "show me what
 * to copy into compose.yaml" view. The bundle README explains the
 * manual edit flow. (A future improvement could add per-service pin
 * inputs that flow into the compose template, but that requires
 * schema and orchestrator changes; we'll do that when there's a
 * stronger product signal.)
 */

// Pull image refs out of all relevant services in the manifest.
//   { serviceKey: 'sonarr', containerName: 'sonarr', image: 'linuxserver/sonarr:latest' }
// Multi-container services emit one entry per sub-service.
function gatherImageRefs(enabledKeys, mediaServer) {
  const out = [];
  const allMeta = { ...serviceMeta, ...mediaServerMeta };
  const keys = [...new Set([
    ...(mediaServer ? [mediaServer] : []),
    ...enabledKeys,
  ])];

  for (const key of keys) {
    const meta    = allMeta[key];
    const compose = meta?.compose;
    if (!compose) continue;
    if (compose.image) {
      out.push({ serviceKey: key, containerName: key, image: compose.image });
    }
    if (compose.services) {
      for (const [subKey, sub] of Object.entries(compose.services)) {
        if (sub?.image) {
          out.push({
            serviceKey:    key,
            containerName: subKey,
            image:         sub.image,
          });
        }
      }
    }
  }
  return out;
}

// Fetch the most-recent tags from Docker Hub. We pull a healthy slice
// so we can pick out semver-looking tags from a stream that's
// otherwise dominated by daily/nightly tags.
async function fetchHubTags(namespace, repo) {
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags/`
            + `?page_size=50&ordering=last_updated`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Docker Hub returned HTTP ${res.status}`);
  const body = await res.json();
  return (body.results || []).map((t) => ({
    name:        t.name,
    lastUpdated: t.last_updated,
    digest:      t.digest || (t.images?.[0]?.digest) || null,
  }));
}

function relativeTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  const days = Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1)   return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30)  return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}


function ServiceImageRow({ entry }) {
  const parsed = parseImageRef(entry.image);
  const [status, setStatus]   = React.useState(null); // null|loading|ok|fail
  const [tags, setTags]       = React.useState([]);
  const [error, setError]     = React.useState(null);

  const handleCheck = async () => {
    if (!parsed?.isHub) return;
    setStatus('loading');
    setError(null);
    try {
      const all = await fetchHubTags(parsed.namespace, parsed.repo);
      setTags(suggestPins(all));
      setStatus('ok');
    } catch (err) {
      setError(err.message || String(err));
      setStatus('fail');
    }
  };

  // Build a fall-back "view tags" link when we can't auto-fetch.
  const externalUrl =
    parsed?.isHub
      ? `https://hub.docker.com/r/${parsed.namespace}/${parsed.repo}/tags`
      : parsed?.registry === 'ghcr.io'
        ? `https://github.com/${parsed.namespace}/${parsed.repo}/pkgs/container/${parsed.repo}`
        : null;

  return (
    <Box sx={{
      background:   'var(--surge-card-bg-inner)',
      border:       '1px solid var(--surge-border-subtle)',
      borderRadius: 1,
      p: 1.25,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography style={{
          color: 'var(--surge-text-primary)', fontWeight: 600, fontSize: 14,
          fontFamily: 'monospace',
        }}>
          {entry.image}
        </Typography>
        {parsed?.tag === 'latest' && (
          <Chip
            size="small"
            label="rolling tag"
            sx={{ background: 'transparent',
                  color: 'var(--surge-warning)',
                  border: '1px solid var(--surge-warning)' }}
          />
        )}
        {parsed?.tag !== 'latest' && parsed?.tag !== undefined && (
          <Chip
            size="small"
            label={`pinned: ${parsed.tag}`}
            sx={{ background: 'transparent',
                  color: 'var(--surge-success)',
                  border: '1px solid var(--surge-success)' }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        {parsed?.isHub ? (
          <Button
            size="small"
            onClick={handleCheck}
            disabled={status === 'loading'}
            variant="outlined"
            sx={{
              color: 'var(--surge-brand)',
              borderColor: 'var(--surge-brand)',
              textTransform: 'none',
              fontSize: 12,
            }}
          >
            {status === 'loading' ? 'Checking…' : 'Check upstream tags'}
          </Button>
        ) : externalUrl ? (
          <Button
            size="small"
            component="a"
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            sx={{
              color: 'var(--surge-brand)',
              borderColor: 'var(--surge-brand)',
              textTransform: 'none',
              fontSize: 12,
            }}
          >
            View tags ↗
          </Button>
        ) : null}
      </Box>

      {status === 'fail' && (
        <Alert severity="error" sx={{ mt: 1 }} variant="outlined">
          {error}{' '}
          {externalUrl && (
            <a href={externalUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--surge-brand)' }}>
              Browse upstream tags ↗
            </a>
          )}
        </Alert>
      )}

      {status === 'ok' && tags.length === 0 && (
        <Typography style={{
          color: 'var(--surge-text-dim)', fontSize: 12, marginTop: 6,
        }}>
          No semver-style tags found in the most recent 50 — this image only
          ships rolling tags. Pin via digest instead:{' '}
          <code style={{ color: 'var(--surge-accent)' }}>
            {entry.image.split(':')[0]}@sha256:&lt;digest&gt;
          </code>
        </Typography>
      )}

      {status === 'ok' && tags.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          <Typography style={{
            color: 'var(--surge-text-muted)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 0.3,
          }}>
            Suggested pins (most recent semver tags)
          </Typography>
          {tags.map((t) => {
            const pinned = `${entry.image.split(':')[0]}:${t.name}`;
            return (
              <Box key={t.name} sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                fontFamily: 'monospace', fontSize: 12,
              }}>
                <Typography style={{
                  color: 'var(--surge-accent)', fontFamily: 'monospace',
                  fontSize: 12,
                }}>
                  {pinned}
                </Typography>
                <Typography style={{
                  color: 'var(--surge-text-dim)', fontSize: 11,
                }}>
                  {relativeTime(t.lastUpdated)}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  onClick={() => navigator.clipboard?.writeText(pinned)}
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
          })}
        </Stack>
      )}
    </Box>
  );
}


export default function TagUpgradePanel({ enabled, mediaServer }) {
  const refs = React.useMemo(
    () => gatherImageRefs(enabled, mediaServer),
    [enabled, mediaServer],
  );

  if (refs.length === 0) {
    return (
      <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13 }}>
        Enable services in the previous step to see image-pin info.
      </Typography>
    );
  }

  // Group by serviceKey so multi-container services render together.
  const grouped = {};
  for (const r of refs) {
    if (!grouped[r.serviceKey]) grouped[r.serviceKey] = [];
    grouped[r.serviceKey].push(r);
  }

  return (
    <Stack spacing={1.5}>
      <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12 }}>
        Surge defaults every image to <code style={{ color: 'var(--surge-accent)' }}>:latest</code>.
        That's fine for first deploy but means your stack moves
        whenever upstream pushes. To pin to a specific version, copy
        the suggested tag below into <code style={{ color: 'var(--surge-accent)' }}>compose.yaml</code>.
        See <code style={{ color: 'var(--surge-accent)' }}>README.md</code> for
        the exact edit.
      </Typography>
      {Object.entries(grouped).map(([key, entries]) => (
        <Box key={key}>
          {entries.length > 1 && (
            <Typography style={{
              color: 'var(--surge-text-dim)', fontSize: 11,
              marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3,
            }}>
              {key} (multi-container)
            </Typography>
          )}
          <Stack spacing={0.75}>
            {entries.map((entry) => (
              <ServiceImageRow
                key={`${entry.serviceKey}:${entry.containerName}`}
                entry={entry}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
