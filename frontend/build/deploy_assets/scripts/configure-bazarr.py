#!/usr/bin/env python3
"""
configure-bazarr.py — Surge post-deploy automation for Bazarr.

Runs after Bazarr's container is up and reachable. The script:

  1. Polls /api/system/status (with X-API-KEY) until Bazarr is ready.
  2. For each enabled *arr (sonarr, radarr — checked via env-var
     presence), POSTs /api/system/settings with the integration
     fields populated from each *arr's apiKey secret.
  3. Enables the corresponding `general-use_*` toggle so Bazarr
     actually queries that *arr.
  4. When PLEX_TOKEN is set (i.e. the user picked Plex as their
     media server), registers Plex as a notification target via
     Bazarr's Apprise integration. This makes Bazarr ping Plex to
     refresh the affected library item after a subtitle download
     so the on-screen subtitle list stays in sync without the user
     manually rescanning.

Idempotent: re-running just re-applies the same settings. Bazarr's
settings endpoint is upsert-style — it merges submitted fields into
the existing configuration, so we can safely call it multiple times
without duplicating anything.

Authentication: Bazarr's API uses the X-API-KEY header (uppercase,
hyphenated). Surge generates the apikey upfront via
bazarr.compose.secrets.apiKey and bakes it into config.ini before
first launch, so this script can authenticate immediately.

Bazarr's settings API (/api/system/settings):
  - Accepts form-encoded POST with hyphenated dotted-flat field names:
        general-use_sonarr=True
        sonarr-ip=sonarr
        sonarr-port=8989
        sonarr-apikey=<key>
  - Only the fields present in the POST body are updated; everything
    else is preserved.

Plex notification — best-effort against Bazarr's Apprise integration:
  Bazarr's notification subsystem uses Apprise URLs. Plex's Apprise
  schema is `plex://<token>@<host>:<port>` where:
    - <token>  is the X-Plex-Token from Plex's Preferences.xml
    - <host>   is reachable from inside the Bazarr container; under
               Surge's host networking, localhost works because both
               Plex and Bazarr bind directly on the host.
    - <port>   is 32400 (Plex's well-known port).
  We POST the URL into the providers list under
  `notifications-providers`. The exact payload shape on
  /api/system/settings for notification providers is not
  comprehensively documented and has shifted across Bazarr versions
  — this script logs the request body and treats a non-success
  response as a soft failure (warns, continues, exits 0). The user
  can finish wiring notifications manually via Bazarr's UI if our
  payload is rejected.

Environment:
  BAZARR_URL       Bazarr base URL (default: http://localhost:6767).
  BAZARR_API_KEY   Value of bazarr.compose.secrets.apiKey. Required.

  SONARR_URL       Optional. If present, register Sonarr.
                   Default: http://localhost:8989.
  SONARR_API_KEY   Value of sonarr.compose.secrets.apiKey.
                   Required when SONARR_URL is set.

  RADARR_URL       Optional. If present, register Radarr.
                   Default: http://localhost:7878.
  RADARR_API_KEY   Value of radarr.compose.secrets.apiKey.
                   Required when RADARR_URL is set.

  PLEX_TOKEN       Optional. When set, registers Plex as an Apprise
                   notification target. Sourced from Plex's
                   fetchScript output (plexToken field). Surge's
                   schema gates this on whenMediaServer:'plex' so the
                   var is only present for Plex deployments.
  PLEX_HOST        Optional. Defaults to 'localhost' (correct under
                   host networking).
  PLEX_PORT        Optional. Defaults to '32400'.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Bazarr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success (including soft failures on the Plex notifier step).
  2  Bazarr unreachable past WAIT_TIMEOUT_SEC.
  3  An *arr settings API call returned non-success.
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


DEFAULT_BAZARR_URL = "http://localhost:6767"
DEFAULT_SONARR_URL = "http://localhost:8989"
DEFAULT_RADARR_URL = "http://localhost:7878"
DEFAULT_PLEX_HOST = "localhost"
DEFAULT_PLEX_PORT = "32400"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-bazarr")


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

def bazarr_request(
    method: str,
    base_url: str,
    path: str,
    *,
    api_key: str,
    form_data: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """All Bazarr API calls go through here. X-API-KEY header always
    sent; form bodies for POST."""
    headers = {
        "Accept": "application/json",
        "X-API-KEY": api_key,
    }
    body: Optional[bytes] = None
    if form_data is not None:
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    url = f"{base_url.rstrip('/')}{path}"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Bazarr API operations
# ---------------------------------------------------------------------

def wait_for_bazarr(base_url: str, api_key: str, timeout_sec: int) -> None:
    """Poll /api/system/status until Bazarr responds 200."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/system/status"
    last_err: Optional[str] = None

    log.info("Waiting for Bazarr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = bazarr_request("GET", base_url, "/api/system/status", api_key=api_key)
            if status == 200:
                log.info("Bazarr reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Bazarr did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def parse_url(url: str) -> tuple[str, int, bool, str]:
    """Split a URL like 'http://sonarr:8989/api' into (host, port,
    ssl, base_url) — Bazarr's settings expect each piece individually
    rather than a whole URL."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or "localhost"
    ssl = parsed.scheme == "https"
    port = parsed.port or (443 if ssl else 80)
    base_url = parsed.path.rstrip("/")  # empty string for "no base url"
    return host, port, ssl, base_url


def configure_arr(
    bazarr_url: str,
    bazarr_api_key: str,
    *,
    arr_name: str,                  # 'sonarr' or 'radarr'
    arr_url: str,
    arr_api_key: str,
    dry_run: bool = False,
) -> None:
    """POST /api/system/settings to register one *arr connection."""
    host, port, ssl, base_url = parse_url(arr_url)

    fields = {
        f"general-use_{arr_name}": "True",
        f"{arr_name}-ip":          host,
        f"{arr_name}-port":        str(port),
        f"{arr_name}-base_url":    base_url,
        f"{arr_name}-ssl":         "True" if ssl else "False",
        f"{arr_name}-apikey":      arr_api_key,
    }

    if dry_run:
        log.info("[DRY RUN] Would POST /api/system/settings registering %s "
                 "(host=%s port=%s ssl=%s)", arr_name, host, port, ssl)
        return

    log.info("Registering %s with Bazarr (host=%s port=%s ssl=%s)",
             arr_name, host, port, ssl)
    status, body = bazarr_request(
        "POST", bazarr_url, "/api/system/settings",
        api_key=bazarr_api_key,
        form_data=fields,
    )
    if status not in (200, 204):
        log.error("POST /api/system/settings for %s failed: HTTP %d body=%s",
                  arr_name, status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("%s registered with Bazarr", arr_name)


# ---------------------------------------------------------------------
# Plex notifier (Apprise)
# ---------------------------------------------------------------------

def configure_plex_notifier(
    bazarr_url: str,
    bazarr_api_key: str,
    *,
    plex_token: str,
    plex_host: str,
    plex_port: str,
    dry_run: bool = False,
) -> None:
    """Register Plex as an Apprise notification target so Bazarr pings
    Plex to refresh after a subtitle download. Soft-failure: warn but
    keep going if Bazarr rejects the payload (the API shape isn't
    formally documented and varies across versions)."""
    # Apprise's Plex schema: plex://<token>@<host>:<port>
    # See https://github.com/caronc/apprise/wiki/Notify_plex
    apprise_url = f"plex://{plex_token}@{plex_host}:{plex_port}"

    if dry_run:
        log.info(
            "[DRY RUN] Would register Plex notification target with "
            "Bazarr (apprise_url=plex://<TOKEN>@%s:%s)",
            plex_host, plex_port,
        )
        return

    # Best-effort payload. The notifications-providers field accepts a
    # JSON-encoded list of provider dicts on the form-encoded settings
    # endpoint. Bazarr expects each provider to be enabled, named, and
    # carry an Apprise URL — this matches the shape we've observed in
    # current Bazarr releases but isn't formally documented.
    providers = [
        {
            "name":    "Plex (Surge)",
            "url":     apprise_url,
            "enabled": True,
        },
    ]
    fields = {
        "notifications-providers": json.dumps(providers),
    }

    log.info(
        "Registering Plex notification target with Bazarr (host=%s port=%s)",
        plex_host, plex_port,
    )
    status, body = bazarr_request(
        "POST", bazarr_url, "/api/system/settings",
        api_key=bazarr_api_key,
        form_data=fields,
    )
    if status not in (200, 204):
        # Soft failure — the *arr registrations already succeeded and
        # those are the load-bearing piece. Plex notifications are a
        # nice-to-have that the user can still wire manually via Bazarr's
        # UI (Settings → Notifications → Apprise).
        log.warning(
            "POST /api/system/settings for Plex notifier returned HTTP %d "
            "(body=%s) — continuing without notification wiring. The user "
            "can add an Apprise provider manually in Bazarr's UI.",
            status, body[:300].decode("utf-8", errors="replace"),
        )
        return
    log.info("Plex notification target registered with Bazarr")


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    bazarr_url = env("BAZARR_URL", DEFAULT_BAZARR_URL)
    bazarr_api_key = env("BAZARR_API_KEY", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    sonarr_url = env("SONARR_URL", DEFAULT_SONARR_URL) if "SONARR_API_KEY" in os.environ else ""
    sonarr_api_key = env("SONARR_API_KEY", "")
    radarr_url = env("RADARR_URL", DEFAULT_RADARR_URL) if "RADARR_API_KEY" in os.environ else ""
    radarr_api_key = env("RADARR_API_KEY", "")

    plex_token = env("PLEX_TOKEN", "")
    plex_host  = env("PLEX_HOST",  DEFAULT_PLEX_HOST)
    plex_port  = env("PLEX_PORT",  DEFAULT_PLEX_PORT)

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Plan: bazarr=%s sonarr=%s radarr=%s plex_notify=%s",
        bazarr_url,
        sonarr_url or "(not enabled)",
        radarr_url or "(not enabled)",
        f"{plex_host}:{plex_port}" if plex_token else "(not enabled)",
    )

    # Step 1: wait for Bazarr.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/system/status for readiness", bazarr_url)
    else:
        wait_for_bazarr(bazarr_url, bazarr_api_key, timeout_sec)

    # Step 2: register *arr connections.
    if sonarr_url and sonarr_api_key:
        configure_arr(
            bazarr_url, bazarr_api_key,
            arr_name="sonarr",
            arr_url=sonarr_url,
            arr_api_key=sonarr_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("Sonarr not enabled (SONARR_API_KEY not set) — skipping")

    if radarr_url and radarr_api_key:
        configure_arr(
            bazarr_url, bazarr_api_key,
            arr_name="radarr",
            arr_url=radarr_url,
            arr_api_key=radarr_api_key,
            dry_run=dry_run,
        )
    else:
        log.info("Radarr not enabled (RADARR_API_KEY not set) — skipping")

    # Step 3: register Plex as an Apprise notification target (if user
    # picked Plex as their media server — gated upstream by the
    # whenMediaServer:'plex' marker in Surge's schema).
    if plex_token:
        configure_plex_notifier(
            bazarr_url, bazarr_api_key,
            plex_token=plex_token,
            plex_host=plex_host,
            plex_port=plex_port,
            dry_run=dry_run,
        )
    else:
        log.info("Plex notifier not enabled (PLEX_TOKEN not set) — skipping")

    log.info("configure-bazarr.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
