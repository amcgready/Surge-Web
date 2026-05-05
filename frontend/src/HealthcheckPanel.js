import React from 'react';
import {
  Box, Typography, Button, Stack, Chip, Alert,
} from '@mui/material';
import { serviceMeta } from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';
import { getHealthcheck, extractHttpEndpoint } from './healthcheckUtils';

/**
 * HealthcheckPanel — surfaces post-deploy stack health.
 *
 * Two render modes:
 *
 *   1. Reference mode (always available): lists each enabled service
 *      and the healthcheck command/port baked into its compose
 *      template. Useful even before the user has deployed — they can
 *      see what a "healthy" service will respond to and know what
 *      port to hit if something goes wrong.
 *
 *   2. Live mode: when the user uploads a status.json produced by
 *      `surge_orchestrator.py --status`, we render the actual current
 *      state (running/exited/etc.) alongside health (healthy/
 *      unhealthy/starting). Status JSON is read entirely client-side;
 *      no upload, no network.
 *
 * The orchestrator emits status.json via:
 *   $ python3 surge_orchestrator.py --manifest manifest.json \
 *       --config config.json --status
 *   # → writes .surge/status.json
 *
 * Schema (kept in sync with do_status() in surge_orchestrator.py):
 *   {
 *     "generatedAt": "<iso-timestamp>",
 *     "services": [
 *       { "name", "image", "state", "health", "uptime",
 *         "ports": [...], "exitCode" }
 *     ]
 *   }
 */

// Render a colored dot for a health/state value. Unknown values get a
// gray dot — better to surface unfamiliar docker statuses than swallow.
function StatusDot({ value, kind }) {
  let color = 'var(--surge-text-dim)';
  if (kind === 'health') {
    if (value === 'healthy')   color = 'var(--surge-success)';
    else if (value === 'unhealthy') color = 'var(--surge-error)';
    else if (value === 'starting')  color = 'var(--surge-warning)';
  } else if (kind === 'state') {
    if (value === 'running')   color = 'var(--surge-success)';
    else if (value === 'exited' || value === 'dead')  color = 'var(--surge-error)';
    else if (value === 'restarting' || value === 'paused') color = 'var(--surge-warning)';
  }
  return (
    <Box component="span" sx={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: color, mr: 0.75, verticalAlign: 'middle',
    }} />
  );
}


export default function HealthcheckPanel({ enabled, mediaServer }) {
  const fileInputRef = React.useRef(null);
  const [statusDoc, setStatusDoc] = React.useState(null);
  const [parseError, setParseError] = React.useState(null);

  const enabledList = React.useMemo(() => {
    const list = enabled.map((s) => (typeof s === 'string' ? s : s[0]));
    if (mediaServer && !list.includes(mediaServer)) list.unshift(mediaServer);
    return list;
  }, [enabled, mediaServer]);

  // Build a name → live-status map for O(1) lookup against the rendered
  // service list. Keys may be base service ('sonarr') or container
  // names ('zurg-rclone'); we match permissively so the orchestrator's
  // multi-container services light up.
  const liveByName = React.useMemo(() => {
    if (!statusDoc?.services) return {};
    const out = {};
    for (const svc of statusDoc.services) {
      const key = (svc.name || '').toLowerCase();
      if (key) out[key] = svc;
    }
    return out;
  }, [statusDoc]);

  const handleStatusUpload = async (file) => {
    if (!file) return;
    setParseError(null);
    try {
      const text   = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.services)) {
        throw new Error('Missing "services" array — was this produced by ' +
                        '`surge_orchestrator.py --status`?');
      }
      setStatusDoc(parsed);
    } catch (err) {
      setParseError(err.message || String(err));
      setStatusDoc(null);
    }
  };

  const clearStatus = () => {
    setStatusDoc(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (enabledList.length === 0) {
    return (
      <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13 }}>
        Enable at least one service in the previous step to see healthcheck
        info.
      </Typography>
    );
  }

  return (
    <Box>
      {/* Status upload control */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Button
          component="label"
          variant="outlined"
          size="small"
          sx={{
            color:        'var(--surge-brand)',
            borderColor:  'var(--surge-brand)',
            textTransform: 'none',
            '&:hover':    { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
          }}
        >
          {statusDoc ? 'status.json loaded ✓' : 'Upload status.json (optional)'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Upload status.json"
            hidden
            onChange={(e) => handleStatusUpload(e.target.files?.[0])}
          />
        </Button>
        {statusDoc && (
          <Button
            size="small"
            onClick={clearStatus}
            sx={{ color: 'var(--surge-text-muted)', textTransform: 'none' }}
          >
            clear
          </Button>
        )}
        <Typography style={{
          color: 'var(--surge-text-dim)', fontSize: 11, marginLeft: 'auto',
        }}>
          Generate via: <code style={{ color: 'var(--surge-accent)' }}>
            python3 surge_orchestrator.py --status
          </code>
        </Typography>
      </Box>

      {parseError && (
        <Alert severity="error" sx={{ mb: 1.5 }}>{parseError}</Alert>
      )}

      {statusDoc && (
        <Typography style={{
          color: 'var(--surge-text-muted)', fontSize: 11, marginBottom: 8,
        }}>
          Snapshot from {statusDoc.generatedAt} —{' '}
          {(statusDoc.services || []).length} container(s) reported
        </Typography>
      )}

      {/* Per-service rows */}
      <Stack spacing={1}>
        {enabledList.map((key) => {
          const meta  = serviceMeta[key] || mediaServerMeta[key];
          const hc    = getHealthcheck(key);
          const live  = liveByName[key];
          const url   = extractHttpEndpoint(hc?.command);

          return (
            <Box
              key={key}
              sx={{
                background:   'var(--surge-card-bg-inner)',
                border:       '1px solid var(--surge-border-subtle)',
                borderRadius: 1,
                p: 1.25,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography style={{
                  color: 'var(--surge-text-primary)', fontWeight: 600, fontSize: 14,
                }}>
                  {meta?.name || key}
                </Typography>
                {live && (
                  <>
                    <Chip
                      size="small"
                      label={
                        <span><StatusDot value={live.state} kind="state" />
                          {live.state}</span>
                      }
                      sx={{ background: 'transparent',
                            color: 'var(--surge-text-secondary)',
                            border: '1px solid var(--surge-border)' }}
                    />
                    <Chip
                      size="small"
                      label={
                        <span><StatusDot value={live.health} kind="health" />
                          {live.health}</span>
                      }
                      sx={{ background: 'transparent',
                            color: 'var(--surge-text-secondary)',
                            border: '1px solid var(--surge-border)' }}
                    />
                    {live.uptime && (
                      <Typography style={{
                        color: 'var(--surge-text-dim)', fontSize: 11,
                      }}>
                        {live.uptime}
                      </Typography>
                    )}
                  </>
                )}
                {!live && statusDoc && (
                  <Chip
                    size="small"
                    label="not in snapshot"
                    sx={{ background: 'transparent',
                          color: 'var(--surge-text-dim)',
                          border: '1px solid var(--surge-border-subtle)' }}
                  />
                )}
              </Box>

              {hc ? (
                <Box sx={{ mt: 0.75 }}>
                  <Typography style={{
                    color: 'var(--surge-text-muted)', fontSize: 11,
                    fontFamily: 'monospace', wordBreak: 'break-all',
                  }}>
                    {hc.command || '(no command)'}
                  </Typography>
                  <Typography style={{
                    color: 'var(--surge-text-dim)', fontSize: 10, marginTop: 2,
                  }}>
                    every {hc.interval}, timeout {hc.timeout},{' '}
                    retries {hc.retries}, grace {hc.startPeriod}
                    {url && (
                      <> · check from your host: <code style={{
                        color: 'var(--surge-accent)',
                      }}>{url.replace('localhost', '<host>')}</code></>
                    )}
                  </Typography>
                </Box>
              ) : (
                <Typography style={{
                  color: 'var(--surge-text-dim)', fontSize: 11, marginTop: 4,
                }}>
                  No healthcheck defined for this service.
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
