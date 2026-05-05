/**
 * Tests for validateStep.js — per-step validation logic.
 * Tests cover incomplete, warning, and complete states across all steps.
 */

import { validateStep } from '../validateStep';

describe('validateStep', () => {
  describe('Step 0: Media Server', () => {
    test('returns incomplete when no mediaServer selected', () => {
      const result = validateStep(0, { mediaServer: '' }, {});
      expect(result).toBe('incomplete');
    });

    test('returns complete when mediaServer selected (non-plex)', () => {
      const result = validateStep(0, { mediaServer: 'jellyfin' }, {});
      expect(result).toBe('complete');
    });

    test('returns complete when plex selected with PLEX_CLAIM', () => {
      const result = validateStep(0, {
        mediaServer: 'plex',
        plexSettings: { PLEX_CLAIM: 'claim-1234567890abcdef' },
      }, {});
      expect(result).toBe('complete');
    });

    test('returns warning when plex selected without PLEX_CLAIM', () => {
      const result = validateStep(0, {
        mediaServer: 'plex',
        plexSettings: { PLEX_CLAIM: '' },
      }, {});
      expect(result).toBe('warning');
    });

    test('returns warning when plex selected with missing plexSettings', () => {
      const result = validateStep(0, {
        mediaServer: 'plex',
      }, {});
      expect(result).toBe('warning');
    });
  });

  describe('Step 1: Storage Config', () => {
    test('returns incomplete when no platform selected', () => {
      const result = validateStep(1, { platform: '' }, {});
      expect(result).toBe('incomplete');
    });

    test('returns complete when docker platform with rootPath', () => {
      const result = validateStep(1, {
        platform: 'docker',
        docker: { rootPath: '/srv/surge' },
      }, {});
      expect(result).toBe('complete');
    });

    test('returns incomplete when docker platform without rootPath', () => {
      const result = validateStep(1, {
        platform: 'docker',
        docker: {},
      }, {});
      expect(result).toBe('incomplete');
    });

    test('returns incomplete when docker platform with empty rootPath', () => {
      const result = validateStep(1, {
        platform: 'docker',
        docker: { rootPath: '' },
      }, {});
      expect(result).toBe('incomplete');
    });

    test('returns complete when unraid without cache drive', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: { useCacheDrive: false },
      }, {});
      expect(result).toBe('complete');
    });

    test('returns complete when unraid with cache and both paths set', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: {
          useCacheDrive: true,
          cachePath: '/mnt/cache',
          appdataPath: '/mnt/user/appdata',
        },
      }, {});
      expect(result).toBe('complete');
    });

    test('returns warning when unraid with cache but missing cachePath', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: {
          useCacheDrive: true,
          cachePath: '',
          appdataPath: '/mnt/user/appdata',
        },
      }, {});
      expect(result).toBe('warning');
    });

    test('returns warning when unraid with cache but missing appdataPath', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: {
          useCacheDrive: true,
          cachePath: '/mnt/cache',
          appdataPath: '',
        },
      }, {});
      expect(result).toBe('warning');
    });

    test('returns warning when unraid with cache but missing both paths', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: { useCacheDrive: true },
      }, {});
      expect(result).toBe('warning');
    });
  });

  describe('Step 2: External APIs', () => {
    test('always returns complete regardless of config', () => {
      const result = validateStep(2, {}, {});
      expect(result).toBe('complete');
    });

    test('returns complete even with empty config', () => {
      const result = validateStep(2, {}, {});
      expect(result).toBe('complete');
    });
  });

  describe('Step 3: Additional Services', () => {
    test('returns incomplete when no services enabled', () => {
      const result = validateStep(3, {}, {});
      expect(result).toBe('incomplete');
    });

    test('returns incomplete when empty contentEnhancement', () => {
      const result = validateStep(3, {}, {});
      expect(result).toBe('incomplete');
    });

    test('returns complete when at least one service enabled', () => {
      const result = validateStep(3, {}, { sonarr: true });
      expect(result).toBe('complete');
    });

    test('returns complete when multiple services enabled', () => {
      const result = validateStep(3, {}, {
        sonarr: true,
        radarr: true,
        bazarr: true,
      });
      expect(result).toBe('complete');
    });

    test('returns incomplete when all services disabled', () => {
      const result = validateStep(3, {}, {
        sonarr: false,
        radarr: false,
      });
      expect(result).toBe('incomplete');
    });

    test('returns incomplete when contentEnhancement is null', () => {
      const result = validateStep(3, {}, null);
      expect(result).toBe('incomplete');
    });

    test('returns incomplete when contentEnhancement is undefined', () => {
      const result = validateStep(3, {}, undefined);
      expect(result).toBe('incomplete');
    });
  });

  describe('Step 4: Deploy', () => {
    test('always returns complete', () => {
      const result = validateStep(4, {}, {});
      expect(result).toBe('complete');
    });

    test('returns complete regardless of config', () => {
      const result = validateStep(4, { some: 'invalid' }, { data: 'here' });
      expect(result).toBe('complete');
    });
  });

  describe('Invalid step index', () => {
    test('returns complete for unknown step', () => {
      const result = validateStep(99, {}, {});
      expect(result).toBe('complete');
    });

    test('returns complete for negative step', () => {
      const result = validateStep(-1, {}, {});
      expect(result).toBe('complete');
    });
  });

  describe('Edge cases', () => {
    test('plex with null plexSettings', () => {
      const result = validateStep(0, {
        mediaServer: 'plex',
        plexSettings: null,
      }, {});
      expect(result).toBe('warning');
    });

    test('unraid with null unraid object', () => {
      const result = validateStep(1, {
        platform: 'unraid',
        unraid: null,
      }, {});
      expect(result).toBe('complete');
    });

    test('docker with null docker object', () => {
      const result = validateStep(1, {
        platform: 'docker',
        docker: null,
      }, {});
      expect(result).toBe('incomplete');
    });

    test('service with falsy value is treated as disabled', () => {
      const result = validateStep(3, {}, {
        sonarr: 0,
        radarr: '',
        bazarr: null,
      });
      expect(result).toBe('incomplete');
    });
  });
});
