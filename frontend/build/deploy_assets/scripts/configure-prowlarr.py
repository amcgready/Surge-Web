#!/usr/bin/env python3
"""
configure-prowlarr.py — Surge post-deploy automation for Prowlarr.

Runs after Prowlarr's container is up and its API responds. The script:

  1. Polls /api/v1/system/status (with X-Api-Key) until Prowlarr is
     ready.
  2. Clones https://github.com/dreulavelle/Prowlarr-Indexers into the
     host path Prowlarr's `/config/Definitions/Custom` mount points at,
     so Prowlarr picks up the curated custom indexer YAMLs. If the
     repo is already cloned, runs `git pull` instead.
  3. For each enabled *arr service (sonarr, radarr — checked via
     presence of the SONARR_*/RADARR_* env vars), POSTs
     /api/v1/applications to register Prowlarr → that *arr.
  4. If zilean is enabled (ZILEAN_URL present), POSTs
     /api/v1/indexer to register Zilean as a Torznab indexer.

Idempotent — re-running won't duplicate applications or indexers; the
script checks current state before adding.

Authentication model (verified from Prowlarr's source — same Servarr
pattern as Sonarr/Radarr): every /api/v1/* request must carry the
X-Api-Key header matching the value in /config/config.xml. Surge
generates that key as the apiKey secret, writes it into config.xml
via compose.files at deploy time, and passes it to this script.

Environment (set by Surge's backend at invocation time):
  PROWLARR_URL        Prowlarr base URL (default: http://localhost:9696).
  PROWLARR_API_KEY    Value of prowlarr.compose.secrets.apiKey. Required.

  SONARR_URL          Optional. If present, register Sonarr.
                      Default: http://localhost:8989.
  SONARR_API_KEY      Value of sonarr.compose.secrets.apiKey.
                      Required when SONARR_URL is present.

  RADARR_URL          Optional. If present, register Radarr.
                      Default: http://localhost:7878.
  RADARR_API_KEY      Value of radarr.compose.secrets.apiKey.
                      Required when RADARR_URL is present.

  ZILEAN_URL          Optional. If present, register Zilean as a
                      Torznab indexer. Typically
                      http://localhost:8192 (zilean's bridge-mapped
                      host port).

  INDEXERS_REPO       Custom-indexers repo (default:
                      https://github.com/dreulavelle/Prowlarr-Indexers).
  INDEXERS_DEST       Host path to clone into. Required. Surge passes
                      the resolved configRoot/Prowlarr-Indexers value.
                      Prowlarr's /config/Definitions/Custom mount must
                      point at <INDEXERS_DEST>/Custom.

  WAIT_TIMEOUT_SEC    Max seconds to wait for Prowlarr (default: 120).
  DRY_RUN             If "1"/"true", log only — no mutations.

Exit codes:
  0  Success.
  2  Prowlarr unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned a non-success status.
  4  `git clone`/`git pull` failed.
  6  Required environment variable missing.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


# ---------------------------------------------------------------------
# Defaults and logging
# ---------------------------------------------------------------------

DEFAULT_PROWLARR_URL = "http://localhost:9696"
DEFAULT_SONARR_URL = "http://localhost:8989"
DEFAULT_RADARR_URL = "http://localhost:7878"
DEFAULT_INDEXERS_REPO = "https://github.com/dreulavelle/Prowlarr-Indexers"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-prowlarr")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return value or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# Generic HTTP helper
# ---------------------------------------------------------------------

def _request(
    method: str,
    url: str,
    *,
    api_key: str,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Make an HTTP request to a Servarr-family API."""
    headers = {
        "Accept": "application/json",
        "X-Api-Key": api_key,
    }
    body: Optional[bytes] = None
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Prowlarr API operations
# ---------------------------------------------------------------------

def wait_for_prowlarr(base_url: str, api_key: str, timeout_sec: int) -> None:
    """Poll /api/v1/system/status until Prowlarr is ready."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/v1/system/status"
    last_err: Optional[str] = None

    log.info("Waiting for Prowlarr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = _request("GET", probe, api_key=api_key)
            if status == 200:
                log.info("Prowlarr reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Prowlarr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def list_existing(base_url: str, api_key: str, path: str) -> list:
    """GET <base>/api/v1/<path>, return JSON list (empty list on non-200)."""
    url = f"{base_url.rstrip('/')}/api/v1/{path.lstrip('/')}"
    status, body = _request("GET", url, api_key=api_key)
    if status != 200:
        log.warning("GET %s returned HTTP %d — assuming empty list", url, status)
        return []
    try:
        parsed = json.loads(body)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


# ---- Applications (Sonarr/Radarr → Prowlarr connections) ----

def application_payload(
    name: str,
    impl: str,
    sync_level: str,
    prowlarr_url: str,
    arr_url: str,
    arr_api_key: str,
) -> dict:
    """
    Build the Prowlarr Application payload for Sonarr/Radarr.
    The schema mirrors what /api/v1/applications/schema returns for
    each implementation. Field shape verified against current Prowlarr
    1.x API.
    """
    return {
        "name": name,
        "implementation": impl,                 # "Sonarr" or "Radarr"
        "configContract": f"{impl}Settings",
        "syncLevel": sync_level,                # "fullSync" most common
        "tags": [],
        "fields": [
            {"name": "prowlarrUrl", "value": prowlarr_url},
            {"name": "baseUrl",     "value": arr_url},
            {"name": "apiKey",      "value": arr_api_key},
            {"name": "syncCategories", "value": [
                # Sensible defaults — covers most categories the arr
                # handles. Prowlarr filters incoming releases to these.
                2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060,  # Movies
                5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070, 5080,  # TV
            ]},
        ],
    }


def register_application(
    prowlarr_url: str,
    prowlarr_api_key: str,
    *,
    name: str,
    impl: str,
    arr_url: str,
    arr_api_key: str,
    dry_run: bool = False,
) -> None:
    """Add a Sonarr/Radarr Application to Prowlarr. Idempotent."""
    endpoint = f"{prowlarr_url.rstrip('/')}/api/v1/applications"

    if dry_run:
        log.info("[DRY RUN] Would POST %s adding %s (impl=%s url=%s)",
                 endpoint, name, impl, arr_url)
        return

    existing = list_existing(prowlarr_url, prowlarr_api_key, "applications")
    for app in existing:
        if app.get("name") == name:
            log.info("Application '%s' already registered (id=%s)", name, app.get("id"))
            return

    payload = application_payload(
        name=name,
        impl=impl,
        sync_level="fullSync",
        prowlarr_url=prowlarr_url,
        arr_url=arr_url,
        arr_api_key=arr_api_key,
    )

    log.info("Registering %s with Prowlarr (impl=%s url=%s)", name, impl, arr_url)
    status, body = _request("POST", endpoint, api_key=prowlarr_api_key, json_body=payload)
    if status not in (200, 201):
        log.error("POST applications failed: HTTP %d body=%s",
                  status, body[:500].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("Application '%s' registered", name)


# ---- Indexers (Zilean) ----

def zilean_indexer_payload(name: str, zilean_url: str) -> dict:
    """
    Build the Prowlarr Indexer payload for Zilean. Zilean exposes a
    Torznab endpoint at /torznab; we register it as a custom Torznab
    indexer.

    Zilean's API key is currently unauthenticated for its Torznab feed
    (it's behind the bridge network), so we leave the apiKey field
    empty. If Zilean ever requires auth, swap "" for the relevant
    secret.
    """
    return {
        "name": name,
        "implementation": "Torznab",
        "configContract": "TorznabSettings",
        "protocol": "torrent",
        "priority": 25,
        "tags": [],
        "fields": [
            {"name": "baseUrl", "value": f"{zilean_url.rstrip('/')}/torznab"},
            {"name": "apiPath", "value": "/api"},
            {"name": "apiKey",  "value": ""},
            # Categories: TV + Movies. Zilean serves the broad debrid
            # library so a wide net is appropriate.
            {"name": "categories", "value": [
                2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060,
                5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070, 5080,
            ]},
        ],
    }


def register_zilean(
    prowlarr_url: str,
    prowlarr_api_key: str,
    zilean_url: str,
    *,
    dry_run: bool = False,
) -> None:
    """Register Zilean as a Torznab indexer in Prowlarr. Idempotent."""
    name = "Zilean"
    endpoint = f"{prowlarr_url.rstrip('/')}/api/v1/indexer"

    if dry_run:
        log.info("[DRY RUN] Would POST %s adding Zilean indexer at %s",
                 endpoint, zilean_url)
        return

    existing = list_existing(prowlarr_url, prowlarr_api_key, "indexer")
    for idx in existing:
        if idx.get("name") == name:
            log.info("Indexer '%s' already registered (id=%s)", name, idx.get("id"))
            return

    payload = zilean_indexer_payload(name, zilean_url)

    log.info("Registering Zilean indexer at %s", zilean_url)
    status, body = _request("POST", endpoint, api_key=prowlarr_api_key, json_body=payload)
    if status not in (200, 201):
        log.error("POST indexer (Zilean) failed: HTTP %d body=%s",
                  status, body[:500].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("Zilean indexer registered")


# ---------------------------------------------------------------------
# dreulavelle/Prowlarr-Indexers clone
# ---------------------------------------------------------------------

def clone_or_pull_indexers(repo_url: str, dest: str, *, dry_run: bool = False) -> None:
    """
    Ensure dreulavelle/Prowlarr-Indexers is present and up-to-date at
    `dest`. The repo's `Custom/` subfolder is what Prowlarr's
    /config/Definitions/Custom mount targets.
    """
    git_dir = os.path.join(dest, ".git")

    if dry_run:
        if os.path.isdir(git_dir):
            log.info("[DRY RUN] Would `git -C %s pull` on existing repo", dest)
        else:
            log.info("[DRY RUN] Would `git clone %s %s`", repo_url, dest)
        return

    try:
        if os.path.isdir(git_dir):
            log.info("Pulling existing dreulavelle/Prowlarr-Indexers at %s", dest)
            subprocess.run(
                ["git", "-C", dest, "pull", "--ff-only"],
                check=True, capture_output=True, text=True, timeout=60,
            )
        else:
            os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
            log.info("Cloning %s into %s", repo_url, dest)
            subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, dest],
                check=True, capture_output=True, text=True, timeout=120,
            )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        log.error("Indexers clone/pull failed: %s", e)
        if isinstance(e, subprocess.CalledProcessError) and e.stderr:
            log.error("stderr: %s", e.stderr.strip())
        sys.exit(4)
    log.info("Custom indexer definitions present at %s", dest)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    prowlarr_url = env("PROWLARR_URL", DEFAULT_PROWLARR_URL)
    prowlarr_api_key = env("PROWLARR_API_KEY", required=True)
    indexers_repo = env("INDEXERS_REPO", DEFAULT_INDEXERS_REPO)
    indexers_dest = env("INDEXERS_DEST", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    sonarr_url = env("SONARR_URL", DEFAULT_SONARR_URL) if "SONARR_API_KEY" in os.environ else ""
    sonarr_api_key = env("SONARR_API_KEY", "")
    radarr_url = env("RADARR_URL", DEFAULT_RADARR_URL) if "RADARR_API_KEY" in os.environ else ""
    radarr_api_key = env("RADARR_API_KEY", "")
    zilean_url = env("ZILEAN_URL", "")

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Plan: prowlarr=%s indexers_dest=%s sonarr=%s radarr=%s zilean=%s",
        prowlarr_url,
        indexers_dest,
        sonarr_url or "(not enabled)",
        radarr_url or "(not enabled)",
        zilean_url or "(not enabled)",
    )

    # Step 1: clone or pull dreulavelle indexers. Done first so they're
    # in place by the time Prowlarr next scans /config/Definitions/Custom.
    # Prowlarr won't auto-discover new Custom YAMLs without a restart,
    # so the user may need to restart Prowlarr to see them in the
    # "Add Indexer" picker — but they're available either way.
    clone_or_pull_indexers(indexers_repo, indexers_dest, dry_run=dry_run)

    # Step 2: wait for Prowlarr's API.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/v1/system/status for readiness", prowlarr_url)
    else:
        wait_for_prowlarr(prowlarr_url, prowlarr_api_key, timeout_sec)

    # Step 3: register *arr applications.
    if sonarr_url and sonarr_api_key:
        register_application(
            prowlarr_url,
            prowlarr_api_key,
            name="Sonarr",
            impl="Sonarr",
            arr_url=sonarr_url,
            arr_api_key=sonarr_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("Sonarr not enabled (SONARR_API_KEY not set) — skipping")

    if radarr_url and radarr_api_key:
        register_application(
            prowlarr_url,
            prowlarr_api_key,
            name="Radarr",
            impl="Radarr",
            arr_url=radarr_url,
            arr_api_key=radarr_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("Radarr not enabled (RADARR_API_KEY not set) — skipping")

    # Step 4: register Zilean indexer if enabled.
    if zilean_url:
        register_zilean(prowlarr_url, prowlarr_api_key, zilean_url, dry_run=dry_run)
    else:
        log.info("Zilean not enabled (ZILEAN_URL not set) — skipping")

    log.info("configure-prowlarr.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
