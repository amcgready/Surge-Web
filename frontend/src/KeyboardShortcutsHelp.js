import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
} from '@mui/material';

/**
 * KeyboardShortcutsHelp — global "?" key overlay listing keyboard
 * shortcuts available in the wizard.
 *
 * Behaviour:
 *   - Opens on Shift+/ (i.e. "?") anywhere in the document, EXCEPT
 *     when focus is in an input/textarea/contenteditable so we don't
 *     hijack legitimate "?" keystrokes inside text fields.
 *   - Esc / click-outside / Close button all dismiss.
 *   - Listed shortcuts are wired to the `actions` prop the parent
 *     passes in. The component itself only owns the overlay; it
 *     doesn't bind the per-action keys (App.js does that, since the
 *     wizard's wider state lives there).
 */

const SHORTCUTS = [
  { keys: ['?'],          label: 'Show / hide this help' },
  { keys: ['→', 'Enter'], label: 'Go to next step (when current step is complete)' },
  { keys: ['←'],          label: 'Go to previous step' },
  { keys: ['1', '–', '5'], label: 'Jump to a specific step (Media Server through Deploy)' },
  { keys: ['Esc'],        label: 'Close any open dialog (tour, details, this help)' },
  { keys: ['Ctrl/⌘', 'L'], label: 'Toggle light/dark mode' },
  { keys: ['Ctrl/⌘', 'R'], label: 'Reset wizard (after confirmation)' },
  { keys: ['/'],          label: 'Focus the service search box (on Service Selection)' },
];


/** Render a small kbd-style chip for each key. */
function Kbd({ children }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-block',
        background:   'var(--surge-card-bg-inner)',
        border:       '1px solid var(--surge-border)',
        borderRadius: 1,
        px: 0.75, py: 0.25,
        fontSize: 11,
        fontFamily: 'monospace',
        color: 'var(--surge-text-secondary)',
        boxShadow: '0 1px 0 var(--surge-border-subtle)',
      }}
    >
      {children}
    </Box>
  );
}


export default function KeyboardShortcutsHelp({ open, onClose }) {
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
        Keyboard shortcuts
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box component="dl" sx={{ m: 0 }}>
          {SHORTCUTS.map((shortcut, i) => (
            <Box
              key={i}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(140px, auto) 1fr',
                gap: 2,
                alignItems: 'center',
                py: 0.75,
                borderBottom: i === SHORTCUTS.length - 1
                  ? 'none'
                  : '1px solid var(--surge-border-subtle)',
              }}
            >
              <Box component="dt" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {shortcut.keys.map((k, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && k !== '–' && k !== ',' && (
                      <Box component="span" sx={{
                        color: 'var(--surge-text-dim)', fontSize: 11, mx: 0.25,
                      }}>
                        {k === '+' ? '+' : '·'}
                      </Box>
                    )}
                    {k === '–' || k === ',' ? (
                      <Box component="span" sx={{
                        color: 'var(--surge-text-dim)', fontSize: 12,
                      }}>
                        {k}
                      </Box>
                    ) : (
                      <Kbd>{k}</Kbd>
                    )}
                  </React.Fragment>
                ))}
              </Box>
              <Box component="dd" sx={{ m: 0 }}>
                <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13 }}>
                  {shortcut.label}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)' }}>
        <Button
          onClick={onClose}
          sx={{
            color: 'var(--surge-brand)',
            textTransform: 'none',
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
