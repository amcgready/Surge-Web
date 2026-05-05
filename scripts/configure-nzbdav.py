#!/usr/bin/env python3
"""
configure-nzbdav.py — Surge post-deploy automation for NzbDAV.

Runs after the `nzbdav` sub-container is up but before the `nzbdav-rclone`
sibling. NzbDAV stores credentials in db.sqlite from its first-run UI
(no env-var bootstrap), so this script automates the equivalent of the
user clicking through that wizard:

  1. Polls NzbDAV's /api/is-onboarding until it responds (the container
     needs a few seconds after `docker compose up` before its listener
     is reachable).
  2. POSTs /api/create-account (form-encoded) to create the admin
     account using the password Surge generated for the
     `webdavPassword` secret.
  3. Runs `rclone obscure` (via the official rclone Docker image) to
     encode the password — rclone.conf wants the obscured form, not
     the plain one.
  4. Writes rclone.conf to the path the rclone sub-container will mount
     at /config/rclone/rclone.conf.

Once this script exits 0, Surge releases the `blocks` list on the
nzbdav entry's `compose.postDeployScript` and brings up nzbdav-rclone.

The script is reverse-engineered from nzbdav-dev/nzbdav backend source
(commit as of 2026-05). Endpoints used:
  GET  /api/is-onboarding   -> { Onboarding: bool, ... } (probe)
  POST /api/create-account  -> { Status: bool }
                                form-encoded fields:
                                  username, password, type
  POST /api/authenticate    -> verification probe (non-fatal)

If NzbDAV ever changes those endpoints, this script breaks loudly with
a non-zero exit and clear log output — Surge surfaces the failure to
the user rather than silently leaving rclone broken.

Environment (set by Surge's backend at invocation time):
  NZBDAV_URL          NzbDAV base URL (default: http://nzbdav:3000).
                      Backend should pass the URL reachable from
                      whatever network the script runs on; under
                      compose-bridge that's http://nzbdav:3000.
  NZBDAV_API_KEY      Value of the `frontendBackendApiKey` secret.
                      Sent on every request as the X-Api-Key header.
                      Must match the FRONTEND_BACKEND_API_KEY env var
                      that the nzbdav container was started with.
                      Required.
  NZBDAV_USERNAME     Admin/WebDAV username (default: admin).
  NZBDAV_PASSWORD     Plain password — value of the `webdavPassword`
                      secret. Required.
  RCLONE_CONF_PATH    Output path for rclone.conf (e.g.
                      /mnt/user/appdata/nzbdav/rclone.conf). Required.
  RCLONE_REMOTE_NAME  Remote name to declare (default: nzbdav).
  RCLONE_REMOTE_URL   URL the remote should connect to (default:
                      http://nzbdav:3000 — the in-bridge name).
  WAIT_TIMEOUT_SEC    Max seconds to wait for nzbdav to respond
                      (default: 120).
  RCLONE_IMAGE        rclone Docker image to invoke for obscure
                      (default: rclone/rclone:latest).
  DRY_RUN             If set to "1" or "true", skip mutating actions
                      (POSTs, file writes) and log what would happen.

Exit codes:
  0  Success — admin account created, rclone.conf written.
  2  NzbDAV unreachable past WAIT_TIMEOUT_SEC.
  3  /api/create-account returned non-success.
  4  `rclone obscure` invocation failed.
  5  Failed to write rclone.conf.
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
# Config & logging
# ---------------------------------------------------------------------

DEFAULT_NZBDAV_URL = "http://nzbdav:3000"
DEFAULT_USERNAME = "admin"
DEFAULT_REMOTE_NAME = "nzbdav"
DEFAULT_REMOTE_URL = "http://nzbdav:3000"
DEFAULT_RCLONE_IMAGE = "rclone/rclone:latest"
DEFAULT_TIMEOUT_SEC = 120
POLL_INTERVAL_SEC = 2
HTTP_TIMEOUT_SEC = 10

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-nzbdav")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    """Read an environment variable, with optional default and required-flag."""
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return value or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# NzbDAV API client
# ---------------------------------------------------------------------

def _request(
    method: str,
    url: str,
    *,
    api_key: Optional[str] = None,
    form_data: Optional[dict] = None,
    timeout: int = HTTP_TIMEOUT_SEC,
) -> tuple[int, bytes]:
    """
    Make an HTTP request, return (status_code, body_bytes). Raises
    urllib.error.URLError if the connection fails entirely.
    """
    headers = {"Accept": "application/json"}
    if api_key:
        # NzbDAV's BaseApiController auth check reads X-Api-Key first,
        # then falls back to ?apikey= or apikey form field. We use the
        # header form — most explicit, doesn't pollute query/form.
        headers["X-Api-Key"] = api_key
    body: Optional[bytes] = None
    if form_data is not None:
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        # Surface non-2xx as (status, body) for callers to decide on.
        return e.code, (e.read() or b"")


def wait_for_nzbdav(base_url: str, api_key: str, timeout_sec: int) -> None:
    """
    Poll POST /api/is-onboarding until it responds 200 (or until timeout).
    Used as the readiness probe — NzbDAV's listener takes a few seconds
    after container startup before it accepts requests. NzbDAV's endpoints
    require POST with a form body even when the body is empty, so we send
    an empty form.
    """
    deadline = time.monotonic() + timeout_sec
    probe = f"{base_url.rstrip('/')}/api/is-onboarding"
    last_err: Optional[str] = None

    log.info("Waiting for NzbDAV at %s (timeout: %ds)", probe, timeout_sec)
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        try:
            status, body = _request("POST", probe, api_key=api_key, form_data={})
            if status == 200:
                log.info("NzbDAV reachable after %d attempt(s)", attempts)
                try:
                    parsed = json.loads(body)
                    log.debug("is-onboarding response: %s", parsed)
                except json.JSONDecodeError:
                    log.debug("is-onboarding response was not JSON: %r", body[:200])
                return
            last_err = f"HTTP {status} body={body[:200]!r}"
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(POLL_INTERVAL_SEC)

    log.error(
        "NzbDAV did not respond within %ds (last error: %s)",
        timeout_sec,
        last_err,
    )
    sys.exit(2)


def create_account(
    base_url: str,
    api_key: str,
    username: str,
    password: str,
    account_type: str = "Admin",
    *,
    dry_run: bool = False,
) -> None:
    """
    Create an account via POST /api/create-account (form-encoded).

    Reverse-engineered from CreateAccountRequest.cs:
        Username = context.Request.Form["username"].FirstOrDefault()?.ToLower()
        Password = context.Request.Form["password"].FirstOrDefault()
        Type     = Enum.TryParse<Account.AccountType>(form["type"], ignoreCase: true, ...)

    Server lowercases the username, parses `type` case-insensitively.

    If NzbDAV ever splits Admin and WebDAV into two account types and
    the WebDAV listener stops accepting Admin credentials, add a second
    create_account() call here for type='WebDav' (or whatever the enum
    name is — confirm against backend/Database/Models/Account.cs).
    """
    endpoint = f"{base_url.rstrip('/')}/api/create-account"
    form = {"username": username, "password": password, "type": account_type}

    if dry_run:
        log.info(
            "[DRY RUN] Would POST %s with username=%s type=%s "
            "(password redacted)",
            endpoint,
            username,
            account_type,
        )
        return

    log.info("Creating %s account '%s' via %s", account_type, username, endpoint)
    status, body = _request("POST", endpoint, api_key=api_key, form_data=form)
    if status != 200:
        log.error(
            "create-account returned HTTP %d: %s",
            status,
            body[:500].decode("utf-8", errors="replace"),
        )
        sys.exit(3)

    # Response shape: { Status: bool }
    try:
        parsed = json.loads(body)
        if not parsed.get("Status", False):
            log.error("create-account succeeded HTTP-wise but Status=false: %s", parsed)
            sys.exit(3)
    except json.JSONDecodeError:
        log.error("create-account response was not JSON: %r", body[:500])
        sys.exit(3)

    log.info("Account '%s' (%s) created successfully", username, account_type)


# ---------------------------------------------------------------------
# rclone obscure + conf writing
# ---------------------------------------------------------------------

def obscure_password(plain: str, image: str = DEFAULT_RCLONE_IMAGE) -> str:
    """
    Run `docker run --rm <image> obscure <plain>` and return the obscured
    string rclone.conf wants. Uses Docker rather than requiring the
    rclone binary on the host, since the rclone image is already pulled
    for the sibling container.
    """
    log.info("Computing obscured password via `%s obscure`", image)
    try:
        result = subprocess.run(
            ["docker", "run", "--rm", "-i", image, "obscure", plain],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        log.error("`rclone obscure` invocation failed: %s", e)
        if isinstance(e, subprocess.CalledProcessError) and e.stderr:
            log.error("stderr: %s", e.stderr.strip())
        sys.exit(4)

    obscured = result.stdout.strip()
    if not obscured:
        log.error("`rclone obscure` produced empty output")
        sys.exit(4)
    return obscured


def render_rclone_conf(
    *, remote_name: str, remote_url: str, username: str, obscured_password: str
) -> str:
    """Build the rclone.conf body. Exactly the format the rclone WebDAV
    backend expects."""
    return (
        f"[{remote_name}]\n"
        f"type = webdav\n"
        f"url = {remote_url}\n"
        f"vendor = other\n"
        f"user = {username}\n"
        f"pass = {obscured_password}\n"
    )


def write_rclone_conf(path: str, content: str, *, dry_run: bool = False) -> None:
    """Write rclone.conf atomically (write to .tmp, then rename)."""
    if dry_run:
        log.info("[DRY RUN] Would write rclone.conf to %s (%d bytes)", path, len(content))
        log.debug("Conf body:\n%s", content)
        return

    log.info("Writing rclone.conf to %s", path)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
        # rclone reads its conf with mode 0600 expectations on some setups;
        # set restrictive permissions before renaming into place.
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError as e:
        log.error("Failed to write %s: %s", path, e)
        sys.exit(5)
    log.info("rclone.conf written successfully")


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    base_url = env("NZBDAV_URL", DEFAULT_NZBDAV_URL)
    api_key = env("NZBDAV_API_KEY", required=True)
    username = env("NZBDAV_USERNAME", DEFAULT_USERNAME)
    password = env("NZBDAV_PASSWORD", required=True)
    rclone_conf_path = env("RCLONE_CONF_PATH", required=True)
    remote_name = env("RCLONE_REMOTE_NAME", DEFAULT_REMOTE_NAME)
    remote_url = env("RCLONE_REMOTE_URL", DEFAULT_REMOTE_URL)
    rclone_image = env("RCLONE_IMAGE", DEFAULT_RCLONE_IMAGE)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no mutating actions will be performed")

    log.info(
        "Configuration: NZBDAV_URL=%s username=%s rclone_conf=%s remote=%s remote_url=%s",
        base_url,
        username,
        rclone_conf_path,
        remote_name,
        remote_url,
    )

    # Step 1: wait for NzbDAV to be reachable (skipped in dry-run since
    # there's nothing to actually probe).
    if dry_run:
        log.info("[DRY RUN] Would poll %s/api/is-onboarding for readiness", base_url)
    else:
        wait_for_nzbdav(base_url, api_key, timeout_sec)

    # Step 2: create the admin account.
    # The single-account model matches the user's existing setup
    # (rclone.conf has user=admin, one password). If NzbDAV later
    # requires a separate WebDAV account type, add a second
    # create_account() call with type='WebDav' (case-insensitive).
    create_account(base_url, api_key, username, password, account_type="Admin", dry_run=dry_run)

    # Step 3: compute obscured password for rclone.conf
    obscured = obscure_password(password, image=rclone_image) if not dry_run else "<obscured>"

    # Step 4: write rclone.conf
    conf = render_rclone_conf(
        remote_name=remote_name,
        remote_url=remote_url,
        username=username,
        obscured_password=obscured,
    )
    write_rclone_conf(rclone_conf_path, conf, dry_run=dry_run)

    log.info("configure-nzbdav.py finished successfully")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
