#!/usr/bin/env python3
"""
configure-pulsarr.py — Surge post-deploy automation for Pulsarr.

Pulsarr (https://github.com/jamcalli/pulsarr) syncs Plex watchlists to
Sonarr/Radarr — when a user adds a show or movie to their plex.tv
watchlist, Pulsarr makes a matching request in the *arr. The three
integrations it needs (Plex token, Sonarr URL+key, Radarr URL+key)
all flow through Pulsarr's REST API at /api/v1/config.

Why API over env-vars: Pulsarr's plexTokens env var expects a JSON
array string (e.g. `["abc123"]`), and Plex's X-Plex-Token is a
runtime-fetched value (fetch-plex-secrets.py reads it after Plex's
first launch). Wrapping a runtime value in JSON-array syntax inside
a docker-compose env entry isn't representable in Surge's schema
without growing it for one-off transforms — the API path sidesteps
that entirely. It also keeps a single source of truth (Pulsarr's DB)
rather than fighting between env-loaded values and DB-stored values.

Steps:
  1. Polls GET /api/v1/config until Pulsarr is ready (also serves as
     an "is the API up" liveness probe).
  2. GETs current config — used for idempotent merging (only updates
     fields we own, leaves user-edited fields alone).
  3. PUTs a merged config back. Idempotent — Pulsarr's PUT is upsert
     style; re-running just rewrites the same values.

Env-var presence drives what gets configured:
  PLEX_TOKEN set     → plexTokens = ["${PLEX_TOKEN}"] (JSON-wrap)
  SONARR_API_KEY set → sonarrBaseUrl + sonarrApiKey
  RADARR_API_KEY set → radarrBaseUrl + radarrApiKey

When NONE are set, the script exits 0 with a "nothing to wire" log
line — Pulsarr boots into a usable state with env-var defaults from
its compose entry; users can complete setup via the UI later.

Pulsarr API quick reference:
  Auth:    No auth on local API by default (Pulsarr's
           authenticationMethod env var gates the WEB UI, not the
           API — the underlying Fastify routes are open on localhost).
  Format:  JSON request/response. PUT body uses the same Zod schema
           as Pulsarr's internal config object.
  Path:    /api/v1/config (Fastify-based).

Environment:
  PULSARR_URL       Pulsarr base URL (default: http://localhost:3003).

  PLEX_TOKEN        Optional. plex.tv account token (from
                    fetch-plex-secrets.py).
  SONARR_URL        Optional. Default: http://localhost:8989.
  SONARR_API_KEY    Optional. apiKey from Sonarr's config.xml.
  RADARR_URL        Optional. Default: http://localhost:7878.
  RADARR_API_KEY    Optional. apiKey from Radarr's config.xml.

  WAIT_TIMEOUT_SEC  Max seconds to wait for Pulsarr (default: 120).
  DRY_RUN           "1"/"true": log only.

Exit codes:
  0  Success, including the "nothing to wire" graceful skip.
  2  Pulsarr unreachable past WAIT_TIMEOUT_SEC.
  3  An API call returned non-success.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional


DEFAULT_PULSARR_URL = "http://localhost:3003"
DEFAULT_SONARR_URL  = "http://localhost:8989"
DEFAULT_RADARR_URL  = "http://localhost:7878"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC   = 2
HTTP_TIMEOUT_SEC    = 15

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-pulsarr")


def env(name: str, default: Optional[str] = None) -> str:
    return os.environ.get(name, default) or ""


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
    """Single HTTP entrypoint. JSON body for non-GET when supplied;
    HTTPError responses normalized into the same tuple shape."""
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
# Pulsarr API
# ---------------------------------------------------------------------

def wait_for_pulsarr(base_url: str, timeout_sec: int) -> dict:
    """Poll GET /api/v1/config until Pulsarr's API is ready, return the
    parsed config object. Doubles as the readiness probe AND the seed
    for the merge step in main()."""
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/v1/config"
    last_err: Optional[str] = None

    log.info("Waiting for Pulsarr at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = http_request("GET", probe)
            if status == 200:
                log.info("Pulsarr reachable after %d attempt(s)", attempts)
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    log.warning(
                        "Pulsarr GET /api/v1/config returned non-JSON body — "
                        "treating as empty config: %r", body[:200],
                    )
                    return {}
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Pulsarr did not respond within %ds (last: %s)",
              timeout_sec, last_err)
    sys.exit(2)


def put_pulsarr_config(base_url: str, payload: dict) -> tuple[int, bytes]:
    """PUT /api/v1/config with the merged config object."""
    url = f"{base_url.rstrip('/')}/api/v1/config"
    return http_request("PUT", url, json_body=payload)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    pulsarr_url      = env("PULSARR_URL", DEFAULT_PULSARR_URL)
    plex_token       = env("PLEX_TOKEN")
    sonarr_url       = env("SONARR_URL", DEFAULT_SONARR_URL) if env("SONARR_API_KEY") else ""
    sonarr_api_key   = env("SONARR_API_KEY")
    radarr_url       = env("RADARR_URL", DEFAULT_RADARR_URL) if env("RADARR_API_KEY") else ""
    radarr_api_key   = env("RADARR_API_KEY")
    timeout_sec      = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run          = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    # Build the patch dict — only fields we have inputs for. Empty ones
    # are omitted so we don't clobber user-set values via merge.
    patch: dict[str, Any] = {}
    if plex_token:
        # Pulsarr's plexTokens is a JSON array of plex.tv user tokens.
        # We pass a single-element list with the captured token; users
        # who manage multiple plex.tv accounts can extend via Pulsarr's
        # UI later.
        patch["plexTokens"] = [plex_token]
    if sonarr_url and sonarr_api_key:
        patch["sonarrBaseUrl"] = sonarr_url
        patch["sonarrApiKey"]  = sonarr_api_key
    if radarr_url and radarr_api_key:
        patch["radarrBaseUrl"] = radarr_url
        patch["radarrApiKey"]  = radarr_api_key

    if not patch:
        log.info(
            "No services to wire (PLEX_TOKEN/SONARR_API_KEY/RADARR_API_KEY "
            "all unset). Pulsarr will boot with its default placeholders; "
            "users can wire connections via Pulsarr's UI at %s.",
            pulsarr_url,
        )
        return 0

    log.info(
        "Plan: pulsarr=%s plex_token=%s sonarr=%s radarr=%s",
        pulsarr_url,
        "(set)" if plex_token else "(not set)",
        sonarr_url or "(not enabled)",
        radarr_url or "(not enabled)",
    )

    # Step 1: wait for Pulsarr + fetch current config.
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/v1/config for readiness", pulsarr_url)
        current: dict = {}
    else:
        current = wait_for_pulsarr(pulsarr_url, timeout_sec)

    # Step 2: idempotency — skip the PUT when the patched fields all
    # already match. Avoids unnecessary writes on re-runs and keeps the
    # log quiet.
    needs_update = False
    for k, v in patch.items():
        if current.get(k) != v:
            needs_update = True
            break
    if not needs_update and not dry_run:
        log.info("Pulsarr config already matches the requested patch — "
                 "nothing to update")
        return 0

    # Step 3: merge + PUT. Start from current so we don't drop fields
    # the user set via Pulsarr's UI; overlay our patch on top.
    merged = {**current, **patch}

    if dry_run:
        log.info("[DRY RUN] Would PUT /api/v1/config with patch keys: %s",
                 sorted(patch.keys()))
        return 0

    log.info("PUT /api/v1/config (updating %s)", sorted(patch.keys()))
    status, body = put_pulsarr_config(pulsarr_url, merged)
    if status not in (200, 201, 204):
        log.error("PUT /api/v1/config failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    log.info("Pulsarr config saved")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
