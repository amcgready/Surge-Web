"""Tests for secret materialization and persistence."""
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from surge_orchestrator import (
    Manifest, Config, State, materialize_secrets,
)


class TestSecretMaterialization:
    """Test that secrets are generated and persisted correctly."""

    def test_generate_random_secret(self, minimal_manifest, base_config):
        """generate:random creates a secret of specified length."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()

        materialize_secrets(manifest, config, state)

        # sonarr.apiKey should be generated (32 chars)
        secret = state.get_secret("sonarr", "apiKey")
        assert secret is not None
        assert len(secret) == 32
        assert isinstance(secret, str)

    def test_generate_custom_length(self, minimal_manifest, base_config):
        """generate:random respects custom length."""
        manifest = Manifest(minimal_manifest)
        # Enable sabnzbd in config so secret gets materialized
        base_config["contentEnhancement"]["sabnzbd"] = True
        config = Config(base_config)
        state = State()

        # sabnzbd.apiKey has length: 24
        materialize_secrets(manifest, config, state)

        secret = state.get_secret("sabnzbd", "apiKey")
        assert secret is not None
        assert len(secret) == 24

    def test_skip_already_persisted(self, minimal_manifest, base_config):
        """materialize_secrets skips keys already in state."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()

        # Pre-seed a secret
        state.set_secret("sonarr", "apiKey", "existing-value")

        materialize_secrets(manifest, config, state)

        # Should not be rotated
        secret = state.get_secret("sonarr", "apiKey")
        assert secret == "existing-value"

    def test_disabled_service_no_secrets(self, minimal_manifest, base_config):
        """Secrets for disabled services not materialized."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)

        # sabnzbd is disabled in base_config
        assert not config.is_service_enabled("sabnzbd")

        state = State()
        materialize_secrets(manifest, config, state)

        # sabnzbd.apiKey should NOT exist
        secret = state.get_secret("sabnzbd", "apiKey")
        assert secret is None

    def test_unique_secrets_on_reruns(self, minimal_manifest, base_config):
        """Different calls to materialize produce different random values."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)

        state1 = State()
        materialize_secrets(manifest, config, state1)
        secret1 = state1.get_secret("sonarr", "apiKey")

        state2 = State()
        materialize_secrets(manifest, config, state2)
        secret2 = state2.get_secret("sonarr", "apiKey")

        # Secrets should be different
        assert secret1 != secret2

    def test_rerun_preserves_existing(self, minimal_manifest, base_config):
        """Re-running materialize with persisted state preserves secrets."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)

        state = State()
        materialize_secrets(manifest, config, state)
        original_secret = state.get_secret("sonarr", "apiKey")

        # Run again (simulating a second deploy)
        materialize_secrets(manifest, config, state)
        preserved_secret = state.get_secret("sonarr", "apiKey")

        assert original_secret == preserved_secret


class TestStatePersistence:
    """Test State save/load round-trips."""

    def test_state_save_load(self, tmp_path):
        """State can be saved and loaded back."""
        state_file = tmp_path / ".surge" / "state.json"

        state1 = State()
        state1.set_secret("service1", "key1", "value1")
        state1.set_runtime("service1", "field1", "runtime1")
        state1.save(state_file)

        state2 = State.load(state_file)
        assert state2.get_secret("service1", "key1") == "value1"
        assert state2.get_runtime("service1", "field1") == "runtime1"

    def test_state_permissions(self, tmp_path):
        """State.json is created with 0o600 permissions."""
        state_file = tmp_path / ".surge" / "state.json"

        state = State()
        state.set_secret("svc", "key", "secret")
        state.save(state_file)

        perms = state_file.stat().st_mode & 0o777
        assert perms == 0o600

    def test_state_atomic_write(self, tmp_path):
        """State writes are atomic (no partial writes on error)."""
        state_file = tmp_path / ".surge" / "state.json"

        state = State()
        state.set_secret("svc1", "key1", "value1")
        state.set_secret("svc2", "key2", "value2")
        state.save(state_file)

        content = state_file.read_text()
        # Should be valid JSON with both secrets
        import json
        data = json.loads(content)
        assert "svc1.key1" in data["secrets"]
        assert "svc2.key2" in data["secrets"]

    def test_state_load_missing_file(self, tmp_path):
        """State.load on missing file returns empty State."""
        state_file = tmp_path / "nonexistent.json"

        state = State.load(state_file)
        assert state.secrets == {}
        assert state.runtime_values == {}

    def test_state_load_only_secrets(self, tmp_path):
        """State.load handles missing runtimeValues gracefully."""
        state_file = tmp_path / "state.json"
        state_file.write_text('{"secrets": {"svc.key": "val"}}')

        state = State.load(state_file)
        assert state.get_secret("svc", "key") == "val"
        assert state.runtime_values == {}

    def test_state_multiple_services(self, tmp_path):
        """State handles secrets from multiple services."""
        state_file = tmp_path / "state.json"

        state = State()
        state.set_secret("sonarr", "apiKey", "sonarr-secret")
        state.set_secret("sabnzbd", "apiKey", "sab-secret")
        state.set_secret("plex", "claim", "plex-claim")
        state.save(state_file)

        loaded = State.load(state_file)
        assert loaded.get_secret("sonarr", "apiKey") == "sonarr-secret"
        assert loaded.get_secret("sabnzbd", "apiKey") == "sab-secret"
        assert loaded.get_secret("plex", "claim") == "plex-claim"
