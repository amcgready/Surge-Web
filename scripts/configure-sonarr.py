#!/usr/bin/env python3
"""
configure-sonarr.py — Surge post-deploy automation for Sonarr.

Sonarr's apiKey is baked into config.xml upfront via Surge's secret-
seeding pattern, so by the time this script runs Sonarr is already
authenticatable. The script handles the cross-service wiring that
Sonarr can't auto-discover:

  1. Polls /api/v3/system/status (X-Api-Key) until Sonarr is ready.
  2. Adds the standard root folder /media/tv (idempotent — skips if
     already configured at that path). Without this, the user can't
     add any shows because Sonarr requires a root folder before
     accepting series.
  3. When SABnzbd is enabled (SABNZBD_API_KEY set):
        a. Adds SABnzbd as a download client (POST /api/v3/downloadclient)
           with category=tv, talking to localhost:8080 since both run
           under host networking.
        b. Adds a remote path mapping (POST /api/v3/remotepathmapping)
           translating SABnzbd's /downloads/ to Sonarr's
           /media/Intake/downloads/ — same host folder, different
           container-side paths because their mounts diverge.

Idempotent — re-running just re-applies the same configuration.
GET-then-POST pattern: list existing first, skip if a matching entry
is already there.

Sonarr's API quick reference:
  Auth:    X-Api-Key header (value: the apiKey from config.xml).
  Format:  JSON request/response throughout.
  Version: /api/v3 for Sonarr v4. Older v2 used /api/v1, deprecated.

Environment:
  SONARR_URL        Sonarr base URL (default: http://localhost:8989).
  SONARR_API_KEY    apiKey from Sonarr's config.xml. Required.

  SABNZBD_URL       Optional. If present (and SABNZBD_API_KEY set),
                    register SABnzbd as a download client.
                    Default: http://localhost:8080.
  SABNZBD_API_KEY   apiKey from SABnzbd's sabnzbd.ini. Required when
                    SABNZBD_URL is set.

  ROOT_FOLDER_PATH  Root folder Sonarr accepts series into.
                    Default: /media/tv.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Sonarr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success.
  2  Sonarr unreachable past WAIT_TIMEOUT_SEC.
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
import urllib.request
from typing import Optional


DEFAULT_SONARR_URL    = "http://localhost:8989"
DEFAULT_SABNZBD_URL   = "http://localhost:8080"
DEFAULT_ROOT_FOLDER   = "/media/tv"
SABNZBD_CATEGORY      = "tv"
DEFAULT_TIMEOUT_SEC   = 120
POLL_INTERVAL_SEC     = 2
HTTP_TIMEOUT_SEC      = 15

# Remote-path mapping: SABnzbd's container-side download path → Sonarr's.
# Both resolve to the same host folder (mediaRoot/media/Intake/downloads)
# but each container has the mount under a different in-container path.
SABNZBD_REMOTE_PATH = "/downloads/"
SONARR_LOCAL_PATH   = "/media/Intake/downloads/"

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-sonarr")


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

def _request(
    method: str,
    url: str,
    *,
    api_key: str,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Servarr API HTTP entrypoint. Always sends X-Api-Key + Accept JSON."""
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
# Sonarr API operations
# ---------------------------------------------------------------------

def wait_for_sonarr(base_url: str, api_key: str, timeout_sec: int) -> None:
    """Poll /api/v3/system/status until Sonarr is responding."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/v3/system/status"
    last_err: Optional[str] = None

    log.info("Waiting for Sonarr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = _request("GET", probe, api_key=api_key)
            if status == 200:
                log.info("Sonarr reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Sonarr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def list_existing(base_url: str, api_key: str, path: str) -> list:
    """GET /api/v3/<path>, return JSON list (empty list on non-200)."""
    url = f"{base_url.rstrip('/')}/api/v3/{path.lstrip('/')}"
    status, body = _request("GET", url, api_key=api_key)
    if status != 200:
        log.warning("GET %s returned HTTP %d — assuming empty list", url, status)
        return []
    try:
        parsed = json.loads(body)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


# ---- Root folder ----

def add_root_folder(
    base_url: str, api_key: str, path: str, dry_run: bool = False,
) -> None:
    """POST /api/v3/rootfolder. Idempotent — skips if path already
    registered. Sonarr expects the folder to exist on disk; if it
    doesn't, the API responds 400 and we log a warning rather than
    failing the whole script (the user can create the folder later
    and re-run)."""
    if dry_run:
        log.info("[DRY RUN] Would POST /api/v3/rootfolder adding %s", path)
        return

    existing = list_existing(base_url, api_key, "rootfolder")
    for rf in existing:
        if rf.get("path", "").rstrip("/") == path.rstrip("/"):
            log.info("Root folder %s already registered (id=%s)",
                     path, rf.get("id"))
            return

    log.info("Adding root folder %s", path)
    url = f"{base_url.rstrip('/')}/api/v3/rootfolder"
    status, body = _request("POST", url, api_key=api_key, json_body={"path": path})
    if status not in (200, 201):
        log.warning(
            "POST /api/v3/rootfolder for %s returned HTTP %d body=%s — "
            "Sonarr requires the folder to exist on disk; create it on "
            "the host (mediaRoot/media/tv) and re-run if you want this "
            "wired automatically.",
            path, status, body[:300].decode("utf-8", errors="replace"),
        )
        return
    log.info("Root folder %s added", path)


# ---- Download client (SABnzbd) ----

def sabnzbd_payload(name: str, sabnzbd_url: str, sabnzbd_api_key: str) -> dict:
    """Build the POST /api/v3/downloadclient payload for SABnzbd.
    Field shape verified against Sonarr v4's
    /api/v3/downloadclient/schema response."""
    # urlparse handles port + scheme cleanly.
    from urllib.parse import urlparse
    parsed = urlparse(sabnzbd_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 8080)
    use_ssl = parsed.scheme == "https"

    return {
        "name":           name,
        "implementation": "Sabnzbd",
        "configContract": "SabnzbdSettings",
        "protocol":       "usenet",
        "priority":       1,
        "enable":         True,
        "removeCompletedDownloads":  True,
        "removeFailedDownloads":     True,
        "fields": [
            {"name": "host",          "value": host},
            {"name": "port",          "value": port},
            {"name": "useSsl",        "value": use_ssl},
            {"name": "urlBase",       "value": ""},
            {"name": "apiKey",        "value": sabnzbd_api_key},
            {"name": "username",      "value": ""},
            {"name": "password",      "value": ""},
            {"name": "tvCategory",    "value": SABNZBD_CATEGORY},
            {"name": "recentTvPriority", "value": -100},  # Default
            {"name": "olderTvPriority",  "value": -100},
        ],
    }


def add_sabnzbd_download_client(
    base_url: str, api_key: str,
    *, sabnzbd_url: str, sabnzbd_api_key: str, dry_run: bool = False,
) -> None:
    """POST /api/v3/downloadclient. Idempotent by name."""
    name = "SABnzbd"

    if dry_run:
        log.info("[DRY RUN] Would POST /api/v3/downloadclient adding %s "
                 "(url=%s category=%s)",
                 name, sabnzbd_url, SABNZBD_CATEGORY)
        return

    existing = list_existing(base_url, api_key, "downloadclient")
    for dc in existing:
        if dc.get("name") == name:
            log.info("Download client '%s' already registered (id=%s)",
                     name, dc.get("id"))
            return

    payload = sabnzbd_payload(name, sabnzbd_url, sabnzbd_api_key)

    log.info("Adding SABnzbd download client (url=%s)", sabnzbd_url)
    url = f"{base_url.rstrip('/')}/api/v3/downloadclient"
    status, body = _request("POST", url, api_key=api_key, json_body=payload)
    if status not in (200, 201):
        log.error("POST /api/v3/downloadclient failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("SABnzbd download client added")


# ---- Remote path mapping ----

def add_remote_path_mapping(
    base_url: str, api_key: str,
    *, host: str, remote_path: str, local_path: str, dry_run: bool = False,
) -> None:
    """POST /api/v3/remotepathmapping. Idempotent — skips if a mapping
    with the same host+remote_path already exists.

    Sonarr uses these to translate the path SABnzbd reports back
    (its own container-side view) into a path Sonarr can read on
    its own filesystem mount."""
    if dry_run:
        log.info("[DRY RUN] Would POST /api/v3/remotepathmapping mapping "
                 "%s:%s → %s", host, remote_path, local_path)
        return

    existing = list_existing(base_url, api_key, "remotepathmapping")
    for rpm in existing:
        if (rpm.get("host") == host
                and rpm.get("remotePath", "").rstrip("/") == remote_path.rstrip("/")):
            log.info("Remote path mapping %s:%s → %s already registered (id=%s)",
                     host, remote_path, rpm.get("localPath"), rpm.get("id"))
            return

    payload = {
        "host":       host,
        "remotePath": remote_path,
        "localPath":  local_path,
    }

    log.info("Adding remote path mapping %s:%s → %s", host, remote_path, local_path)
    url = f"{base_url.rstrip('/')}/api/v3/remotepathmapping"
    status, body = _request("POST", url, api_key=api_key, json_body=payload)
    if status not in (200, 201):
        log.error("POST /api/v3/remotepathmapping failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("Remote path mapping added")


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    sonarr_url     = env("SONARR_URL", DEFAULT_SONARR_URL)
    sonarr_api_key = env("SONARR_API_KEY", required=True)
    root_folder    = env("ROOT_FOLDER_PATH", DEFAULT_ROOT_FOLDER)
    timeout_sec    = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run        = is_truthy(env("DRY_RUN", "0"))

    sabnzbd_url      = env("SABNZBD_URL", DEFAULT_SABNZBD_URL) if env("SABNZBD_API_KEY") else ""
    sabnzbd_api_key  = env("SABNZBD_API_KEY")

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Plan: sonarr=%s root_folder=%s sabnzbd=%s",
        sonarr_url, root_folder,
        sabnzbd_url or "(not enabled)",
    )

    # Step 1: wait for Sonarr.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/v3/system/status for readiness", sonarr_url)
    else:
        wait_for_sonarr(sonarr_url, sonarr_api_key, timeout_sec)

    # Step 2: root folder. Required before adding shows.
    add_root_folder(sonarr_url, sonarr_api_key, root_folder, dry_run=dry_run)

    # Step 3: SABnzbd download client (when enabled).
    if sabnzbd_url and sabnzbd_api_key:
        add_sabnzbd_download_client(
            sonarr_url, sonarr_api_key,
            sabnzbd_url=sabnzbd_url, sabnzbd_api_key=sabnzbd_api_key,
            dry_run=dry_run,
        )
        # Step 4: remote path mapping for SABnzbd's /downloads/ →
        # Sonarr's /media/Intake/downloads/. Required because the two
        # containers mount the same host folder under different paths.
        add_remote_path_mapping(
            sonarr_url, sonarr_api_key,
            host="localhost",
            remote_path=SABNZBD_REMOTE_PATH,
            local_path=SONARR_LOCAL_PATH,
            dry_run=dry_run,
        )
    else:
        log.info("SABnzbd not enabled (SABNZBD_API_KEY not set) — skipping "
                 "download client and remote path mapping")

    log.info("configure-sonarr.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
