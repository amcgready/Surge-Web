#!/usr/bin/env python3
"""
configure-kometa.py — Surge post-deploy automation for Kometa.

Kometa is a YAML-config driven CLI that runs on a schedule (no web
UI, no API) — its only configuration interface is /config/config.yml,
which it reads at the start of each scheduled pass. This script
generates that file from env vars after Plex's fetchScript has
captured the X-Plex-Token, then writes it atomically to the host
path the orchestrator passes in.

Why a script vs. a static compose.files seed: Plex's token is a
runtime-fetched value (fetch-plex-secrets.py reads PlexOnlineToken
from Preferences.xml after Plex's first launch). At compose.files
write time the token doesn't exist yet, so we can't produce the full
config.yml statically. Doing the write post-deploy lets us include
the token alongside everything else in a single coherent file.

Steps:
  1. Validates that PLEX_URL + PLEX_TOKEN + TMDB_API_KEY are present
     (the three required-by-Kometa fields).
  2. Builds a config.yml document with sections for plex, tmdb, and
     optionally sonarr/radarr (when those services are part of the
     deploy — gated via env-var presence).
  3. Writes to KOMETA_CONFIG_PATH atomically via temp-file + rename.
     Idempotent — re-runs overwrite the same file with the same
     content (modulo any changes in the env values).

The libraries section defaults to "Movies" and "TV Shows" — matching
the Plex library names configure-plex.py auto-creates on the *arr
side. Users who want Kometa to manage CineSync-side libraries (or
custom libraries) can edit config.yml after first deploy; subsequent
re-runs of this script will overwrite, so any user edits should be
backed up to a separate file Kometa imports via `external_overlays`.

Environment:
  KOMETA_CONFIG_PATH  Host path where config.yml should be written.
                      Required (orchestrator resolves
                      configRoot/kometa/config.yml).

  PLEX_URL            Plex base URL. Required.
  PLEX_TOKEN          X-Plex-Token from fetch-plex-secrets.py.
                      Required. (When user picked Jellyfin/Emby
                      instead of Plex, the orchestrator omits this
                      var via whenMediaServer:'plex' and the script
                      exits 0 with a "no Plex to wire" log line —
                      Kometa is Plex-only and doesn't function
                      without it.)

  TMDB_API_KEY        TMDB API key from the wizard's External APIs
                      step. Required for Kometa to look up metadata.
                      When unset, Kometa works in degraded mode but
                      most metadata operations fail.

  SONARR_URL          Optional. Default: http://localhost:8989.
  SONARR_API_KEY      Optional. When set, adds a sonarr: section
                      to config.yml.
  RADARR_URL          Optional. Default: http://localhost:7878.
  RADARR_API_KEY      Optional. When set, adds a radarr: section
                      to config.yml.

  DRY_RUN             "1"/"true": log only.

Exit codes:
  0  Success, including the "no Plex to wire" graceful skip.
  3  File write failed.
  6  Required env var missing.
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from typing import Optional


logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("configure-kometa")


def env(name: str, default: Optional[str] = None, *, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Required environment variable %s is not set", name)
        sys.exit(6)
    return v or ""


def is_truthy(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------
# YAML rendering
# ---------------------------------------------------------------------
# We hand-render YAML rather than pulling in PyYAML so this stays
# stdlib-only (matches Surge's other configure scripts). The output
# is a small fixed-shape document so the manual rendering stays
# readable.

def render_config_yml(
    *,
    plex_url: str,
    plex_token: str,
    tmdb_api_key: str,
    sonarr_url: Optional[str],
    sonarr_api_key: Optional[str],
    radarr_url: Optional[str],
    radarr_api_key: Optional[str],
) -> str:
    """Build the Kometa config.yml content. Always emits plex + tmdb
    + libraries sections; sonarr/radarr sections are conditional on
    the corresponding env vars being set."""
    lines = [
        "# Kometa config.yml — seeded by Surge's configure-kometa.py.",
        "# Re-running the post-deploy step overwrites this file. Add",
        "# library overlays / collections / playlists in separate",
        "# files Kometa imports via external_overlays / external_files.",
        "#",
        "# Reference: https://kometa.wiki/en/latest/config/overview/",
        "",
        "plex:",
        f"  url: {plex_url}",
        f"  token: {plex_token}",
        "  timeout: 60",
        "  db_cache: 40",
        "  clean_bundles: false",
        "  empty_trash: false",
        "  optimize: false",
        "",
        "tmdb:",
        f"  apikey: {tmdb_api_key or '(unset — set via External APIs step)'}",
        "  language: en",
        "  cache_expiration: 60",
        "",
    ]

    if sonarr_url and sonarr_api_key:
        lines += [
            "sonarr:",
            f"  url: {sonarr_url}",
            f"  token: {sonarr_api_key}",
            "  add_missing: false",
            "  add_existing: false",
            "  upgrade_existing: false",
            "  monitor_existing: false",
            "  root_folder_path: /media/tv",
            "  monitor: all",
            "  quality_profile: HD-1080p",
            "  language_profile: English",
            "  series_type: standard",
            "  season_folder: true",
            "  search: false",
            "  cutoff_search: false",
            "",
        ]

    if radarr_url and radarr_api_key:
        lines += [
            "radarr:",
            f"  url: {radarr_url}",
            f"  token: {radarr_api_key}",
            "  add_missing: false",
            "  add_existing: false",
            "  upgrade_existing: false",
            "  root_folder_path: /media/movies",
            "  monitor: true",
            "  availability: announced",
            "  quality_profile: HD-1080p",
            "  search: false",
            "",
        ]

    lines += [
        "# Default library config — manages metadata for the two",
        "# auto-created Plex libraries on the *arr side. Users with",
        "# more libraries can extend this section freely.",
        "libraries:",
        "  Movies:",
        "    operations:",
        "      assets_for_all: true",
        "  TV Shows:",
        "    operations:",
        "      assets_for_all: true",
        "",
    ]

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------
# Atomic file write
# ---------------------------------------------------------------------

def write_atomic(path: str, content: str) -> None:
    """Write content to path via temp file + rename so partial writes
    can't corrupt an existing config.yml mid-replace."""
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8",
        dir=parent, prefix=".kometa-", suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    os.replace(tmp_path, path)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    config_path     = env("KOMETA_CONFIG_PATH", required=True)
    plex_url        = env("PLEX_URL", "http://localhost:32400")
    plex_token      = env("PLEX_TOKEN")
    tmdb_api_key    = env("TMDB_API_KEY")
    sonarr_url      = env("SONARR_URL", "http://localhost:8989") if env("SONARR_API_KEY") else ""
    sonarr_api_key  = env("SONARR_API_KEY")
    radarr_url      = env("RADARR_URL", "http://localhost:7878") if env("RADARR_API_KEY") else ""
    radarr_api_key  = env("RADARR_API_KEY")
    dry_run         = is_truthy(env("DRY_RUN", "0"))

    if dry_run:
        log.warning("DRY_RUN enabled — no file will be written")

    # Graceful skip when Plex isn't part of this deploy. Kometa is
    # Plex-only — it has no Jellyfin/Emby support — so without a
    # token there's nothing for it to do.
    if not plex_token:
        log.info(
            "PLEX_TOKEN not set — Plex isn't part of this deploy. Kometa "
            "is Plex-only; skipping config.yml seed. Kometa will boot but "
            "its scheduled passes will fail loudly until config.yml is "
            "either provided manually or the user enables Plex.",
        )
        return 0

    if not tmdb_api_key:
        log.warning(
            "TMDB_API_KEY not set — Kometa will write a config.yml with "
            "an empty TMDB key, and most metadata operations will fail "
            "until the user fills it in (External APIs step).",
        )

    log.info(
        "Plan: kometa_config=%s plex=%s tmdb=%s sonarr=%s radarr=%s",
        config_path, plex_url,
        "(set)" if tmdb_api_key else "(not set)",
        sonarr_url or "(not enabled)",
        radarr_url or "(not enabled)",
    )

    content = render_config_yml(
        plex_url=plex_url,
        plex_token=plex_token,
        tmdb_api_key=tmdb_api_key,
        sonarr_url=sonarr_url or None,
        sonarr_api_key=sonarr_api_key or None,
        radarr_url=radarr_url or None,
        radarr_api_key=radarr_api_key or None,
    )

    if dry_run:
        log.info("[DRY RUN] Would write %d bytes to %s",
                 len(content), config_path)
        log.info("[DRY RUN] First few lines:\n%s",
                 "\n".join(content.splitlines()[:8]))
        return 0

    try:
        write_atomic(config_path, content)
    except OSError as e:
        log.error("Failed to write %s: %s", config_path, e)
        sys.exit(3)

    log.info("Wrote Kometa config.yml to %s (%d bytes)",
             config_path, len(content))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
