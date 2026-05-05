"""Tests for the apply_vpn_routing post-process step.

The transformation hoists ports from VPN-routed services onto gluetun
and swaps each routed service to network_mode: service:<gluetun>. This
test pins the behavior for the common cases — single-container,
multi-container, dependency wiring, no-op when gluetun disabled.
"""
import sys
from pathlib import Path

# Allow importing the orchestrator module from the parent dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from surge_orchestrator import apply_vpn_routing, container_name_for, Config


def make_config(*, gluetun_enabled, routed_services):
    """Build a minimal Config with the bits apply_vpn_routing reads."""
    return Config({
        "platform":          "docker",
        "docker":            {"rootPath": "/srv/surge"},
        "contentEnhancement": {"gluetun": gluetun_enabled},
        "vpnRoutedServices":  routed_services,
    })


def test_noop_when_gluetun_disabled():
    services = {
        "sonarr":  {"ports": ["8989:8989"], "networks": ["surge"]},
        "gluetun": {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=False, routed_services={"sonarr": True},
    ))
    assert services["sonarr"]["ports"] == ["8989:8989"]
    assert "network_mode" not in services["sonarr"]


def test_noop_when_no_services_flagged():
    services = {
        "sonarr":  {"ports": ["8989:8989"]},
        "gluetun": {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={},
    ))
    assert services["sonarr"]["ports"] == ["8989:8989"]
    assert services["gluetun"]["ports"] == []


def test_hoists_ports_and_sets_network_mode():
    services = {
        container_name_for("sonarr"): {
            "ports":    ["8989:8989"],
            "networks": ["surge"],
        },
        container_name_for("gluetun"): {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={"sonarr": True},
    ))
    sonarr = services[container_name_for("sonarr")]
    gluetun = services[container_name_for("gluetun")]
    assert sonarr["ports"] == []
    assert sonarr["network_mode"] == f"service:{container_name_for('gluetun')}"
    assert "networks" not in sonarr
    assert "8989:8989" in gluetun["ports"]


def test_dependency_added_so_routed_waits_for_tunnel():
    services = {
        container_name_for("sonarr"):  {"ports": ["8989:8989"]},
        container_name_for("gluetun"): {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={"sonarr": True},
    ))
    sonarr = services[container_name_for("sonarr")]
    assert sonarr["depends_on"][container_name_for("gluetun")]["condition"] \
        == "service_healthy"


def test_multiple_routed_services_dedupe_on_gluetun():
    g = container_name_for("gluetun")
    services = {
        container_name_for("sonarr"):  {"ports": ["8989:8989"]},
        container_name_for("radarr"):  {"ports": ["7878:7878"]},
        # Pre-existing port on gluetun (defensive — schema doesn't ship
        # gluetun with ports today, but be sure we don't drop them).
        g: {"ports": ["9999:9999"]},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True,
        routed_services={"sonarr": True, "radarr": True},
    ))
    assert sorted(services[g]["ports"]) == sorted([
        "9999:9999", "8989:8989", "7878:7878",
    ])


def test_multi_container_service_routed_as_unit():
    """When a multi-container service like zurg gets flagged, all its
    sub-containers (zurg, zurg-rclone) should be hoisted together."""
    g = container_name_for("gluetun")
    services = {
        container_name_for("zurg"):              {"ports": ["9999:9999"]},
        f"{container_name_for('zurg')}-rclone":  {"ports": ["8000:8000"]},
        g: {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={"zurg": True},
    ))
    assert services[container_name_for("zurg")]["network_mode"] \
        == f"service:{g}"
    assert services[f"{container_name_for('zurg')}-rclone"]["network_mode"] \
        == f"service:{g}"
    # Both ports should land on gluetun.
    assert "9999:9999" in services[g]["ports"]
    assert "8000:8000" in services[g]["ports"]


def test_flag_for_disabled_service_is_silently_ignored():
    """User flagged sonarr for VPN routing but didn't enable sonarr.
    Should be a quiet no-op rather than crashing."""
    services = {
        container_name_for("gluetun"): {"ports": []},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={"sonarr": True},
    ))
    assert services[container_name_for("gluetun")]["ports"] == []


def test_gluetun_not_yet_rendered_is_safe():
    """Gluetun toggled on but for whatever reason not in the rendered
    services dict (shouldn't happen in practice — defensive guard)."""
    services = {
        container_name_for("sonarr"): {"ports": ["8989:8989"]},
    }
    apply_vpn_routing(services, make_config(
        gluetun_enabled=True, routed_services={"sonarr": True},
    ))
    # Sonarr stays untouched — we don't half-route it.
    assert services[container_name_for("sonarr")]["ports"] == ["8989:8989"]
