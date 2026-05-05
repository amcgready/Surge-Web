#!/usr/bin/env python3
"""
configure-episeerr.py — Surge post-deploy automation for Episeerr.

Episeerr (https://github.com/Vansmak/episeerr) wires most service
integrations via env vars at container startup — Sonarr, Radarr,
TMDB, Tautulli, Plex, Jellyfin, Emby are all set up declaratively in
Surge's schema (see episeerr.compose.env in AdditionalServicesStep.js).
Two integrations don't have env-var support upstream and need to be
configured via Episeerr's REST API instead:

  - Prowlarr (loaded as a ServiceIntegration plugin, no env-var path)
  - SABnzbd  (same)

Both share Episeerr's generic plugin endpoint:
  POST /api/test-connection/<service>   — validates credentials
  POST /api/save-service/<service>      — persists to settings.db
                                           (UPSERT — idempotent)

Body shape: JSON with service-prefixed keys, e.g.:
  { "prowlarr-url": "http://localhost:9696",
    "prowlarr-api_key": "<key>" }

Field-name flexibility: Episeerr accepts either `apikey` or `api_key`
suffix (settings_db.py lines 333-341 try multiple variants in order).
We use `api_key` for consistency.

Auth: Episeerr's auth defaults off, with localhost bypass on by
default. Surge runs everything on a private host network so this
script reaches Episeerr at http://localhost:5002 without auth.
If a user enables REQUIRE_AUTH=true, the script will fail with HTTP
401 and the user will need to wire credentials manually via the UI.

Idempotent: re-running just re-applies the same UPSERT. Same record
gets updated; no duplicates.

Environment:
  EPISEERR_URL      Episeerr base URL (default: http://localhost:5002).

  PROWLARR_URL      Optional. If present, register Prowlarr.
                    Default: http://localhost:9696.
  PROWLARR_API_KEY  Required when PROWLARR_URL is set.

  SABNZBD_URL       Optional. If present, register SABnzbd.
                    Default: http://localhost:8080.
  SABNZBD_API_KEY   Required when SABNZBD_URL is set.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Episeerr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success — all enabled integrations registered (or none enabled).
  2  Episeerr unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned non-success (test or save).
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


DEFAULT_EPISEERR_URL = "http://localhost:5002"
DEFAULT_PROWLARR_URL = "http://localhost:9696"
DEFAULT_SABNZBD_URL  = "http://localhost:8080"
DEFAULT_TIMEOUT_SEC  = 120
POLL_INTERVAL_SEC    = 2
HTTP_TIMEOUT_SEC     = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-episeerr")


def env(name: str, default: Optional[str] = None) -> str:
    v = os.environ.get(name, default)
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
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Single HTTP entrypoint. Returns (status_code, body_bytes).
    HTTPError responses are normalized into the same tuple shape so
    callers can branch on status without try/except boilerplate."""
    headers = {"Accept": "application/json"}
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
# Episeerr API operations
# ---------------------------------------------------------------------

def wait_for_episeerr(base_url: str, timeout_sec: int) -> None:
    """Poll Episeerr's root until it responds 200. Episeerr doesn't
    expose a dedicated /health probe; the dashboard root is good
    enough for a liveness check."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/"
    last_err: Optional[str] = None

    log.info("Waiting for Episeerr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, _body = http_request("GET", probe)
            if status == 200:
                log.info("Episeerr reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Episeerr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def configure_service(
    base_url: str,
    *,
    service: str,        # 'prowlarr' or 'sabnzbd'
    service_url: str,
    api_key: str,
    dry_run: bool = False,
) -> None:
    """Test and save one service integration via Episeerr's API.

    Calls /api/test-connection/<service> first as a soft validation;
    if the test fails, logs a warning but still attempts the save —
    Episeerr's save endpoint persists regardless of test result, and
    the user gets visible "test failed" status in the dashboard which
    is more useful than us silently bailing."""
    payload = {
        f"{service}-url":     service_url,
        f"{service}-api_key": api_key,
    }
    redacted = dict(payload)
    redacted[f"{service}-api_key"] = "***REDACTED***"

    if dry_run:
        log.info("[DRY RUN] Would test + save %s integration: %s",
                 service, redacted)
        return

    # Step 1: test connection — informational, not blocking.
    test_url = f"{base_url.rstrip('/')}/api/test-connection/{service}"
    log.info("Testing %s connection (url=%s)", service, service_url)
    status, body = http_request("POST", test_url, json_body=payload)
    if status == 200:
        try:
            result = json.loads(body)
            msg = result.get("message", "(no message)")
        except json.JSONDecodeError:
            msg = body[:200].decode("utf-8", errors="replace")
        log.info("%s test: %s", service, msg)
    else:
        log.warning(
            "%s test-connection returned HTTP %d body=%s — proceeding with "
            "save anyway; Episeerr's dashboard will show the connection "
            "status and the user can re-test from there.",
            service, status, body[:200].decode("utf-8", errors="replace"),
        )

    # Step 2: save (idempotent UPSERT).
    save_url = f"{base_url.rstrip('/')}/api/save-service/{service}"
    log.info("Saving %s integration", service)
    status, body = http_request("POST", save_url, json_body=payload)
    if status not in (200, 201):
        log.error(
            "POST /api/save-service/%s failed: HTTP %d body=%s",
            service, status, body[:300].decode("utf-8", errors="replace"),
        )
        sys.exit(3)

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        result = {}
    log.info("%s saved: %s", service, result.get("message", "(no message)"))


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    base_url    = env("EPISEERR_URL", DEFAULT_EPISEERR_URL)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run     = is_truthy(env("DRY_RUN", "0"))

    # Prowlarr / SABnzbd: presence of the API_KEY env var gates whether
    # to attempt registration. Schema-side, whenService:'prowlarr' /
    # whenService:'sabnzbd' on the postDeployScript.env entries omits
    # both URL and KEY when the upstream service isn't part of this
    # deploy — the script then sees empty env and skips gracefully.
    prowlarr_url     = env("PROWLARR_URL", DEFAULT_PROWLARR_URL) if env("PROWLARR_API_KEY") else ""
    prowlarr_api_key = env("PROWLARR_API_KEY")
    sabnzbd_url      = env("SABNZBD_URL",  DEFAULT_SABNZBD_URL)  if env("SABNZBD_API_KEY")  else ""
    sabnzbd_api_key  = env("SABNZBD_API_KEY")

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Plan: episeerr=%s prowlarr=%s sabnzbd=%s",
        base_url,
        prowlarr_url or "(not enabled)",
        sabnzbd_url  or "(not enabled)",
    )

    # If neither integration is enabled, nothing to do — env-var
    # integrations (Sonarr/Radarr/Plex/etc.) are already wired by
    # Episeerr at startup from the schema's compose.env declarations.
    if not prowlarr_url and not sabnzbd_url:
        log.info("No plugin integrations to configure — env-var ones are "
                 "wired at startup. Nothing for the post-deploy script to do.")
        return 0

    # Step 1: wait for Episeerr.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/ for readiness", base_url)
    else:
        wait_for_episeerr(base_url, timeout_sec)

    # Step 2: register Prowlarr (if enabled).
    if prowlarr_url and prowlarr_api_key:
        configure_service(
            base_url,
            service="prowlarr",
            service_url=prowlarr_url,
            api_key=prowlarr_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("Prowlarr not enabled (PROWLARR_API_KEY not set) — skipping")

    # Step 3: register SABnzbd (if enabled).
    if sabnzbd_url and sabnzbd_api_key:
        configure_service(
            base_url,
            service="sabnzbd",
            service_url=sabnzbd_url,
            api_key=sabnzbd_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("SABnzbd not enabled (SABNZBD_API_KEY not set) — skipping")

    log.info("configure-episeerr.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
