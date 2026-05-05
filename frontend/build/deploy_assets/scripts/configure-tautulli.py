#!/usr/bin/env python3
"""
configure-tautulli.py — Surge post-deploy automation for Tautulli.

Tautulli's apiKey is baked into config.ini upfront via Surge's
secret-seeding pattern, so the script is authenticated from the
moment Tautulli boots. The remaining cross-service wiring is the
Plex-server connection, which Tautulli won't auto-discover.

Steps:
  1. Polls /api/v2?cmd=arnold (returns a Schwarzenegger quote, doubles
     as Tautulli's "I am alive" probe) until ready.
  2. Fetches Plex's /identity (no auth required — open endpoint) to
     extract machineIdentifier. Tautulli requires this for proper
     server verification; without it, the saved Plex connection
     shows as "unverified" and metrics / live stats won't populate.
  3. POSTs /api/v2?cmd=set_settings (form body) with:
        pms_ip, pms_port, pms_ssl, pms_url, pms_url_manual=1,
        pms_token, pms_identifier
     Tautulli reloads its config in-process; no restart needed.

Idempotent — set_settings is upsert-style; re-runs overwrite cleanly
without duplicate side effects.

Why API instead of seeding config.ini directly? Plex's X-Plex-Token
is a runtime-generated value that doesn't exist until Plex's first
launch (it's written to Preferences.xml, picked up by
fetch-plex-secrets.py). At compose.files write time we don't have it
yet, so the [PMS] section can't be statically seeded. The API path
runs after the runtime fetch has completed.

Tautulli API quick reference:
  Auth:    apikey query string param (or form param). No headers.
  Format:  Returns JSON-wrapped responses. Each command's "response"
           key carries result + status.
  Path:    All commands at /api/v2?cmd=<command>. set_settings accepts
           additional params either as query string or form-encoded
           body. We use form body (cleaner with secrets in payload).

Environment:
  TAUTULLI_URL      Tautulli base URL (default: http://localhost:8181).
  TAUTULLI_API_KEY  apiKey from Tautulli's config.ini. Required.

  PLEX_URL          Plex base URL for identity probe + settings.
                    Default: http://localhost:32400.
  PLEX_TOKEN        X-Plex-Token from fetch-plex-secrets.py output.
                    Required. When unset, the script exits 0 with a
                    "skipping — no Plex to wire" log line (Tautulli
                    is dead weight without Plex but we don't fail
                    deploys on it).

  WAIT_TIMEOUT_SEC  Max seconds to wait for Tautulli (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success, including the "no Plex to wire" graceful skip.
  2  Tautulli unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned non-success.
  4  Plex /identity unreachable or didn't return machineIdentifier.
  6  Required env var missing.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


DEFAULT_TAUTULLI_URL = "http://localhost:8181"
DEFAULT_PLEX_URL     = "http://localhost:32400"
DEFAULT_TIMEOUT_SEC  = 120
POLL_INTERVAL_SEC    = 2
HTTP_TIMEOUT_SEC     = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-tautulli")


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
    form_data: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Single HTTP entrypoint. Form body for POST when supplied;
    HTTPError responses normalized into the same tuple shape."""
    h = {"Accept": "application/json"}
    if headers:
        h.update(headers)
    body: Optional[bytes] = None
    if form_data is not None:
        body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
        h["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")


# ---------------------------------------------------------------------
# Tautulli API
# ---------------------------------------------------------------------

def tautulli_api_url(base_url: str, api_key: str, command: str) -> str:
    """Build a /api/v2?apikey=X&cmd=Y URL."""
    qs = urllib.parse.urlencode({"apikey": api_key, "cmd": command})
    return f"{base_url.rstrip('/')}/api/v2?{qs}"


def wait_for_tautulli(base_url: str, api_key: str, timeout_sec: int) -> None:
    """Poll Tautulli's /api/v2?cmd=arnold until it returns 200.
    arnold is a no-side-effects command that returns a randomized
    Schwarzenegger quote — Tautulli's de facto liveness probe."""
    deadline = time.monotonic() + timeout_sec
    probe = tautulli_api_url(base_url, api_key, "arnold")
    last_err: Optional[str] = None

    log.info("Waiting for Tautulli at %s (timeout: %ds)",
             f"{base_url.rstrip('/')}/api/v2?cmd=arnold", timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, _body = http_request("GET", probe)
            if status == 200:
                log.info("Tautulli reachable after %d attempt(s)", attempts)
                return
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Tautulli did not respond within %ds (last: %s)",
              timeout_sec, last_err)
    sys.exit(2)


def set_pms_settings(
    base_url: str,
    api_key: str,
    *,
    pms_ip: str,
    pms_port: int,
    pms_ssl: bool,
    pms_url: str,
    pms_token: str,
    pms_identifier: str,
    dry_run: bool = False,
) -> None:
    """POST /api/v2?cmd=set_settings with the [PMS] section fields.
    Tautulli reloads in-process — no restart needed."""
    if dry_run:
        log.info(
            "[DRY RUN] Would POST cmd=set_settings (ip=%s port=%d ssl=%s "
            "url=%s identifier=%s token=***REDACTED***)",
            pms_ip, pms_port, pms_ssl, pms_url, pms_identifier,
        )
        return

    url = tautulli_api_url(base_url, api_key, "set_settings")
    fields = {
        "pms_ip":          pms_ip,
        "pms_port":        str(pms_port),
        "pms_ssl":         "1" if pms_ssl else "0",
        "pms_url":         pms_url,
        "pms_url_manual":  "1",
        "pms_token":       pms_token,
        "pms_identifier":  pms_identifier,
    }

    log.info("Saving Plex connection to Tautulli (ip=%s port=%d url=%s)",
             pms_ip, pms_port, pms_url)
    status, body = http_request("POST", url, form_data=fields)
    if status not in (200, 201):
        log.error("POST cmd=set_settings failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    # Tautulli's response body is JSON-wrapped: {"response": {"result":
    # "success" | "error", "message": "..."}}.
    try:
        result = json.loads(body)
        resp = result.get("response", {})
        if resp.get("result") == "error":
            log.error("Tautulli rejected set_settings: %s",
                      resp.get("message", "(no message)"))
            sys.exit(3)
    except json.JSONDecodeError:
        log.warning("set_settings response not JSON — assuming success: %r",
                    body[:200])
    log.info("Plex connection saved to Tautulli")


# ---------------------------------------------------------------------
# Plex /identity probe (open endpoint — no auth)
# ---------------------------------------------------------------------

def fetch_plex_machine_id(plex_url: str, plex_token: str) -> str:
    """GET /identity from Plex, return machineIdentifier. Plex
    requires X-Plex-Token for authenticated calls but /identity itself
    is open — we still pass the token for forward-compat with future
    Plex versions that might gate it."""
    url = f"{plex_url.rstrip('/')}/identity"
    headers = {
        "X-Plex-Token": plex_token,
        "Accept":       "application/xml",
    }
    status, body = http_request("GET", url, headers=headers)
    if status != 200:
        log.error("GET %s failed: HTTP %d body=%s",
                  url, status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(4)

    text = body.decode("utf-8", errors="replace")
    # /identity returns XML like:
    #   <MediaContainer ... machineIdentifier="abcdef0123..." ...>
    m = re.search(r'machineIdentifier="([^"]+)"', text)
    if not m:
        log.error("Plex /identity returned 200 but no machineIdentifier "
                  "attribute found. Body: %s", text[:300])
        sys.exit(4)
    machine_id = m.group(1)
    log.info("Plex machineIdentifier: %s", machine_id[:8] + "…")
    return machine_id


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    tautulli_url     = env("TAUTULLI_URL", DEFAULT_TAUTULLI_URL)
    tautulli_api_key = env("TAUTULLI_API_KEY", required=True)
    plex_url         = env("PLEX_URL", DEFAULT_PLEX_URL)
    plex_token       = env("PLEX_TOKEN", "")
    timeout_sec      = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run          = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    # Graceful skip when Plex isn't part of this deploy. Tautulli without
    # Plex is dead weight, but failing the post-deploy step would block
    # other services — better to log and continue.
    if not plex_token:
        log.info(
            "PLEX_TOKEN not set — Plex isn't part of this deploy. "
            "Skipping Tautulli configuration; the user can wire a Plex "
            "(or Jellyfin/Emby — Tautulli supports those too) connection "
            "via Tautulli's UI at %s/settings.", tautulli_url,
        )
        return 0

    log.info("Plan: tautulli=%s plex=%s", tautulli_url, plex_url)

    # Step 1: wait for Tautulli.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/v2?cmd=arnold for readiness",
                 tautulli_url)
    else:
        wait_for_tautulli(tautulli_url, tautulli_api_key, timeout_sec)

    # Step 2: fetch Plex's machine identifier.
    if dry_run:
        log.info("[DRY RUN] Would GET %s/identity for machineIdentifier", plex_url)
        machine_id = "<DRY_RUN_MACHINE_ID>"
    else:
        machine_id = fetch_plex_machine_id(plex_url, plex_token)

    # Parse the Plex URL into the discrete fields Tautulli stores.
    parsed = urllib.parse.urlparse(plex_url)
    pms_ip   = parsed.hostname or "localhost"
    pms_ssl  = parsed.scheme == "https"
    pms_port = parsed.port or (443 if pms_ssl else 32400)

    # Step 3: save settings via Tautulli's API.
    set_pms_settings(
        tautulli_url, tautulli_api_key,
        pms_ip=pms_ip,
        pms_port=pms_port,
        pms_ssl=pms_ssl,
        pms_url=plex_url,
        pms_token=plex_token,
        pms_identifier=machine_id,
        dry_run=dry_run,
    )

    log.info("configure-tautulli.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
