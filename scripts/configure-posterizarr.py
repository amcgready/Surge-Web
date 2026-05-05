#!/usr/bin/env python3
"""
configure-posterizarr.py — Surge post-deploy automation for Posterizarr.

Posterizarr (https://github.com/fscorrupt/Posterizarr) is a PowerShell-
based poster automation tool that runs on a schedule (no web UI, no
HTTP API for config). Its single configuration interface is
/config/config.json, which it reads at the start of each scheduled
pass. This script generates that file from env vars after Plex's
fetchScript has captured the X-Plex-Token, then writes it atomically.

Same pattern as configure-kometa.py.

Schema caveats
==============
Posterizarr's config.json has a deeply nested schema with many sections
(ApiPart, PlexPart, JellyfinPart, EmbyPart, OverlayPart, etc.). Surge
seeds only the integration fields it knows about (Plex URL+token, TMDB
+ FanArt + TVDB API keys) and leaves everything else at Posterizarr's
own defaults.

The exact field names below match the upstream config.example.json's
common pattern (verified against the tool's documented schema as of
Posterizarr v1.9.x). If a future upstream release renames a field,
Posterizarr will silently fall back to its hardcoded defaults for the
missing entries — the user can re-run with an updated script or edit
config.json by hand.

Steps:
  1. Validate PLEX_TOKEN is present (Posterizarr's whole purpose is
     poster generation against a Plex library; without a token,
     there's nothing for it to do).
  2. Build a minimal config.json with our known integration fields.
  3. Write atomically to KOMETA_CONFIG_PATH-style POSTERIZARR_CONFIG_PATH.
  4. Log warnings for any optional API keys we don't have — most are
     genuinely optional but the user might want to know.

Environment:
  POSTERIZARR_CONFIG_PATH  Host path where config.json should land.
                           Required (orchestrator resolves
                           configRoot/posterizarr/config.json).

  PLEX_URL                 Default: http://localhost:32400.
  PLEX_TOKEN               X-Plex-Token from fetch-plex-secrets.py.
                           Required. When empty (user picked Jellyfin
                           or Emby), the script exits 0 with a "skip"
                           log line — Posterizarr is Plex-first.

  TMDB_API_KEY             From the External APIs step. Recommended;
                           drives the bulk of Posterizarr's metadata.
  FANART_API_KEY           Optional. Improves poster quality.
  TVDB_API_KEY             Optional. TV-side metadata fallback.

  DRY_RUN                  "1"/"true": log only.

Exit codes:
  0  Success, including the "no Plex to wire" graceful skip.
  3  File write failed.
  6  Required env var missing.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
from typing import Optional


logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-posterizarr")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return v or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


def write_atomic(path: str, content: str) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8",
        dir=parent, prefix=".posterizarr-", suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    os.replace(tmp_path, path)


def main() -> int:
    config_path     = env("POSTERIZARR_CONFIG_PATH", required=True)
    plex_url        = env("PLEX_URL", "http://localhost:32400")
    plex_token      = env("PLEX_TOKEN")
    tmdb_api_key    = env("TMDB_API_KEY")
    fanart_api_key  = env("FANART_API_KEY")
    tvdb_api_key    = env("TVDB_API_KEY")
    dry_run         = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no file will be written")

    # Posterizarr is Plex-only — without a token, its scheduled runs do
    # nothing. Skip seeding rather than write an unusable config file.
    if not plex_token:
        log.info(
            "PLEX_TOKEN not set — Plex isn't part of this deploy. Posterizarr "
            "is Plex-only; skipping config.json seed. Posterizarr will boot "
            "but its scheduled passes will fail until config.json is "
            "provided manually.",
        )
        return 0

    if not tmdb_api_key:
        log.warning(
            "TMDB_API_KEY not set — Posterizarr's metadata lookups will "
            "fail until the user fills in the External APIs step.",
        )

    log.info(
        "Plan: posterizarr_config=%s plex=%s tmdb=%s fanart=%s tvdb=%s",
        config_path, plex_url,
        "(set)" if tmdb_api_key else "(not set)",
        "(set)" if fanart_api_key else "(not set)",
        "(set)" if tvdb_api_key else "(not set)",
    )

    # Build the config tree. Top-level structure follows Posterizarr's
    # config.example.json (ApiPart / PlexPart / etc.). We seed only the
    # fields we have inputs for; everything else stays at Posterizarr's
    # internal defaults.
    config = {
        "ApiPart": {
            "tvdbapi":         tvdb_api_key,
            "tmdbtoken":       tmdb_api_key,
            "FanartTvAPIKey":  fanart_api_key,
            "PlexToken":       plex_token,
            "FavProvider":     "tmdb",
            "tmdbvote_count":  3,
            "PreferredLanguageOrder":       "xx,en",
            "PreferredSeasonLanguageOrder": "xx,en",
        },
        "PlexPart": {
            "LibstoExclude": [],
            "PlexUrl":       plex_url,
            "UsePlex":       True,
        },
        "JellyfinPart": {
            "UseJellyfin": False,
        },
        "EmbyPart": {
            "UseEmby": False,
        },
    }

    content = json.dumps(config, indent=2) + "\n"

    if dry_run:
        log.info("[DRY RUN] Would write %d bytes to %s",
                 len(content), config_path)
        return 0

    try:
        write_atomic(config_path, content)
    except OSError as e:
        log.error("Failed to write %s: %s", config_path, e)
        sys.exit(3)

    log.info("Wrote Posterizarr config.json to %s (%d bytes)",
             config_path, len(content))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
