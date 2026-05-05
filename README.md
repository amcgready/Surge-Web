# Surge

A wizard for self-hosted media stacks. Pick your services in the
browser, get a single ZIP with everything you need to run them
(`docker-compose.yaml`, seeded config files, secrets, post-deploy
glue scripts, README), and run it on your target host.

No backend, no account, no telemetry. The wizard is a static React
app — your config never leaves the browser until *you* download the
bundle.

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Wizard (browser)       │         │  Your deploy host       │
│  • Pick services        │         │  • Unpack the ZIP       │
│  • Configure paths      │  ZIP    │  • Run the orchestrator │
│  • Provide API keys     │ ──────► │  • Orchestrator runs    │
│  • Generate bundle      │         │    docker compose up    │
│                         │         │  • Post-deploy scripts  │
│  Static React           │         │    auto-wire services   │
└─────────────────────────┘         └─────────────────────────┘
```


## What's in the bundle

Generating a bundle gives you a `surge-deploy.zip` containing:

- `docker-compose.yaml` — every service the wizard rendered, with
  resolved volumes, env vars, healthchecks, and dependencies
- `config.json` — your wizard answers (so re-running the orchestrator
  produces the same stack)
- `manifest.json` — the schema export for the services you picked
- `surge_orchestrator.py` — single-file, **stdlib-only** Python that
  runs the rest of the lifecycle on your host
- `scripts/` — the `fetch-*.py` and `configure-*.py` helpers that
  bootstrap inter-service wiring (API keys, library creation, indexer
  links)
- `seeded/` — pre-populated config files (e.g. `sonarr/config.xml`
  with Surge's chosen API key) so services come up authenticated
- `README.md` — bundle-specific instructions for the host operator


## Supported services

**Media servers** (mutually exclusive — pick one):

| Service     | Notes                                           |
|-------------|-------------------------------------------------|
| Plex        | Auto-claim from `plex.tv/claim`; auto-creates Plex libraries from CineSync output |
| Jellyfin    | Published-URL config; secrets fetched at runtime |
| Emby        | Published-URL config; secrets fetched at runtime |

**Media management** (the *arr suite):

| Service     | Notes                                           |
|-------------|-------------------------------------------------|
| Sonarr      | Pre-seeded API key; auto-wired to Bazarr / Episeerr / Prowlarr |
| Radarr      | Pre-seeded API key; same auto-wiring as Sonarr  |
| Bazarr      | Subtitle manager; configures Sonarr/Radarr instances post-deploy |
| Prowlarr    | Indexer manager; auto-registers downstream apps |
| CineSync    | Library structure + auto-creates Plex libraries |
| Pulsarr     | Plex/Overseerr integration                      |
| Boxarr      | Box-set tracking; auto-registers via Boxarr API |
| GAPS        | Missing-movies finder for Radarr                |
| Kometa      | Metadata + collections via seeded `config.yml`  |
| Posterizarr | Poster/artwork manager                          |
| mdblistarr  | MDBList → *arr list sync                        |
| Seasonarr   | Season-pack handler                             |

**Indexers / proxies:**

| Service       | Notes                                         |
|---------------|-----------------------------------------------|
| Flaresolverr  | Cloudflare bypass proxy                       |
| Zilean        | DMM scraper; multi-container with PostgreSQL  |

**Download clients / debrid:**

| Service     | Notes                                           |
|-------------|-------------------------------------------------|
| SABnzbd     | Pre-seeded API key                              |
| RDT-Client  | Real-Debrid client; consumes `rdApiToken`       |
| Decypharr   | Multi-debrid (RD/AD/Premiumize/TorBox)          |
| NZBDAV      | NZB → WebDAV mount; multi-container             |
| Zurg        | Real-Debrid mount; multi-container with rclone  |

**Requests + dashboards:**

| Service     | Notes                                           |
|-------------|-------------------------------------------------|
| Overseerr   | Request manager (`seerr` key in schema)         |
| Episeerr    | Episode-level requests; auto-wires Prowlarr + SABnzbd |
| Tautulli    | Plex monitoring; pre-seeded API key             |

**Networking add-ons:**

| Service     | Notes                                           |
|-------------|-------------------------------------------------|
| Pangolin (Newt) | Tunneled reverse proxy — public access without port-forwarding |
| Gluetun     | Per-container VPN (Mullvad / ProtonVPN / NordVPN / etc.) |


## Wizard features

**Step 1 — Media Server.** Plex / Jellyfin / Emby tile picker. Plex
flow includes a 4-minute claim-token countdown so you don't paste a
stale token.

**Step 2 — Storage Config.** Unraid (cache-pool aware) or generic
Docker. Lays out where each service's appdata lives, what mediaRoot
points to, PUID/PGID/UMASK. Path preview shows the resolved layout
before you commit.

**Step 3 — External APIs.** TMDB (with browser-side test button),
FanArt.tv, TVDB, MDBList, Real-Debrid, AllDebrid, Premiumize, Discord
webhooks. Each field shows which services consume it. Plus the
networking config: Pangolin endpoint + Newt credentials, Gluetun
provider with capability-driven WireGuard / OpenVPN field switching.

**Step 4 — Service Selection.** 23 service tiles plus the media
server, organized by category (Media, Indexers, Downloads, Debrid,
Requests, Metadata, Monitoring, Networking). Features:

- **Quick-start presets** (Plex + *arr starter, Jellyfin minimalist,
  Debrid power user, etc.)
- **User presets** — save the current selection as a named preset,
  load later
- **Live stats sidebar** — container count, port count, secret
  count, scripts to run
- **Service search** — filter tiles by name or description
- **Dependency warnings** — yellow `!` when a tile needs an API key
  or peer service that isn't set up
- **Per-tile VPN toggle** — when Gluetun is enabled, every routable
  service gets a 🛡 button that hoists its ports onto Gluetun and
  flips its `network_mode`
- **Service details modal** — click the `i` to see image, ports,
  upstream repo, healthcheck command

**Step 5 — Deploy Preview.** Read-only summary of everything the
orchestrator will do. Expandable accordions:

- **Generate bundle** — produces the ZIP
- **Re-deploy diff** — shows what's added/removed since the prior
  bundle (preserves secrets across re-runs)
- **Connection graph** — interactive Mermaid diagram of who reads
  whose secrets/runtime values; click a node to jump back to its
  tile
- **Healthcheck reference + live status** — every service's
  healthcheck command + endpoint; upload `status.json` from a
  deployed host for live state
- **Pangolin route preview** — copy-pasteable list of
  `subdomain → container:port` for Pangolin's UI
- **Image tags + pin suggestions** — checks Docker Hub for newer
  semver-style tags
- **Bundle inspector** — drag-and-drop a previous `surge-deploy.zip`
  to see its config or reload it into the wizard
- **Copy compose YAML** — full compose document to clipboard, no
  download needed

**Cross-cutting UX:**

- **Wizard state persists in localStorage** — close the tab, your
  config is still there
- **Reset wizard** in the header clears it
- **Restored-session toast** confirms when state was loaded back
- **First-run onboarding tour** explains each step
- **Keyboard shortcuts** — `?` for help overlay, `Ctrl/⌘+L` toggles
  light mode, etc.
- **Light / dark mode** — real palette swap, not a filter hack
- **Settings export/import** — JSON of UI prefs (color mode, saved
  presets, tour state). Wizard config and API keys are deliberately
  *not* exported here — those travel with the deploy bundle so
  secrets never end up in plaintext settings files
- **Accessibility** — every interactive surface has aria-labels,
  keyboard activation, focus-visible outlines


## Quick start

```bash
git clone https://github.com/your-repo/surge-web
cd surge-web/frontend
npm install
npm start
```

Open <http://localhost:3000>, walk through the wizard, hit **Generate
deploy bundle**. Copy the resulting `surge-deploy.zip` to your target
host and:

```bash
unzip surge-deploy.zip && cd surge-deploy
python3 surge_orchestrator.py --manifest manifest.json --config config.json
```

That's it. Orchestrator stops here on first run if you have any
fetchScripts that need post-deploy validation; just re-run it once
the relevant services are healthy.


## Orchestrator CLI

The orchestrator is **stdlib-only Python 3.8+** — no `pip install`
required on your deploy host. All the lifecycle commands:

```bash
# Standard deploy: render compose, write seeded files, generate
# secrets, docker compose up, run post-deploy scripts.
python3 surge_orchestrator.py \
  --manifest manifest.json \
  --config   config.json

# Dry-run: resolve everything, write nothing, run nothing.
python3 surge_orchestrator.py ... --dry-run

# Stop the stack and tar configRoot + state into a backup.
python3 surge_orchestrator.py ... --backup [path/to/backup.tar.gz]

# Restore from a backup tarball.
python3 surge_orchestrator.py ... --restore path/to/backup.tar.gz

# Snapshot live container health to .surge/status.json — upload into
# the wizard's healthcheck panel for live state.
python3 surge_orchestrator.py ... --status [path/to/status.json]

# Skip docker compose up (just write artifacts).
python3 surge_orchestrator.py ... --skip-up

# Skip post-deploy scripts.
python3 surge_orchestrator.py ... --skip-scripts
```

Default paths: backups land in `.surge/backups/`, state in
`.surge/state.json`, status in `.surge/status.json`.


## Re-deploys

Re-running the orchestrator with the same `state.json` preserves
every Surge-generated secret. To roll a service's secret, delete its
entry from `state.json` and re-run.

The wizard's **Re-deploy diff** view (Step 5) shows what changed
between successive bundles before you regenerate. Useful for sanity
checks before pushing a new bundle to production.


## Development

```bash
cd frontend

# Lint + format
npm run lint
npm run lint:fix
npm run format
npm run format:check

# Tests
npm test                         # watch mode
CI=true npm test --watchAll=false  # one-shot

# Production build
npm run build
```

```bash
cd orchestrator

# Tests (pytest)
python3 -m pytest tests/ -v
# Lint (ruff + black, configured in pyproject.toml)
ruff check . && black --check .
```

Test counts at time of writing: **307 frontend tests, 90
orchestrator tests, all passing**.


## Repo layout

```
frontend/                React wizard (Create React App + MUI)
  src/
    AdditionalServicesStep.js   Schema for all 23 services
    mediaServerMeta.js          Schema for Plex/Jellyfin/Emby
    composePreview.js           Read-only compose generator
    deployBundle.js             ZIP builder
    *.js                         Step components, panels, utilities
    __tests__/                  Jest + RTL test suite
orchestrator/
  surge_orchestrator.py         Single-file Python orchestrator
  tests/                        pytest suite
docs/
  adding-a-service.md           Guide for contributors adding a service
```


## Contributing

Adding a new service is mostly schema work — see
[docs/adding-a-service.md](docs/adding-a-service.md) for a walkthrough
covering the marker types (`fromSecret`, `fromService`, `fromConfig`,
`generate`, `whenService`, `whenMediaServer`), the three secret
pipelines (upfront, fetchScript, postDeployScript), and a worked
example.

Pull requests welcome. Run `npm run lint && npm test` and
`pytest tests/` before opening one.


## License

MIT — see [LICENSE](LICENSE).
