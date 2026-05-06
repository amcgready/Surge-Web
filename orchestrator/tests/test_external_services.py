"""Tests for "existing-services mode" in the orchestrator.

Mirror of the frontend's externalServices.test.js — services flagged
external should be skipped during enabled_services enumeration, and
fromService / fromServiceSecret marker resolution should fall back
to config.externalServices.<key>.url / .apiKey instead of state.json.

Keeping these in sync with the JS preview is essential — if the wizard
shows a different shape than the orchestrator emits, users get
"the bundle works in the preview but breaks at deploy time" surprises.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from surge_orchestrator import Config, Manifest, State, resolve_env_marker


# ---------------------------------------------------------------------
# Test fixtures — minimal manifest + state shapes
# ---------------------------------------------------------------------

def _manifest_with(service_meta=None, media_server_meta=None):
    m = Manifest.__new__(Manifest)
    m.service_meta = service_meta or {}
    m.media_server_meta = media_server_meta or {}
    m.compose_defaults = {}
    m.env_defaults = {}
    return m


def _config_with(**raw):
    return Config({
        "platform": "docker",
        "docker": {"rootPath": "/srv/surge"},
        "contentEnhancement": {},
        "externalServices": {},
        **raw,
    })


# ---------------------------------------------------------------------
# enabled_services skip behavior
# ---------------------------------------------------------------------

def test_enabled_services_skips_externally_marked_service():
    manifest = _manifest_with(service_meta={
        "sonarr":   {"name": "Sonarr",   "compose": {"image": "x:latest"}},
        "bazarr":   {"name": "Bazarr",   "compose": {"image": "y:latest"}},
    })
    cfg = _config_with(
        contentEnhancement={"sonarr": True, "bazarr": True},
        externalServices={
            "sonarr": {"external": True, "url": "http://10.0.0.5:8989", "apiKey": "k"},
        },
    )
    keys = [k for k, _ in cfg.enabled_services(manifest)]
    assert "sonarr" not in keys
    assert "bazarr" in keys


def test_enabled_services_skips_externally_marked_media_server():
    manifest = _manifest_with(media_server_meta={
        "plex": {"name": "Plex", "compose": {"image": "plexinc/pms-docker:latest"}},
    })
    cfg = _config_with(
        mediaServer="plex",
        externalServices={
            "plex": {"external": True, "url": "http://10.0.0.5:32400", "apiKey": "t"},
        },
    )
    assert cfg.enabled_services(manifest) == []


def test_external_with_external_false_acts_normally():
    manifest = _manifest_with(service_meta={
        "sonarr": {"name": "Sonarr", "compose": {"image": "x:latest"}},
    })
    cfg = _config_with(
        contentEnhancement={"sonarr": True},
        externalServices={
            "sonarr": {"external": False, "url": "http://x", "apiKey": "k"},
        },
    )
    keys = [k for k, _ in cfg.enabled_services(manifest)]
    assert "sonarr" in keys


# ---------------------------------------------------------------------
# Marker resolution: fromServiceSecret -> external apiKey
# ---------------------------------------------------------------------

def test_fromServiceSecret_resolves_to_external_apiKey():
    cfg = _config_with(
        contentEnhancement={"sonarr": True, "bazarr": True},
        externalServices={
            "sonarr": {"external": True, "url": "http://10.0.0.5:8989",
                       "apiKey": "real-sonarr-key"},
        },
    )
    state = State()
    marker = {"fromServiceSecret": "sonarr", "secret": "apiKey"}
    resolved = resolve_env_marker(marker, "bazarr", {},
                                 cfg, state, runtime_required=False)
    assert resolved == "real-sonarr-key"


def test_fromServiceSecret_unsupported_field_returns_placeholder():
    """Non-key/token shaped secrets fall through to a visible
    placeholder so the missing wiring is obvious in the preview."""
    cfg = _config_with(
        contentEnhancement={"sonarr": True},
        externalServices={
            "sonarr": {"external": True, "url": "http://x", "apiKey": "k"},
        },
    )
    state = State()
    marker = {"fromServiceSecret": "sonarr", "secret": "someOtherSecret"}
    resolved = resolve_env_marker(marker, "bazarr", {}, cfg, state,
                                 runtime_required=False)
    assert resolved.startswith("<FROM-EXTERNAL:sonarr.")


# ---------------------------------------------------------------------
# Marker resolution: fromService.url / .apiKey
# ---------------------------------------------------------------------

def test_fromService_url_resolves_to_external_url():
    cfg = _config_with(
        contentEnhancement={"sonarr": True, "bazarr": True},
        externalServices={
            "sonarr": {"external": True, "url": "http://10.0.0.5:8989",
                       "apiKey": "k"},
        },
    )
    state = State()
    marker = {"fromService": "sonarr", "field": "url"}
    resolved = resolve_env_marker(marker, "bazarr", {}, cfg, state,
                                 runtime_required=False)
    assert resolved == "http://10.0.0.5:8989"


def test_fromService_token_resolves_to_external_apiKey():
    """Plex-style: fromService(plex).plexToken should return the
    user-provided apiKey when Plex is external."""
    cfg = _config_with(
        mediaServer="plex",
        externalServices={
            "plex": {"external": True, "url": "http://10.0.0.5:32400",
                     "apiKey": "real-plex-token"},
        },
    )
    state = State()
    marker = {"fromService": "plex", "field": "plexToken"}
    resolved = resolve_env_marker(marker, "tautulli", {}, cfg, state,
                                 runtime_required=False)
    assert resolved == "real-plex-token"


def test_fromService_unknown_field_returns_placeholder():
    cfg = _config_with(
        externalServices={
            "sonarr": {"external": True, "url": "http://x", "apiKey": "k"},
        },
    )
    state = State()
    marker = {"fromService": "sonarr", "field": "weirdField"}
    resolved = resolve_env_marker(marker, "bazarr", {}, cfg, state,
                                 runtime_required=False)
    assert resolved.startswith("<FROM-EXTERNAL:sonarr.")


def test_internal_service_unaffected_by_externalServices_map():
    """When sonarr ISN'T marked external (or no entry exists), the
    resolver falls through to the normal state.json-backed path."""
    cfg = _config_with(
        contentEnhancement={"sonarr": True},
        externalServices={},
    )
    state = State(secrets={"sonarr.apiKey": "managed-by-surge"})
    marker = {"fromServiceSecret": "sonarr", "secret": "apiKey"}
    resolved = resolve_env_marker(marker, "bazarr", {}, cfg, state,
                                 runtime_required=False)
    assert resolved == "managed-by-surge"
