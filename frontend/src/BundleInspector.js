import React from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, Chip, Alert,
} from '@mui/material';
import { parseSurgeBundle } from './bundleInspectorUtils';

/**
 * BundleInspector — drag-and-drop a previously-downloaded
 * surge-deploy.zip onto a target, parse manifest.json + config.json
 * + (optionally) state.json, and render a quick summary.
 *
 * Two output modes:
 *   1. View-only: shows what services + config were in the bundle.
 *      Useful for QA / audit / "what did I deploy last week?"
 *   2. Load-into-wizard: replaces the current wizard state with the
 *      bundle's config. Useful for restoring a deploy on a fresh
 *      browser, or migrating a config between machines.
 *
 * Inputs are read entirely client-side via JSZip — no upload, no
 * network. Existing wizard state is never overwritten until the user
 * explicitly clicks "Load into wizard".
 */


export default function BundleInspector({ onLoadIntoWizard }) {
  const [open, setOpen]       = React.useState(false);
  const [parsed, setParsed]   = React.useState(null);
  const [error, setError]     = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = React.useRef(null);

  const reset = () => {
    setParsed(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    setOpen(false);
    setDragging(false);
    reset();
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setParsed(null);
    try {
      const result = await parseSurgeBundle(file);
      setParsed(result);
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <>
      <Button
        variant="text"
        size="small"
        onClick={() => setOpen(true)}
        sx={{
          color: 'var(--surge-text-muted)',
          fontSize: 12,
          textTransform: 'none',
          '&:hover': { color: '#07938f', background: 'transparent' },
        }}
      >
        Inspect a previous bundle…
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { background: 'var(--surge-panel-bg)', color: 'var(--surge-text-primary)', border: '1px solid var(--surge-border-subtle)' },
        }}
      >
        <DialogTitle sx={{ color: 'var(--surge-text-primary)', borderBottom: '1px solid var(--surge-border-subtle)' }}>
          Inspect a deploy bundle
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 13, marginBottom: 16 }}>
            Drop a <code style={{ color: 'var(--surge-accent)' }}>surge-deploy.zip</code> file
            below to see what services and config it contains. Read-only by
            default — click <em>Load into wizard</em> at the bottom to replace
            your current wizard state with the bundle's.
          </Typography>

          {/* Drop target */}
          <Box
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            sx={{
              border: dragging ? '2px solid #07938f' : '2px dashed #444',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
              background: dragging ? 'rgba(7,147,143,0.05)' : '#0a0a0a',
              mb: 2,
              '&:hover': { borderColor: '#07938f' },
            }}
          >
            <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 14 }}>
              {dragging
                ? 'Drop to inspect'
                : 'Drag & drop surge-deploy.zip — or click to browse'}
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              aria-label="Upload surge-deploy bundle ZIP"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {parsed && (
            <Box>
              <Typography style={{
                color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                letterSpacing: 0.3, textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Bundle contents
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1} mb={2}>
                <Chip
                  size="small"
                  label={`platform: ${parsed.config.platform || 'unset'}`}
                  sx={{ background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                        border: '1px solid #07938f' }}
                />
                <Chip
                  size="small"
                  label={`media server: ${parsed.config.mediaServer || 'none'}`}
                  sx={{ background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                        border: '1px solid #07938f' }}
                />
                <Chip
                  size="small"
                  label={
                    `${Object.values(parsed.config.contentEnhancement || {})
                       .filter((v) => v).length} additional services`
                  }
                  sx={{ background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                        border: '1px solid #07938f' }}
                />
                {parsed.state && (
                  <Chip
                    size="small"
                    label={
                      `${Object.keys(parsed.state.secrets || {}).length} secrets · ` +
                      `${Object.keys(parsed.state.runtimeValues || {}).length} runtime values`
                    }
                    sx={{ background: '#0d1f1e', color: 'var(--surge-text-secondary)',
                          border: '1px dashed #07938f' }}
                  />
                )}
              </Stack>

              <Typography style={{
                color: 'var(--surge-text-primary)', fontSize: 12, fontWeight: 600,
                letterSpacing: 0.3, textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Enabled services
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1} mb={2}>
                {Object.entries(parsed.config.contentEnhancement || {})
                  .filter(([, v]) => v)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name]) => (
                    <Chip
                      key={name}
                      size="small"
                      label={name}
                      sx={{ background: 'var(--surge-panel-bg)', color: 'var(--surge-text-secondary)',
                            border: '1px solid var(--surge-border-subtle)' }}
                    />
                  ))}
                {Object.values(parsed.config.contentEnhancement || {})
                  .filter((v) => v).length === 0 && (
                  <Typography style={{ color: 'var(--surge-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
                    No additional services enabled in this bundle.
                  </Typography>
                )}
              </Stack>

              {parsed.state && (
                <Typography style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 12 }}>
                  This bundle includes <strong>state.json</strong> with persisted
                  secrets — loading it into the wizard will preserve those
                  secrets across re-deploys (no rotation).
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)' }}>
          <Button onClick={handleClose} sx={{ color: 'var(--surge-text-muted)' }}>
            Close
          </Button>
          {parsed && (
            <Button
              onClick={() => {
                onLoadIntoWizard(parsed.config, parsed.state);
                handleClose();
              }}
              variant="contained"
              sx={{
                background: '#07938f',
                color: 'var(--surge-text-primary)',
                '&:hover': { background: '#065a57' },
              }}
            >
              Load into wizard
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
