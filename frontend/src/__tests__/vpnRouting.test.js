import { applyVpnRouting } from '../composePreview';

/**
 * Mirror of the orchestrator's test_vpn_routing.py — pins the wizard-
 * side preview transformation to match what the orchestrator does at
 * deploy time. If these two ever drift, the bundle the user generates
 * won't match the preview they saw, which is a confusing surprise to
 * debug.
 */

function makeResult(services = {}) {
  return {
    services,
    networks:          {},
    files:             [],
    secrets:           {},
    fetchScripts:      [],
    postDeployScripts: [],
    warnings:          [],
  };
}

function makeConfig({ gluetun = false, routed = {} } = {}) {
  return {
    contentEnhancement: { gluetun },
    vpnRoutedServices:  routed,
  };
}

describe('applyVpnRouting', () => {
  test('no-op when gluetun disabled', () => {
    const result = makeResult({
      sonarr:  { ports: ['8989:8989'], networks: ['surge'] },
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: false, routed: { sonarr: true } }));
    expect(result.services.sonarr.ports).toEqual(['8989:8989']);
    expect(result.services.sonarr.networkMode).toBeUndefined();
  });

  test('no-op when no services flagged', () => {
    const result = makeResult({
      sonarr:  { ports: ['8989:8989'] },
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: {} }));
    expect(result.services.sonarr.ports).toEqual(['8989:8989']);
    expect(result.services.gluetun.ports).toEqual([]);
  });

  test('hoists ports and sets networkMode', () => {
    const result = makeResult({
      sonarr:  { ports: ['8989:8989'], networks: ['surge'] },
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: { sonarr: true } }));
    expect(result.services.sonarr.ports).toEqual([]);
    expect(result.services.sonarr.networkMode).toBe('service:gluetun');
    expect(result.services.sonarr.networks).toBeUndefined();
    expect(result.services.gluetun.ports).toContain('8989:8989');
  });

  test('adds dependsOn so routed services wait for tunnel', () => {
    const result = makeResult({
      sonarr:  { ports: ['8989:8989'] },
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: { sonarr: true } }));
    expect(result.services.sonarr.dependsOn.gluetun).toEqual({
      condition: 'service_healthy',
    });
  });

  test('multiple routed services dedupe ports on gluetun', () => {
    const result = makeResult({
      sonarr:  { ports: ['8989:8989'] },
      radarr:  { ports: ['7878:7878'] },
      gluetun: { ports: ['9999:9999'] },
    });
    applyVpnRouting(result, makeConfig({
      gluetun: true,
      routed:  { sonarr: true, radarr: true },
    }));
    expect(result.services.gluetun.ports.sort()).toEqual([
      '7878:7878', '8989:8989', '9999:9999',
    ]);
  });

  test('multi-container service routes all sub-containers', () => {
    const result = makeResult({
      zurg: {
        ports:    [],
        services: {
          zurg:          { ports: ['9999:9999'] },
          'zurg-rclone': { ports: ['8000:8000'] },
        },
      },
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: { zurg: true } }));
    expect(result.services.zurg.services.zurg.networkMode).toBe('service:gluetun');
    expect(result.services.zurg.services['zurg-rclone'].networkMode).toBe('service:gluetun');
    expect(result.services.gluetun.ports.sort()).toEqual(['8000:8000', '9999:9999']);
  });

  test('flag for disabled service is silently ignored', () => {
    const result = makeResult({
      gluetun: { ports: [] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: { sonarr: true } }));
    expect(result.services.gluetun.ports).toEqual([]);
  });

  test('gluetun not in result is a safe no-op', () => {
    const result = makeResult({
      sonarr: { ports: ['8989:8989'] },
    });
    applyVpnRouting(result, makeConfig({ gluetun: true, routed: { sonarr: true } }));
    expect(result.services.sonarr.ports).toEqual(['8989:8989']);
    expect(result.services.sonarr.networkMode).toBeUndefined();
  });
});
