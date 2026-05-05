import React from 'react';
import {
  Dialog, DialogContent, DialogActions, Box, Typography, Button, Stack,
} from '@mui/material';

/**
 * OnboardingTour — first-time-visitor walkthrough.
 *
 * Behavior:
 *   - Shown on first paint when localStorage `surge-tour-completed`
 *     is unset AND there's no restored wizard state (so returning
 *     users with saved state aren't pestered).
 *   - Five cards walking through what Surge does + what each wizard
 *     step expects.
 *   - Persisting completion is idempotent: explicitly clicking
 *     "Done" or "Skip tour" both flip the flag, so the user only
 *     sees the tour once unless they hit "Reset wizard" (which
 *     clears `surge-wizard-state` but keeps the tour flag — most
 *     users resetting are course-correcting, not asking for the
 *     full intro again).
 */

const STEPS = [
  {
    title: 'Welcome to Surge',
    body: (
      <>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          Surge is a deploy tool for self-hosted media stacks (Plex /
          Jellyfin / Emby plus the *arr suite, debrid clients, request
          managers, and more).
        </Typography>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          You configure your stack here in the wizard, click{' '}
          <strong>Generate deploy bundle</strong>, and run the
          downloaded ZIP on your target host. The orchestrator
          handles secrets, cross-service wiring, and{' '}
          <code style={{ color: 'var(--surge-accent)' }}>docker compose up</code>{' '}
          for you.
        </Typography>
        <Typography style={{ color: 'var(--surge-text-secondary)' }}>
          The whole tour is five short slides — about a minute. Skip
          anytime via the button at the bottom.
        </Typography>
      </>
    ),
  },
  {
    title: 'Step 1 — Media Server',
    body: (
      <>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          Pick the media server you want at the heart of your stack.
          Plex / Jellyfin / Emby are mutually exclusive — Surge wires
          everything else around the one you choose.
        </Typography>
        <Typography style={{ color: 'var(--surge-text-secondary)' }}>
          For Plex, you'll paste a 4-minute claim token from{' '}
          <code style={{ color: 'var(--surge-accent)' }}>plex.tv/claim</code> right
          before deploying. The wizard's countdown reminds you when
          it's about to expire.
        </Typography>
      </>
    ),
  },
  {
    title: 'Step 2 — Storage Config',
    body: (
      <>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          Tell Surge where to put things on your deploy target. Two
          flavors:
        </Typography>
        <Box component="ul" sx={{
          color: 'var(--surge-text-secondary)', m: 0, pl: 2, mb: 1.5, lineHeight: 1.7,
        }}>
          <li>
            <strong>Unraid</strong> — uses the standard{' '}
            <code style={{ color: 'var(--surge-accent)' }}>/mnt/cache</code> +{' '}
            <code style={{ color: 'var(--surge-accent)' }}>/mnt/user/appdata</code>{' '}
            convention.
          </li>
          <li>
            <strong>Docker</strong> — single root path; Surge nests
            everything underneath.
          </li>
        </Box>
        <Typography style={{ color: 'var(--surge-text-secondary)' }}>
          PUID/PGID/UMASK control file ownership for every container.
        </Typography>
      </>
    ),
  },
  {
    title: 'Step 3 — External APIs',
    body: (
      <>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          API keys for services that need external metadata or debrid
          access. Each field shows which services would consume it
          ("Used by: …") so you know what's optional.
        </Typography>
        <Typography style={{ color: 'var(--surge-text-secondary)' }}>
          Skip what you don't need — services tolerate missing keys
          gracefully (you'll see a yellow warning badge on the relevant
          tile in the next step).
        </Typography>
      </>
    ),
  },
  {
    title: 'Step 4 — Services + Deploy',
    body: (
      <>
        <Typography style={{ color: 'var(--surge-text-secondary)', marginBottom: 12 }}>
          22 services, grouped by category. Use the preset buttons at
          the top for common stacks (Plex + *arr starter / Jellyfin
          minimalist / Debrid power user / etc.) or pick by hand.
        </Typography>
        <Typography style={{ color: 'var(--surge-text-secondary)' }}>
          Once you're happy with the picks, the Deploy step shows a
          summary, lets you generate the bundle, and points you at
          your deployed services' URLs once the run completes.
        </Typography>
      </>
    ),
  },
];


export default function OnboardingTour({ skipIfRestored }) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (skipIfRestored) return;
    try {
      if (localStorage.getItem('surge-tour-completed')) return;
    } catch (err) {
      // No storage → just show the tour; flag won't persist but the
      // user can dismiss it for the session via the buttons.
    }
    // Defer the open by a tick so the wizard's first paint completes
    // first — opens feel snappier when they arrive after the rest of
    // the page has rendered.
    const id = window.setTimeout(() => setOpen(true), 250);
    return () => window.clearTimeout(id);
  }, [skipIfRestored]);

  const finish = () => {
    setOpen(false);
    try {
      localStorage.setItem('surge-tour-completed', '1');
    } catch (err) {
      // Storage unavailable — the user just won't have the flag
      // persist; they'll see the tour again next visit. Acceptable.
    }
  };

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onClose={finish}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { background: 'var(--surge-panel-bg)', color: 'var(--surge-text-primary)', border: '1px solid #07938f' },
      }}
    >
      <DialogContent sx={{ pt: 3 }}>
        <Typography
          style={{ color: 'var(--surge-text-muted)', fontSize: 12, marginBottom: 4,
                   letterSpacing: 0.3, textTransform: 'uppercase' }}
        >
          {index + 1} of {STEPS.length}
        </Typography>
        <Typography variant="h6" style={{ color: 'var(--surge-text-primary)', marginBottom: 12 }}>
          {step.title}
        </Typography>
        <Box>{step.body}</Box>

        {/* Progress dots */}
        <Stack direction="row" spacing={0.75} sx={{ mt: 3, mb: 0.5 }}>
          {STEPS.map((_, i) => (
            <Box
              key={i}
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                background: i === index ? '#07938f'
                          : i <  index ? 'rgba(7,147,143,0.5)' : 'var(--surge-border)',
                transition: 'background 0.15s',
              }}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid var(--surge-border-subtle)', justifyContent: 'space-between' }}>
        <Button
          onClick={finish}
          sx={{ color: 'var(--surge-text-muted)', textTransform: 'none' }}
        >
          Skip tour
        </Button>
        <Stack direction="row" spacing={1}>
          {index > 0 && (
            <Button
              onClick={() => setIndex((i) => i - 1)}
              sx={{ color: 'var(--surge-text-muted)', textTransform: 'none' }}
            >
              Back
            </Button>
          )}
          <Button
            onClick={isLast ? finish : () => setIndex((i) => i + 1)}
            variant="contained"
            sx={{
              background: '#07938f', color: 'var(--surge-text-primary)',
              '&:hover': { background: '#065a57' },
            }}
          >
            {isLast ? 'Get started' : 'Next'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
