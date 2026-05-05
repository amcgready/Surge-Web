"""Tests for marker resolution (fromSecret, fromService, fromConfig, etc.)."""
import pytest
import sys
from pathlib import Path

# Add orchestrator to path so we can import it
sys.path.insert(0, str(Path(__file__).parent.parent))

from surge_orchestrator import (
    Manifest, Config, State, PathResolver,
    resolve_env_marker, resolve_env_dict, OMIT,
    read_dotted, substitute_template_refs,
)


class TestReadDotted:
    """Test read_dotted utility for config lookups."""

    def test_simple_key(self):
        obj = {"a": "value"}
        assert read_dotted(obj, "a") == "value"

    def test_nested_path(self):
        obj = {"a": {"b": {"c": "deep"}}}
        assert read_dotted(obj, "a.b.c") == "deep"

    def test_missing_segment(self):
        obj = {"a": {"b": "value"}}
        assert read_dotted(obj, "a.x.c") is None

    def test_non_dict_segment(self):
        obj = {"a": "string"}
        assert read_dotted(obj, "a.b") is None

    def test_empty_path(self):
        obj = {"a": "value"}
        assert read_dotted(obj, "") is None

    def test_none_obj(self):
        assert read_dotted(None, "a.b") is None


class TestMarkerResolver:
    """Test resolve_env_marker covering each marker type."""

    def test_literal_string(self, base_config, minimal_manifest):
        """Plain strings pass through."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        result = resolve_env_marker("hello world", "sonarr", meta, config, state)
        assert result == "hello world"

    def test_literal_number(self, base_config, minimal_manifest):
        """Numbers convert to strings."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        result = resolve_env_marker(42, "sonarr", meta, config, state)
        assert result == "42"

    def test_literal_bool_true(self, base_config, minimal_manifest):
        """Booleans convert to lowercase strings."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        result = resolve_env_marker(True, "sonarr", meta, config, state)
        assert result == "true"

    def test_literal_bool_false(self, base_config, minimal_manifest):
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        result = resolve_env_marker(False, "sonarr", meta, config, state)
        assert result == "false"

    def test_from_secret(self, base_config, minimal_manifest):
        """fromSecret resolves persisted secret."""
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "secret123")
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"fromSecret": "apiKey"}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "secret123"

    def test_from_secret_missing_raises(self, base_config, minimal_manifest):
        """fromSecret without materialized value raises."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"fromSecret": "apiKey"}
        with pytest.raises(RuntimeError, match="but no value is materialized"):
            resolve_env_marker(marker, "sonarr", meta, config, state)

    def test_from_service_secret(self, base_config, minimal_manifest):
        """fromServiceSecret resolves cross-service secret."""
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "sonarr-secret")
        meta = minimal_manifest["serviceMeta"]["sabnzbd"]

        marker = {
            "fromServiceSecret": "sonarr",
            "secret": "apiKey",
        }
        result = resolve_env_marker(marker, "sabnzbd", meta, config, state)
        assert result == "sonarr-secret"

    def test_from_service_secret_missing_raises(self, base_config, minimal_manifest):
        """fromServiceSecret without value raises."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sabnzbd"]

        marker = {
            "fromServiceSecret": "sonarr",
            "secret": "apiKey",
        }
        with pytest.raises(RuntimeError, match="but no value is materialized"):
            resolve_env_marker(marker, "sabnzbd", meta, config, state)

    def test_from_service_runtime_value_exists(self, base_config, minimal_manifest):
        """fromService resolves runtime-fetched value if present."""
        config = Config(base_config)
        state = State()
        state.set_runtime("sonarr", "baseUrl", "http://sonarr:8989")
        meta = minimal_manifest["serviceMeta"]["sabnzbd"]

        marker = {
            "fromService": "sonarr",
            "field": "baseUrl",
        }
        result = resolve_env_marker(marker, "sabnzbd", meta, config, state)
        assert result == "http://sonarr:8989"

    def test_from_service_runtime_missing_first_pass(self, base_config, minimal_manifest):
        """fromService without runtime value on first pass emits placeholder."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sabnzbd"]

        marker = {
            "fromService": "sonarr",
            "field": "baseUrl",
        }
        result = resolve_env_marker(marker, "sabnzbd", meta, config, state,
                                   runtime_required=False)
        assert result == "<RUNTIME-FETCH:sonarr.baseUrl>"

    def test_from_service_runtime_missing_required_raises(self, base_config, minimal_manifest):
        """fromService without runtime value with runtime_required=True raises."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sabnzbd"]

        marker = {
            "fromService": "sonarr",
            "field": "baseUrl",
        }
        with pytest.raises(RuntimeError, match="hasn't been captured"):
            resolve_env_marker(marker, "sabnzbd", meta, config, state,
                             runtime_required=True)

    def test_from_config_simple(self, base_config, minimal_manifest):
        """fromConfig resolves from user config."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"fromConfig": "userId"}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "1000"

    def test_from_config_dotted_path(self, base_config, minimal_manifest):
        """fromConfig supports dot notation."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"fromConfig": "docker.rootPath"}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "/srv/surge"

    def test_from_config_missing_returns_empty(self, base_config, minimal_manifest):
        """fromConfig missing key returns empty string."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"fromConfig": "nosuchkey"}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == ""

    def test_from_config_with_default(self, base_config, minimal_manifest):
        """fromConfig missing key falls back to defaultValue."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {
            "fromConfig": "nosuchkey",
            "defaultValue": "fallback",
        }
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "fallback"

    def test_value_marker(self, base_config, minimal_manifest):
        """value marker is a literal."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"value": "explicit-value"}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "explicit-value"

    def test_when_service_gate_enabled(self, base_config, minimal_manifest):
        """whenService gate allows marker when service is enabled."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {
            "whenService": "sonarr",
            "value": "show-me",
        }
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == "show-me"

    def test_when_service_gate_disabled(self, base_config, minimal_manifest):
        """whenService gate returns OMIT when service not enabled."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        # sabnzbd is not enabled in base_config
        marker = {
            "whenService": "sabnzbd",
            "value": "hide-me",
        }
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result is OMIT

    def test_when_media_server_gate_match(self, base_config, minimal_manifest):
        """whenMediaServer gate allows when media server matches."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["mediaServerMeta"]["plex"]

        marker = {
            "whenMediaServer": "plex",
            "value": "plex-only",
        }
        result = resolve_env_marker(marker, "plex", meta, config, state)
        assert result == "plex-only"

    def test_when_media_server_gate_mismatch(self, base_config, minimal_manifest):
        """whenMediaServer gate returns OMIT when doesn't match."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["mediaServerMeta"]["plex"]

        marker = {
            "whenMediaServer": "emby",
            "value": "not-plex",
        }
        result = resolve_env_marker(marker, "plex", meta, config, state)
        assert result is OMIT

    def test_generate_marker_in_env_logs_warning(self, base_config, minimal_manifest, caplog):
        """generate marker in env (not secrets) logs warning."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        marker = {"generate": "random", "length": 32}
        result = resolve_env_marker(marker, "sonarr", meta, config, state)
        assert result == ""
        assert "should only appear in compose.secrets" in caplog.text


class TestResolveEnvDict:
    """Test resolve_env_dict which processes entire env blocks."""

    def test_resolve_multiple_entries(self, base_config, minimal_manifest):
        """Resolve all env entries, dropping OMITs."""
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "secret123")
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        env_decl = {
            "KEY": {"fromSecret": "apiKey"},
            "DISABLED": {
                "whenService": "sabnzbd",
                "value": "hidden",
            },
            "LITERAL": "plain-value",
        }
        result = resolve_env_dict(env_decl, "sonarr", meta, config, state)

        assert result["KEY"] == "secret123"
        assert result["LITERAL"] == "plain-value"
        assert "DISABLED" not in result  # OMIT dropped


class TestTemplateSubstitution:
    """Test substitute_template_refs for ${name} in strings."""

    def test_secret_substitution(self, base_config, minimal_manifest):
        """${secretName} replaced with secret value."""
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "my-secret")
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        literal = "http://sonarr:8989?apikey=${apiKey}"
        result = substitute_template_refs(literal, "sonarr", meta, config, state)
        assert result == "http://sonarr:8989?apikey=my-secret"

    def test_config_substitution(self, base_config, minimal_manifest):
        """${path.to.config} replaced with config value."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        literal = "UID=${userId}"
        result = substitute_template_refs(literal, "sonarr", meta, config, state)
        assert result == "UID=1000"

    def test_tz_passthrough(self, base_config, minimal_manifest):
        """${TZ} stays as-is (docker env expression)."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        literal = "TZ=${TZ:-UTC}"
        result = substitute_template_refs(literal, "sonarr", meta, config, state)
        assert result == "TZ=${TZ:-UTC}"

    def test_missing_secret_unresolved(self, base_config, minimal_manifest):
        """Missing ${secret} becomes <UNRESOLVED:name>."""
        config = Config(base_config)
        state = State()
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        literal = "key=${missingSecret}"
        result = substitute_template_refs(literal, "sonarr", meta, config, state)
        assert result == "key=<UNRESOLVED:missingSecret>"

    def test_multiple_substitutions(self, base_config, minimal_manifest):
        """Multiple ${ref} in one string."""
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "secret123")
        meta = minimal_manifest["serviceMeta"]["sonarr"]

        literal = "http://sonarr:8989?key=${apiKey}&uid=${userId}"
        result = substitute_template_refs(literal, "sonarr", meta, config, state)
        assert result == "http://sonarr:8989?key=secret123&uid=1000"
