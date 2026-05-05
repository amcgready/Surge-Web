#!/usr/bin/env python3
"""
fetch-plex-secrets.py — Surge runtime-fetch script for Plex.

Plex's authentication token (X-Plex-Token) is generated when the server
claims itself against plex.tv on first launch. The claim flow uses the
PLEX_CLAIM env var (a one-time, ~4-minute token from
https://www.plex.tv/claim) — once exchanged, plex.tv returns a
long-lived token that the server stores as the PlexOnlineToken
attribute on the <Preferences/> root of Preferences.xml.

This script polls Preferences.xml on the host bind mount and emits the
token once it's populated. Pairs with configure-plex.py (the
postDeployScript) which uses the token to create libraries.

The Preferences.xml file lives at a path with spaces:
  <CONFIG_PATH>/Library/Application Support/Plex Media Server/Preferences.xml

Stdout (success):
  {"plexToken": "1A2b3c4D5e6F..."}

Failure modes worth logging clearly:
  - File never appears: container hasn't created its config tree yet.
  - File appears but PlexOnlineToken is missing/empty: the claim flow
    failed. Most common cause: PLEX_CLAIM was empty (user skipped) OR
    the user's PLEX_CLAIM expired before Plex got to use it (4-minute
    window). Surface that in the timeout error.

Environment:
  CONFIG_PATH         Resolved configRoot/<service> for plex (the host
                      directory bind-mounted at /config inside the
                      container). Required. Surge sets automatically.
  WAIT_TIMEOUT_SEC    Max seconds to wait (default: 180 — Plex first
                      run + claim handshake takes longer than Tautulli).
  DRY_RUN             "1"/"true": emit fake key, exit 0.

Exit codes:
  0  Success.
  2  Token didn't materialize within WAIT_TIMEOUT_SEC (likely
     PLEX_CLAIM was empty or expired).
  3  Preferences.xml exists but is malformed.
  6  Required environment variable missing.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import xml.etree.ElementTree as ET
from typing import Optional


DEFAULT_TIMEOUT_SEC = 180  # Plex's first-run + claim handshake is slower.
POLL_INTERVAL_SEC = 3

# Path inside <CONFIG_PATH> where Plex stores Preferences.xml.
PREFS_RELATIVE_PATH = (
    "Library/Application Support/Plex Media Server/Preferences.xml"
)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    stream=sys.stderr,
)
log = logging.getLogger("fetch-plex-secrets")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return value or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


def read_plex_token(prefs_path: str) -> Optional[str]:
    """
    Parse Preferences.xml and return the PlexOnlineToken attribute, or
    None if the file/attribute isn't ready yet.

    Plex's Preferences.xml is a single element with all settings as
    attributes:
      <?xml version="1.0" encoding="utf-8"?>
      <Preferences MachineIdentifier="..." PlexOnlineToken="xxx" .../>
    """
    if not os.path.isfile(prefs_path):
        return None  # Plex still starting up, file not written yet.

    try:
        tree = ET.parse(prefs_path)
    except ET.ParseError as e:
        # File exists but is malformed (or being written mid-poll).
        # Treat as transient on poll; if we hit timeout the caller
        # surfaces the error.
        log.debug("Preferences.xml parse failed (transient?): %s", e)
        return None
    except OSError as e:
        log.debug("Preferences.xml read failed (transient?): %s", e)
        return None

    root = tree.getroot()
    if root.tag != "Preferences":
        log.error(
            "Preferences.xml root element is %r, expected 'Preferences'",
            root.tag,
        )
        sys.exit(3)

    token = root.get("PlexOnlineToken", "").strip()
    return token or None


def main() -> int:
    config_path = env("CONFIG_PATH", required=True)
    timeout_sec = int(env("WAIT_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
    dry_run = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — emitting fake plexToken")
        json.dump({"plexToken": "DRY_RUN_FAKE_PLEX_TOKEN"}, sys.stdout)
        sys.stdout.write("\n")
        return 0

    prefs_path = os.path.join(config_path, PREFS_RELATIVE_PATH)
    log.info(
        "Polling %s for PlexOnlineToken (timeout: %ds)",
        prefs_path,
        timeout_sec,
    )

    deadline = time.monotonic() + timeout_sec
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        token = read_plex_token(prefs_path)
        if token:
            log.info("PlexOnlineToken found after %d attempt(s)", attempts)
            json.dump({"plexToken": token}, sys.stdout)
            sys.stdout.write("\n")
            return 0
        time.sleep(POLL_INTERVAL_SEC)

    # Timeout. Diagnose: did the file appear at all? Helps the user
    # know whether Plex is stuck claiming or just hasn't started.
    if os.path.isfile(prefs_path):
        log.error(
            "Preferences.xml exists but PlexOnlineToken is still empty "
            "after %ds. Most likely the PLEX_CLAIM token was missing or "
            "expired before Plex could use it (claims expire 4 minutes "
            "after generation). Get a fresh token at "
            "https://www.plex.tv/claim and redeploy.",
            timeout_sec,
        )
    else:
        log.error(
            "Preferences.xml never appeared at %s within %ds. Plex's "
            "container may have failed to start — check `docker logs plex`.",
            prefs_path,
            timeout_sec,
        )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
