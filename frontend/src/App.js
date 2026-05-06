import React from 'react';
import MediaServerStep from './MediaServerStep';
import StorageConfigStep from './StorageConfigStep';
import ExternalAPIStep from './ExternalAPIStep';
import AdditionalServicesStep from './AdditionalServicesStep';
import ComposePreviewPanel from './ComposePreviewPanel';
import OnboardingTour from './OnboardingTour';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import SettingsBackup from './SettingsBackup';
import { validateStep } from './validateStep';
import { palettes, paletteToCssVars } from './theme';
import { Container, Typography, Box, Stepper, Step, StepLabel, Button, Tooltip, Alert } from '@mui/material';
import SurgeLogo from './SurgeLogo';
import bgImage from './assets/background.jpg';
import { mediaServerOptions } from './mediaServerMeta';

const steps = [
  'Media Server',
  'Storage Config',
  'External APIs',
  'Additional Services',
  'Deploy'
];

// Custom Step icon renderer for the 'warning' status. Inline SVG-free
// — yellow filled circle with a "!" inside, scaled to roughly match
// MUI's default StepIcon size.
function WarningStepIcon() {
  return (
    <Box
      sx={{
        width: 24, height: 24, borderRadius: '50%',
        backgroundColor: '#ffb300', color: '#1a1a1a',
        fontSize: 14, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: '24px',
      }}
    >
      !
    </Box>
  );
}

function App() {
  // (Removed auth + daemon-connection + WebSocket state — Surge today
  // is a static frontend that produces a downloadable deploy bundle.)


  // Per-service "show advanced" toggles. Only the three below are
  // actively consumed by step components; the rest of the *arr-suite
  // toggles got removed when each service's advanced section migrated
  // into per-service detail dialogs in AdditionalServicesStep.
  const [showKometaAdvanced, setShowKometaAdvanced] = React.useState(false);
  const [showPosterizarrAdvanced, setShowPosterizarrAdvanced] = React.useState(false);
  const [showPlaceholdarrAdvanced, setShowPlaceholdarrAdvanced] = React.useState(false);
  // eslint-disable-next-line no-unused-vars
  const [showNoMediaServerDialog, setShowNoMediaServerDialog] = React.useState(false);
  // JSON parse error banner — surfaced when a wizard JSON import
  // fails to parse. setter is currently unused (no import path
  // wired up in the post-auth-rip rewrite); we keep the read side
  // around so the banner is ready when an import flow is added.
  // eslint-disable-next-line no-unused-vars
  const [jsonParseError, setJsonParseError] = React.useState('');
  // Content Enhancement toggles — drives the Service Selection grid.
  // Defaults are merged with each service's defaultSelected map at
  // load time so the user lands on a sensible starter config.
  const [contentEnhancement, setContentEnhancement] = React.useState({
    kometa: true,
    posterizarr: true
  });
  // Core Media Server tiles — sourced from mediaServerMeta so the
  // wizard's options stay in sync with the deployable compose templates.
  const coreServers = mediaServerOptions;
  const [activeStep, setActiveStep] = React.useState(0);
  // Tracks whether wizard state has been hydrated from localStorage. Used
  // to suppress the first save effect — without it, the initial empty
  // state would clobber saved data before the load effect runs.
  const hydratedFromStorageRef = React.useRef(false);

  const [config, setConfig] = React.useState({
    // Core Media Server
    mediaServer: '', // plex|emby|jellyfin
    // Storage Config
    storagePath: '',
    platform: '',
    // Media Automation - Radarr settings
    radarrSettings: {
      port: 7878,
      sslPort: '',
      enableSsl: 'false',
      urlBase: '',
      apiKey: 'surgestack',
      rootFolderPath: '/data/movies',
      movieProfileId: '',
      minimumAvailability: 'released',
      authMethod: 'Basic',
      logLevel: 'Info',
      branch: 'master',
      launchBrowser: 'false',
      analyticsEnabled: 'false',
      updateAutomatically: 'true',
      updateMechanism: 'docker',
      logRotate: '',
      backupRetention: '',
      proxyEnabled: 'false',
      proxyType: 'http',
      proxyHostname: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      appData: '',
      configPath: '',
      // removed puid/pgid, now in shared config
      // removed umask/tz, now in shared config
    },
    // Media Automation - Sonarr settings
    sonarrSettings: {
      port: 8989,
      sslPort: '',
      enableSsl: 'false',
      urlBase: '',
      instanceName: '',
      apiKey: 'surgestack',
      rootFolderPath: '/data/tv',
      seriesProfileId: '',
      minimumAvailability: 'released',
      namingFormat: '',
      seasonFolderFormat: '',
      multiEpisodeStyle: '',
      createEmptyFolders: 'true',
      deleteEmptyFolders: 'true',
      useHardLinks: 'true',
      importExtraFiles: 'true',
      unmonitorDeleted: 'true',
      downloadPropers: 'prefer',
      analyseVideo: 'true',
      rescanAfterRefresh: 'always',
      changeFileDate: 'none',
      recyclingBinPath: '',
      recyclingBinRetention: '',
      setPermissions: 'false',
      chmodFolder: '',
      chownGroup: '',
      authMethod: 'Basic',
      logLevel: 'Info',
      branch: 'master',
      analyticsEnabled: 'false',
      updateAutomatically: 'true',
      updateMechanism: 'docker',
      appData: '',
      configPath: '',
      backupFolder: '',
      backupInterval: '',
      backupRetention: '',
      proxyEnabled: 'false',
      proxyType: 'http',
      proxyHostname: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      ignoredAddresses: '',
      bypassProxyLocal: 'true',
      logRotate: '',
      // removed puid/pgid, now in shared config
      // removed umask/tz, now in shared config
      launchBrowser: 'false',
    },
    // Media Automation - Prowlarr settings
    prowlarrSettings: {
      port: 9696,
      sslPort: '',
      enableSsl: 'false',
      urlBase: '',
      instanceName: '',
      apiKey: 'surgestack',
      appData: '',
      configPath: '',
      authMethod: 'Basic',
      certificateValidation: 'enabled',
      logLevel: 'Info',
      logRotate: '',
      branch: 'master',
      analyticsEnabled: 'false',
      updateAutomatically: 'true',
      updateMechanism: 'docker',
      updateScript: '',
      backupFolder: '',
      backupInterval: '',
      backupRetention: '',
      proxyEnabled: 'false',
      proxyType: 'http',
      proxyHostname: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      ignoredAddresses: '',
      bypassProxyLocal: 'true',
      // removed puid/pgid, now in shared config
      // removed umask/tz, now in shared config
      tags: '',
      launchBrowser: 'false',
    },
    // Media Automation - Bazarr settings
    bazarrSettings: {
      port: 6767,
      sslPort: '',
      enableSsl: 'false',
      urlBase: '',
      apiKey: 'surgestack',
      authMethod: 'Basic',
      logLevel: 'Info',
      branch: 'master',
      launchBrowser: 'false',
      appData: '',
      configPath: '',
      analyticsEnabled: 'false',
      updateAutomatically: 'false',
      updateMechanism: '',
      logRotate: '',
      backupRetention: '',
      proxyEnabled: 'false',
      proxyType: '',
      proxyHostname: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
    },
    // Media Automation - CineSync settings
    cinesyncSettings: {
      webuiPort: 5173,
      apiPort: 8082,
      webdavPort: 8082,
      apiKey: 'surgestack',
      authMethod: 'Basic',
      logLevel: 'Info',
      branch: 'master',
      launchBrowser: 'false',
      sourceDir: '',
      useSourceStructure: false,
      cinesyncLayout: true,
      // Both default off so CineSync only creates Movies/ and Shows/
      // by default. Users opt into anime/4K via the Service Selection
      // step's "CineSync settings" panel; the toggle drives both
      // CineSync's .env (ANIME_SEPARATION/4K_SEPARATION) AND Plex's
      // library auto-creation (anime/4K libraries gated on these flags).
      animeSeparation: false,
      fourKSeparation: false,
      kidsSeparation: false,
      customShowFolder: '',
      custom4kShowFolder: '',
      customAnimeShowFolder: '',
      customMovieFolder: '',
      custom4kMovieFolder: '',
      customAnimeMovieFolder: '',
      customKidsMovieFolder: '',
      customKidsShowFolder: '',
      showResolutionStructure: false,
      movieResolutionStructure: false,
      cinesyncIp: '0.0.0.0',
      cinesyncAuthEnabled: true,
      cinesyncUsername: 'admin',
      cinesyncPassword: 'admin',
      origin_directory: '/opt/surge/CineSync/Origin',
      destination_directory: '/opt/surge/CineSync/Destination',
      rcloneMount: false,
      mountCheckInterval: 30,
      tmdbApiKey: '',
      language: 'English',
      animeScan: false,
      tmdbFolderId: false,
      imdbFolderId: false,
      tvdbFolderId: false,
      renameEnabled: false,
      mediaInfoParser: false,
      renameTags: '',
      mediaInfoTags: '',
      movieCollectionEnabled: false,
      relativeSymlink: false,
      maxCores: 1,
      maxProcesses: 15,
      skipExtrasFolder: true,
      junkMaxSizeMb: 5,
      allowedExtensions: '.mp4,.mkv,.srt,.avi,.mov,.divx,.strm',
      skipAdultPatterns: true,
      sleepTime: 60,
      symlinkCleanupInterval: 600,
      enablePlexUpdate: false,
      plexUrl: '',
      plexToken: '',
      mediahubAutoStart: true,
      rtmAutoStart: false,
      fileOperationsAutoMode: true,
      dbThrottleRate: 100,
      dbMaxRetries: 10,
      dbRetryDelay: 1.0,
      dbBatchSize: 1000,
      dbMaxWorkers: 20,
      port: 8080,
      host: '0.0.0.0',
      username: 'admin',
      password: 'surge',
      enable_ssl: false,
      ssl_cert: '',
      ssl_key: '',
      webhook_url: '',
      extra_env: {},
      extra_args: '',
    },
    // Media Automation - Placeholdarr settings
    placeholdarrSettings: {
      plexUrl: '',
      plexToken: '',
      radarrUrl: '',
      radarrApiKey: '',
      sonarrUrl: '',
      sonarrApiKey: '',
      movieLibraryFolder: '',
      tvLibraryFolder: '',
      dummyFilePath: '',
      placeholderStrategy: 'hardlink',
      tvPlayMode: 'episode',
      titleUpdates: 'OFF',
      includeSpecials: false,
      episodesLookahead: 0,
      maxMonitorTime: 0,
      checkInterval: 0,
      availableCleanupDelay: 0,
      calendarLookaheadDays: 0,
      calendarSyncIntervalHours: 0,
      enableComingSoonPlaceholders: false,
      preferredMovieDateType: 'inCinemas',
      enableComingSoonCountdown: false,
      calendarPlaceholderMode: 'episode',
      comingSoonDummyFilePath: '',
      apiKey: 'surgestack',
      authMethod: 'Basic',
      logLevel: 'Info',
      branch: 'master',
      launchBrowser: 'false',
    },
    // Download Clients & Tools
    nzbgetUrl: '',
    nzbgetApiKey: '',
    nzbgetPort: '',
    nzbgetUsername: '',
    nzbgetPassword: '',
    nzbgetSsl: 'false',
    nzbgetDestinationDirectory: '',
    rdtClientUrl: '', rdtClientApiKey: '',
    // Decypharr (common fields)
    decypharrUrl: '',
    decypharrApiKey: '',
    decypharrDownloadFolder: '',
    decypharrCategories: '',
    decypharrUseAuth: false,
    decypharrPort: 8282,
    decypharrLogLevel: 'info',
    // Decypharr (advanced fields)
    decypharrMinFileSize: '',
    decypharrMaxFileSize: '',
    decypharrAllowedFileTypes: '',
    decypharrRateLimit: '',
    decypharrDownloadUncached: false,
    decypharrCheckCached: false,
    decypharrUseWebdav: false,
    decypharrProxy: '',
    decypharrTorrentsRefreshInterval: '',
    decypharrDownloadLinksRefreshInterval: '',
    decypharrWorkers: '',
    decypharrServeFromRclone: false,
    decypharrAddSamples: false,
    decypharrFolderNaming: '',
    decypharrAutoExpireLinksAfter: '',
    decypharrRcUrl: '',
    decypharrRcUser: '',
    decypharrRcPass: '',
    decypharrRcRefreshDirs: '',
    decypharrDirectories: '',
    decypharrRefreshInterval: '',
    decypharrMaxDownloads: '',
    decypharrSkipPreCache: false,
    // Content Enhancement
    kometaUrl: '', kometaApiKey: '',
    posterizarrUrl: '', posterizarrApiKey: '',
    // Monitoring & Interface
    overseerrUrl: '', overseerrApiKey: '',
    tautulliUrl: '', tautulliApiKey: '',
    // Shared Configuration
    destinationDir: '',
    discordWebhook: '',
    // External API Keys
    tmdbApiKey: '',
    fanartApiKey: '',
    tvdbApiKey: '',
    mdblistApiKey: '',
    rdApiToken: '',
    adApiToken: '',
    premiumizeApiToken: '',
    timezone: '',
    // Pangolin / Newt — opt-in tunneled reverse proxy. The user runs
    // Pangolin on a public-IP host elsewhere; Newt sits in this stack
    // and connects out via WireGuard. All three values come from the
    // user's Pangolin "Add site" flow.
    pangolinEndpoint: '',
    newtId: '',
    newtSecret: '',
    // Gluetun VPN — opt-in per-container outbound VPN. Provider list
    // comes from Gluetun's docs; both wireguard + openvpn fields are
    // declared so we can store either set. The renderer lifts ports
    // off any service flagged with vpnRoute and onto gluetun.
    vpnProvider: '',
    vpnType: 'wireguard',
    vpnWireguardPrivateKey: '',
    vpnWireguardAddresses: '',
    vpnWireguardPresharedKey: '',
    vpnOpenvpnUser: '',
    vpnOpenvpnPassword: '',
    vpnServerCountries: '',
    vpnServerCities: '',
    // Per-service "route through Gluetun" flags. Keys match
    // serviceMeta keys; default empty (off).
    vpnRoutedServices: {},
    // Default to Unraid's nobody:users (99:100). Non-Unraid Docker hosts
    // typically want their own user's UID/GID — surfaced on the Storage
    // Config step. These flow into every container's env via the
    // composePreview's SURGE_ENV_DEFAULTS merge.
    userId: '99',
    groupId: '100',
    umask: '022',
    tz: '',
    // Zurg Configuration
    zurgToken: '',
    // Media Server Configuration
    plexSettings: {
      HOSTNAME: 'PlexServer',
      TZ: 'UTC',
      PLEX_CLAIM: '',
      ADVERTISE_IP: '',
      PLEX_UID: 1000,
      PLEX_GID: 1000,
      CHANGE_CONFIG_DIR_OWNERSHIP: true,
      ALLOWED_NETWORKS: '',
      extra_env: {},
      extra_args: '',
    },
    jellyfinSettings: {
      TZ: 'UTC',
      JELLYFIN_PublishedServerUrl: '',
      JELLYFIN_LOG_DIR: '',
      JELLYFIN_DATA_DIR: '',
      JELLYFIN_CONFIG_DIR: '',
      JELLYFIN_CACHE_DIR: '',
      JELLYFIN_FFMPEG_PATH: '',
      extra_env: {},
      extra_args: '',
    },
    embySettings: {
      TZ: 'UTC',
      EMBY_PublishedServerUrl: '',
      EMBY_DATA_DIR: '',
      EMBY_CONFIG_DIR: '',
      EMBY_CACHE_DIR: '',
      extra_env: {},
      extra_args: '',
    }
  });

  // (Removed: email-verification + password-reset routing, auth-token
  // hydration, WebSocket setup. All depended on a backend that no longer
  // exists. Surge today is a static frontend that produces a downloadable
  // deploy bundle — see deployBundle.js. Realtime deploy progress is
  // logged on the target host instead of streamed back here.)

  // (Removed legacy /api/autodetect + surge-setup localStorage fallback —
  // wizard state is now persisted via the surge-wizard-state effect below.
  // The old code called a backend endpoint that no longer exists.)

  // Auto-persist wizard state to localStorage so a refresh / browser
  // close doesn't lose progress. Two effects:
  //   - Load on mount (runs once): rehydrate config + contentEnhancement
  //     + activeStep from `surge-wizard-state` if present.
  //   - Save on every relevant state change: serialize the live wizard
  //     state to the same key. Suppressed until the load effect has
  //     run, otherwise the initial empty state would overwrite the
  //     saved data on first render.
  // Tracks whether the load effect actually had data to restore. Drives
  // a small dismissable banner so the user knows their prior session was
  // brought back automatically.
  const [restoredFromStorage, setRestoredFromStorage] = React.useState(false);

  // Light/dark mode toggle. The wizard's color values are heavily
  // inlined across every step, so a "real" palette swap would touch
  // every file. Instead, we apply a CSS filter to the wizard root
  // when light mode is active (with images counter-inverted so the
  // service logos stay correct). Pragmatic, ships now, and the user
  // can refine to a true palette later.
  const [colorMode, setColorMode] = React.useState(() => {
    try {
      const stored = localStorage.getItem('surge-color-mode');
      return stored === 'light' ? 'light' : 'dark';
    } catch (err) {
      return 'dark';
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('surge-color-mode', colorMode);
    } catch (err) { /* no storage — preference resets next visit */ }
    // Emit `data-surge-mode` on the <html> root so the CSS variables
    // declared in the global <style> block apply globally.
    document.documentElement.setAttribute('data-surge-mode', colorMode);
  }, [colorMode]);
  const toggleColorMode = React.useCallback(() => {
    setColorMode((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  // Keyboard shortcut help overlay. Opens on "?" anywhere in the
  // document EXCEPT when focus is in an editable surface (input,
  // textarea, contenteditable). The overlay's content lives in
  // KeyboardShortcutsHelp.js — this just owns the open/close state
  // and the global key bindings the help screen documents.
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select'
          || el.isContentEditable;
    };
    const handler = (e) => {
      // Don't hijack typing inside form fields.
      if (isEditable(document.activeElement)) return;

      // "?" — toggle help. Use e.key to handle layouts where Shift+/
      // doesn't produce '?'.
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // Ctrl/Cmd+L — toggle light/dark mode.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleColorMode();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleColorMode]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('surge-wizard-state');
      if (raw) {
        const saved = JSON.parse(raw);
        let didRestore = false;
        if (saved.config && typeof saved.config === 'object') {
          setConfig((prev) => ({ ...prev, ...saved.config }));
          didRestore = true;
        }
        if (saved.contentEnhancement &&
            typeof saved.contentEnhancement === 'object') {
          setContentEnhancement((prev) => ({ ...prev, ...saved.contentEnhancement }));
          didRestore = true;
        }
        if (typeof saved.activeStep === 'number'
            && saved.activeStep >= 0 && saved.activeStep < steps.length) {
          setActiveStep(saved.activeStep);
          didRestore = true;
        }
        if (didRestore) setRestoredFromStorage(true);
      }
    } catch (err) {
      // Bad JSON or storage unavailable (incognito / quota): ignore
      // silently — wizard falls back to initial state.
      console.warn('Could not restore wizard state from localStorage:', err);
    }
    hydratedFromStorageRef.current = true;
  }, []);

  React.useEffect(() => {
    if (!hydratedFromStorageRef.current) return;
    try {
      localStorage.setItem('surge-wizard-state', JSON.stringify({
        config,
        contentEnhancement,
        activeStep,
      }));
    } catch (err) {
      // Quota exceeded or storage unavailable — log and move on; the
      // wizard still works in-memory, just won't survive a refresh.
      console.warn('Could not persist wizard state to localStorage:', err);
    }
  }, [config, contentEnhancement, activeStep]);

  const handleNext = () => setActiveStep((prev) => prev + 1);
  const handleBack = () => setActiveStep((prev) => prev - 1);

  // (Removed: checkDaemonStatus, generateDaemonToken, handleLogin,
  // handleLogout, handleDeploy, handleTest/handleSave, password-reset /
  // email-verification screen routing, and the !isAuthenticated →
  // <AuthComponent /> branch. All depended on backends that no longer
  // exist. The current deploy model is the bundle download flow in
  // deployBundle.js.)

  return (
    <>
      {/* First-time onboarding overlay. Skipped when the load-from-
          localStorage effect actually restored data (returning user). */}
      <OnboardingTour skipIfRestored={restoredFromStorage} />
      <KeyboardShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SettingsBackup open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <style>{`
        :root {
${paletteToCssVars(palettes.dark)}
        }
        :root[data-surge-mode="light"] {
${paletteToCssVars(palettes.light)}
        }
        .MuiButton-root, .MuiButton-outlined, .MuiButton-contained {
          box-shadow: none !important;
          -webkit-box-shadow: none !important;
          outline: none !important;
        }
        .MuiButton-root:focus, .MuiButton-root:focus-visible, .Mui-focusVisible {
          box-shadow: none !important;
          outline: none !important;
        }
        /* Surge logo: white-on-transparent PNG. In light mode, invert
           to black-on-transparent so it reads against the light bg. */
        :root[data-surge-mode="light"] .surge-logo {
          filter: invert(1);
        }
      `}</style>
      {jsonParseError && (
        <div style={{ background: '#ffdddd', color: '#900', padding: 16, margin: 16, border: '2px solid #900', borderRadius: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', zIndex: 9999 }}>
          <b>JSON Parse Error:</b><br />
          {jsonParseError}
        </div>
      )}
      <div style={{
        minHeight: '100vh',
        minWidth: '100vw',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        zIndex: -1
      }} />
      <div
        style={{
          minHeight: '100vh',
          width: '100vw',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          margin: 0,
          zIndex: 1
        }}
      >
        <Container style={{ width: '100%', maxWidth: '1200px', background: 'var(--surge-app-bg)', color: 'var(--surge-text-primary)', borderRadius: 12, boxShadow: 'none', padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box flex={1}>
                {/* Beta badge — outline-style chip in the brand teal,
                    matching the rest of the chrome. Placed in the
                    left-third flex slot opposite the header buttons
                    on the right; doesn't wrap onto its own line on
                    narrow viewports because it's flex-bound. */}
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    border: '1px solid var(--surge-brand)',
                    color: 'var(--surge-brand)',
                    background: 'rgba(7,147,143,0.08)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    fontFamily: 'monospace',
                  }}
                >
                  Beta
                </Box>
              </Box>
              <Box flex={1} textAlign="center">
                <SurgeLogo />
              </Box>
              <Box flex={1} textAlign="right" sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Tooltip title="Settings — export / import" placement="bottom">
                  <Button
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Open settings"
                    variant="outlined"
                    size="small"
                    sx={{
                      minWidth: 0,
                      px: 1.25,
                      color: 'var(--surge-text-primary)',
                      borderColor: 'var(--surge-border)',
                      '&:hover': { borderColor: 'var(--surge-text-primary)' },
                    }}
                  >
                    ⚙
                  </Button>
                </Tooltip>
                <Tooltip title="Keyboard shortcuts (?)" placement="bottom">
                  <Button
                    onClick={() => setShortcutsOpen(true)}
                    aria-label="Show keyboard shortcuts"
                    variant="outlined"
                    size="small"
                    sx={{
                      minWidth: 0,
                      px: 1.25,
                      color: 'var(--surge-text-primary)',
                      borderColor: 'var(--surge-border)',
                      '&:hover': { borderColor: 'var(--surge-text-primary)' },
                    }}
                  >
                    ?
                  </Button>
                </Tooltip>
                <Tooltip
                  title={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode`}
                  placement="bottom"
                >
                  <Button
                    onClick={toggleColorMode}
                    aria-label={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode`}
                    variant="outlined"
                    size="small"
                    sx={{
                      minWidth: 0,
                      px: 1.25,
                      color: 'var(--surge-text-primary)',
                      borderColor: 'var(--surge-border)',
                      '&:hover': { borderColor: 'var(--surge-text-primary)' },
                    }}
                  >
                    {colorMode === 'dark' ? '☀' : '☾'}
                  </Button>
                </Tooltip>
                <Tooltip
                  title="Clears your saved wizard state and reloads."
                  placement="bottom"
                >
                  <Button
                    onClick={() => {
                      try {
                        localStorage.removeItem('surge-wizard-state');
                      } catch (err) {
                        // Storage unavailable; reload anyway, in-memory
                        // state will reset.
                      }
                      window.location.reload();
                    }}
                    variant="outlined"
                    size="small"
                    sx={{
                      color: 'var(--surge-text-primary)',
                      borderColor: 'var(--surge-border)',
                      '&:hover': { borderColor: 'var(--surge-text-primary)' }
                    }}
                  >
                    Reset wizard
                  </Button>
                </Tooltip>
              </Box>
            </Box>
            <Typography variant="h4" align="center" gutterBottom style={{ color: 'var(--surge-text-primary)' }}>
              Surge Setup
            </Typography>
            {restoredFromStorage && (
              <Alert
                severity="info"
                sx={{
                  mb: 2,
                  background: '#0d1f1e',
                  border: '1px solid #07938f',
                  color: '#cfd8dc',
                  '& .MuiAlert-icon': { color: '#07938f' },
                }}
                action={
                  <Button
                    size="small"
                    onClick={() => setRestoredFromStorage(false)}
                    sx={{ color: '#07938f' }}
                  >
                    Dismiss
                  </Button>
                }
              >
                Restored your previous wizard session. Use{' '}
                <strong>Reset wizard</strong> in the top-right to start fresh.
              </Alert>
            )}
            <Stepper activeStep={activeStep} alternativeLabel>
              {steps.map((label, idx) => {
                const status = validateStep(idx, config, contentEnhancement);
                // `completed` drives MUI's built-in green check icon.
                // For 'warning' we override StepIconComponent. For
                // 'incomplete' (and active), MUI's default applies.
                return (
                  <Step key={label} completed={status === 'complete'}>
                    <StepLabel
                      sx={{
                        '& .MuiStepLabel-label': { color: '#fff !important' },
                        '& .MuiStepIcon-root': { color: '#07938f', cursor: 'pointer' },
                        // Native completed-step check inherits MUI's
                        // success color (green) — leave it alone.
                      }}
                      StepIconComponent={status === 'warning'
                        ? WarningStepIcon : undefined}
                      onClick={() => setActiveStep(idx)}
                      style={{ cursor: 'pointer' }}
                    >
                      {label}
                    </StepLabel>
                  </Step>
                );
              })}
            </Stepper>
          </Box>
          <Box sx={{ flex: 1, minHeight: 400, my: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
            {activeStep === 0 && (
              <MediaServerStep config={config} setConfig={setConfig} coreServers={coreServers} />
            )}
            {activeStep === 1 && (
              <StorageConfigStep config={config} setConfig={setConfig} />
            )}
            {activeStep === 2 && (
              <ExternalAPIStep config={config} setConfig={setConfig} />
            )}
            {activeStep === 3 && (
              <AdditionalServicesStep
                contentEnhancement={contentEnhancement}
                setContentEnhancement={setContentEnhancement}
                showKometaAdvanced={showKometaAdvanced}
                setShowKometaAdvanced={setShowKometaAdvanced}
                showPosterizarrAdvanced={showPosterizarrAdvanced}
                setShowPosterizarrAdvanced={setShowPosterizarrAdvanced}
                showPlaceholdarrAdvanced={showPlaceholdarrAdvanced}
                setShowPlaceholdarrAdvanced={setShowPlaceholdarrAdvanced}
                config={config}
                setConfig={setConfig}
              />
            )}
            {activeStep === 4 && (
              <Box>
                <ComposePreviewPanel
                  config={config}
                  setConfig={setConfig}
                  setContentEnhancement={setContentEnhancement}
                  onJumpToService={(serviceKey) => {
                    // Send the user back to the Service Selection
                    // step. AdditionalServicesStep listens for this
                    // event and scrolls/highlights the matching tile.
                    setActiveStep(3);
                    window.dispatchEvent(new CustomEvent(
                      'surge:focus-service', { detail: { serviceKey } }
                    ));
                  }}
                />

                <Box
                  mt={4}
                  p={2}
                  sx={{
                    background: 'rgba(7,147,143,0.08)',
                    border: '1px solid rgba(7,147,143,0.4)',
                    borderRadius: 2,
                  }}
                >
                  <Typography style={{ color: 'var(--surge-accent)', fontSize: 14, fontWeight: 600 }}>
                    How deploy works
                  </Typography>
                  <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13, marginTop: 4 }}>
                    Click <strong>Generate deploy bundle</strong> to download
                    a ZIP containing <code>docker-compose.yaml</code>,{' '}
                    <code>config.json</code>, the seeded config files, and{' '}
                    <code>surge_orchestrator.py</code> (stdlib-only Python).
                    On your target host, unzip and run:
                  </Typography>
                  <Box component="pre" sx={{
                    mt: 1, mb: 0, p: 1,
                    background: 'rgba(0,0,0,0.35)',
                    borderRadius: 1,
                    fontFamily: 'monospace', fontSize: 12,
                    color: 'var(--surge-text-primary)',
                    overflowX: 'auto',
                  }}>
{`python3 surge_orchestrator.py \\
  --manifest manifest.json \\
  --config   config.json`}
                  </Box>
                  <Typography style={{ color: 'var(--surge-text-secondary)', fontSize: 13, marginTop: 8 }}>
                    The orchestrator materializes secrets, writes config
                    files, runs the fetch/post-deploy scripts in dependency
                    order, and executes <code>docker compose up</code>. Pass{' '}
                    <code>--dry-run</code> to preview without writing or
                    starting anything;{' '}
                    <code>--backup</code>, <code>--restore</code>, and{' '}
                    <code>--status</code> handle lifecycle ops once the
                    stack is live.
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
          <Box display="flex" justifyContent="space-between" sx={{ mt: 'auto', mb: 2, px: 2, py: 1, borderRadius: 2, background: 'transparent', border: 'none' }}>
            {activeStep === 0 ? (
              // Hide Back button on the first step (Media Server)
              <div />
            ) : (
              <Button disabled={activeStep === 0} onClick={handleBack} variant="outlined" disableRipple disableElevation sx={{ color: 'var(--surge-text-primary)', borderColor: 'var(--surge-text-primary)', boxShadow: 'none', '&:hover': { boxShadow: 'none' }, '&:focus': { boxShadow: 'none', outline: 'none' }, '&.Mui-focusVisible': { boxShadow: 'none', outline: 'none' } }}>Back</Button>
            )}

            <Button
              disableRipple
              disableElevation
              disabled={
                (activeStep === 1 && !config.platform) ||
                (activeStep === 1 && config.platform === 'docker' && !config.docker?.rootPath?.trim()) ||
                activeStep === steps.length - 1
              }
              onClick={() => {
                if (activeStep === 0 && !config.mediaServer) {
                  setShowNoMediaServerDialog(true);
                } else {
                  handleNext();
                }
              }}
              variant="outlined"
              sx={{ color: 'var(--surge-text-primary)', borderColor: 'var(--surge-text-primary)', boxShadow: 'none', '&:hover': { boxShadow: 'none' }, '&:focus': { boxShadow: 'none', outline: 'none' }, '&.Mui-focusVisible': { boxShadow: 'none', outline: 'none' } }}
            >
              Next
            </Button>
          </Box>
        </Container>
      </div>
    </>
  );
  }
  
  export default App;
