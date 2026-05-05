/**
 * Snapshot tests for composePreview.js — exercises end-to-end
 * preview generation across realistic config scenarios.
 *
 * Run via `npm test -- --watchAll=false` from frontend/.
 *
 * Each test snapshots the full preview output (containers, files,
 * secrets, scripts, networks). When you intentionally change schema
 * shape or resolution behavior, regenerate via:
 *   npm test -- --watchAll=false --updateSnapshot
 * and review the diff carefully.
 */

import { generateComposePreview } from '../composePreview';

// ---------------------------------------------------------------------
// Test fixtures: realistic config scenarios users might pick.
// ---------------------------------------------------------------------

const SCENARIOS = {
  // Minimum config: nothing enabled. Tests the "empty deploy" baseline.
  emptyConfig: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: '',
    contentEnhancement: {},
  },

  // Just a media server, nothing else. Smallest meaningful deploy.
  jellyfinOnly: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'jellyfin',
    contentEnhancement: {},
    jellyfinSettings: {
      JELLYFIN_PublishedServerUrl: 'https://jellyfin.example.com',
    },
  },

  // Classic *arr stack on Unraid with cache. Most common deployment
  // shape — *arrs + Bazarr + Prowlarr + SABnzbd, no debrid.
  arrStackUnraidCache: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'plex',
    contentEnhancement: {
      sonarr: true,
      radarr: true,
      bazarr: true,
      prowlarr: true,
      sabnzbd: true,
    },
    plexSettings: {
      PLEX_CLAIM: 'claim-1234567890abcdef',
      ADVERTISE_IP: '',
    },
    tmdbApiKey: 'test-tmdb-key',
  },

  // Debrid-flavored stack. Exercises multi-container services (zurg,
  // zilean) and FUSE caps + bridge networks + secrets.
  debridStackUnraidCache: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'jellyfin',
    contentEnhancement: {
      sonarr: true,
      radarr: true,
      prowlarr: true,
      zurg: true,
      zilean: true,
      'rdt-client': true,
    },
    rdApiToken: 'test-rd-token',
    jellyfinSettings: {
      JELLYFIN_PublishedServerUrl: 'https://jellyfin.example.com',
    },
  },

  // Same debrid stack on Docker — should produce a flat ${rootPath}
  // tree with no cache/user-shares distinction.
  debridStackDocker: {
    platform: 'docker',
    docker: { rootPath: '/srv/surge' },
    mediaServer: 'jellyfin',
    contentEnhancement: {
      sonarr: true,
      radarr: true,
      prowlarr: true,
      zurg: true,
      zilean: true,
      'rdt-client': true,
    },
    rdApiToken: 'test-rd-token',
    jellyfinSettings: {
      JELLYFIN_PublishedServerUrl: 'https://jellyfin.example.com',
    },
  },

  // Episeerr + Tautulli + Jellyfin — exercises every cross-service
  // marker shape: fromServiceSecret (sonarr, tautulli), fromService
  // (jellyfin's fetchScript), whenMediaServer gating, fromConfig
  // (TMDB), and ${name} template substitution.
  episeerrCrossServiceFlavors: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'jellyfin',
    contentEnhancement: {
      episeerr: true,
      sonarr: true,
      tautulli: true,
    },
    tmdbApiKey: 'test-tmdb-from-config',
    jellyfinSettings: {
      JELLYFIN_PublishedServerUrl: 'https://jellyfin.example.com',
    },
  },

  // Same episeerr config but media server is Plex — should drop the
  // JELLYFIN_* env vars entirely (whenMediaServer: 'jellyfin' gate).
  episeerrWithPlex: {
    platform: 'unraid',
    unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'plex',
    contentEnhancement: {
      episeerr: true,
      sonarr: true,
      tautulli: true,
    },
    tmdbApiKey: 'test-tmdb-from-config',
    plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
  },
};


// ---------------------------------------------------------------------
// Snapshot tests, one per scenario.
// ---------------------------------------------------------------------

describe.each(Object.entries(SCENARIOS))(
  'preview: %s',
  (label, config) => {
    test('matches snapshot', () => {
      const preview = generateComposePreview(config);
      expect(preview).toMatchSnapshot();
    });
  },
);


// ---------------------------------------------------------------------
// Targeted assertions on key behaviors. Less brittle than snapshots
// for the things we particularly care about being correct.
// ---------------------------------------------------------------------

describe('targeted behavior', () => {
  test('empty config produces empty preview', () => {
    const p = generateComposePreview(SCENARIOS.emptyConfig);
    expect(Object.keys(p.services)).toHaveLength(0);
    expect(p.files).toHaveLength(0);
    expect(p.secrets).toEqual({});
  });

  test('jellyfinOnly deploys exactly one container', () => {
    const p = generateComposePreview(SCENARIOS.jellyfinOnly);
    expect(Object.keys(p.services)).toEqual(['jellyfin']);
  });

  test('multi-container service emits both containers + private network', () => {
    const p = generateComposePreview(SCENARIOS.debridStackUnraidCache);
    expect(p.services.zilean).toBeDefined();
    expect(p.services['zilean-postgres']).toBeDefined();
    expect(p.networks['zilean-internal']).toEqual({ driver: 'bridge' });
    expect(p.services.zurg).toBeDefined();
    expect(p.services['zurg-rclone']).toBeDefined();
    expect(p.networks['zurg-internal']).toEqual({ driver: 'bridge' });
  });

  test('whenMediaServer gates env vars correctly', () => {
    const withJellyfin = generateComposePreview(SCENARIOS.episeerrCrossServiceFlavors);
    const withPlex = generateComposePreview(SCENARIOS.episeerrWithPlex);
    const epEnvJ = withJellyfin.services.episeerr.environment;
    const epEnvP = withPlex.services.episeerr.environment;

    // Jellyfin scenario: JELLYFIN_* present.
    expect(epEnvJ.some(e => e.startsWith('JELLYFIN_URL='))).toBe(true);
    expect(epEnvJ.some(e => e.startsWith('JELLYFIN_API_KEY='))).toBe(true);
    expect(epEnvJ.some(e => e.startsWith('JELLYFIN_USER_ID='))).toBe(true);

    // Plex scenario: JELLYFIN_* omitted entirely.
    expect(epEnvP.some(e => e.startsWith('JELLYFIN_URL='))).toBe(false);
    expect(epEnvP.some(e => e.startsWith('JELLYFIN_API_KEY='))).toBe(false);
    expect(epEnvP.some(e => e.startsWith('JELLYFIN_USER_ID='))).toBe(false);
  });

  test('cross-service secret references resolve to GENERATED placeholders', () => {
    const p = generateComposePreview(SCENARIOS.episeerrCrossServiceFlavors);
    const env = p.services.episeerr.environment;
    expect(env).toContain('SONARR_API_KEY=<GENERATED:sonarr.apiKey>');
    expect(env).toContain('TAUTULLI_API_KEY=<GENERATED:tautulli.apiKey>');
  });

  test('runtime-fetch markers resolve to RUNTIME-FETCH placeholders', () => {
    const p = generateComposePreview(SCENARIOS.episeerrCrossServiceFlavors);
    const env = p.services.episeerr.environment;
    expect(env).toContain('JELLYFIN_API_KEY=<RUNTIME-FETCH:jellyfin.apiKey>');
    expect(env).toContain('JELLYFIN_USER_ID=<RUNTIME-FETCH:jellyfin.userId>');
  });

  test('fromConfig with user value substitutes the real value', () => {
    const p = generateComposePreview(SCENARIOS.episeerrCrossServiceFlavors);
    const env = p.services.episeerr.environment;
    expect(env).toContain('TMDB_API_KEY=test-tmdb-from-config');
  });

  test('fromConfig without user value falls back to defaultValue', () => {
    const p = generateComposePreview({
      ...SCENARIOS.episeerrCrossServiceFlavors,
      tmdbApiKey: '',
    });
    const env = p.services.episeerr.environment;
    expect(env).toContain('TMDB_API_KEY=');  // empty defaultValue
  });

  test('Episeerr env wires every supported integration with whenService/whenMediaServer gates', () => {
    // Full stack: Plex + sonarr + radarr + tautulli + episeerr.
    // Episeerr should see PLEX_*, SONARR_*, RADARR_*, TAUTULLI_*, TMDB_*
    // resolved; JELLYFIN_* and EMBY_* omitted (mediaServer != either).
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: {
        episeerr: true,
        sonarr:   true,
        radarr:   true,
        tautulli: true,
      },
      tmdbApiKey: 'tmdb-key-xyz',
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const env = p.services.episeerr.environment;
    // Resolved.
    expect(env).toContain('TMDB_API_KEY=tmdb-key-xyz');
    expect(env).toContain('SONARR_URL=http://localhost:8989');
    expect(env).toContain('SONARR_API_KEY=<GENERATED:sonarr.apiKey>');
    expect(env).toContain('RADARR_URL=http://localhost:7878');
    expect(env).toContain('RADARR_API_KEY=<GENERATED:radarr.apiKey>');
    expect(env).toContain('TAUTULLI_URL=http://localhost:8181');
    expect(env).toContain('TAUTULLI_API_KEY=<GENERATED:tautulli.apiKey>');
    expect(env).toContain('PLEX_URL=http://localhost:32400');
    expect(env).toContain('PLEX_TOKEN=<RUNTIME-FETCH:plex.plexToken>');
    // Gated off by whenMediaServer.
    expect(env.some(e => e.startsWith('JELLYFIN_'))).toBe(false);
    expect(env.some(e => e.startsWith('EMBY_'))).toBe(false);
  });

  test('Pulsarr postDeployScript wires plex+sonarr+radarr with proper gates', () => {
    // Plex + Sonarr + Radarr + Pulsarr all enabled — every gated env
    // resolves through. plexTokens stays a single value (script wraps
    // it into a JSON array before PUTing to Pulsarr's API).
    const full = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: { pulsarr: true, sonarr: true, radarr: true },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const post = full.postDeployScripts.find(s => s.service === 'pulsarr');
    expect(post).toBeDefined();
    expect(post.path).toBe('scripts/configure-pulsarr.py');
    expect(post.env).toEqual({
      PLEX_TOKEN:     '<RUNTIME-FETCH:plex.plexToken>',
      SONARR_URL:     'http://localhost:8989',
      SONARR_API_KEY: '<GENERATED:sonarr.apiKey>',
      RADARR_URL:     'http://localhost:7878',
      RADARR_API_KEY: '<GENERATED:radarr.apiKey>',
    });

    // Pulsarr + Jellyfin (no Plex) + only Sonarr — PLEX_TOKEN omitted
    // by whenMediaServer, RADARR_* omitted by whenService.
    const noPlex = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'jellyfin',
      contentEnhancement: { pulsarr: true, sonarr: true },
      jellyfinSettings: { JELLYFIN_PublishedServerUrl: '' },
    });
    const postNo = noPlex.postDeployScripts.find(s => s.service === 'pulsarr');
    expect(postNo.env).toEqual({
      SONARR_URL:     'http://localhost:8989',
      SONARR_API_KEY: '<GENERATED:sonarr.apiKey>',
    });
    expect('PLEX_TOKEN' in postNo.env).toBe(false);
    expect('RADARR_URL' in postNo.env).toBe(false);
  });

  test('Episeerr postDeployScript wires Prowlarr+SABnzbd via API gated by whenService', () => {
    // Episeerr + Prowlarr + SABnzbd enabled — both env vars resolve.
    const both = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: {
        episeerr: true,
        prowlarr: true,
        sabnzbd:  true,
      },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const post = both.postDeployScripts.find(s => s.service === 'episeerr');
    expect(post).toBeDefined();
    expect(post.path).toBe('scripts/configure-episeerr.py');
    expect(post.env).toEqual({
      PROWLARR_URL:     'http://localhost:9696',
      PROWLARR_API_KEY: '<GENERATED:prowlarr.apiKey>',
      SABNZBD_URL:      'http://localhost:8080',
      SABNZBD_API_KEY:  '<GENERATED:sabnzbd.apiKey>',
    });

    // Episeerr only — script gets empty env and short-circuits.
    const only = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: { episeerr: true },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const postOnly = only.postDeployScripts.find(s => s.service === 'episeerr');
    expect(postOnly).toBeDefined();
    expect(postOnly.env).toEqual({});

    // Prowlarr only — Prowlarr vars resolve, SABnzbd gated off.
    const prowlarrOnly = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: { episeerr: true, prowlarr: true },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const postP = prowlarrOnly.postDeployScripts.find(s => s.service === 'episeerr');
    expect(postP.env).toEqual({
      PROWLARR_URL:     'http://localhost:9696',
      PROWLARR_API_KEY: '<GENERATED:prowlarr.apiKey>',
    });
    expect('SABNZBD_URL' in postP.env).toBe(false);
    expect('SABNZBD_API_KEY' in postP.env).toBe(false);
  });

  test('Episeerr with Emby resolves EMBY_* and gates Plex/Jellyfin off', () => {
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'emby',
      contentEnhancement: {
        episeerr: true,
        sonarr:   true,
      },
      embySettings: { EMBY_PublishedServerUrl: '' },
    });
    const env = p.services.episeerr.environment;
    expect(env).toContain('EMBY_URL=http://localhost:8096');
    expect(env).toContain('EMBY_API_KEY=<RUNTIME-FETCH:emby.apiKey>');
    expect(env).toContain('EMBY_USER_ID=<RUNTIME-FETCH:emby.userId>');
    expect(env.some(e => e.startsWith('PLEX_'))).toBe(false);
    expect(env.some(e => e.startsWith('JELLYFIN_'))).toBe(false);
    // Radarr disabled too — should be omitted.
    expect(env.some(e => e.startsWith('RADARR_'))).toBe(false);
  });

  test('Plex postDeployScript env wires CineSync gating', () => {
    // Plex + CineSync enabled, anime+4K toggles BOTH off — script
    // gets CINESYNC_*_LIBRARIES_ENABLED='false' and creates only
    // the always-on Movies/Shows libraries on the CineSync side.
    const withCinesync = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: { cinesync: true },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
      cinesyncSettings: { animeSeparation: false, fourKSeparation: false },
    });
    const plexCs = withCinesync.postDeployScripts.find(s => s.service === 'plex');
    expect(plexCs).toBeDefined();
    expect(plexCs.env).toEqual({
      PLEX_TOKEN:                       '<RUNTIME-FETCH:plex.plexToken>',
      CINESYNC_ENABLED:                 '1',
      CINESYNC_OUTPUT_PATH:             '/data/output/CineSync',
      CINESYNC_ANIME_LIBRARIES_ENABLED: 'false',
      CINESYNC_4K_LIBRARIES_ENABLED:    'false',
    });

    // Same scenario but anime toggle ON — fromConfig resolves to
    // 'true', script creates anime libraries too.
    const animeOn = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: { cinesync: true },
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
      cinesyncSettings: { animeSeparation: true, fourKSeparation: false },
    });
    const plexAnime = animeOn.postDeployScripts.find(s => s.service === 'plex');
    expect(plexAnime.env.CINESYNC_ANIME_LIBRARIES_ENABLED).toBe('true');
    expect(plexAnime.env.CINESYNC_4K_LIBRARIES_ENABLED).toBe('false');

    // Plex without CineSync — only PLEX_TOKEN should resolve;
    // all CINESYNC_* vars omitted by the whenService gate.
    const withoutCinesync = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      contentEnhancement: {},
      plexSettings: { PLEX_CLAIM: 'claim-test', ADVERTISE_IP: '' },
    });
    const plexNo = withoutCinesync.postDeployScripts.find(s => s.service === 'plex');
    expect(plexNo).toBeDefined();
    expect(plexNo.env).toEqual({
      PLEX_TOKEN: '<RUNTIME-FETCH:plex.plexToken>',
    });
    expect('CINESYNC_ENABLED' in plexNo.env).toBe(false);
    expect('CINESYNC_OUTPUT_PATH' in plexNo.env).toBe(false);
    expect('CINESYNC_ANIME_LIBRARIES_ENABLED' in plexNo.env).toBe(false);
    expect('CINESYNC_4K_LIBRARIES_ENABLED' in plexNo.env).toBe(false);
  });

  test('CineSync .env file content seeds source + destination paths', () => {
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: '',
      contentEnhancement: { cinesync: true },
      cinesyncSettings: { animeSeparation: false, fourKSeparation: false },
    });
    // Host path: cache-pool side, under media root.
    const envFile = p.files.find(f => f.path.endsWith('/cinesync/.env'));
    expect(envFile).toBeDefined();
    expect(envFile.content).toContain('SOURCE_DIR=/media/Intake');
    expect(envFile.content).toContain('DESTINATION_DIR=/media/output/CineSync');
    // Anime + 4K separation toggles default off — wizard config drives
    // the substitution so flipping the toggle in the UI changes the .env.
    expect(envFile.content).toContain('ANIME_SEPARATION=false');
    expect(envFile.content).toContain('4K_SEPARATION=false');

    // Same template with anime toggle ON should render 'true'.
    const animeOn = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: '',
      contentEnhancement: { cinesync: true },
      cinesyncSettings: { animeSeparation: true, fourKSeparation: false },
    });
    const envFileAnime = animeOn.files.find(f => f.path.endsWith('/cinesync/.env'));
    expect(envFileAnime.content).toContain('ANIME_SEPARATION=true');
    expect(envFileAnime.content).toContain('4K_SEPARATION=false');

    // CineSync's /app/db is mounted from the same configRoot/<service>
    // tree so the .env we just seeded lands where godotenv reads it.
    const cinesync = p.services.cinesync;
    expect(cinesync).toBeDefined();
    const dbVolume = cinesync.volumes.find(v => v.container === '/app/db');
    expect(dbVolume).toBeDefined();
    // Host side of the /app/db mount should match the .env's host dir.
    expect(envFile.path.startsWith(dbVolume.host)).toBe(true);

    // /home mount should be gone.
    expect(cinesync.volumes.some(v => v.container === '/home')).toBe(false);
  });

  test('Servarr config.xml file content has secret placeholder', () => {
    const p = generateComposePreview(SCENARIOS.arrStackUnraidCache);
    const sonarrConfig = p.files.find(f => f.path.endsWith('/sonarr/config.xml'));
    expect(sonarrConfig).toBeDefined();
    expect(sonarrConfig.content).toContain('<ApiKey><GENERATED:sonarr.apiKey></ApiKey>');
  });

  test('Docker preview produces flat ${rootPath} tree', () => {
    const p = generateComposePreview(SCENARIOS.debridStackDocker);
    // No cache-pool paths in any volume host paths.
    for (const svc of Object.values(p.services)) {
      for (const v of svc.volumes || []) {
        expect(v.host).not.toMatch(/^\/mnt\/(cache|user)/);
        if (!v.host.startsWith('/var/run') && !v.host.startsWith('/dev') &&
            !v.host.startsWith('/etc/localtime') && !v.host.startsWith('/home')) {
          expect(v.host).toMatch(/^\/srv\/surge/);
        }
      }
    }
  });

  test('SURGE_ENV_DEFAULTS get applied to every container', () => {
    const p = generateComposePreview(SCENARIOS.arrStackUnraidCache);
    for (const [containerName, svc] of Object.entries(p.services)) {
      expect(svc.environment).toContain('PUID=99');
      expect(svc.environment).toContain('PGID=100');
      expect(svc.environment).toContain('UMASK=022');
    }
  });

  test('postDeployScripts captured for services that declare them', () => {
    const p = generateComposePreview(SCENARIOS.arrStackUnraidCache);
    const services = p.postDeployScripts.map(s => s.service);
    expect(services).toContain('prowlarr');
  });

  test('fetchScripts captured for services that declare them', () => {
    const p = generateComposePreview(SCENARIOS.jellyfinOnly);
    const services = p.fetchScripts.map(s => s.service);
    expect(services).toContain('jellyfin');
  });

  test('postDeployScript.env resolves env-markers (bazarr + plex)', () => {
    const p = generateComposePreview(SCENARIOS.arrStackUnraidCache);
    const bazarr = p.postDeployScripts.find(s => s.service === 'bazarr');
    expect(bazarr).toBeDefined();
    expect(bazarr.env).toEqual({
      // Same-service secret.
      BAZARR_API_KEY: '<GENERATED:bazarr.apiKey>',
      // Cross-service secrets.
      SONARR_API_KEY: '<GENERATED:sonarr.apiKey>',
      RADARR_API_KEY: '<GENERATED:radarr.apiKey>',
      // Runtime-fetched value, gated on whenMediaServer:'plex'.
      PLEX_TOKEN:     '<RUNTIME-FETCH:plex.plexToken>',
    });
  });

  test('postDeployScript.env wires boxarr → radarr (cross-service secret + static URL)', () => {
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: '',
      contentEnhancement: {
        boxarr: true,
        radarr: true,
      },
    });
    const boxarr = p.postDeployScripts.find(s => s.service === 'boxarr');
    expect(boxarr).toBeDefined();
    expect(boxarr.path).toBe('scripts/configure-boxarr.py');
    expect(boxarr.env).toEqual({
      RADARR_URL:     'http://localhost:7878',
      RADARR_API_KEY: '<GENERATED:radarr.apiKey>',
    });
  });

  test('whenService gate omits env vars when target service is disabled', () => {
    // boxarr enabled, radarr NOT enabled — both RADARR_URL and
    // RADARR_API_KEY should be absent from the resolved env.
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: '',
      contentEnhancement: {
        boxarr: true,
        // radarr deliberately omitted
      },
    });
    const boxarr = p.postDeployScripts.find(s => s.service === 'boxarr');
    expect(boxarr).toBeDefined();
    expect(boxarr.env).toEqual({});  // both gated → both omitted
  });

  test('whenService gate on bazarr drops absent *arr env vars', () => {
    // bazarr enabled with sonarr only — RADARR_API_KEY should be
    // omitted, SONARR_API_KEY should resolve, BAZARR_API_KEY (no
    // gate) should resolve, PLEX_TOKEN should be omitted (no plex
    // mediaServer).
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'jellyfin',
      contentEnhancement: {
        bazarr: true,
        sonarr: true,
        // radarr deliberately omitted
      },
      jellyfinSettings: { JELLYFIN_PublishedServerUrl: '' },
    });
    const bazarr = p.postDeployScripts.find(s => s.service === 'bazarr');
    expect(bazarr).toBeDefined();
    expect(bazarr.env).toEqual({
      BAZARR_API_KEY: '<GENERATED:bazarr.apiKey>',
      SONARR_API_KEY: '<GENERATED:sonarr.apiKey>',
      // RADARR_API_KEY: omitted (whenService:'radarr' fails)
      // PLEX_TOKEN:     omitted (whenMediaServer:'plex' fails)
    });
  });

  test('postDeployScript.env whenMediaServer omits PLEX_TOKEN for jellyfin', () => {
    // Bazarr + Jellyfin scenario — PLEX_TOKEN should not be emitted
    // because the whenMediaServer:'plex' gate fails.
    const p = generateComposePreview({
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'jellyfin',
      contentEnhancement: {
        bazarr:  true,
        sonarr:  true,
        radarr:  true,
      },
      jellyfinSettings: { JELLYFIN_PublishedServerUrl: '' },
    });
    const bazarr = p.postDeployScripts.find(s => s.service === 'bazarr');
    expect(bazarr).toBeDefined();
    expect('PLEX_TOKEN' in bazarr.env).toBe(false);
    // Servarr keys still present.
    expect(bazarr.env.SONARR_API_KEY).toBe('<GENERATED:sonarr.apiKey>');
    expect(bazarr.env.RADARR_API_KEY).toBe('<GENERATED:radarr.apiKey>');
    expect(bazarr.env.BAZARR_API_KEY).toBe('<GENERATED:bazarr.apiKey>');
  });
});
