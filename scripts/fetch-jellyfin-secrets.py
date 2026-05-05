#!/usr/bin/env python3
"""
fetch-jellyfin-secrets.py — Surge runtime-fetch script for Jellyfin.

Jellyfin has no env-var or config-file bootstrap — admin user creation
goes through the first-run wizard, and API keys are issued from the
admin dashboard. So unlike services where Surge can pre-seed credentials
in a config file at deploy time (Sonarr/Radarr/Tautulli/Prowlarr), this
fetchScript runs after Jellyfin's container is up and orchestrates the
entire setup flow programmatically. The script automates that whole sequence:

  1. Polls /System/Info/Public until Jellyfin is reachable.
  2. Inspects StartupWizardCompleted in the response. If false:
       - POST /Startup/Configuration (locale defaults)
       - POST /Startup/User (create admin: username + password)
       - POST /Startup/RemoteAccess (default settings)
       - POST /Startup/Complete (finalize)
  3. Authenticates via POST /Users/AuthenticateByName, captures the
     AccessToken and User.Id.
  4. Looks for an existing API key tagged AppName="Surge" via
     GET /Auth/Keys; creates one via POST /Auth/Keys?App=Surge if
     missing, then GET /Auth/Keys again to read the issued key value
     (POST doesn't return it directly).
  5. Emits {"apiKey": "...", "userId": "..."} on stdout for the backend
     to capture.

Idempotent on re-runs:
  - If the wizard is already complete, step 2 is skipped.
  - If the Surge API key already exists, step 4 returns it instead of
    creating a duplicate.
  - The same admin password is expected on every run (Surge persists
    it as a secret); if the user manually changed it in Jellyfin's UI,
    the script will fail at step 3 — they'd need to update Surge's
    persisted secret to match.

NOTE on integration status:
  Episeerr's compose template references this fetcher via:
    JELLYFIN_API_KEY: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'apiKey' }
    JELLYFIN_USER_ID: { whenMediaServer: 'jellyfin', fromService: 'jellyfin', field: 'userId' }
  But Jellyfin itself isn't yet wired as a deployable service in
  serviceMeta — the media-server choice (Plex/Jellyfin/Emby) lives on
  the wizard's Media Server step, not Additional Services. When the
  media-server deployment flow gets built, that compose template will
  declare:
    compose.secrets.adminPassword: { generate: 'random', length: 32 }
    compose.fetchScript: { path: 'scripts/fetch-jellyfin-secrets.py' }
  The script is ready ahead of that wire-up.

Auth header conventions:
  Jellyfin uses two auth headers depending on context:
    Unauthenticated calls / setup wizard:
      X-Emby-Authorization: MediaBrowser Client="Surge", Device="Surge",
                            DeviceId="...", Version="1.0.0"
    Token-authenticated calls (after /Users/AuthenticateByName):
      Authorization: MediaBrowser Token="<accessToken>"
  Both are required together for some endpoints (X-Emby-Authorization
  for client identity, Authorization for the token).

Environment:
  JELLYFIN_URL        Base URL (default: http://localhost:8096).
  JELLYFIN_USERNAME   Admin username (default: admin).
  JELLYFIN_PASSWORD   Admin password — Surge-persisted secret. Required.
  WAIT_TIMEOUT_SEC    Max seconds to wait for Jellyfin (default: 120).
  DRY_RUN             "1"/"true": emit fake values, exit 0.

Exit codes:
  0  Success — JSON written to stdout.
  2  Jellyfin unreachable past WAIT_TIMEOUT_SEC.
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


DEFAULT_JELLYFIN_URL = "http://localhost:8096"
DEFAULT_USERNAME = "admin"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 15

# Identity Surge presents to Jellyfin. AppName="Surge" is also how we
# tag the issued API key, so future runs can find and reuse it instead
# of creating duplicates.
APP_NAME = "Surge"
APP_VERSION = "1.0.0"
DEVICE_ID = "surge-fetch-script"

# Logging on stderr keeps stdout clean for the JSON payload.
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    stream=sys.stderr,
)
log = logging.getLogger("fetch-jellyfin-secrets")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return value or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------

def jellyfin_client_header() -> str:
    """X-Emby-Authorization for unauthenticated / client-identity calls."""
    return (
        f'MediaBrowser Client="{APP_NAME}", '
        f'Device="{APP_NAME}", '
        f'DeviceId="{DEVICE_ID}", '
        f'Version="{APP_VERSION}"'
    )


def jellyfin_token_header(access_token: str) -> str:
    """Authorization header for token-authenticated calls."""
    return f'MediaBrowser Token="{access_token}"'


def http_request(
    method: str,
    url: str,
    *,
    access_token: Optional[str] = None,
    json_body: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """Single point for all HTTP calls. Always sends X-Emby-Authorization
    (Jellyfin requires client identity even on unauthenticated calls).
    Adds the bearer-style Authorization header when access_token is set."""
    headers = {
        "Accept": "application/json",
        "X-Emby-Authorization": jellyfin_client_header(),
    }
    if access_token:
        headers["Authorization"] = jellyfin_token_header(access_token)
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

def wait_for_jellyfin(base_url: str, timeout_sec: int) -> dict:
    """
    Poll /System/Info/Public until Jellyfin responds. Returns the parsed
    response (which carries StartupWizardCompleted that step 2 reads).
    """
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/System/Info/Public"
    last_err: Optional[str] = None

    log.info("Waiting for Jellyfin at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = http_request("GET", probe)
            if status == 200:
                log.info("Jellyfin reachable after %d attempt(s)", attempts)
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return {}
            last_err = f"HTTP {status}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error("Jellyfin did not respond within %ds (last: %s)", timeout_sec, last_err)
    sys.exit(2)


def run_setup_wizard(base_url: str, username: str, password: str) -> None:
    """
    Walk Jellyfin's first-run wizard programmatically. Endpoints are only
    accessible while StartupWizardCompleted is false; once Complete is
    POSTed, subsequent calls 403.
    """
    log.info("Running Jellyfin first-run setup wizard")

    # 1. Locale and metadata defaults — required step in the wizard.
    status, body = http_request(
        "POST",
        f"{base_url.rstrip('/')}/Startup/Configuration",
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

    # 2. Create the admin user. Surge persists the password as a secret
    #    and passes the same value on every fetch run.
    status, body = http_request(
        "POST",
        f"{base_url.rstrip('/')}/Startup/User",
        json_body={"Name": username, "Password": password},
    )
    if status not in (200, 204):
        log.error("Startup/User failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    # 3. Remote access — leave at sensible defaults. Non-fatal if the
    #    endpoint behaves differently across Jellyfin versions; we can
    #    proceed without this.
    status, body = http_request(
        "POST",
        f"{base_url.rstrip('/')}/Startup/RemoteAccess",
        json_body={"EnableRemoteAccess": True, "EnableAutomaticPortMapping": False},
    )
    if status not in (200, 204):
        log.warning("Startup/RemoteAccess returned HTTP %d (non-fatal): %s",
                    status, body[:200].decode("utf-8", errors="replace"))

    # 4. Finalize. After this call, StartupWizardCompleted flips to true.
    status, body = http_request(
        "POST", f"{base_url.rstrip('/')}/Startup/Complete"
    )
    if status not in (200, 204):
        log.warning("Startup/Complete returned HTTP %d (non-fatal): %s",
                    status, body[:200].decode("utf-8", errors="replace"))

    log.info("Setup wizard completed")


def authenticate(base_url: str, username: str, password: str) -> tuple[str, str]:
    """
    Authenticate with admin credentials, return (accessToken, userId).
    Used after the setup wizard to authorize API-key creation.
    """
    log.info("Authenticating as %s", username)
    status, body = http_request(
        "POST",
        f"{base_url.rstrip('/')}/Users/AuthenticateByName",
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
    """
    Find an existing API key whose AppName == APP_NAME, or create one
    and read it back. Idempotent on re-runs.
    """
    keys_url = f"{base_url.rstrip('/')}/Auth/Keys"

    # First pass: maybe a previous Surge run already issued a key.
    existing = _list_api_keys(keys_url, access_token)
    for key in existing:
        if key.get("AppName") == APP_NAME:
            log.info("Reusing existing %s API key", APP_NAME)
            return key["AccessToken"]

    # Otherwise create one. POST /Auth/Keys?App=<name> — note the App
    # is a query param, not a JSON field.
    log.info("Creating new %s API key", APP_NAME)
    create_url = f"{keys_url}?App={APP_NAME}"
    status, body = http_request("POST", create_url, access_token=access_token)
    if status not in (200, 204):
        log.error("POST /Auth/Keys failed: HTTP %d body=%s",
                  status, body[:300].decode("utf-8", errors="replace"))
        sys.exit(3)

    # POST doesn't return the key; read it back via GET.
    refreshed = _list_api_keys(keys_url, access_token)
    for key in refreshed:
        if key.get("AppName") == APP_NAME:
            return key["AccessToken"]

    log.error("Created %s API key but couldn't retrieve it via GET /Auth/Keys",
              APP_NAME)
    sys.exit(3)


def _list_api_keys(keys_url: str, access_token: str) -> list:
    """GET /Auth/Keys → list of {AccessToken, AppName, DateCreated}."""
    status, body = http_request("GET", keys_url, access_token=access_token)
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
    base_url = env("JELLYFIN_URL", DEFAULT_JELLYFIN_URL)
    username = env("JELLYFIN_USERNAME", DEFAULT_USERNAME)
    password = env("JELLYFIN_PASSWORD", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — emitting fake values without any HTTP calls")
        json.dump(
            {"apiKey": "DRY_RUN_FAKE_JELLYFIN_API_KEY", "userId": "DRY_RUN_FAKE_USER_ID"},
            sys.stdout,
        )
        sys.stdout.write("\n")
        return 0

    public_info = wait_for_jellyfin(base_url, timeout_sec)

    # `/System/Info/Public` returns StartupWizardCompleted: bool —
    # whether the first-run flow has been completed. False on a fresh
    # install; True on every subsequent boot.
    if not public_info.get("StartupWizardCompleted", True):
        run_setup_wizard(base_url, username, password)
    else:
        log.info("Jellyfin setup wizard already complete; skipping")

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
