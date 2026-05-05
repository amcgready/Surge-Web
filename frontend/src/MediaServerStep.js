import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
// ...import any other components, hooks, or assets needed for step 1...

// Plex claim tokens are valid for ~4 minutes from generation. We can't
// know exactly when the user generated theirs (we only see when they
// pasted it), but we can give them a "you have N minutes left" countdown
// from the moment a non-empty value first lands in PLEX_CLAIM. Helps
// catch the most common deploy gotcha (stale claim token).
const PLEX_CLAIM_LIFETIME_MS = 4 * 60 * 1000;

function PlexClaimCountdown({ token }) {
  // Records the timestamp when a non-empty token first appeared in
  // this session. Resets if token is cleared or replaced with a
  // different non-empty value.
  const [pastedAt, setPastedAt] = React.useState(null);
  const lastSeenRef = React.useRef('');
  // Tick every second so the countdown re-renders.
  const [, forceTick] = React.useState(0);

  React.useEffect(() => {
    if (token && token !== lastSeenRef.current) {
      // New non-empty value (either freshly pasted or replaced).
      setPastedAt(Date.now());
    } else if (!token) {
      setPastedAt(null);
    }
    lastSeenRef.current = token || '';
  }, [token]);

  React.useEffect(() => {
    if (!pastedAt) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [pastedAt]);

  if (!pastedAt) return null;

  const remainingMs = PLEX_CLAIM_LIFETIME_MS - (Date.now() - pastedAt);
  const expired = remainingMs <= 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');

  // Color tier: >2min green, 1-2min yellow, <1min orange, expired red.
  let color = 'var(--surge-success)';
  if (expired) color = 'var(--surge-error)';
  else if (remainingMs < 60_000) color = '#ff7043';
  else if (remainingMs < 120_000) color = 'var(--surge-warning)';

  return (
    <Typography
      style={{ color, fontSize: 12, marginTop: 4, fontFamily: 'monospace' }}
    >
      {expired
        ? '⚠ Token has likely expired — get a fresh one before deploying.'
        : `⏱ ${mm}:${ss} remaining (estimated, from when you pasted)`}
    </Typography>
  );
}

const Step1 = ({ config, setConfig, coreServers }) => {
  return (
    <Box>
      <Typography variant="h6" align="center" style={{ color: 'var(--surge-text-primary)', marginBottom: 16 }}>Core Media Server</Typography>
      <Box display="flex" gap={3} mb={3} justifyContent="center">
        {coreServers.map((srv) => (
          <Tooltip key={srv.key} title={srv.desc} placement="top">
            <Box
              role="button"
              tabIndex={0}
              aria-label={`${srv.name}: ${config.mediaServer === srv.key ? 'selected' : 'not selected'} — click to ${config.mediaServer === srv.key ? 'deselect' : 'select'}`}
              aria-pressed={config.mediaServer === srv.key}
              onClick={() => setConfig((prev) => ({ ...prev, mediaServer: prev.mediaServer === srv.key ? '' : srv.key }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setConfig((prev) => ({ ...prev, mediaServer: prev.mediaServer === srv.key ? '' : srv.key }));
                }
              }}
              sx={{
                cursor: 'pointer',
                opacity: config.mediaServer === srv.key ? 1 : 0.4,
                filter: config.mediaServer === srv.key ? 'none' : 'grayscale(100%)',
                border: config.mediaServer === srv.key ? '2px solid #07938f' : '2px solid var(--surge-border)',
                borderRadius: 2,
                p: 3,
                background: 'var(--surge-panel-bg)',
                transition: 'all 0.2s',
                position: 'relative',
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
                '&:focus-visible': {
                  outline: '2px solid #07938f',
                  outlineOffset: 2,
                },
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 220,
                minWidth: 220
              }}
            >
              <img src={srv.logo} alt={srv.name} style={{ width: 128, height: 128, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
              {config.mediaServer !== srv.key && (
                <Box sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  bgcolor: 'rgba(40,40,40,0.6)',
                  borderRadius: 2
                }} />
              )}
            </Box>
          </Tooltip>
        ))}
      </Box>
      {/* Media Server Configuration */}
      {config.mediaServer && (
        <Box mt={4} p={2} sx={{ background: 'var(--surge-card-bg)', borderRadius: 2, border: '1px solid var(--surge-border-muted)' }}>
          <Typography variant="h6" style={{ color: 'var(--surge-text-primary)', marginBottom: 16 }}>
            {coreServers.find(s => s.key === config.mediaServer)?.name} Configuration
          </Typography>
          {config.mediaServer === 'plex' && (
            <Box>
              <Box display="flex" gap={2} mb={2}>
                <Box flex={1}>
                  <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 8 }}>
                    Plex Claim Token
                    <Typography component="span" style={{ color: 'var(--surge-warning)', fontSize: 12, marginLeft: 8 }}>
                      ⏱ 4-minute expiration
                    </Typography>
                  </Typography>
                  <input
                    type="text"
                    aria-label="Plex claim token"
                    value={config.plexSettings?.PLEX_CLAIM || ''}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      plexSettings: { ...prev.plexSettings, PLEX_CLAIM: e.target.value }
                    }))}
                    placeholder="claim-xxxxxxxxxxxxxxxx"
                    style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
                  />
                  <PlexClaimCountdown token={config.plexSettings?.PLEX_CLAIM || ''} />
                  <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 4 }}>
                    Get a fresh token from{' '}
                    <a
                      href="https://www.plex.tv/claim"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#07938f' }}
                    >
                      plex.tv/claim
                    </a>{' '}
                    immediately before deploying — tokens expire 4 minutes after generation. Required for first-run auto-claim; if left blank, you'll need to claim manually via the Plex web UI on first launch.
                  </Typography>
                </Box>
              </Box>

              <Box mt={2} p={2} sx={{ background: 'var(--surge-card-bg-inner)', borderRadius: 1, border: '1px solid var(--surge-border)' }}>
                <Typography style={{ color: 'var(--surge-text-primary)', fontWeight: 'bold', marginBottom: 8 }}>
                  🎬 Automatic Library Creation
                </Typography>
                <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 14 }}>
                  Surge will automatically create Plex libraries based on your CineSync folder structure:
                </Typography>
                <Box mt={1} ml={2}>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 13 }}>• Movies</Typography>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 13 }}>• TV Shows</Typography>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 13 }}>• Anime Movies</Typography>
                  <Typography style={{ color: 'var(--surge-text-primary)', fontSize: 13 }}>• Anime Series</Typography>
                </Box>
                <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 8 }}>
                  Libraries will be created automatically after deployment with proper metadata agents.
                </Typography>
              </Box>

              <Box mt={2}>
                <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 8 }}>
                  Advertise IP
                  <Typography component="span" style={{ color: 'var(--surge-text-dim)', fontSize: 12, marginLeft: 8 }}>
                    optional · advanced
                  </Typography>
                </Typography>
                <input
                  type="text"
                  aria-label="Plex advertise IP"
                  value={config.plexSettings?.ADVERTISE_IP || ''}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    plexSettings: { ...prev.plexSettings, ADVERTISE_IP: e.target.value }
                  }))}
                  placeholder="https://plex.yourdomain.com:32400 (leave blank if unsure)"
                  style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
                />
                <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 4 }}>
                  Comma-separated list of URLs Plex should advertise to clients. Useful when running behind a reverse proxy with a public URL. Leave blank to let Plex auto-detect.
                </Typography>
              </Box>
            </Box>
          )}
          {config.mediaServer === 'jellyfin' && (
            <Box>
              <Box display="flex" gap={2} mb={2}>
                <Box flex={1}>
                  <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 8 }}>Published Server URL</Typography>
                  <input
                    type="text"
                    aria-label="Jellyfin published server URL"
                    value={config.jellyfinSettings.JELLYFIN_PublishedServerUrl}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      jellyfinSettings: { ...prev.jellyfinSettings, JELLYFIN_PublishedServerUrl: e.target.value }
                    }))}
                    placeholder="https://jellyfin.yourdomain.com"
                    style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
                  />
                  <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 4 }}>
                    The external URL for your Jellyfin server
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}
          {config.mediaServer === 'emby' && (
            <Box>
              <Box display="flex" gap={2} mb={2}>
                <Box flex={1}>
                  <Typography style={{ color: 'var(--surge-text-primary)', marginBottom: 8 }}>Published Server URL</Typography>
                  <input
                    type="text"
                    aria-label="Emby published server URL"
                    value={config.embySettings?.EMBY_PublishedServerUrl || ''}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      embySettings: { ...prev.embySettings, EMBY_PublishedServerUrl: e.target.value }
                    }))}
                    placeholder="https://emby.yourdomain.com"
                    style={{ width: '100%', background: 'var(--surge-input-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border)', borderRadius: 4, padding: 8 }}
                  />
                  <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginTop: 4 }}>
                    The external URL for your Emby server
                  </Typography>
                </Box>
              </Box>
              <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13 }}>
                Advanced settings (transcoding, users, libraries) can be configured through Emby's web UI after deployment.
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default Step1;
