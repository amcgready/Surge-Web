#!/usr/bin/env python3
"""
configure-seerr.py — Surge post-deploy automation for Seerr.

Seerr is an Overseerr fork — same /api/v1 surface and JSON shapes.
The script:

  1. Polls /api/v1/status (with X-Api-Key) until Seerr is ready.
  2. For each enabled *arr (sonarr, radarr — checked via env-var
     presence), POSTs /api/v1/settings/sonarr or /radarr to register
     the connection.
  3. Idempotent — checks existing instances by name before adding.

Authentication: Seerr expects the X-Api-Key header. Surge generates
the apiKey upfront via seerr.compose.secrets.apiKey and bakes it into
settings.json before first launch, so authentication works immediately.

Plex/Jellyfin/Emby server configuration is intentionally NOT done here.
Plex requires Plex SSO + library-discovery flows that don't fit a one-
shot post-deploy script; users complete that on first UI visit. Sonarr
and Radarr are pure REST so they're automatable.

Notes on Sonarr / Radarr settings shape:
  - activeProfileId / activeProfileName describe Sonarr's quality
    profile to send new shows to. Sonarr's auto-created profile is
    "Any" (id=1) on a fresh install — we default to that. Users with
    custom profiles will need to update via Seerr's UI after.
  - activeDirectory is the path *inside Sonarr's container* where
    new media lands. Surge's Sonarr exposes /media as the library
    root, so /media/tv (sonarr) and /media/movies (radarr) are the
    sensible defaults that match the Plex library auto-creation paths
    in configure-plex.py.

Environment:
  SEERR_URL         Seerr base URL (default: http://localhost:5055).
  SEERR_API_KEY     Value of seerr.compose.secrets.apiKey. Required.

  SONARR_URL        Optional. If present, register Sonarr.
                    Default: http://localhost:8989.
  SONARR_API_KEY    Required when SONARR_URL is set.

  RADARR_URL        Optional. If present, register Radarr.
                    Default: http://localhost:7878.
  RADARR_API_KEY    Required when RADARR_URL is set.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Seerr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success.
  2  Seerr unreachable past WAIT_TIMEOUT_SEC.
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


DEFAULT_SEERR_URL = "http://localhost:5055"
DEFAULT_SONARR_URL = "http://localhost:8989"
DEFAULT_RADARR_URL = "http://localhost:7878"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-seerr")


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

def seerr_request(
    method: str,
    base_url: str,
    path: str,
    *,
    api_key: str,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """All Seerr API calls go through here. X-Api-Key always sent."""
    headers = {
        "Accept": "application/json",
        "X-Api-Key": api_key,
    }
    body: Optional[bytes] = None
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    url = f"{base_url.rstrip('/')}{path}"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Seerr API operations
# ---------------------------------------------------------------------

def wait_for_seerr(base_url: str, api_key: str, timeout_sec: int) -> None:
    """Poll /api/v1/status until Seerr responds 200."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/v1/status"
    last_err: Optional[str] = None

    log.info("Waiting for Seerr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = seerr_request("GET", base_url, "/api/v1/status", api_key=api_key)
            if status == 200:
                log.info("Seerr reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Seerr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def parse_url(url: str) -> tuple[str, int, bool, str]:
    """Split a URL like 'http://sonarr:8989/api' into
    (hostname, port, useSsl, baseUrl) — Seerr's settings expect each
    piece individually."""
    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname or "localhost"
    use_ssl = parsed.scheme == "https"
    port = parsed.port or (443 if use_ssl else 80)
    base_url = parsed.path.rstrip("/")
    return hostname, port, use_ssl, base_url


def list_existing_arr_instances(
    seerr_url: str, seerr_api_key: str, arr_kind: str,
) -> list:
    """GET /api/v1/settings/{arr_kind} → list of existing instances."""
    status, body = seerr_request(
        "GET", seerr_url, f"/api/v1/settings/{arr_kind}",
        api_key=seerr_api_key,
    )
    if status != 200:
        log.warning("GET /api/v1/settings/%s returned HTTP %d — assuming empty",
                    arr_kind, status)
        return []
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def configure_arr(
    seerr_url: str,
    seerr_api_key: str,
    *,
    arr_kind: str,                  # 'sonarr' or 'radarr'
    arr_name: str,                  # display name in Seerr's UI
    arr_url: str,
    arr_api_key: str,
    active_directory: str,
    dry_run: bool = False,
) -> None:
    """POST /api/v1/settings/{arr_kind} to register a *arr instance."""
    hostname, port, use_ssl, base_url = parse_url(arr_url)

    if dry_run:
        log.info(
            "[DRY RUN] Would POST /api/v1/settings/%s registering %s "
            "(hostname=%s port=%s ssl=%s dir=%s)",
            arr_kind, arr_name, hostname, port, use_ssl, active_directory,
        )
        return

    # Idempotency: skip if a same-named instance is already registered.
    existing = list_existing_arr_instances(seerr_url, seerr_api_key, arr_kind)
    for inst in existing:
        if inst.get("name") == arr_name:
            log.info("%s instance '%s' already registered (id=%s)",
                     arr_kind, arr_name, inst.get("id"))
            return

    payload = {
        "name": arr_name,
        "hostname": hostname,
        "port": port,
        "useSsl": use_ssl,
        "baseUrl": base_url,
        "apiKey": arr_api_key,
        # Default to the auto-created "Any" profile. Users with custom
        # quality profiles will need to update this via the Seerr UI.
        "activeProfileId": 1,
        "activeProfileName": "Any",
        "activeDirectory": active_directory,
        "is4k": False,
        "isDefault": True,
        # Sonarr-only fields. Radarr ignores enableSeasonFolders.
        "enableSeasonFolders": True,
        "syncEnabled": True,
        "preventSearch": False,
    }

    log.info("Registering %s instance '%s' with Seerr (hostname=%s port=%s)",
             arr_kind, arr_name, hostname, port)
    status, body = seerr_request(
        "POST", seerr_url, f"/api/v1/settings/{arr_kind}",
        api_key=seerr_api_key,
        json_body=payload,
    )
    if status not in (200, 201):
        log.error("POST /api/v1/settings/%s failed: HTTP %d body=%s",
                  arr_kind, status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("%s instance '%s' registered", arr_kind, arr_name)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    seerr_url = env("SEERR_URL", DEFAULT_SEERR_URL)
    seerr_api_key = env("SEERR_API_KEY", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    sonarr_url = env("SONARR_URL", DEFAULT_SONARR_URL) if "SONARR_API_KEY" in os.environ else ""
    sonarr_api_key = env("SONARR_API_KEY", "")
    radarr_url = env("RADARR_URL", DEFAULT_RADARR_URL) if "RADARR_API_KEY" in os.environ else ""
    radarr_api_key = env("RADARR_API_KEY", "")

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Plan: seerr=%s sonarr=%s radarr=%s",
        seerr_url,
        sonarr_url or "(not enabled)",
        radarr_url or "(not enabled)",
    )

    # Step 1: wait for Seerr.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/v1/status for readiness", seerr_url)
    else:
        wait_for_seerr(seerr_url, seerr_api_key, timeout_sec)

    # Step 2: register Sonarr (if enabled).
    if sonarr_url and sonarr_api_key:
        configure_arr(
            seerr_url, seerr_api_key,
            arr_kind="sonarr",
            arr_name="Sonarr",
            arr_url=sonarr_url,
            arr_api_key=sonarr_api_key,
            # Matches Plex auto-creation in configure-plex.py.
            active_directory="/media/tv",
            dry_run=dry_run,
        )
    else:
        log.info("Sonarr not enabled (SONARR_API_KEY not set) — skipping")

    # Step 3: register Radarr (if enabled).
    if radarr_url and radarr_api_key:
        configure_arr(
            seerr_url, seerr_api_key,
            arr_kind="radarr",
            arr_name="Radarr",
            arr_url=radarr_url,
            arr_api_key=radarr_api_key,
            active_directory="/media/movies",
            dry_run=dry_run,
        )
    else:
        log.info("Radarr not enabled (RADARR_API_KEY not set) — skipping")

    log.info("configure-seerr.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
