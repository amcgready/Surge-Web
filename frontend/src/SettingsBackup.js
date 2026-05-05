import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
  Alert,
} from '@mui/material';

/**
 * SettingsBackup — export/import of UI preferences only.
 *
 * Keys deliberately scoped to preferences, NOT secrets:
 *   - surge-color-mode      (light/dark)
 *   - surge-tour-completed  (so fresh machines don't pester you again)
 *   - surge-presets         (user-defined wizard presets, when added)
 *
 * NOT exported:
 *   - surge-wizard-state — that's what the deploy bundle is for; it
 *     contains API keys + config that should travel with the bundle,
 *     not in a plaintext settings JSON.
 *   - surge-last-bundle-config — stale snapshot of last deploy.
 *
 * The exported file is a single JSON document so it's easy to inspect
 * before import. Schema version included so we can break it later.
 */

const SETTINGS_KEYS = [
  'surge-color-mode',
  'surge-tour-completed',
  'surge-presets',
];

function exportSettings() {
  const out = { schema: 1, exportedAt: new Date().toISOString(), settings: {} };
  for (const key of SETTINGS_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) out.settings[key] = v;
    } catch (err) { /* localStorage unavailable */ }
  }
  return out;
}

function importSettings(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Not a JSON object — was this exported from Surge?');
  }
  if (payload.schema !== 1) {
    throw new Error(`Unsupported schema version: ${payload.schema}. ` +
                    `This Surge build expects schema 1.`);
  }
  if (!payload.settings || typeof payload.settings !== 'object') {
    throw new Error('Missing "settings" object.');
  }
  let applied = 0;
  for (const key of SETTINGS_KEYS) {
    if (key in payload.settings) {
      try {
        localStorage.setItem(key, payload.settings[key]);
        applied++;
      } catch (err) {
        throw new Error(`localStorage write failed for ${key}: ${err.message}`);
      }
    }
  }
  return applied;
}


export default function SettingsBackup({ open, onClose }) {
  const [error, setError] = React.useState(null);
  const [success, setSuccess] = React.useState(null);
  const fileInputRef = React.useRef(null);

  // Reset banner state whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const handleExport = () => {
    setError(null);
    setSuccess(null);
    try {
      const payload = exportSettings();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const blob = new Blob([JSON.stringify(payload, null, 2)],
                            { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `surge-settings-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const count = Object.keys(payload.settings).length;
      setSuccess(
        count === 0
          ? 'Exported (no preferences set yet — file is a clean baseline).'
          : `Exported ${count} preference${count === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    setError(null);
    setSuccess(null);
    try {
      const text   = await file.text();
      const parsed = JSON.parse(text);
      const applied = importSettings(parsed);
      setSuccess(
        `Imported ${applied} preference${applied === 1 ? '' : 's'}. ` +
        `Reload the page to see them take effect.`
      );
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          background: 'var(--surge-panel-bg)',
          color:      'var(--surge-text-primary)',
          border:     '1px solid var(--surge-border-subtle)',
        },
      }}
    >
      <DialogTitle sx={{
        color: 'var(--surge-text-primary)',
        borderBottom: '1px solid var(--surge-border-subtle)',
      }}>
        Settings — export / import
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Typography style={{
          color: 'var(--surge-text-secondary)', fontSize: 13, marginBottom: 12,
        }}>
          Move your UI preferences (light/dark mode, onboarding state,
          saved presets) between machines. Wizard config and API keys
          are <strong>not</strong> included — those travel with the
          deploy bundle so secrets don't end up in a plaintext settings
          file.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, my: 2 }}>
          <Button
            variant="outlined"
            onClick={handleExport}
            sx={{
              color: 'var(--surge-brand)',
              borderColor: 'var(--surge-brand)',
              textTransform: 'none',
              alignSelf: 'flex-start',
              '&:hover': { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
            }}
          >
            Export settings to JSON
          </Button>

          <Button
            variant="outlined"
            component="label"
            sx={{
              color: 'var(--surge-brand)',
              borderColor: 'var(--surge-brand)',
              textTransform: 'none',
              alignSelf: 'flex-start',
              '&:hover': { borderColor: '#0bbab5', background: 'rgba(7,147,143,0.1)' },
            }}
          >
            Import settings from JSON
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import surge settings"
              hidden
              onChange={(e) => handleImport(e.target.files?.[0])}
            />
          </Button>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1 }}>{success}</Alert>}

        <Typography style={{
          color: 'var(--surge-text-dim)', fontSize: 11, marginTop: 16,
        }}>
          Stored keys: {SETTINGS_KEYS.join(', ')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)' }}>
        <Button
          onClick={onClose}
          sx={{ color: 'var(--surge-brand)', textTransform: 'none' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Exported for tests.
export const __testables = { exportSettings, importSettings, SETTINGS_KEYS };
