/**
 * Compose-output snapshot fixtures.
 *
 * For each platform scenario, capture the resolved compose output for
 * a representative subset of services. These snapshots act as
 * regression tests — if the path resolver, token semantics, or any
 * service's mount template changes, the snapshot diff makes the change
 * visible and forces an explicit decision to accept (via
 * `npm test -- --updateSnapshot`).
 *
 * Coverage targets at least one of each pattern:
 *   - Single-container with /config + /media (Bazarr).
 *   - Multi-container with private network + secrets (Zilean).
 *   - Multi-container with FUSE caps + obscured-password rclone (zurg).
 *   - Bridge networking + port remap (Seasonarr).
 *   - Servarr with secret-driven config.xml (Sonarr).
 *   - File mounts with ${name} substitution (Tautulli).
 *   - Media server with fetchScript + dot-notation fromConfig (Jellyfin).
 *
 * Run via `npm test -- --watchAll=false` from frontend/.
 */

import { serviceMeta, resolveMount } from '../AdditionalServicesStep';
import { mediaServerMeta } from '../mediaServerMeta';

// ---------------------------------------------------------------------
// Test scenarios: every interesting platform configuration.
// ---------------------------------------------------------------------

const SCENARIOS = [
  {
    label: 'unraid-cache-on',
    config: {
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    },
  },
  {
    label: 'unraid-cache-on-custom-pool',
    config: {
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache_nvme' },
    },
  },
  {
    label: 'unraid-cache-off',
    config: {
      platform: 'unraid',
      unraid: { useCacheDrive: false },
    },
  },
  {
    label: 'docker-default-root',
    config: {
      platform: 'docker',
      docker: { rootPath: '/opt/surge' },
    },
  },
  {
    label: 'docker-custom-root',
    config: {
      platform: 'docker',
      docker: { rootPath: '/srv/media-stack' },
    },
  },
];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function resolveMounts(serviceKey, mounts, config) {
  return mounts.map(m => ({
    src: resolveMount(m.src, { config, serviceKey }),
    dst: m.dst,
    ...(m.options ? { options: m.options } : {}),
  }));
}

function captureService(registry, serviceKey, config) {
  const meta = registry[serviceKey];
  const compose = meta?.compose;
  if (!compose) return { error: `no compose template for ${serviceKey}` };

  const out = {
    image: compose.image,
    ports: compose.ports,
    networkMode: compose.networkMode,
  };

  if (compose.mounts) {
    out.mounts = resolveMounts(serviceKey, compose.mounts, config);
  }
  if (compose.files) {
    out.files = Object.fromEntries(
      Object.entries(compose.files).map(([name, f]) => [
        name,
        { hostPath: resolveMount(f.hostPath, { config, serviceKey }) },
      ]),
    );
  }
  if (compose.services) {
    out.services = Object.fromEntries(
      Object.entries(compose.services).map(([subKey, sub]) => [
        subKey,
        {
          image: sub.image,
          ports: sub.ports,
          networkMode: sub.networkMode,
          ...(sub.mounts
            ? { mounts: resolveMounts(serviceKey, sub.mounts, config) }
            : {}),
          ...(sub.capAdd ? { capAdd: sub.capAdd } : {}),
          ...(sub.devices ? { devices: sub.devices } : {}),
        },
      ]),
    );
  }
  return out;
}

// ---------------------------------------------------------------------
// Snapshot tests, organized by service. Each describe() block produces
// one snapshot per scenario, so running --updateSnapshot regenerates
// them all in lockstep.
// ---------------------------------------------------------------------

describe.each(SCENARIOS)('scenario: $label', ({ label, config }) => {
  describe('serviceMeta — single-container patterns', () => {
    test('bazarr — basic media + config mount', () => {
      expect(captureService(serviceMeta, 'bazarr', config)).toMatchSnapshot();
    });
    test('tautulli — secret-driven config.ini', () => {
      expect(captureService(serviceMeta, 'tautulli', config)).toMatchSnapshot();
    });
    test('sonarr — Servarr with secret-driven config.xml', () => {
      expect(captureService(serviceMeta, 'sonarr', config)).toMatchSnapshot();
    });
    test('seasonarr — bridge networking + port remap', () => {
      expect(captureService(serviceMeta, 'seasonarr', config)).toMatchSnapshot();
    });
  });

  describe('serviceMeta — multi-container patterns', () => {
    test('zilean — postgres sibling + bridge net + secrets', () => {
      expect(captureService(serviceMeta, 'zilean', config)).toMatchSnapshot();
    });
    test('zurg — rclone sibling + FUSE caps + compose.files', () => {
      expect(captureService(serviceMeta, 'zurg', config)).toMatchSnapshot();
    });
    test('nzbdav — postDeployScript-gated rclone sibling', () => {
      expect(captureService(serviceMeta, 'nzbdav', config)).toMatchSnapshot();
    });
  });

  describe('mediaServerMeta', () => {
    test('jellyfin — fetchScript + transcodes on cache', () => {
      expect(captureService(mediaServerMeta, 'jellyfin', config)).toMatchSnapshot();
    });
    test('plex — host networking + library auto-creation paths', () => {
      expect(captureService(mediaServerMeta, 'plex', config)).toMatchSnapshot();
    });
    test('emby — Emby-flavored fetchScript + adminPassword secret', () => {
      expect(captureService(mediaServerMeta, 'emby', config)).toMatchSnapshot();
    });
  });
});

// ---------------------------------------------------------------------
// Path-token edge cases — explicit fixtures that double as documentation
// for what each token resolves to.
// ---------------------------------------------------------------------

describe('path-token resolution edge cases', () => {
  test('mediaRoot with no suffix', () => {
    expect(resolveMount('mediaRoot', {
      config: SCENARIOS[0].config, serviceKey: 'foo',
    })).toBe('/mnt/cache');
  });

  test('configRoot/<service>/nested/path', () => {
    expect(resolveMount('configRoot/<service>/zilean/data', {
      config: SCENARIOS[0].config, serviceKey: 'zilean',
    })).toBe('/mnt/user/appdata/zilean/zilean/data');
  });

  test('userSharesRoot ignores cache toggle', () => {
    const onSrc = resolveMount('userSharesRoot/media', {
      config: SCENARIOS[0].config, serviceKey: 'foo',
    });
    const offSrc = resolveMount('userSharesRoot/media', {
      config: SCENARIOS[2].config, serviceKey: 'foo',
    });
    expect(onSrc).toBe('/mnt/user/media');
    expect(offSrc).toBe('/mnt/user/media');
    expect(onSrc).toBe(offSrc);
  });

  test('absolute paths pass through unchanged', () => {
    expect(resolveMount('/var/run/docker.sock', {
      config: SCENARIOS[0].config, serviceKey: 'foo',
    })).toBe('/var/run/docker.sock');
  });

  test('Docker default rootPath when not configured', () => {
    expect(resolveMount('mediaRoot/media', {
      config: { platform: 'docker', docker: {} }, serviceKey: 'foo',
    })).toBe('/opt/surge/media');
  });

  test('handles missing config gracefully (no platform → empty token expansion)', () => {
    // Defensive case — shouldn't happen in real use (platform is always
    // set by the wizard before any deploy logic runs). Documents the
    // current behavior: tokens expand to empty string, so what comes
    // through is the literal remainder of the path with the leading
    // slash that was after the token.
    expect(resolveMount('mediaRoot/media', {
      config: null, serviceKey: 'foo',
    })).toBe('/media');
  });
});
