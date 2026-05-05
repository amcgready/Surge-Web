"""Tests for compose.yml rendering."""
import pytest
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from surge_orchestrator import (
    Manifest, Config, State, PathResolver,
    render_compose, render_container, render_file_content,
    container_name_for, to_yaml, SURGE_ENV_DEFAULTS, SURGE_COMPOSE_DEFAULTS,
)


class TestPathResolver:
    """Test path token resolution (mediaRoot, configRoot, userSharesRoot)."""

    def test_docker_defaults(self, base_config):
        """Docker paths default to rootPath."""
        resolver = PathResolver(Config(base_config))

        assert resolver.media_root() == "/srv/surge"
        assert resolver.config_root() == "/srv/surge"
        assert resolver.user_shares_root() == "/srv/surge"

    def test_unraid_cached(self, unraid_config_cached):
        """Unraid with cache: mediaRoot -> cache, configRoot -> appdata."""
        resolver = PathResolver(Config(unraid_config_cached))

        assert resolver.media_root() == "/mnt/cache"
        assert resolver.config_root() == "/mnt/user/appdata"
        assert resolver.user_shares_root() == "/mnt/user"

    def test_unraid_no_cache(self, unraid_config_no_cache):
        """Unraid without cache: all paths -> /mnt/user."""
        resolver = PathResolver(Config(unraid_config_no_cache))

        assert resolver.media_root() == "/mnt/user"
        assert resolver.config_root() == "/mnt/user/appdata"
        assert resolver.user_shares_root() == "/mnt/user"

    def test_resolve_media_root(self, base_config):
        """resolve() replaces mediaRoot token."""
        resolver = PathResolver(Config(base_config))

        path = resolver.resolve("mediaRoot/media/tv")
        assert path == "/srv/surge/media/tv"

    def test_resolve_config_root(self, base_config):
        """resolve() replaces configRoot token."""
        resolver = PathResolver(Config(base_config))

        path = resolver.resolve("configRoot/<service>/config.ini", service_key="sonarr")
        assert path == "/srv/surge/sonarr/config.ini"

    def test_resolve_user_shares_root(self, base_config):
        """resolve() replaces userSharesRoot token."""
        resolver = PathResolver(Config(base_config))

        path = resolver.resolve("userSharesRoot/share1")
        assert path == "/srv/surge/share1"

    def test_resolve_absolute_path_passthrough(self, base_config):
        """resolve() passes absolute paths unchanged."""
        resolver = PathResolver(Config(base_config))

        path = resolver.resolve("/etc/nginx/nginx.conf")
        assert path == "/etc/nginx/nginx.conf"

    def test_resolve_service_placeholder(self, base_config):
        """<service> placeholder substitution."""
        resolver = PathResolver(Config(base_config))

        path = resolver.resolve("configRoot/<service>", service_key="sonarr")
        assert path == "/srv/surge/sonarr"


class TestContainerNameFor:
    """Test container name generation."""

    def test_simple_name(self):
        name = container_name_for("sonarr")
        assert name == "sonarr"

    def test_uppercase_lowercased(self):
        name = container_name_for("Sonarr")
        assert name == "sonarr"


class TestRenderContainer:
    """Test single-container rendering."""

    def test_basic_render(self, minimal_manifest, base_config):
        """Render a basic container with image and env."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "test-key")
        paths = PathResolver(config)

        meta = manifest.service_meta["sonarr"]
        sub = meta["compose"]

        container = render_container(
            service_key="sonarr", sub_key=None, sub=sub,
            meta=meta, config=config, state=state, paths=paths,
        )

        assert container["image"] == "linuxserver/sonarr:latest"
        assert container["restart"] == SURGE_COMPOSE_DEFAULTS["restart"]
        assert container["network_mode"] == SURGE_COMPOSE_DEFAULTS["networkMode"]

    def test_env_includes_defaults(self, minimal_manifest, base_config):
        """Env includes SURGE_ENV_DEFAULTS."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "test-key")
        paths = PathResolver(config)

        meta = manifest.service_meta["sonarr"]
        sub = meta["compose"]

        container = render_container(
            service_key="sonarr", sub_key=None, sub=sub,
            meta=meta, config=config, state=state, paths=paths,
        )

        env_list = container["environment"]
        env_dict = {k: v for k, v in (e.split("=", 1) for e in env_list)}

        # Should include surge defaults
        assert env_dict["TZ"] == "${TZ:-UTC}"
        assert env_dict["PUID"] == "1000"  # from config.userId
        assert env_dict["PGID"] == "1000"  # from config.groupId

    def test_volumes_resolved(self, minimal_manifest, base_config):
        """Volumes paths are token-resolved."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "test-key")  # Materialize for env resolution
        paths = PathResolver(config)

        meta = manifest.service_meta["sonarr"]
        sub = meta["compose"]

        container = render_container(
            service_key="sonarr", sub_key=None, sub=sub,
            meta=meta, config=config, state=state, paths=paths,
        )

        # sonarr configRoot/<service> should resolve to /srv/surge/sonarr
        volumes = container.get("volumes", [])
        assert any("srv/surge/sonarr" in v for v in volumes)


class TestRenderCompose:
    """Test full compose document rendering."""

    def test_render_single_service(self, minimal_manifest, base_config):
        """Render compose with one enabled service."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "key1")
        paths = PathResolver(config)

        doc = render_compose(manifest, config, state, paths)

        assert "services" in doc
        assert "sonarr" in doc["services"]
        assert "plex" in doc["services"]  # media server always included
        assert "sabnzbd" not in doc["services"]  # disabled

    def test_render_multiple_services(self, minimal_manifest, base_config):
        """Render compose with multiple enabled services."""
        manifest = Manifest(minimal_manifest)
        base_config["contentEnhancement"]["sabnzbd"] = True
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "key1")
        state.set_secret("sabnzbd", "apiKey", "key2")
        paths = PathResolver(config)

        doc = render_compose(manifest, config, state, paths)

        assert "sonarr" in doc["services"]
        assert "sabnzbd" in doc["services"]
        assert "plex" in doc["services"]

    def test_render_no_networks_if_none_needed(self, minimal_manifest, base_config):
        """Compose has no networks section if not needed."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "key1")
        paths = PathResolver(config)

        doc = render_compose(manifest, config, state, paths)

        # Single-container services don't create networks
        assert "networks" not in doc or not doc["networks"]


class TestRenderFileContent:
    """Test seeded file content rendering."""

    def test_render_string_content(self, minimal_manifest, base_config):
        """String content gets template-substituted."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        state.set_secret("sonarr", "apiKey", "test-secret")
        meta = manifest.service_meta["sonarr"]

        content = "api_key=${apiKey}"
        result = render_file_content(content, "sonarr", meta, config, state)

        assert result == "api_key=test-secret"

    def test_render_from_upstream(self, minimal_manifest, base_config):
        """fromUpstream marker returned as-is."""
        manifest = Manifest(minimal_manifest)
        config = Config(base_config)
        state = State()
        meta = manifest.service_meta["sonarr"]

        content = {"fromUpstream": "http://example.com/file.ini"}
        result = render_file_content(content, "sonarr", meta, config, state)

        assert result == content


class TestYamlEmit:
    """Test YAML serialization."""

    def test_emit_simple_dict(self):
        doc = {"key": "value"}
        yaml = to_yaml(doc)

        assert "key: value" in yaml

    def test_emit_nested_dict(self):
        doc = {"services": {"app": {"image": "ubuntu"}}}
        yaml = to_yaml(doc)

        assert "services:" in yaml
        assert "app:" in yaml
        assert "image: ubuntu" in yaml

    def test_emit_list(self):
        doc = {"ports": ["8080:8080", "9090:9090"]}
        yaml = to_yaml(doc)

        assert "- 8080:8080" in yaml
        assert "- 9090:9090" in yaml

    def test_emit_quoted_string_with_special_chars(self):
        doc = {"key": "value: with colon"}
        yaml = to_yaml(doc)

        assert '"value: with colon"' in yaml

    def test_emit_boolean(self):
        doc = {"enabled": True, "disabled": False}
        yaml = to_yaml(doc)

        assert "enabled: true" in yaml
        assert "disabled: false" in yaml

    def test_emit_integer(self):
        doc = {"port": 8080}
        yaml = to_yaml(doc)

        assert "port: 8080" in yaml

    def test_roundtrip_parses_valid_yaml(self):
        """Generated YAML parses back (basic validation)."""
        doc = {
            "services": {
                "app": {
                    "image": "ubuntu:latest",
                    "ports": ["8080:8080"],
                    "environment": ["VAR=value"],
                }
            }
        }
        yaml = to_yaml(doc)

        # Should be valid YAML structure
        assert "services:" in yaml
        assert "app:" in yaml
        assert "- 8080:8080" in yaml
