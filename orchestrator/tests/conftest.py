import json
import pytest
from pathlib import Path
from typing import Any


@pytest.fixture
def tmp_config_root(tmp_path):
    """Create a temporary configRoot directory tree."""
    root = tmp_path / "configRoot"
    root.mkdir()
    return root


@pytest.fixture
def minimal_manifest() -> dict:
    """A minimal manifest with one service and one media server."""
    return {
        "serviceMeta": {
            "sonarr": {
                "compose": {
                    "image": "linuxserver/sonarr:latest",
                    "mounts": [
                        {
                            "src": "configRoot/<service>",
                            "dst": "/config",
                        }
                    ],
                    "env": {
                        "SONARR_API_KEY": {"fromSecret": "apiKey"}
                    },
                    "secrets": {
                        "apiKey": {"generate": "random", "length": 32}
                    },
                }
            },
            "sabnzbd": {
                "compose": {
                    "image": "linuxserver/sabnzbd:latest",
                    "mounts": [
                        {
                            "src": "configRoot/<service>",
                            "dst": "/config",
                        }
                    ],
                    "env": {
                        "SAB_API_KEY": {"fromSecret": "apiKey"},
                        "SONARR_URL": {
                            "fromService": "sonarr",
                            "field": "baseUrl"
                        }
                    },
                    "secrets": {
                        "apiKey": {"generate": "random", "length": 24}
                    },
                }
            },
        },
        "mediaServerMeta": {
            "plex": {
                "compose": {
                    "image": "plexinc/pms-docker:latest",
                    "mounts": [
                        {
                            "src": "mediaRoot/media",
                            "dst": "/media",
                            "options": "ro"
                        }
                    ],
                    "env": {
                        "PLEX_CLAIM": {"value": "claim-token-here"}
                    },
                }
            }
        },
    }


@pytest.fixture
def base_config() -> dict:
    """A minimal user config (wizard output)."""
    return {
        "platform": "docker",
        "docker": {
            "rootPath": "/srv/surge",
        },
        "mediaServer": "plex",
        "contentEnhancement": {
            "sonarr": True,
            "sabnzbd": False,
        },
        "userId": 1000,
        "groupId": 1000,
        "umask": "022",
    }


@pytest.fixture
def unraid_config_cached() -> dict:
    """Unraid config with cache drive enabled."""
    return {
        "platform": "unraid",
        "unraid": {
            "useCacheDrive": True,
            "cachePath": "/mnt/cache",
            "appdataPath": "/mnt/user/appdata",
        },
        "mediaServer": "plex",
        "contentEnhancement": {
            "sonarr": True,
        },
    }


@pytest.fixture
def unraid_config_no_cache() -> dict:
    """Unraid config with cache drive disabled."""
    return {
        "platform": "unraid",
        "unraid": {
            "useCacheDrive": False,
        },
        "mediaServer": "plex",
        "contentEnhancement": {
            "sonarr": True,
        },
    }
