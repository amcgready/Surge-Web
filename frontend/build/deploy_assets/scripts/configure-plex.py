#!/usr/bin/env python3
"""
configure-plex.py — Surge post-deploy automation for Plex.

Runs after Plex's fetchScript captures the X-Plex-Token. The script:

  1. Polls /identity (with X-Plex-Token) until Plex is ready.
  2. Lists existing libraries via GET /library/sections.
  3. For each of Surge's standard libraries (Movies, TV Shows) that
     doesn't already exist:
        POST /library/sections?name=...&type=...&agent=...&scanner=...&location=...
     to create it. Idempotent — re-runs are no-ops.
  4. When CINESYNC_ENABLED=1, ALSO creates two CineSync-side
     libraries pointing at CineSync's organized output tree. These
     have a "(CineSync)" suffix so they don't collide with the
     *arr-managed libraries above — Plex shows both, the user can
     keep whichever set fits their workflow.

*arr-managed library layout (always created):
  Movies    → /data/movies     (tv.plex.agents.movie / Plex Movie)
  TV Shows  → /data/tv         (tv.plex.agents.series / Plex TV Series)

CineSync-managed library layout (created when CINESYNC_ENABLED=1).
Paths match CineSync's always-populated subfolders. If the user
customized CINESYNC_OUTPUT_PATH or CUSTOM_*_FOLDER vars on the
CineSync side, they'll need to either match those overrides via env
vars here or add the libraries manually in Plex's UI:
  Movies (CineSync)    → <CINESYNC_OUTPUT_PATH>/Movies
  TV Shows (CineSync)  → <CINESYNC_OUTPUT_PATH>/Shows

Anime + 4K libraries are deliberately not auto-created on either
side. The four categories that would be candidates (Anime Movies,
Anime Series, 4K Movies, 4K Shows) all live in folders that only
exist when explicitly opted-in:
  - *arr side: /data/anime/* requires Sonarr/Radarr root-folder
    setup that Surge doesn't auto-perform.
  - CineSync side: AnimeMovies/AnimeShows/4KMovies/4KShows are gated
    by ANIME_SEPARATION and 4K_SEPARATION in CineSync's .env, both
    pinned to false in Surge's seeded config (configRoot/cinesync/
    .env). Users who flip those toggles can add the matching Plex
    libraries manually via "Add Library" in two clicks.
Auto-creating those libraries would just leave them permanently
empty for the majority of users.

Plex API quick reference:
  Auth:     X-Plex-Token header (or ?X-Plex-Token= query string).
  Format:   Returns XML by default; pass Accept: application/json for JSON.
  Library:  POST /library/sections accepts query string parameters,
            not JSON body. Response includes the new section's id.

Environment:
  PLEX_URL              Plex base URL (default: http://localhost:32400).
  PLEX_TOKEN            X-Plex-Token from fetchScript output. Required.
  MEDIA_BASE            In-container path that maps to the media library
                        root. Default: /data (matches plexinc/pms-docker).
  CINESYNC_ENABLED      "1"/"true": also create CineSync-side libraries.
                        Schema-side this is gated via
                        whenService:'cinesync' so the var is only present
                        when CineSync is actually part of the deploy.
  CINESYNC_OUTPUT_PATH  In-container path of CineSync's organized output
                        tree. Default: /data/output/CineSync — matches
                        the DESTINATION_DIR=/media/output/CineSync that
                        Surge seeds on the CineSync side, translated
                        through plexinc's /data mount (== mediaRoot/media).
  WAIT_TIMEOUT_SEC      Max seconds to wait for Plex (default: 120).
  DRY_RUN               "1"/"true": log only.

Exit codes:
  0  Success — all libraries present.
  2  Plex unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned non-success.
  6  Required env var missing.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


DEFAULT_PLEX_URL = "http://localhost:32400"
DEFAULT_MEDIA_BASE = "/data"
DEFAULT_CINESYNC_OUTPUT_PATH = "/data/output/CineSync"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

# Servarr-managed libraries — always created. Each entry:
#   (display name, type, agent, scanner, full container-side path)
# Paths are built from MEDIA_BASE + relative path at main()-time so
# the user can override MEDIA_BASE without retemplating this list.
#
# Only the two "always-populated" library types are auto-created:
# Movies and TV Shows. Anime + 4K libraries are deliberately absent —
# Sonarr/Radarr don't auto-create /data/anime/* or 4K-separated root
# folders without explicit user setup, so libraries pointing there
# would just sit empty in Plex's UI on most deploys. Users who
# configure anime or 4K root folders in Sonarr/Radarr can add the
# matching Plex libraries via "Add Library" in two clicks.
SERVARR_LIBRARIES = [
    ("Movies",   "movie", "tv.plex.agents.movie",  "Plex Movie",     "movies"),
    ("TV Shows", "show",  "tv.plex.agents.series", "Plex TV Series", "tv"),
]

# CineSync-managed libraries — created only when CINESYNC_ENABLED=1.
# Three groups, each gated by a separate env var so the wizard's
# toggles drive both CineSync's .env and Plex's library list:
#
#   CINESYNC_LIBRARIES         — always (when CineSync is enabled)
#   CINESYNC_ANIME_LIBRARIES   — when CINESYNC_ANIME_LIBRARIES_ENABLED is truthy
#   CINESYNC_4K_LIBRARIES      — when CINESYNC_4K_LIBRARIES_ENABLED is truthy
#
# Subfolder names match CineSync's defaults from the upstream config.
# Custom CINESYNC_OUTPUT_PATH or CUSTOM_*_FOLDER overrides on
# CineSync's side need to be matched by env vars here, otherwise
# users can fix up via Plex's UI manually.
CINESYNC_LIBRARIES = [
    ("Movies (CineSync)",   "movie", "tv.plex.agents.movie",  "Plex Movie",     "Movies"),
    ("TV Shows (CineSync)", "show",  "tv.plex.agents.series", "Plex TV Series", "Shows"),
]

CINESYNC_ANIME_LIBRARIES = [
    ("Anime Movies (CineSync)", "movie", "tv.plex.agents.movie",  "Plex Movie",     "AnimeMovies"),
    ("Anime Series (CineSync)", "show",  "tv.plex.agents.series", "Plex TV Series", "AnimeShows"),
]

CINESYNC_4K_LIBRARIES = [
    ("4K Movies (CineSync)", "movie", "tv.plex.agents.movie",  "Plex Movie",     "4KMovies"),
    ("4K Shows (CineSync)",  "show",  "tv.plex.agents.series", "Plex TV Series", "4KShows"),
]

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-plex")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return v or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------

def plex_request(
    method: str,
    base_url: str,
    path: str,
    *,
    token: str,
    params: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """All Plex API calls go through here. Always sends X-Plex-Token
    as a header AND requests JSON via Accept."""
    qs = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{base_url.rstrip('/')}{path}"
    if qs:
        url += ("&" if "?" in url else "?") + qs

    req = urllib.request.Request(
        url,
        method=method,
        headers={
            "X-Plex-Token": token,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Plex API operations
# ---------------------------------------------------------------------

def wait_for_plex(base_url: str, token: str, timeout_sec: int) -> None:
    """Poll /identity until Plex is responding to authenticated calls."""
    deadline = time.monotonic() + timeout_sec
    last_err: Optional[str] = None

    log.info("Waiting for Plex at %s (timeout: %ds)", base_url, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = plex_request("GET", base_url, "/identity", token=token)
            if status == 200:
                log.info("Plex reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Plex did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def list_existing_library_names(base_url: str, token: str) -> set[str]:
    """Return the set of library names already configured in Plex."""
    status, body = plex_request("GET", base_url, "/library/sections", token=token)
    if status != 200:
        log.error("GET /library/sections failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        log.error("/library/sections response was not JSON: %r", body[:300])
        sys.exit(3)

    # Plex's JSON response wraps things in MediaContainer.Directory.
    container = parsed.get("MediaContainer", {})
    directories = container.get("Directory", []) or []
    return {d.get("title", "") for d in directories if d.get("title")}


def create_library(
    base_url: str,
    token: str,
    *,
    name: str,
    library_type: str,
    agent: str,
    scanner: str,
    location: str,
    dry_run: bool = False,
) -> None:
    """POST /library/sections to create a single library."""
    params = {
        "name": name,
        "type": library_type,
        "agent": agent,
        "scanner": scanner,
        "language": "en-US",
        "location": location,
    }

    if dry_run:
        log.info(
            "[DRY RUN] Would create library '%s' (type=%s agent=%s location=%s)",
            name, library_type, agent, location,
        )
        return

    log.info("Creating library '%s' at %s", name, location)
    status, body = plex_request(
        "POST", base_url, "/library/sections",
        token=token, params=params,
    )
    if status not in (200, 201):
        log.error(
            "POST /library/sections for '%s' failed: HTTP %d body=%s",
            name, status, body[:300].decode("utf-8", errors="replace"),
        )
        sys.exit(3)
    log.info("Library '%s' created", name)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    base_url             = env("PLEX_URL", DEFAULT_PLEX_URL)
    token                = env("PLEX_TOKEN", required=True)
    media_base           = env("MEDIA_BASE", DEFAULT_MEDIA_BASE).rstrip("/")
    cinesync_enabled     = is_truthy(env("CINESYNC_ENABLED", "0"))
    cinesync_output_path = env("CINESYNC_OUTPUT_PATH", DEFAULT_CINESYNC_OUTPUT_PATH).rstrip("/")
    cinesync_anime       = is_truthy(env("CINESYNC_ANIME_LIBRARIES_ENABLED", "0"))
    cinesync_4k          = is_truthy(env("CINESYNC_4K_LIBRARIES_ENABLED", "0"))
    timeout_sec          = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run              = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    # Build the full plan of (name, type, agent, scanner, location)
    # tuples — *arr libraries unconditionally, CineSync libraries
    # gated by feature flags so each toggle in the wizard's "CineSync
    # settings" panel only adds the libraries matching the folders
    # CineSync will actually create.
    plan = [
        (name, lib_type, agent, scanner, f"{media_base}/{rel}")
        for name, lib_type, agent, scanner, rel in SERVARR_LIBRARIES
    ]
    if cinesync_enabled:
        plan += [
            (name, lib_type, agent, scanner, f"{cinesync_output_path}/{sub}")
            for name, lib_type, agent, scanner, sub in CINESYNC_LIBRARIES
        ]
        cinesync_lib_count = len(CINESYNC_LIBRARIES)
        if cinesync_anime:
            plan += [
                (name, lib_type, agent, scanner, f"{cinesync_output_path}/{sub}")
                for name, lib_type, agent, scanner, sub in CINESYNC_ANIME_LIBRARIES
            ]
            cinesync_lib_count += len(CINESYNC_ANIME_LIBRARIES)
        if cinesync_4k:
            plan += [
                (name, lib_type, agent, scanner, f"{cinesync_output_path}/{sub}")
                for name, lib_type, agent, scanner, sub in CINESYNC_4K_LIBRARIES
            ]
            cinesync_lib_count += len(CINESYNC_4K_LIBRARIES)
        log.info(
            "CineSync enabled — adding %d CineSync libraries under %s "
            "(anime=%s 4k=%s)",
            cinesync_lib_count, cinesync_output_path, cinesync_anime, cinesync_4k,
        )
    else:
        log.info("CineSync not enabled — only *arr-managed libraries will be created")

    log.info(
        "Plan: plex=%s media_base=%s libraries=%s",
        base_url, media_base, [name for name, *_ in plan],
    )

    if dry_run:
        log.info("[DRY RUN] Would poll %s/identity for readiness", base_url)
        existing: set[str] = set()
    else:
        wait_for_plex(base_url, token, timeout_sec)
        existing = list_existing_library_names(base_url, token)
        log.info("Existing libraries: %s", sorted(existing) or "(none)")

    for name, library_type, agent, scanner, location in plan:
        if name in existing:
            log.info("Library '%s' already exists — skipping", name)
            continue
        create_library(
            base_url, token,
            name=name,
            library_type=library_type,
            agent=agent,
            scanner=scanner,
            location=location,
            dry_run=dry_run,
        )

    log.info("configure-plex.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
