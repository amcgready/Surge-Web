// mediaServerMeta — parallel registry to serviceMeta in
// AdditionalServicesStep.js, but for the one-of media-server choice
// (Plex / Jellyfin / Emby) made on the wizard's Media Server step.
//
// Same compose-template shape as serviceMeta entries. The future
// backend's compose generator iterates BOTH registries when building
// the deploy. From mediaServerMeta it deploys exactly the entry whose
// key matches `config.mediaServer`; from serviceMeta it deploys every
// entry where `contentEnhancement[<key>] === true`.
//
// Resolver helpers (resolveMount, containerNameFor, the env-marker
// schema, SURGE_*_DEFAULTS) are shared — imported from
// AdditionalServicesStep.js where they're already exported.
//
// All three media servers (Plex, Jellyfin, Emby) have full compose
// templates wired. The fetch and configure scripts referenced by Plex
// and Emby are TODO stubs at deterministic paths in scripts/ — file
// templates exist with documented contracts; implementation comes
// when the runtime-fetch backend orchestration is built.

import plexLogo from './assets/service-logos/plex.png';
import embyLogo from './assets/service-logos/emby.png';
import jellyfinLogo from './assets/service-logos/jellyfin.png';

export const mediaServerMeta = {
  // -------------------------------------------------------------------
  // Jellyfin — fully wired.
  // -------------------------------------------------------------------
  jellyfin: {
    name: 'Jellyfin',
    desc: 'Free and open-source media server',
    logo: jellyfinLogo,
    repo: 'https://github.com/jellyfin/jellyfin',
    compose: {
      image: 'lscr.io/linuxserver/jellyfin:latest',
      // Host networking is the right call for a media server:
      //   - DLNA/SSDP discovery requires multicast on the host network
      //     (broadcasts don't traverse Docker bridges).
      //   - Sibling containers reach Jellyfin at http://localhost:8096
      //     (matches Episeerr's hardcoded JELLYFIN_URL value).
      // This matches SURGE_COMPOSE_DEFAULTS.networkMode but we set it
      // explicitly here so the choice is documented.
      networkMode: 'host',
      // Informational under host networking; Jellyfin binds 8096 (HTTP)
      // and 8920 (HTTPS) directly on the host. We don't expose 8920
      // since Surge users typically front Jellyfin with a reverse proxy
      // for TLS rather than relying on Jellyfin's own cert.
      ports: ['8096:8096'],
      // /System/Ping returns the literal string "Jellyfin Server" on
      // 200 — no auth required. wget is in the linuxserver image.
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8096/System/Ping || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '120s',
      },
      secrets: {
        // Admin password — Surge generates per install and persists.
        // Used by fetch-jellyfin-secrets.py to:
        //   (a) complete the first-run setup wizard via /Startup/User
        //   (b) authenticate via /Users/AuthenticateByName before
        //       creating the API key
        // The user can still change it later through Jellyfin's UI;
        // if they do, they need to update Surge's persisted secret to
        // match or future fetch runs will fail at step (b).
        adminPassword: { generate: 'random', length: 32 },
      },
      env: {
        // The external URL clients should use to reach Jellyfin —
        // collected from the wizard's Media Server step, where the
        // user types it into the Published Server URL field.
        // Note: dot-notation traversal — `fromConfig` reads
        // config.jellyfinSettings.JELLYFIN_PublishedServerUrl. The
        // backend's fromConfig resolver needs to handle nested keys.
        JELLYFIN_PublishedServerUrl: {
          fromConfig: 'jellyfinSettings.JELLYFIN_PublishedServerUrl',
          defaultValue: '',
        },
      },
      mounts: [
        // Configuration, metadata cache, transcode logs.
        { src: 'configRoot/<service>',           dst: '/config' },
        // Library — same mediaRoot/media as every other Surge service.
        { src: 'mediaRoot/media',                dst: '/media' },
        // Live transcode workspace on the cache pool. Jellyfin defaults
        // to /config/transcodes inside the container, but pulling it
        // out as a dedicated mount lets us put it on fast storage
        // without bloating the config tree.
        { src: 'mediaRoot/<service>/transcodes', dst: '/transcodes' },
      ],
      fetchScript: {
        path: 'scripts/fetch-jellyfin-secrets.py',
        env: {
          // Same admin password the container uses; the script needs
          // it both to complete the setup wizard AND to authenticate.
          JELLYFIN_PASSWORD: { fromSecret: 'adminPassword' },
          // JELLYFIN_USERNAME defaults to 'admin' inside the script.
          // JELLYFIN_URL defaults to http://localhost:8096 inside the
          // script (correct under host networking).
        },
      },
    },
  },

  // -------------------------------------------------------------------
  // Plex.
  //
  // Image choice: plexinc/pms-docker (Plex Inc.'s official image)
  // rather than the LSIO variant. Reason: PLEX_CLAIM env-var support
  // is plexinc-specific and gives us full first-run automation. LSIO's
  // image requires manual claim via the web UI — incompatible with
  // Surge's autodeploy promise.
  //
  // Two staged scripts are stubbed below — implementing both is a
  // follow-up task. The compose template alone gets Plex deployed and
  // claimed; the scripts complete library auto-creation.
  // -------------------------------------------------------------------
  plex: {
    name: 'Plex',
    desc: 'Premium media streaming platform',
    logo: plexLogo,
    repo: 'https://github.com/plexinc/pms-docker',
    compose: {
      image: 'plexinc/pms-docker:latest',
      // Host networking is required for Plex's GDM (Good Day Mate)
      // local-network discovery — multicast doesn't traverse Docker
      // bridge networks. Also lets sibling containers reach Plex at
      // http://localhost:32400.
      networkMode: 'host',
      // Informational under host networking; plexinc binds these
      // directly on the host:
      //   32400  HTTP API and web UI (the only one we expose)
      //   32400-32414  GDM, DLNA, RokuConnect — bound automatically
      //                under host networking; we don't list them
      //                because compose `ports:` is documentation only
      //                in this mode.
      ports: ['32400:32400'],
      // /identity returns server XML without auth. plexinc image has wget.
      // Long start_period because Plex's first-launch DB init can run
      // 1-2 minutes on slower hardware.
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:32400/identity || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '180s',
      },
      env: {
        // PLEX_CLAIM is a one-time, ~4-minute-lifespan token from
        // https://www.plex.tv/claim. The wizard collects it from the
        // user at deploy time. If the user takes longer than 4 minutes
        // between claiming and Surge starting Plex, they'll need a
        // fresh token. After Plex starts with this token, the server
        // claims itself on plex.tv and stores a long-lived
        // X-Plex-Token in Preferences.xml.
        //
        // The wizard's MediaServerStep doesn't yet collect this — see
        // the Plex configuration block in MediaServerStep.js for where
        // to add the input field. Until then, defaultValue:'' means
        // Plex starts unclaimed and the user has to claim manually
        // via /web on first launch.
        PLEX_CLAIM: { fromConfig: 'plexSettings.PLEX_CLAIM', defaultValue: '' },
        // plexinc/pms-docker uses its own UID/GID env names. PUID/PGID
        // from SURGE_ENV_DEFAULTS still get set on the container but
        // plexinc ignores them — PLEX_UID/PLEX_GID are what it reads.
        // Hardcoded to match SURGE_ENV_DEFAULTS values; if those ever
        // change, update these too.
        PLEX_UID: '99',
        PLEX_GID: '100',
        // ADVERTISE_IP tells Plex to include this URL in the list of
        // connection addresses it announces to clients. Useful when
        // running behind a reverse proxy with a public URL.
        ADVERTISE_IP: { fromConfig: 'plexSettings.ADVERTISE_IP', defaultValue: '' },
      },
      mounts: [
        { src: 'configRoot/<service>',           dst: '/config' },
        // Plex's plexinc image expects /transcode (not /transcodes).
        // On the cache pool because transcodes are write-heavy.
        { src: 'mediaRoot/<service>/transcode', dst: '/transcode' },
        // plexinc convention is /data, not /media. The data root
        // matches every other Surge service (mediaRoot/media); only
        // the in-container path differs.
        { src: 'mediaRoot/media',                dst: '/data' },
      ],
      fetchScript: {
        // TODO: implement scripts/fetch-plex-secrets.py
        // Polls <CONFIG_PATH>/Library/Application Support/Plex Media Server/Preferences.xml
        // and extracts the PlexOnlineToken attribute (this is the
        // X-Plex-Token used for all subsequent API auth). Outputs:
        //   {"plexToken": "<token>"}
        // The script needs to handle the spaces in the directory
        // name and parse the XML attribute (it's not a standard XML
        // element — it's an attribute on the <Preferences/> root).
        path: 'scripts/fetch-plex-secrets.py',
      },
      postDeployScript: {
        // scripts/configure-plex.py auto-creates Plex libraries based
        // on Surge's standard layout. Always creates two *arr-side
        // libraries (Movies, TV Shows at /data/{movies,tv}); when
        // CineSync is also part of this deploy, creates two additional
        // libraries pointing at CineSync's organized output tree
        // (/data/output/CineSync/{Movies,Shows}) with a "(CineSync)"
        // suffix so they don't collide with the *arr-managed ones.
        // Anime Movies / Anime Series / 4K Movies / 4K Shows are
        // intentionally omitted from defaults — those folders only
        // exist when the user explicitly enables the corresponding
        // CineSync toggle (ANIME_SEPARATION/4K_SEPARATION, both
        // pinned false in Surge's seeded .env) or sets up Sonarr/
        // Radarr anime root folders. Auto-creating libraries pointing
        // at folders that won't exist would clutter Plex's UI with
        // permanently-empty libraries. Users who opt into anime or
        // 4K can add the relevant Plex libraries via "Add Library"
        // in two clicks. Idempotent — skips any library whose name
        // already exists.
        path: 'scripts/configure-plex.py',
        blocks: [],
        env: {
          // Plex's own X-Plex-Token comes from its own fetchScript
          // (fetch-plex-secrets.py reads PlexOnlineToken out of
          // Preferences.xml after first launch). Same-service
          // fetchScript→postDeployScript handoff — declared
          // explicitly here so the orchestrator's deploy-ordering
          // graph knows to run the fetchScript first.
          PLEX_TOKEN: { fromService: 'plex', field: 'plexToken' },
          // CineSync gating — when CineSync is enabled, the script
          // adds six more libraries under CINESYNC_OUTPUT_PATH.
          // whenService:'cinesync' makes the orchestrator omit both
          // vars entirely when CineSync isn't part of this deploy,
          // and the script's is_truthy(CINESYNC_ENABLED) check then
          // returns false → only *arr libraries are created.
          CINESYNC_ENABLED: { whenService: 'cinesync', value: '1' },
          // Container-side path of CineSync's organized output. The
          // host path is mediaRoot/media/output/CineSync (per the
          // DESTINATION_DIR Surge seeds in CineSync's .env), which
          // plexinc/pms-docker exposes at /data/output/CineSync via
          // its mediaRoot/media → /data mount.
          CINESYNC_OUTPUT_PATH: {
            whenService: 'cinesync',
            value:       '/data/output/CineSync',
          },
          // Anime + 4K library auto-creation, driven by the same
          // wizard toggles that drive CineSync's ANIME_SEPARATION
          // and 4K_SEPARATION env vars in its .env. When the toggle
          // is on, Plex gets matching "Anime Movies (CineSync)" /
          // "4K Movies (CineSync)" libraries pointing at
          // CINESYNC_OUTPUT_PATH/{AnimeMovies,4KMovies,...}.
          // configure-plex.py reads the env vars as truthy strings
          // — fromConfig resolves the boolean wizard value, and the
          // script's is_truthy() handles the conversion.
          CINESYNC_ANIME_LIBRARIES_ENABLED: {
            whenService:  'cinesync',
            fromConfig:   'cinesyncSettings.animeSeparation',
            defaultValue: 'false',
          },
          CINESYNC_4K_LIBRARIES_ENABLED: {
            whenService:  'cinesync',
            fromConfig:   'cinesyncSettings.fourKSeparation',
            defaultValue: 'false',
          },
        },
      },
    },
  },

  // -------------------------------------------------------------------
  // Emby.
  //
  // Same general shape as Jellyfin (Emby is the closed-source
  // progenitor; Jellyfin forked from Emby 3.5). API endpoints differ
  // slightly — Emby uses /emby/<endpoint> URL prefix and the
  // X-Emby-Token header where Jellyfin uses bare paths and
  // X-Emby-Authorization with MediaBrowser Token. The fetchScript
  // mirrors fetch-jellyfin-secrets.py with these adjustments — it's
  // a TODO stub below.
  // -------------------------------------------------------------------
  emby: {
    name: 'Emby',
    desc: 'Feature-rich media server with live TV support',
    logo: embyLogo,
    repo: 'https://github.com/MediaBrowser/Emby',
    compose: {
      image: 'emby/embyserver:latest',
      // Host networking for the same DLNA-discovery reason as Jellyfin.
      // Also avoids port-collision between concurrent Emby + Jellyfin
      // by virtue of mediaServerMeta only deploying one (Surge picks
      // the entry whose key matches config.mediaServer).
      networkMode: 'host',
      // Emby's web UI is on 8096 (HTTP) — same as Jellyfin since
      // Jellyfin inherited the port. Informational under host net.
      ports: ['8096:8096'],
      // /emby/System/Ping returns "Emby Server" on 200 (no auth).
      healthcheck: {
        test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:8096/emby/System/Ping || exit 1'],
        interval:    '30s',
        timeout:     '10s',
        retries:     5,
        start_period: '120s',
      },
      secrets: {
        // Admin password — same pattern as Jellyfin's. Surge generates
        // per install, the fetchScript uses it to complete first-run
        // setup and authenticate for API key creation.
        adminPassword: { generate: 'random', length: 32 },
      },
      env: {
        // External URL for clients to reach this server. Same
        // dot-notation fromConfig pattern as Jellyfin's published URL.
        EMBY_PublishedServerUrl: {
          fromConfig: 'embySettings.EMBY_PublishedServerUrl',
          defaultValue: '',
        },
        // Emby image accepts UID/GID env vars (not PUID/PGID like
        // LSIO). Like Plex's PLEX_UID/PLEX_GID — pin to match
        // SURGE_ENV_DEFAULTS so the file ownership lines up.
        UID: '99',
        GID: '100',
      },
      mounts: [
        { src: 'configRoot/<service>',           dst: '/config' },
        { src: 'mediaRoot/media',                dst: '/media' },
        // Emby's transcode dir is /transcoding-temp by default. On
        // the cache pool — same reasoning as Plex/Jellyfin.
        { src: 'mediaRoot/<service>/transcoding-temp', dst: '/transcoding-temp' },
      ],
      fetchScript: {
        // TODO: implement scripts/fetch-emby-secrets.py
        // Same shape as fetch-jellyfin-secrets.py — the workflow is
        // identical (poll for reachable, complete setup wizard via
        // /Startup/* endpoints, authenticate via
        // /Users/AuthenticateByName, create or fetch API key via
        // /Auth/Keys). Endpoints are prefixed /emby/ for Emby and
        // the auth header is X-Emby-Token (not MediaBrowser Token).
        // Output: {"apiKey": "...", "userId": "..."}
        path: 'scripts/fetch-emby-secrets.py',
        env: {
          EMBY_PASSWORD: { fromSecret: 'adminPassword' },
        },
      },
    },
  },
};

// Convenience export for the wizard's existing `coreServers` shape —
// just a flattened array of { key, name, logo, desc } pulled from the
// registry. Lets App.js drop its inline coreServers and stay in sync
// with this single source of truth.
export const mediaServerOptions = Object.entries(mediaServerMeta).map(
  ([key, meta]) => ({
    key,
    name: meta.name,
    logo: meta.logo,
    desc: meta.desc,
  })
);
