#!/usr/bin/env python3
"""
configure-boxarr.py — Surge post-deploy automation for Boxarr.

Boxarr (https://github.com/iongpt/boxarr) tracks weekly box-office
charts and auto-adds trending movies to Radarr. Without a Radarr
connection it does nothing useful, so this script wires the connection
right after first launch — same pattern as Bazarr / Seerr / Prowlarr.

Boxarr's setup is a web-wizard flow by default; the user is expected
to open /setup and paste Radarr URL + API key. We bypass that by
POSTing directly to its API:

  1. GET /api/health  — readiness probe + idempotency flag
                        (response includes "radarr_configured": bool).
  2. If radarr_configured is true, exit 0 — nothing to do.
  3. Otherwise, query Radarr for first available root folder and
     quality profile (Radarr's own /api/v3/rootfolder and
     /api/v3/qualityprofile endpoints). Boxarr stores these as
     strings (folder PATH and profile NAME) and resolves them
     against Radarr's live state when it later tries to add a movie.
  4. POST /api/config/save with the resolved values. Boxarr itself
     test-connects to Radarr before persisting, so a network or
     auth misconfiguration surfaces as a non-success response.

If Radarr has zero root folders or zero quality profiles configured
(fresh install, user hasn't visited Radarr yet), we still POST the
save with Boxarr's hardcoded defaults ("/movies" and "HD-1080p"),
and warn — Boxarr will accept it but adding movies will fail until
the user creates a real root folder in Radarr. Better than
abandoning the post-deploy and forcing the user into Boxarr's setup
wizard manually.

Boxarr API has no auth — local-only by design. No header to send.

Environment:
  BOXARR_URL        Boxarr base URL (default: http://localhost:8888).
  RADARR_URL        Radarr base URL (default: http://localhost:7878).
                    Needed for the save to succeed (Boxarr
                    test-connects before persisting).
  RADARR_API_KEY    Radarr's apiKey secret. When unset/empty the
                    script skips configuration with a 0 exit — the
                    user enabled Boxarr without Radarr (uncommon but
                    not invalid; they can wire something else via
                    Boxarr's UI). The schema marks this as
                    fromServiceSecret:'radarr' so the orchestrator
                    will omit the var entirely when Radarr isn't in
                    the deploy.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Boxarr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success, including:
       - "already configured" short-circuit
       - "Radarr not enabled — nothing to wire" graceful skip
  2  Boxarr unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned non-success.
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


DEFAULT_BOXARR_URL = "http://localhost:8888"
DEFAULT_RADARR_URL = "http://localhost:7878"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

# Boxarr's hardcoded fallbacks (from src/api/routes/config.py upstream).
# We only fall back to these when Radarr has nothing configured yet —
# normally we resolve from Radarr's live state.
FALLBACK_ROOT_FOLDER     = "/movies"
FALLBACK_QUALITY_PROFILE = "HD-1080p"

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-boxarr")


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

def http_request(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Single HTTP entrypoint. Returns (status_code, body_bytes).
    HTTPError responses are normalized into the same tuple shape so
    callers can branch on status without try/except boilerplate."""
    h = {"Accept": "application/json"}
    if headers:
        h.update(headers)
    body: Optional[bytes] = None
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Boxarr API
# ---------------------------------------------------------------------

def wait_for_boxarr(boxarr_url: str, timeout_sec: int) -> dict:
    """Poll /api/health until Boxarr responds 200, return parsed body.

    Boxarr's health response includes radarr_configured — caller uses
    that to decide whether to short-circuit on idempotency."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{boxarr_url.rstrip('/')}/api/health"
    last_err: Optional[str] = None

    log.info("Waiting for Boxarr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = http_request("GET", probe)
            if status == 200:
                log.info("Boxarr reachable after %d attempt(s)", attempts)
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    log.warning("Boxarr health body not valid JSON: %r", body[:200])
                    return {}
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Boxarr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def post_boxarr_config(boxarr_url: str, payload: dict) -> tuple[int, bytes]:
    """POST /api/config/save (JSON). Returns (status, body)."""
    url = f"{boxarr_url.rstrip('/')}/api/config/save"
    return http_request("POST", url, json_body=payload)


# ---------------------------------------------------------------------
# Radarr API — we read live state to pick sensible defaults for Boxarr.
# ---------------------------------------------------------------------

def radarr_get_first_root_folder(radarr_url: str, radarr_api_key: str) -> Optional[str]:
    """Returns the first root folder PATH (string), or None if none
    are configured. Radarr's /api/v3/rootfolder returns a JSON list."""
    url = f"{radarr_url.rstrip('/')}/api/v3/rootfolder"
    status, body = http_request(
        "GET", url, headers={"X-Api-Key": radarr_api_key},
    )
    if status != 200:
        log.warning("Radarr GET /api/v3/rootfolder returned HTTP %d — "
                    "falling back to Boxarr's default", status)
        return None
    try:
        folders = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(folders, list) or not folders:
        return None
    path = folders[0].get("path")
    return path if isinstance(path, str) and path else None


def radarr_get_first_quality_profile(radarr_url: str, radarr_api_key: str) -> Optional[str]:
    """Returns the first quality profile NAME (string). Boxarr stores
    quality profiles as names, not IDs."""
    url = f"{radarr_url.rstrip('/')}/api/v3/qualityprofile"
    status, body = http_request(
        "GET", url, headers={"X-Api-Key": radarr_api_key},
    )
    if status != 200:
        log.warning("Radarr GET /api/v3/qualityprofile returned HTTP %d — "
                    "falling back to Boxarr's default", status)
        return None
    try:
        profiles = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(profiles, list) or not profiles:
        return None
    name = profiles[0].get("name")
    return name if isinstance(name, str) and name else None


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    boxarr_url     = env("BOXARR_URL", DEFAULT_BOXARR_URL)
    radarr_url     = env("RADARR_URL", DEFAULT_RADARR_URL)
    radarr_api_key = env("RADARR_API_KEY", "")
    timeout_sec    = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run        = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    # Step 0: graceful skip when Radarr isn't part of this deploy.
    # Boxarr without Radarr can still come up — the user enters config
    # via /setup later. Nothing for us to do here.
    if not radarr_api_key:
        log.info(
            "RADARR_API_KEY not set — Radarr is not enabled in this "
            "deploy. Skipping Boxarr configuration; the user can wire "
            "a Radarr connection (or other targets) via Boxarr's UI "
            "at %s/setup.", boxarr_url,
        )
        return 0

    log.info("Plan: boxarr=%s radarr=%s", boxarr_url, radarr_url)

    # Step 1: wait for Boxarr.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/health for readiness", boxarr_url)
        health = {"radarr_configured": False}
    else:
        health = wait_for_boxarr(boxarr_url, timeout_sec)

    # Step 2: idempotency — if Boxarr already has Radarr wired, skip.
    if health.get("radarr_configured"):
        log.info("Boxarr already has Radarr configured (radarr_configured=true) — nothing to do")
        return 0

    # Step 3: query Radarr for root folder + quality profile defaults
    # so Boxarr stores values that match the user's actual Radarr state.
    if dry_run:
        log.info("[DRY RUN] Would query Radarr for root folder + quality profile")
        root_folder = FALLBACK_ROOT_FOLDER
        quality_profile = FALLBACK_QUALITY_PROFILE
    else:
        root_folder = radarr_get_first_root_folder(radarr_url, radarr_api_key)
        quality_profile = radarr_get_first_quality_profile(radarr_url, radarr_api_key)

        if not root_folder:
            log.warning(
                "Radarr has no root folders configured — using Boxarr's "
                "default (%s). The user will need to add a root folder "
                "in Radarr and update Boxarr's settings before movies "
                "can actually be added.", FALLBACK_ROOT_FOLDER,
            )
            root_folder = FALLBACK_ROOT_FOLDER
        if not quality_profile:
            log.warning(
                "Radarr has no quality profiles configured — using Boxarr's "
                "default (%s). User may need to update via Boxarr's UI.",
                FALLBACK_QUALITY_PROFILE,
            )
            quality_profile = FALLBACK_QUALITY_PROFILE

    payload = {
        "radarr_url":                     radarr_url,
        "radarr_api_key":                 radarr_api_key,
        "radarr_root_folder":             root_folder,
        "radarr_quality_profile_default": quality_profile,
        # Everything else — scheduler cron, auto_add toggle, genre
        # filters, etc. — keeps Boxarr's hardcoded defaults from
        # src/api/routes/config.py. The user can tune via the UI.
    }

    if dry_run:
        log.info("[DRY RUN] Would POST /api/config/save payload: %s", _redact(payload))
        return 0

    # Step 4: save. Boxarr test-connects to Radarr before persisting,
    # so a connection problem surfaces here rather than silently later.
    log.info("Saving Boxarr config (root_folder=%s quality_profile=%s)",
             root_folder, quality_profile)
    status, body = post_boxarr_config(boxarr_url, payload)
    if status not in (200, 201):
        log.error("POST /api/config/save failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    # Boxarr's response shape: {"success": bool, "message": str}
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        result = {}
    if result.get("success") is False:
        # Boxarr returned 200 with success=false (typical for connection-
        # test failures). Treat as a hard error — the script can't
        # recover by itself.
        log.error("Boxarr rejected the config: %s",
                  result.get("message", "(no message)"))
        sys.exit(3)

    log.info("Boxarr configured: %s",
             result.get("message", "configuration saved"))
    return 0


def _redact(payload: dict) -> dict:
    """Replace api keys / secrets in dry-run logs."""
    out = dict(payload)
    for k in ("radarr_api_key",):
        if k in out and out[k]:
            out[k] = "***REDACTED***"
    return out


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
