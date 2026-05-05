/**
 * Per-step validation logic extracted from App.js.
 * Returns one of:
 *   'complete'   — required fields set, no soft issues → green check
 *   'warning'    — required filled but has soft issues → yellow !
 *   'incomplete' — required fields missing → default (gray dot)
 * Drives the step indicator color in the Stepper so users can see at a
 * glance which steps still need attention.
 */

export function validateStep(stepIndex, config, contentEnhancement) {
  switch (stepIndex) {
    case 0: { // Media Server
      if (!config.mediaServer) return 'incomplete';
      if (config.mediaServer === 'plex' && !config.plexSettings?.PLEX_CLAIM) {
        return 'warning';
      }
      return 'complete';
    }
    case 1: { // Storage Config
      if (!config.platform) return 'incomplete';
      if (config.platform === 'unraid'
          && config.unraid?.useCacheDrive
          && (!config.unraid?.cachePath || !config.unraid?.appdataPath)) {
        return 'warning';
      }
      if (config.platform === 'docker' && !config.docker?.rootPath) {
        return 'incomplete';
      }
      return 'complete';
    }
    case 2: { // External APIs — always optional
      return 'complete';
    }
    case 3: { // Service Selection
      const anyEnabled = Object.values(contentEnhancement || {}).some((v) => !!v);
      return anyEnabled ? 'complete' : 'incomplete';
    }
    case 4: { // Deploy — terminal step, just informational
      return 'complete';
    }
    default:
      return 'complete';
  }
}
