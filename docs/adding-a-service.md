# Adding a Service to Surge

This guide walks you through adding a new service end-to-end. You'll edit one file (`frontend/src/AdditionalServicesStep.js`), add a logo asset, and optionally write post-deploy automation scripts.

## The Big Picture

Surge's deploy wizard is schema-driven. The `serviceMeta` export in `AdditionalServicesStep.js` drives everything:

- **Wizard tile**: The service's name, description, logo, category, and upstream repo URL appear as a clickable card on the Service Selection step.
- **Compose generation**: The `compose` field becomes a Docker Compose template. The orchestrator resolves env-var markers (secrets, cross-service references, conditionals) and renders the final `docker-compose.yml`.
- **Secret pipeline**: Three patterns handle API keys and credentials:
  1. **Upfront secret**: You generate a random value and bake it into the service's config file before container start (e.g., Sonarr's `apiKey` → `config.xml`).
  2. **fetchScript**: After the container starts, a Python script polls the service's API or filesystem, extracts a runtime-generated value, and stores it for other services to consume (e.g., Plex's `X-Plex-Token`).
  3. **postDeployScript**: After the container is healthy, a Python script configures the service via its REST API — registering connections, creating users, etc. (e.g., Bazarr's post-deploy wiring of Sonarr/Radarr).
- **File templates**: Surge can seed config files with templated content before the container starts (e.g., Zurg's `config.yml` with the user's Real-Debrid token).

## Schema Reference

### Top-Level Entry

```javascript
serviceMeta: {
  myservice: {
    name: 'MyService',                          // Display name on tile
    desc: 'One-line description',               // Tile subtitle
    logo: myserviceLogo,                        // PNG/SVG import or null
    category: 'media',                          // 'media'|'indexers'|'downloads'|'debrid'|'requests'|'metadata'|'monitoring'
    repo: 'https://github.com/user/repo',       // Upstream canonical URL
    compose: { /* template below */ },
  }
}
```

**Logo workflow**: Import your PNG/SVG at the top of the file:
```javascript
import myserviceLogo from './assets/service-logos/myservice.png';
```
Drop the file in `frontend/src/assets/service-logos/`. Prefer square PNGs (128x128+). If none is available yet, set `logo: null` — a placeholder circle with the first letter renders instead.

### Compose Template

The `compose` object is where the magic happens. All fields are optional unless noted.

#### Container Definition

```javascript
compose: {
  image: 'linuxserver/myservice:latest',        // Docker image (required)
  
  // Override Surge's defaults (host networking, unless-stopped restart)
  networkMode: 'bridge',                        // 'host' | 'bridge'
  
  ports: ['8000:8000', '9000:9000'],           // Expose container ports
  
  healthcheck: {
    test:        ['CMD-SHELL', 'wget --spider -q -T 5 http://localhost:8000/health || exit 1'],
    interval:    '30s',
    timeout:     '10s',
    retries:     5,
    start_period: '60s',                        // Grace period before checking
  },
  
  env: {
    // Env-var markers — see "Marker Schema" below
  },
  
  mounts: [
    { src: 'configRoot/<service>',    dst: '/config' },     // Config persistence
    { src: 'mediaRoot/media',         dst: '/media' },      // Shared library
    { src: 'mediaRoot/media/Intake',  dst: '/media/Intake', options: 'rshared' },
  ],
  
  // Per-container Linux capabilities / device access (zilean/zurg only)
  capAdd:      ['SYS_ADMIN'],
  securityOpt: ['apparmor:unconfined'],
  devices:     ['/dev/fuse:/dev/fuse:rwm'],
  
  // Override the image's default CMD (for headless tools like rclone mount)
  command: 'mount zurg: /data --allow-other',
}
```

**Mount tokens**:
- `configRoot/<service>` → `/mnt/user/appdata/<service>` (Unraid) or Docker root (Docker). Persistent config per service.
- `mediaRoot/media` → `/mnt/cache/media` (Unraid + cache) or `/opt/surge/media` (Docker). Shared library across all services.
- `userSharesRoot` → `/mnt/user` (Unraid, merged FUSE view; immaterial on Docker).
- `<service>` → The service key in lowercase (e.g., `zurg` → `zurg`).

#### Secrets (Upfront API Keys)

When a service generates a credential at first run (but you need it before then), upfront-seed it in a config file.

```javascript
secrets: {
  apiKey: { generate: 'random', length: 32 },
},

files: {
  configXml: {
    hostPath: 'configRoot/<service>/config.xml',
    content:
      '<Config>\n' +
      '  <ApiKey>${apiKey}</ApiKey>\n' +  // Substituted from secrets above
      '</Config>\n',
  },
},

env: {
  // Reference your own secret — no cross-service fetch needed
  MY_API_KEY: { fromSecret: 'apiKey' },
},
```

The orchestrator writes the file before `docker compose up`, so the container sees the seeded value on startup and doesn't auto-generate. **Example**: Sonarr, Radarr, Tautulli.

#### Environment Variables

All env-var values support markers:

**Literal values**:
```javascript
LOG_LEVEL: 'info',
```

**Generate random at install time, persist across redeploys**:
```javascript
JWT_SECRET: { generate: 'random', length: 64 },
```

**From user config (External APIs step, Storage Config step, etc.)**:
```javascript
TMDB_API_KEY: { fromConfig: 'tmdbApiKey', defaultValue: '' },
JELLYFIN_URL: { fromConfig: 'jellyfinSettings.JELLYFIN_PublishedServerUrl', defaultValue: '' },
```
Nested keys use dot notation.

**From this service's upfront secret**:
```javascript
SONARR_API_KEY: { fromSecret: 'apiKey' },
```

**From another service's upfront secret**:
```javascript
SONARR_API_KEY: {
  fromServiceSecret: 'sonarr',        // The service key
  secret:            'apiKey',        // The secret name in that service's secrets
},
```

**From another service's runtime-fetched value** (after that service's `fetchScript` runs):
```javascript
PLEX_TOKEN: {
  fromService: 'plex',               // The service key
  field:       'plexToken',          // The field name from plex's fetchScript output
},
```

**Conditional: only emit if a peer service is enabled**:
```javascript
SONARR_API_KEY: {
  whenService:       'sonarr',        // Only if sonarr is in contentEnhancement
  fromServiceSecret: 'sonarr',
  secret:            'apiKey',
},
```

**Conditional: only emit for a specific media server**:
```javascript
PLEX_TOKEN: {
  whenMediaServer: 'plex',            // Only if user picked Plex
  fromService:     'plex',
  field:           'plexToken',
},
```

Wrap any marker shape inside `whenService` or `whenMediaServer` — the condition gates emission.

#### Multi-Container Services

For services that ship multiple containers (e.g., Zurg + rclone, NzbDAV + HTTP server):

```javascript
compose: {
  services: {
    zurg: {
      image: 'ghcr.io/debridmediamanager/zurg:latest',
      networkMode: 'bridge',
      ports: ['9999:9999'],
      mounts: [
        { src: 'configRoot/<service>/config.yml', dst: '/app/config.yml' },
        { src: 'mediaRoot/media',                 dst: '/media' },
      ],
    },
    rclone: {
      image: 'rclone/rclone:latest',
      networkMode: 'bridge',
      capAdd:  ['SYS_ADMIN'],
      command: 'mount zurg: /data --allow-other',
      mounts: [
        { src: 'mediaRoot/media/Intake/zurg', dst: '/data', options: 'rshared' },
        { src: 'configRoot/<service>/rclone.conf', dst: '/config/rclone/rclone.conf' },
      ],
      // Plain dependency: rclone waits for zurg's container to be up
      dependsOn: { zurg: {} },
      // OR: health-gated dependency
      // dependsOn: { zurg: { condition: 'service_healthy' } },
    },
  },
  
  // Top-level env/secrets/files still apply; merged into all sub-containers
  env: { /* ... */ },
  secrets: { /* ... */ },
  files: { /* ... */ },
}
```

Sub-container names become `<serviceKey>-<subKey>` in the final compose.yml, except when `subKey === serviceKey` (the primary container keeps its user-facing name).

#### File Templates

Pre-seed config files before `docker compose up`:

```javascript
files: {
  configJson: {
    hostPath: 'configRoot/<service>/config.json',
    content:
      '{\n' +
      '  "api_key": "${apiKey}",\n' +      // Substituted from secrets or user config
      '  "mode": "auto"\n' +
      '}\n',
    mode: 0o755,                             // Optional: octal file mode
  },
  
  // Fetch from upstream, with fallback to inline snapshot
  fetchScript: {
    hostPath: 'configRoot/<service>/script.sh',
    content: {
      fromUpstream: 'https://raw.githubusercontent.com/user/repo/main/script.sh',
      fallback: '#!/bin/bash\necho "fallback"\n',
    },
    mode: 0o755,
  },
}
```

Template substitution uses `${name}` syntax, resolving from:
1. Same-service secrets (e.g., `${apiKey}` → `compose.secrets.apiKey`).
2. User config (e.g., `${rdApiToken}` → config's `rdApiToken`).

### The Secret Pipelines

#### Pattern 1: Upfront Secret (Sonarr, Radarr, Bazarr, etc.)

You generate the key upfront and bake it into a config file:

```javascript
secrets: {
  apiKey: { generate: 'random', length: 32 },
},
files: {
  configXml: {
    hostPath: 'configRoot/<service>/config.xml',
    content: '<Config>\n<ApiKey>${apiKey}</ApiKey>\n</Config>\n',
  },
},
env: {
  MY_API_KEY: { fromSecret: 'apiKey' },
},
```

**When to use**: The service reads config files at startup and doesn't auto-generate if it finds a value.

#### Pattern 2: fetchScript (Plex, Jellyfin, Tautulli)

After the container starts, poll for a runtime-generated value, extract it, and persist it:

```javascript
fetchScript: {
  path: 'scripts/fetch-plex-secrets.py',
  env: {
    PLEX_URL:      'http://localhost:32400',
    PLEX_PASSWORD: { fromSecret: 'adminPassword' },
  },
},
```

The script outputs JSON to stdout:
```json
{"plexToken": "<X-Plex-Token>"}
```

The orchestrator captures this and makes it available to consumers via `fromService`:
```javascript
PLEX_TOKEN: {
  fromService: 'plex',
  field:       'plexToken',
},
```

Any consumer of this runtime value is deferred until the `fetchScript` succeeds (deploy-ordering graph).

**When to use**: The service auto-generates credentials at first launch and you can't seed them upfront.

#### Pattern 3: postDeployScript (Bazarr, Seerr, Episeerr, etc.)

After the container is healthy, run a script that configures the service via its REST API:

```javascript
postDeployScript: {
  path: 'scripts/configure-bazarr.py',
  env: {
    BAZARR_API_KEY: { fromSecret: 'apiKey' },
    SONARR_API_KEY: {
      whenService:       'sonarr',
      fromServiceSecret: 'sonarr',
      secret:            'apiKey',
    },
    PLEX_TOKEN: {
      whenMediaServer: 'plex',
      fromService:     'plex',
      field:           'plexToken',
    },
  },
  blocks: [],  // Sub-container keys that should NOT start until this script succeeds
},
```

The script receives env vars and makes API calls:
```python
# scripts/configure-bazarr.py
import os, requests, json

bazarr_url = 'http://localhost:6767'
bazarr_api_key = os.environ.get('BAZARR_API_KEY')
sonarr_api_key = os.environ.get('SONARR_API_KEY')

if sonarr_api_key:
    resp = requests.post(
        f'{bazarr_url}/api/system/settings',
        json={'sonarr': {'apikey': sonarr_api_key, ...}},
        headers={'X-Api-Key': bazarr_api_key},
    )
    ...
```

**When to use**: You need to register connections, create users, or apply settings dynamically after the service is running.

---

## Worked Example: Fooarr

Imagine adding a fictional subtitle service called "Fooarr". It:
- Listens on port 7777
- Reads an upfront API key from `/config/fooarr.ini`
- Needs Sonarr + Radarr connections configured via a post-deploy script
- Has no logo yet

### 1. Add the serviceMeta entry

In `frontend/src/AdditionalServicesStep.js`, inside `export const serviceMeta = { ... }`:

```javascript
fooarr: {
  name: 'Fooarr',
  desc: 'Fictional subtitle magic',
  logo: null,                         // Will use placeholder until we add fooarr.png
  category: 'media',
  repo: 'https://github.com/user/fooarr',
  compose: {
    image: 'ghcr.io/user/fooarr:latest',
    ports: ['7777:7777'],
    healthcheck: {
      test:        ['CMD-SHELL', 'wget --spider -q -T 5 -t 1 http://localhost:7777/health || exit 1'],
      interval:    '30s',
      timeout:     '10s',
      retries:     5,
      start_period: '60s',
    },
    
    // Upfront API key
    secrets: {
      apiKey: { generate: 'random', length: 32 },
    },
    
    // Seed the config file before container start
    files: {
      configIni: {
        hostPath: 'configRoot/<service>/fooarr.ini',
        content:
          '[general]\n' +
          'api_key = ${apiKey}\n' +
          'port = 7777\n',
      },
    },
    
    // Mounts
    mounts: [
      { src: 'mediaRoot/media',      dst: '/media' },
      { src: 'configRoot/<service>', dst: '/config' },
    ],
    
    // Post-deploy configuration via API
    postDeployScript: {
      path: 'scripts/configure-fooarr.py',
      blocks: [],
      env: {
        FOOARR_API_KEY: { fromSecret: 'apiKey' },
        
        // Cross-service references, gated on each service being enabled
        SONARR_URL: { whenService: 'sonarr', value: 'http://localhost:8989' },
        SONARR_API_KEY: {
          whenService:       'sonarr',
          fromServiceSecret: 'sonarr',
          secret:            'apiKey',
        },
        RADARR_URL: { whenService: 'radarr', value: 'http://localhost:7878' },
        RADARR_API_KEY: {
          whenService:       'radarr',
          fromServiceSecret: 'radarr',
          secret:            'apiKey',
        },
      },
    },
  },
},
```

### 2. Add to the allServices list

Near the end of `AdditionalServicesStep.js`:

```javascript
export const allServices = [
  'bazarr',
  // ... other services in alphabetical order ...
  'fooarr',
  // ... rest ...
];
```

And optionally set a default (defaults are in `defaultSelected`):

```javascript
const defaultSelected = {
  // ...
  fooarr: true,  // or false to require manual opt-in
  // ...
};
```

### 3. Create the post-deploy script

Write `orchestrator/scripts/configure-fooarr.py`:

```python
#!/usr/bin/env python3
"""
Configure Fooarr post-deploy.

Registers Sonarr and Radarr connections via Fooarr's REST API.
Idempotent — re-runs refresh the same record.
"""

import os
import requests
import sys
import time

def wait_for_fooarr(url, api_key, timeout=60):
    """Poll /health until Fooarr is up."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(f'{url}/health', headers={'X-Api-Key': api_key}, timeout=5)
            if resp.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(1)
    return False

def main():
    fooarr_url = 'http://localhost:7777'
    fooarr_api_key = os.environ.get('FOOARR_API_KEY')
    sonarr_url = os.environ.get('SONARR_URL')
    sonarr_api_key = os.environ.get('SONARR_API_KEY')
    radarr_url = os.environ.get('RADARR_URL')
    radarr_api_key = os.environ.get('RADARR_API_KEY')
    
    if not wait_for_fooarr(fooarr_url, fooarr_api_key):
        print('ERROR: Fooarr did not come up in time', file=sys.stderr)
        return 1
    
    # Register Sonarr if enabled
    if sonarr_url and sonarr_api_key:
        print(f'Registering Sonarr at {sonarr_url}')
        resp = requests.post(
            f'{fooarr_url}/api/connections/sonarr',
            json={'url': sonarr_url, 'api_key': sonarr_api_key},
            headers={'X-Api-Key': fooarr_api_key},
        )
        if resp.status_code not in (200, 201, 409):  # 409 = already exists
            print(f'ERROR: Failed to register Sonarr: {resp.text}', file=sys.stderr)
            return 1
    
    # Register Radarr if enabled
    if radarr_url and radarr_api_key:
        print(f'Registering Radarr at {radarr_url}')
        resp = requests.post(
            f'{fooarr_url}/api/connections/radarr',
            json={'url': radarr_url, 'api_key': radarr_api_key},
            headers={'X-Api-Key': fooarr_api_key},
        )
        if resp.status_code not in (200, 201, 409):
            print(f'ERROR: Failed to register Radarr: {resp.text}', file=sys.stderr)
            return 1
    
    print('Fooarr configuration complete')
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

### 4. Add a logo (optional)

Drop `fooarr.png` (128x128+, square) in `frontend/src/assets/service-logos/`.

At the top of `AdditionalServicesStep.js`, add:
```javascript
import fooarrLogo from './assets/service-logos/fooarr.png';
```

Then update the compose entry:
```javascript
logo: fooarrLogo,
```

### 5. Validate

- The wizard should render a "Fooarr" tile on the Service Selection step.
- Toggling it on should add it to the deploy preview.
- Enabling Sonarr/Radarr should show no dependency warnings.
- The bundle's generated `manifest.json` should include Fooarr's full schema.
- The orchestrator should materialize the upfront secret, seed `fooarr.ini`, bring the container up, and run `configure-fooarr.py`.

---

## Healthcheck Definition

Every service should declare a healthcheck in its compose template. The orchestrator uses this to determine when a container is ready before proceeding to post-deploy scripts.

```javascript
healthcheck: {
  test:        ['CMD-SHELL', '<command-that-exits-0-on-healthy>'],
  interval:    '30s',     // How often to check
  timeout:     '10s',     // How long to wait for the check
  retries:     5,         // Failures before unhealthy
  start_period: '60s',    // Grace period before first check
},
```

Common patterns:
- HTTP `wget --spider`: `wget --spider -q -T 5 http://localhost:8989/ping || exit 1`
- Listening port: `nc -z localhost 8000 || exit 1`
- File existence: `[ -f /config/init.done ] || exit 1`

---

## Dependency Warnings

The wizard automatically checks:
- **Missing peer services**: If your service uses `whenService: 'sonarr'` but Sonarr isn't enabled, a yellow badge appears.
- **Missing media server**: If your service needs Plex (`whenMediaServer: 'plex'`) but the user picked Jellyfin, the badge appears.
- **Missing External APIs**: If your service references `fromConfig: 'tmdbApiKey'` and the user left it blank, the badge appears.

These warnings are computed from the schema itself — no extra declaration needed. The badge text is automatically generated from the gated markers in your `compose.env`, `postDeployScript.env`, and `files` template refs.

---

## Testing Your Service

1. **Frontend**: Run `npm start` in `frontend/`, enable your service, verify the tile renders and dependency warnings work.
2. **Compose preview**: Check that the Deploy step's compose preview looks correct (no unresolved `${...}` markers).
3. **Dry-run**: Generate a bundle, extract it, run `surge_orchestrator.py --dry-run`, and inspect the generated `compose.yml` + seeded config files.
4. **Full deploy**: Run the orchestrator end-to-end and verify the container comes up healthy and post-deploy automation succeeds.

---

## Reference: Other Example Services

For more patterns, study these existing services:

- **Sonarr** (simple, upfront secret): TV manager with minimal post-deploy.
- **Bazarr** (upfront secret + post-deploy with cross-service refs): Subtitle manager that wires Sonarr/Radarr connections.
- **Plex** (fetch-script): Media server that auto-generates its token at first run.
- **Zurg** (multi-container, file templates): Debrid FUSE mount with rclone helper.

---

## Schema Fields You Might Not Need

- `capAdd`, `securityOpt`, `devices`: Only for privileged services (Zurg/rclone FUSE).
- `command`: Only to override the image's default CMD (rclone mount, zilean's sub-containers).
- `dependsOn`: Only for multi-container services with ordering constraints.
- `fetchScript`: Only if the service auto-generates credentials you can't seed upfront.
- `blocks`: Only if a post-deploy script generates values that a sibling sub-container needs.

For most services, you need only `image`, `ports`, `healthcheck`, `mounts`, `env`, and optionally `secrets`/`files`/`postDeployScript`.
