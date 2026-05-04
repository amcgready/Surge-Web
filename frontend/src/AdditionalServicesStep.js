import React from 'react';
import { Box, Typography, Tooltip, Chip, Stack } from '@mui/material';
import bazarrLogo from './assets/service-logos/bazarr.png';
import boxarrLogo from './assets/service-logos/boxarr.png';
import cinesyncLogo from './assets/service-logos/cinesync.png';
import flaresolverrLogo from './assets/service-logos/flaresolverr.svg';
import decypharrLogo from './assets/service-logos/decypharr.png';
import gapsLogo from './assets/service-logos/gaps.png';
import kometaLogo from './assets/service-logos/kometa.png';
import mdblistarrLogo from './assets/service-logos/mdblistarr.png';
import nzbdavLogo from './assets/service-logos/nzbdav.png';
import posterizarrLogo from './assets/service-logos/posterizarr.png';
import pulsarrLogo from './assets/service-logos/pulsarr.webp';
import prowlarrLogo from './assets/service-logos/prowlarr.png';
import radarrLogo from './assets/service-logos/radarr.png';
import sonarrLogo from './assets/service-logos/sonarr.png';
import tautulliLogo from './assets/service-logos/tautulli.png';
import rdtClientLogo from './assets/service-logos/RDT-Client.png';
import sabnzbdLogo from './assets/service-logos/sabnzbd.png';
import seasonarrLogo from './assets/service-logos/seasonarr.png';
import seerrLogo from './assets/service-logos/overseerr.png';
import zileanLogo from './assets/service-logos/zilean.jpg';
import zurgLogo from './assets/service-logos/zurg.png';

// Placeholder rendered when a service doesn't yet have a logo asset.
// Drop a PNG into ./assets/service-logos/ and add a logo: import to
// replace the tile.
function LogoPlaceholder({ name }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: '#07938f',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 600,
        margin: '0 auto',
      }}
    >
      {letter}
    </Box>
  );
}

// Universal environment variables applied to every Surge-deployed
// container. PUID/PGID match Unraid's nobody:users convention and have
// been approved for cross-platform use. TZ pulls from the user's
// environment via the standard compose-time substitution.
export const SURGE_ENV_DEFAULTS = {
  PUID: 99,
  PGID: 100,
  UMASK: '022',
  TZ: '${TZ:-UTC}',
};

// Universal compose-level defaults applied to every Surge-deployed
// container. Host networking is the default because services reach
// each other via http://localhost:<port>.
//
// A service may override any of these by setting the same field on
// its compose template (e.g. compose.networkMode = 'bridge' for
// Seasonarr, which can't share a host port with Posterizarr). When
// a service uses bridge mode, its `ports` list becomes a real
// host:container mapping and sibling-service URLs need different
// addresses than localhost.
export const SURGE_COMPOSE_DEFAULTS = {
  networkMode: 'host',
  restart: 'unless-stopped',
};

// Service keys in `serviceMeta` MUST be lowercase. The compose
// generator uses them verbatim for: container_name, the `services:`
// YAML key, the <service> token in mount paths (so volume folders are
// also lowercase), and any cross-service reference. Display names
// (meta.name) keep their natural casing — only identifiers are
// lowercased. This helper is the canonical accessor; call it instead
// of using the raw key directly.
export function containerNameFor(serviceKey) {
  return String(serviceKey || '').toLowerCase();
}

// Resolve a mount source token to an absolute host path using the
// user's platform config. Returns '' when called without a platform.
//
// Tokens recognized inside `src`:
//   mediaRoot       Unraid: U2 (cache mount when toggle on, else /mnt/user).
//                   Docker: config.docker.rootPath.
//   configRoot      Unraid: U1 (/mnt/user/appdata; fixed).
//                   Docker: config.docker.rootPath.
//   userSharesRoot  Unraid: /mnt/user always — independent of cache toggle.
//                   Use for paths that need the FUSE-merged library view
//                   so services see files regardless of cache vs array.
//                   Docker: config.docker.rootPath.
//   <service>       Replaced with the service key being resolved.
export function resolveMount(src, { config, serviceKey }) {
  if (!src) return '';

  let mediaRoot = '';
  let configRoot = '';
  let userSharesRoot = '';

  if (config?.platform === 'unraid') {
    const u = config.unraid || {};
    configRoot = '/mnt/user/appdata'; // U1, fixed
    mediaRoot = u.useCacheDrive
      ? (u.cachePath?.trim() || '/mnt/cache') // U2 with cache
      : '/mnt/user';                          // U2 falls back to user shares
    userSharesRoot = '/mnt/user';             // Always merged user-shares root
  } else if (config?.platform === 'docker') {
    const root = config.docker?.rootPath?.trim() || '/opt/surge';
    mediaRoot = root;
    configRoot = root;
    userSharesRoot = root;
  }

  return src
    .replace(/^mediaRoot(?=\/|$)/, mediaRoot)
    .replace(/^configRoot(?=\/|$)/, configRoot)
    .replace(/^userSharesRoot(?=\/|$)/, userSharesRoot)
    .replace(/<service>/g, serviceKey || '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

// Category filter buttons shown above the service grid. Order matters —
// it controls the chip display order. 'all' is always first.
const categories = [
  { key: 'all',        label: 'All' },
  { key: 'media',      label: 'Media Management' },
  { key: 'indexers',   label: 'Indexers' },
  { key: 'downloads',  label: 'Download Clients' },
  { key: 'debrid',     label: 'Debrid & Storage' },
  { key: 'requests',   label: 'Requests' },
  { key: 'metadata',   label: 'Metadata & Posters' },
  { key: 'monitoring', label: 'Monitoring' },
];

// Service metadata. Keys are lowercase identifiers used in
// contentEnhancement state. logo is null when no asset exists yet.
// repo is the canonical upstream git URL — the new backend will use
// these to clone whatever the user enables.
const serviceMeta = {
  bazarr: {
    name: 'Bazarr',
    desc: 'Subtitle manager',
    logo: bazarrLogo,
    category: 'media',
    repo: 'https://github.com/morpheus65535/bazarr',
    compose: {
      image: 'linuxserver/bazarr:latest',
      ports: ['6767:6767'],
      mounts: [
        { src: 'mediaRoot/media',      dst: '/media' },
        { src: 'configRoot/<service>', dst: '/config' },
      ],
    },
  },
  boxarr: {
    name: 'Boxarr',
    desc: 'Automatically track and add trending box office movies to your Radarr library',
    logo: boxarrLogo,
    category: 'metadata',
    repo: 'https://github.com/iongpt/boxarr',
    compose: {
      image: 'ghcr.io/iongpt/boxarr:latest',
      ports: ['8888:8888'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/config' },
      ],
    },
  },
  cinesync: {
    name: 'CineSync',
    desc: 'Media folder manager',
    logo: cinesyncLogo,
    category: 'media',
    repo: 'https://github.com/sureshfizzy/CineSync',
    compose: {
      image: 'sureshfizzy/cinesync:latest',
      ports: ['5173:5173', '8082:8082'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/data' },
        { src: 'mediaRoot/media',      dst: '/media'    },
        { src: '/home',                dst: '/home'     },
      ],
    },
  },
  decypharr: {
    name: 'Decypharr',
    desc: 'qBittorrent-API w/ Debrid support',
    logo: decypharrLogo,
    category: 'downloads',
    repo: 'https://github.com/sirrobot01/decypharr',
    compose: {
      image: 'cy01/blackhole:latest',
      ports: ['8282:8282'],
      mounts: [
        { src: 'mediaRoot/media',      dst: '/mnt' },
        { src: 'configRoot/<service>', dst: '/app' },
      ],
    },
  },
  episeerr: {
    name: 'Episeerr',
    desc: 'Per-episode request handling',
    logo: null,
    category: 'media',
    repo: 'https://github.com/Vansmak/episeerr',
    compose: {
      image: 'vansmak/episeerr:latest',
      ports: ['5002:5002'],
      mounts: [
        { src: 'configRoot/<service>',      dst: '/app/config' },
        { src: 'configRoot/<service>/logs', dst: '/app/logs'   },
        { src: 'configRoot/<service>/data', dst: '/app/data'   },
        { src: 'configRoot/<service>/temp', dst: '/app/temp'   },
      ],
      env: {
        // Static URLs reach sibling containers via host networking.
        SONARR_URL:       'http://localhost:8989',
        TAUTULLI_URL:     'http://localhost:8181',

        // From the External APIs step. Empty string when user leaves it blank.
        TMDB_API_KEY:     { fromConfig: 'tmdbApiKey', defaultValue: '' },

        // Runtime-fetched: backend orchestrator deploys these services
        // first, parses each one's config to extract the field, then
        // injects the value before launching Episeerr.
        SONARR_API_KEY:   { fromService: 'sonarr',   field: 'apiKey' },
        TAUTULLI_API_KEY: { fromService: 'tautulli', field: 'apiKey' },

        // Conditional: only emitted when the user picked Jellyfin on
        // the Media Server step.
        JELLYFIN_URL:     { whenMediaServer: 'jellyfin', value: 'http://localhost:8096' },
        JELLYFIN_API_KEY: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'apiKey' },
        JELLYFIN_USER_ID: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'userId' },
      },
    },
  },
  flaresolverr: {
    name: 'Flaresolverr',
    desc: 'Cloudflare bypass proxy',
    logo: flaresolverrLogo,
    category: 'indexers',
    repo: 'https://github.com/FlareSolverr/FlareSolverr',
    compose: {
      image: 'flaresolverr/flaresolverr:latest',
      ports: ['8191:8191'],
      mounts: [],
      env: {
        LOG_LEVEL: 'info',
      },
    },
  },
  gaps: {
    name: 'GAPS',
    desc: 'Missing movies finder',
    logo: gapsLogo,
    category: 'media',
    repo: 'https://github.com/JasonHHouse/gaps',
    compose: {
      image: 'housewrecker/gaps:latest',
      ports: ['8484:8484'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/usr/data' },
      ],
      env: {
        ENABLE_SSL:   'false',
        ENABLE_LOGIN: 'false',
        BASE_URL:     '/',
      },
    },
  },
  kometa: {
    name: 'Kometa',
    desc: 'Collection and metadata manager',
    logo: kometaLogo,
    category: 'metadata',
    repo: 'https://github.com/kometa-team/kometa',
    compose: {
      image: 'lscr.io/linuxserver/kometa:latest',
      // Kometa runs scheduled CLI passes — no web UI, no exposed port.
      ports: [],
      mounts: [
        { src: 'mediaRoot/media/assets',                                          dst: '/assets' },
        { src: 'configRoot/plex/Library/Application Support/Plex Media Server/', dst: '/plex'   },
        { src: 'configRoot/radarr',                                               dst: '/radarr' },
        { src: 'configRoot/sonarr',                                               dst: '/sonarr' },
        { src: 'mediaRoot/media/movies',                                          dst: '/movies' },
        { src: 'configRoot/<service>',                                            dst: '/config' },
      ],
      env: {
        KOMETA_TIMES:      '00:00',
        KOMETA_RUN:        'False',
        KOMETA_TESTS:      'False',
        KOMETA_NO_MISSING: 'True',
      },
    },
  },
  mdblistarr: {
    name: 'mdblistarr',
    desc: 'MDBList integration',
    logo: mdblistarrLogo,
    category: 'metadata',
    repo: 'https://github.com/linaspurinis/mdblistarr',
    compose: {
      image: 'linaspurinis/mdblistarr:latest',
      ports: ['5353:5353'],
      mounts: [
        { src: 'configRoot/<service>/db', dst: '/usr/src/db' },
      ],
      env: {
        CA_TS_FALLBACK_DIR: '/usr/src/db',
      },
    },
  },
  nzbdav: {
    name: 'NzbDAV',
    desc: 'WebDAV layer for usenet content',
    logo: nzbdavLogo,
    category: 'downloads',
    repo: 'https://github.com/nzbdav-dev/nzbdav',
    compose: {
      // Pre-release tag per upstream — bump when a stable image lands.
      image: 'nzbdav/nzbdav:alpha',
      ports: ['3000:3000'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/config' },
      ],
    },
  },
  posterizarr: {
    name: 'Posterizarr',
    desc: 'Poster automation',
    logo: posterizarrLogo,
    category: 'metadata',
    repo: 'https://github.com/fscorrupt/posterizarr',
    compose: {
      image: 'ghcr.io/fscorrupt/posterizarr:latest',
      ports: ['8000:8000'],
      mounts: [
        { src: 'mediaRoot/media',                dst: '/media'        },
        { src: 'configRoot/<service>',           dst: '/config'       },
        // /assets and /manualassets intentionally share the same host
        // path so the app's auto-generated and user-supplied assets
        // sit in one directory.
        { src: 'mediaRoot/media/assets',         dst: '/assets'       },
        { src: 'mediaRoot/media/assets',         dst: '/manualassets' },
        { src: 'mediaRoot/media/assetsbackup',   dst: '/assetsbackup' },
      ],
      env: {
        RUN_TIME: '22:00',
        TERM:     'xterm',
      },
    },
  },
  prowlarr: {
    name: 'Prowlarr',
    desc: 'Indexer manager',
    logo: prowlarrLogo,
    category: 'indexers',
    repo: 'https://github.com/prowlarr/prowlarr',
    compose: {
      image: 'lscr.io/linuxserver/prowlarr:latest',
      ports: ['9696:9696'],
      mounts: [
        { src: 'mediaRoot/media',                          dst: '/media'                     },
        // Nested mount: shared community indexer-defs folder shows
        // through at /config/Definitions/Custom, overriding that
        // subdirectory of the broader /config mount below.
        { src: 'configRoot/Prowlarr-Indexers/Custom',      dst: '/config/Definitions/Custom' },
        { src: 'configRoot/<service>',                     dst: '/config'                    },
      ],
    },
  },
  pulsarr: {
    name: 'Pulsarr',
    desc: 'Plex watchlist sync to *arr',
    logo: pulsarrLogo,
    category: 'requests',
    repo: 'https://github.com/jamcalli/pulsarr',
    compose: {
      image: 'lakker/pulsarr:latest',
      ports: ['3003:3003'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/data' },
      ],
      env: {
        // camelCase per Pulsarr's own config schema (upstream docs).
        cookieSecured:         'false',
        basePath:              '/',
        authenticationMethod:  'required',
        allowIframes:          'false',
        enableRequestLogging:  'false',
        dbType:                'sqlite',
        dbHost:                'localhost',
        dbPort:                '5432',
        dbName:                'pulsarr',
        dbUser:                'postgres',
        dbPassword:            'pulsarrdb',
        CA_TS_FALLBACK_DIR:    '/app/data',
      },
    },
  },
  radarr: {
    name: 'Radarr',
    desc: 'Movie manager',
    logo: radarrLogo,
    category: 'media',
    repo: 'https://github.com/Radarr/Radarr',
    compose: {
      image: 'lscr.io/linuxserver/radarr:latest',
      ports: ['7878:7878'],
      mounts: [
        // Library — same root as every other /media mount across Surge.
        { src: 'mediaRoot/media',          dst: '/media'        },
        // Cache-side intake folder, nested under /media.
        { src: 'mediaRoot/media/Intake',   dst: '/media/Intake' },
        // Direct cache-pool path for hardlink-safe staging.
        { src: 'mediaRoot/media',          dst: '/cache'        },
        { src: 'configRoot/<service>',     dst: '/config'       },
      ],
    },
  },
  'rdt-client': {
    name: 'rdt-client',
    desc: 'Real-Debrid torrent client',
    logo: rdtClientLogo,
    category: 'downloads',
    repo: 'https://github.com/rogerfar/rdt-client',
    compose: {
      image: 'rogerfar/rdtclient:latest',
      ports: ['6500:6500'],
      mounts: [
        { src: 'configRoot/<service>/db',                   dst: '/data/db'        },
        // Capital Intake to align with Radarr's intake folder; rdt-client
        // drops debrid-pulled torrents into a zurg/__all__ subtree there.
        { src: 'mediaRoot/media/Intake/zurg/__all__',       dst: '/data/downloads' },
      ],
    },
  },
  sabnzbd: {
    name: 'SABnzbd',
    desc: 'Usenet downloader',
    logo: sabnzbdLogo,
    category: 'downloads',
    repo: 'https://github.com/sabnzbd/sabnzbd',
    compose: {
      image: 'lscr.io/linuxserver/sabnzbd:latest',
      ports: ['8080:8080'],
      mounts: [
        { src: 'mediaRoot/media/Intake/incomplete', dst: '/incomplete-downloads' },
        { src: 'mediaRoot/media/Intake/downloads',  dst: '/downloads'            },
        { src: 'configRoot/<service>',              dst: '/config'               },
      ],
    },
  },
  seasonarr: {
    name: 'Seasonarr',
    desc: 'Season-pack management for Sonarr',
    logo: seasonarrLogo,
    category: 'media',
    repo: 'https://github.com/d3v1l1989/seasonarr',
    compose: {
      image: 'ghcr.io/d3v1l1989/seasonarr:latest',
      // Bridge mode overrides the Surge-wide host networking default —
      // Seasonarr's listen port (8000) collides with Posterizarr under
      // host networking, so we remap to host port 8500 via bridge.
      networkMode: 'bridge',
      ports: ['8500:8000'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/data' },
      ],
      env: {
        DATABASE_URL: 'sqlite:///./data/seasonarr.db',
        // Backend's compose generator emits a unique 64-char crypto-random
        // string per Surge install and persists it so it survives restarts.
        // See SURGE_COMPOSE_DEFAULTS comment for the full env-marker schema.
        JWT_SECRET_KEY: { generate: 'random', length: 64 },
      },
    },
  },
  seerr: {
    name: 'Seerr',
    desc: 'Media requests (formerly Overseerr)',
    logo: seerrLogo,
    category: 'requests',
    repo: 'https://github.com/seerr-team/seerr',
    compose: {
      image: 'ghcr.io/seerr-team/seerr:latest',
      ports: ['5055:5055'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/app/config' },
      ],
      env: {
        LOG_LEVEL:          'debug',
        CA_TS_FALLBACK_DIR: '/app/config',
      },
    },
  },
  sonarr: {
    name: 'Sonarr',
    desc: 'TV series manager',
    logo: sonarrLogo,
    category: 'media',
    repo: 'https://github.com/Sonarr/Sonarr',
    compose: {
      image: 'lscr.io/linuxserver/sonarr:latest',
      ports: ['8989:8989'],
      mounts: [
        // Library — same root as every other /media mount across Surge.
        { src: 'mediaRoot/media',          dst: '/media'        },
        // Cache-side intake folder, nested under /media.
        { src: 'mediaRoot/media/Intake',   dst: '/media/Intake' },
        // Direct cache-pool path for hardlink-safe staging.
        { src: 'mediaRoot/media',          dst: '/cache'        },
        { src: 'configRoot/<service>',     dst: '/config'       },
      ],
    },
  },
  tautulli: {
    name: 'Tautulli',
    desc: 'Plex analytics',
    logo: tautulliLogo,
    category: 'monitoring',
    repo: 'https://github.com/tautulli/tautulli',
    compose: {
      image: 'lscr.io/linuxserver/tautulli:latest',
      ports: ['8181:8181'],
      mounts: [
        { src: 'configRoot/<service>', dst: '/config' },
      ],
    },
  },
  zilean: {
    name: 'Zilean',
    desc: 'DMM scraper for debrid stacks',
    logo: zileanLogo,
    category: 'debrid',
    repo: 'https://github.com/iPromKnight/zilean',
    // ====================================================================
    // First multi-container service. Introduces several schema fields used
    // here for the first time — the backend's compose generator interprets:
    //
    //   compose.services         Object of sub-container definitions. Each
    //                            value has the same shape as a single-
    //                            container compose template (image, ports,
    //                            mounts, env, networkMode, etc).
    //                            Sub-container names are emitted as
    //                            <serviceKey>-<subKey>; the special case
    //                            where subKey === serviceKey emits as just
    //                            <serviceKey> (so the primary container
    //                            keeps the user-facing name).
    //
    //   compose.secrets          Service-scoped named secrets. Each entry
    //                            is { generate: 'random', length: N }.
    //                            Backend creates the value once per
    //                            install, persists it across redeploys,
    //                            and substitutes it wherever referenced.
    //
    //   env: { fromSecret: '<name>' }
    //                            Direct reference — the env value becomes
    //                            the secret's value verbatim.
    //
    //   env literals with ${name}
    //                            Template substitution — the backend
    //                            replaces ${name} inside the literal
    //                            string with the secret's value at
    //                            compose-gen time.
    //
    //   per-container fields:
    //     healthcheck:   { test: [...], interval, timeout, retries }
    //     dependsOn:     { <subKey>: { condition: 'service_healthy' } }
    //     tty:           true → allocate pseudo-TTY
    //     shmSize:       '2G' → /dev/shm size override
    //
    // When compose.services is present and any sub-container uses
    // networkMode='bridge', the backend auto-emits a private compose
    // network named <serviceKey>-internal so the sub-containers can
    // reach each other by name.
    // ====================================================================
    compose: {
      secrets: {
        // 32-char random per Surge install. Used by both sub-containers
        // (declared by postgres, consumed by zilean's connection string).
        postgresPassword: { generate: 'random', length: 32 },
      },
      services: {
        postgres: {
          image: 'postgres:17.2-alpine',
          networkMode: 'bridge',
          shmSize: '2G',
          // No ports: postgres reachable only via the internal bridge.
          mounts: [
            { src: 'configRoot/<service>/postgres/pgdata',
              dst: '/var/lib/postgresql/data/pgdata' },
          ],
          env: {
            PGDATA:            '/var/lib/postgresql/data/pgdata',
            POSTGRES_USER:     'postgres',
            POSTGRES_PASSWORD: { fromSecret: 'postgresPassword' },
            POSTGRES_DB:       'zilean',
          },
          healthcheck: {
            test:     ['CMD-SHELL', 'pg_isready -U postgres -d zilean'],
            interval: '10s',
            timeout:  '5s',
            retries:  10,
          },
        },
        zilean: {
          image: 'ipromknight/zilean:latest',
          networkMode: 'bridge',
          tty: true,
          ports: ['8192:8181'],
          mounts: [
            { src: 'configRoot/<service>/data', dst: '/app/data' },
            { src: 'configRoot/<service>/tmp',  dst: '/tmp'      },
          ],
          env: {
            // ${postgresPassword} substituted at compose-gen.
            // 'zilean-postgres' is the emitted name of the sibling
            // sub-container (sub-key 'postgres' prefixed with the
            // service key).
            'Zilean__Database__ConnectionString':
              'Host=zilean-postgres;Port=5432;Database=zilean;Username=postgres;Password=${postgresPassword}',
            'Zilean__Dmm__SyncInterval':            '00:30:00',
            'Zilean__Scraper__MaxParallelRequests': 2,
            'Zilean__Dmm__Enabled':                 'false',
          },
          dependsOn: {
            postgres: { condition: 'service_healthy' },
          },
          healthcheck: {
            test:     ['CMD-SHELL', 'wget -qO- http://localhost:8181/healthchecks/ping >/dev/null 2>&1'],
            interval: '30s',
            timeout:  '10s',
            retries:  10,
          },
        },
      },
    },
  },
  zurg: {
    name: 'zurg',
    desc: 'Real-Debrid filesystem mount (rclone bundled)',
    logo: zurgLogo,
    category: 'debrid',
    repo: 'https://github.com/debridmediamanager/zurg-testing',
    // ====================================================================
    // Second multi-container service (after zilean). Two sub-containers:
    //   - zurg     The WebDAV server exposing Real-Debrid content. Listens
    //              on 9999. Reachable from rclone via the internal network
    //              at http://zurg:9999.
    //   - rclone   FUSE-mounts zurg's WebDAV at /data inside the container,
    //              propagating that mount to the host at
    //              mediaRoot/media/Intake/zurg via :rshared so the *arr
    //              services see the debrid library as a regular directory.
    //
    // Introduces these new schema fields (the backend's compose generator
    // interprets them; forward-documented for the implementer):
    //
    //   compose.files
    //     Object of templated config files Surge writes to host paths
    //     before launching containers. Each entry has:
    //       hostPath  Token-resolvable destination on the host.
    //       content   One of:
    //                   - String literal (with ${name} substitution from
    //                     service secrets and user config).
    //                   - { fromUpstream: '<URL>' } — fetch file contents
    //                     from a URL at install time.
    //                   - { fromUpstream: '<URL>', fallback: '<literal>' }
    //                     — try upstream first, fall back to the literal
    //                     when the URL is unreachable. The fallback is
    //                     a snapshot, not auto-updated against upstream.
    //       mode      Optional octal file mode (e.g. 0o755 for an
    //                 executable script).
    //     Files declared here MUST be written before docker-compose up,
    //     since they're typically referenced by mount entries on the
    //     same service (e.g. zurg's config.yml mount points to a file
    //     that compose.files generated).
    //
    //   per-container fields (in addition to those zilean introduced):
    //     capAdd       Array of Linux capabilities (e.g. ['SYS_ADMIN'])
    //     securityOpt  Array of security options (e.g. ['apparmor:unconfined'])
    //     devices      Array of host:container[:perms] device mappings
    //     command      String overriding the image's default CMD
    //
    //   mount entry option:
    //     options      String mount-option flag (e.g. 'rshared' for the
    //                  mount propagation needed by FUSE).
    //
    //   dependsOn (simple form):
    //     dependsOn: { <subKey>: {} }
    //                  Plain dependency without a health condition.
    //                  Compare with zilean's healthcheck-gated form:
    //                  dependsOn: { <subKey>: { condition: 'service_healthy' } }
    // ====================================================================
    compose: {
      files: {
        rcloneConf: {
          hostPath: 'configRoot/<service>/rclone.conf',
          content:
            '[zurg]\n' +
            'type = webdav\n' +
            'url = http://zurg:9999/dav\n' +
            'vendor = other\n' +
            'pacer_min_sleep = 0\n',
        },
        configYml: {
          hostPath: 'configRoot/<service>/config.yml',
          // ${rdApiToken} substituted from the user's External APIs entry.
          content:
            'zurg: v1\n' +
            'token: ${rdApiToken}\n',
        },
        plexUpdateSh: {
          hostPath: 'configRoot/<service>/scripts/plex_update.sh',
          // Backend fetches the canonical script from upstream at install
          // time and writes it to the host with executable mode.
          content: {
            fromUpstream:
              'https://raw.githubusercontent.com/debridmediamanager/zurg-testing/main/scripts/plex_update.sh',
          },
          mode: 0o755,
        },
      },
      services: {
        zurg: {
          image: 'ghcr.io/debridmediamanager/zurg-testing:latest',
          networkMode: 'bridge',
          ports: ['9999:9999'],
          mounts: [
            { src: 'configRoot/<service>/scripts/plex_update.sh', dst: '/app/plex_update.sh' },
            { src: 'configRoot/<service>/config.yml',             dst: '/app/config.yml'    },
            { src: 'configRoot/<service>/data',                   dst: '/app/data'          },
            { src: 'mediaRoot/media',                             dst: '/media'             },
          ],
        },
        rclone: {
          image: 'rclone/rclone:latest',
          networkMode: 'bridge',
          capAdd:      ['SYS_ADMIN'],
          securityOpt: ['apparmor:unconfined'],
          devices:     ['/dev/fuse:/dev/fuse:rwm'],
          // Long single-line `mount` invocation (rclone's image has no
          // useful default CMD).
          command:
            'mount zurg: /data ' +
            '--allow-other --allow-non-empty ' +
            '--dir-cache-time 10s ' +
            '--vfs-cache-mode full --vfs-cache-max-size 50G --vfs-cache-max-age 1h ' +
            '--buffer-size 64M --vfs-read-ahead 256M',
          mounts: [
            // FUSE target. :rshared propagation makes the mount visible
            // to the host (and to *arr containers binding from the same
            // host path) once rclone populates /data.
            { src: 'mediaRoot/media/Intake/zurg',      dst: '/data',
              options: 'rshared' },
            // Surge-generated rclone.conf with the [zurg] WebDAV remote.
            { src: 'configRoot/<service>/rclone.conf', dst: '/config/rclone/rclone.conf' },
            // VFS cache directory on the cache pool for fast reads.
            { src: 'mediaRoot/<service>/rclone-cache', dst: '/cache' },
          ],
          // Plain dependency: rclone won't start until zurg's container is up.
          dependsOn: { zurg: {} },
        },
      },
    },
  },
};

// Display order on the page (case-insensitive alphabetical).
const allServices = [
  'bazarr',
  'boxarr',
  'cinesync',
  'decypharr',
  'episeerr',
  'flaresolverr',
  'gaps',
  'kometa',
  'mdblistarr',
  'nzbdav',
  'posterizarr',
  'prowlarr',
  'pulsarr',
  'radarr',
  'rdt-client',
  'sabnzbd',
  'seasonarr',
  'seerr',
  'sonarr',
  'tautulli',
  'zilean',
  'zurg',
];

// Sensible defaults for which services start enabled. Common *arr-suite
// staples default on; niche/optional services default off so users
// opt-in rather than discover them later.
const defaultSelected = {
  bazarr: true,
  boxarr: false,
  cinesync: true,
  decypharr: false,
  episeerr: false,
  flaresolverr: false,
  gaps: true,
  kometa: true,
  mdblistarr: false,
  nzbdav: false,
  posterizarr: true,
  prowlarr: true,
  pulsarr: false,
  radarr: true,
  'rdt-client': false,
  sabnzbd: false,
  seasonarr: false,
  seerr: true,
  sonarr: true,
  tautulli: true,
  zilean: false,
  zurg: false,
};

// Public map of upstream repo URLs, keyed by service. NOT used for
// deployment — Surge runs services from their published Docker images
// (compose.image), never by cloning source. This map exists for two
// purposes:
//   1. Documentation / linking out — the UI can surface a service's
//      upstream from its tile.
//   2. Base URL for compose.files entries that use the `fromUpstream`
//      content marker, so file URLs can be derived from the repo
//      rather than duplicated as raw GitHub URLs.
export const serviceRepos = Object.fromEntries(
  Object.entries(serviceMeta).map(([key, meta]) => [key, meta.repo])
);

export default function AdditionalServicesStep(props) {
  const { contentEnhancement, setContentEnhancement } = props;
  const [selectedCategory, setSelectedCategory] = React.useState('all');

  // Seed defaults on first render only; preserve any prior selections.
  React.useEffect(() => {
    setContentEnhancement((prev) => ({ ...defaultSelected, ...prev }));
  }, [setContentEnhancement]);

  const visibleServices =
    selectedCategory === 'all'
      ? allServices
      : allServices.filter((key) => serviceMeta[key]?.category === selectedCategory);

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h6" align="center" style={{ color: '#fff', marginBottom: 16 }}>
        Service Selection
      </Typography>

      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        justifyContent="center"
        rowGap={1}
        sx={{ mb: 3 }}
      >
        {categories.map((cat) => {
          const active = cat.key === selectedCategory;
          return (
            <Chip
              key={cat.key}
              label={cat.label}
              clickable
              onClick={() => setSelectedCategory(cat.key)}
              variant={active ? 'filled' : 'outlined'}
              sx={{
                color: '#fff',
                borderColor: '#07938f',
                backgroundColor: active ? '#07938f' : 'transparent',
                fontWeight: active ? 600 : 400,
                '&:hover': {
                  backgroundColor: active ? '#065a57' : 'rgba(7,147,143,0.15)',
                },
              }}
            />
          );
        })}
      </Stack>

      <Box display="flex" flexWrap="wrap" gap={2} mb={3} justifyContent="center">
        {visibleServices.map((key) => {
          const meta = serviceMeta[key] || { name: key, desc: '', logo: null };
          const enabled = !!contentEnhancement[key];
          return (
            <Tooltip key={key} title={meta.desc || meta.name} placement="top">
              <Box
                onClick={() =>
                  setContentEnhancement((prev) => ({ ...prev, [key]: !prev[key] }))
                }
                sx={{
                  cursor: 'pointer',
                  opacity: enabled ? 1 : 0.4,
                  filter: enabled ? 'none' : 'grayscale(100%)',
                  borderRadius: 2,
                  p: 0.5,
                  background: '#181818',
                  transition: 'all 0.2s',
                  position: 'relative',
                  boxShadow: 'none',
                  '&:hover': { boxShadow: 'none' },
                  width: 100,
                  height: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {meta.logo ? (
                  <img
                    src={meta.logo}
                    alt={meta.name}
                    style={{
                      width: 48,
                      height: 48,
                      display: 'block',
                      margin: '0 auto',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <LogoPlaceholder name={meta.name} />
                )}
                <Typography align="center" style={{ color: '#fff', fontSize: 14, marginTop: 4 }}>
                  {meta.name}
                </Typography>
                {!enabled && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      bgcolor: 'rgba(40,40,40,0.6)',
                      borderRadius: 2,
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
