#!/usr/bin/env python3
"""
fetch-emby-secrets.py — Surge runtime-fetch script for Emby.

Sibling of fetch-jellyfin-secrets.py. The flow is identical (Jellyfin
forked from Emby 3.5 so the API shapes match), with two adjustments:

  - All API endpoints are prefixed /emby/ rather than living at the
    server root (e.g. /emby/Users/AuthenticateByName).
  - The auth header convention is the same MediaBrowser-style
    X-Emby-Authorization for unauthenticated calls. After login,
    Emby accepts both the long-form `Authorization: MediaBrowser
    Token="..."` and the short-form `X-Emby-Token: ...` — we use the
    short-form on token-authenticated calls because it's simpler.

Steps:
  1. Polls /emby/System/Info/Public until Emby is reachable.
  2. Inspects StartupWizardCompleted in the response. If false:
       - POST /emby/Startup/Configuration (locale defaults)
       - POST /emby/Startup/User (admin: username + password)
       - POST /emby/Startup/RemoteAccess (defaults)
       - POST /emby/Startup/Complete (finalize)
  3. Authenticates via POST /emby/Users/AuthenticateByName.
  4. Looks for an existing Surge API key, creates one if missing,
     reads it back via GET /emby/Auth/Keys.
  5. Emits {"apiKey": "...", "userId": "..."} on stdout.

Idempotent on re-runs (same as Jellyfin).

Environment:
  EMBY_URL        Base URL (default: http://localhost:8096).
  EMBY_USERNAME   Admin username (default: admin).
  EMBY_PASSWORD   Admin password — Surge-persisted secret. Required.
  WAIT_TIMEOUT_SEC  Max seconds (default: 120).
  DRY_RUN         "1"/"true": emit fake values, exit 0.

Exit codes:
  0  Success.
  2  Emby unreachable past WAIT_TIMEOUT_SEC.
  3  An API call failed.
  6  Required environment variable missing.
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


DEFAULT_EMBY_URL = "http://localhost:8096"
DEFAULT_USERNAME = "admin"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

# Identity Surge presents to Emby. AppName="Surge" is also how we tag
# the issued API key, so future runs find and reuse it.
APP_NAME = "Surge"
APP_VERSION = "1.0.0"
DEVICE_ID = "surge-fetch-script"

# Emby's API endpoints all live under /emby/.
API_ROOT = "/emby"

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    stream=sys.stderr,
)
log = logging.getLogger("fetch-emby-secrets")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return value or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------

def emby_client_header() -> str:
    """X-Emby-Authorization for client-identity / unauthenticated calls."""
    return (
        f'MediaBrowser Client="{APP_NAME}", '
        f'Device="{APP_NAME}", '
        f'DeviceId="{DEVICE_ID}", '
        f'Version="{APP_VERSION}"'
    )


def http_request(
    method: str,
    base_url: str,
    api_path: str,
    *,
    access_token: Optional[str] = None,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """All Emby API calls go through here. api_path is appended to
    /emby (e.g. '/Users/AuthenticateByName' becomes
    '/emby/Users/AuthenticateByName')."""
    url = f"{base_url.rstrip('/')}{API_ROOT}{api_path}"
    headers = {
        "Accept": "application/json",
        "X-Emby-Authorization": emby_client_header(),
    }
    if access_token:
        # Emby accepts the short-form X-Emby-Token alongside the
        # client header — simpler than constructing
        # Authorization: MediaBrowser Token="..."
        headers["X-Emby-Token"] = access_token
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
# Setup wizard flow
# ---------------------------------------------------------------------

def wait_for_emby(base_url: str, timeout_sec: int) -> dict:
    """Poll /emby/System/Info/Public until Emby responds. Returns the
    parsed response (which carries StartupWizardCompleted)."""
    deadline = time.monotonic() + timeout_sec
    last_err: Optional[str] = None

    log.info("Waiting for Emby at %s (timeout: %ds)", base_url, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = http_request("GET", base_url, "/System/Info/Public")
            if status == 200:
                log.info("Emby reachable after %d attempt(s)", attempts)
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return {}
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Emby did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def run_setup_wizard(base_url: str, username: str, password: str) -> None:
    """Walk Emby's first-run wizard programmatically. Once Complete is
    POSTed, subsequent calls 403."""
    log.info("Running Emby first-run setup wizard")

    status, body = http_request(
        "POST", base_url, "/Startup/Configuration",
        json_body={
            "UICulture": "en-US",
            "MetadataCountryCode": "US",
            "PreferredMetadataLanguage": "en",
        },
    )
    if status not in (200, 204):
        log.error("Startup/Configuration failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    status, body = http_request(
        "POST", base_url, "/Startup/User",
        json_body={"Name": username, "Password": password},
    )
    if status not in (200, 204):
        log.error("Startup/User failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    status, body = http_request(
        "POST", base_url, "/Startup/RemoteAccess",
        json_body={"EnableRemoteAccess": True, "EnableAutomaticPortMapping": False},
    )
    if status not in (200, 204):
        log.warning("Startup/RemoteAccess returned HTTP %d (non-fatal): %s",
                    status, body[:200].decode("utf-8", errors="replace"))

    status, body = http_request("POST", base_url, "/Startup/Complete")
    if status not in (200, 204):
        log.warning("Startup/Complete returned HTTP %d (non-fatal): %s",
                    status, body[:200].decode("utf-8", errors="replace"))

    log.info("Setup wizard completed")


def authenticate(base_url: str, username: str, password: str) -> tuple[str, str]:
    """Authenticate, return (accessToken, userId)."""
    log.info("Authenticating as %s", username)
    status, body = http_request(
        "POST", base_url, "/Users/AuthenticateByName",
        json_body={"Username": username, "Pw": password},
    )
    if status != 200:
        log.error("Authentication failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        log.error("AuthenticateByName response was not JSON: %r", body[:300])
        sys.exit(3)

    access_token = parsed.get("AccessToken")
    user_id = (parsed.get("User") or {}).get("Id")
    if not access_token or not user_id:
        log.error(
            "AuthenticateByName response missing fields: AccessToken=%s userId=%s",
            bool(access_token), bool(user_id),
        )
        sys.exit(3)
    return access_token, user_id


def get_or_create_api_key(base_url: str, access_token: str) -> str:
    """Find or create a Surge-tagged API key. Idempotent on re-runs."""
    existing = _list_api_keys(base_url, access_token)
    for key in existing:
        if key.get("AppName") == APP_NAME:
            log.info("Reusing existing %s API key", APP_NAME)
            return key["AccessToken"]

    log.info("Creating new %s API key", APP_NAME)
    # POST /emby/Auth/Keys?App=<name> — App is a query param.
    status, body = http_request(
        "POST", base_url, f"/Auth/Keys?App={APP_NAME}",
        access_token=access_token,
    )
    if status not in (200, 204):
        log.error("POST /Auth/Keys failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    refreshed = _list_api_keys(base_url, access_token)
    for key in refreshed:
        if key.get("AppName") == APP_NAME:
            return key["AccessToken"]

    log.error("Created %s API key but couldn't retrieve it via GET /Auth/Keys",
              APP_NAME)
    sys.exit(3)


def _list_api_keys(base_url: str, access_token: str) -> list:
    """GET /emby/Auth/Keys → list of {AccessToken, AppName, DateCreated}."""
    status, body = http_request("GET", base_url, "/Auth/Keys", access_token=access_token)
    if status != 200:
        log.error("GET /Auth/Keys failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        log.error("/Auth/Keys response was not JSON: %r", body[:200])
        sys.exit(3)
    items = parsed.get("Items") if isinstance(parsed, dict) else parsed
    return items if isinstance(items, list) else []


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    base_url = env("EMBY_URL", DEFAULT_EMBY_URL)
    username = env("EMBY_USERNAME", DEFAULT_USERNAME)
    password = env("EMBY_PASSWORD", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — emitting fake values without HTTP calls")
        json.dump(
            {"apiKey": "DRY_RUN_FAKE_EMBY_API_KEY", "userId": "DRY_RUN_FAKE_USER_ID"},
            sys.stdout,
        )
        sys.stdout.write("\n")
        return 0

    public_info = wait_for_emby(base_url, timeout_sec)

    if not public_info.get("StartupWizardCompleted", True):
        run_setup_wizard(base_url, username, password)
    else:
        log.info("Emby setup wizard already complete; skipping")

    access_token, user_id = authenticate(base_url, username, password)
    log.info("Authenticated; userId=%s", user_id)

    api_key = get_or_create_api_key(base_url, access_token)

    json.dump({"apiKey": api_key, "userId": user_id}, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
