/**
 * Tests for bundleInspectorUtils.js — bundle parsing and validation.
 * Uses JSZip to create in-memory bundles for testing.
 */

import JSZip from 'jszip';
import { parseSurgeBundle } from '../bundleInspectorUtils';

describe('parseSurgeBundle', () => {
  /**
   * Helper to build a valid test bundle
   */
  async function createValidBundle(overrides = {}) {
    const zip = new JSZip();
    const config = {
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache' },
      mediaServer: 'plex',
      ...overrides,
    };
    const manifest = {
      services: { plex: {} },
      ...overrides.manifest,
    };
    zip.file('surge-deploy/config.json', JSON.stringify(config));
    zip.file('surge-deploy/manifest.json', JSON.stringify(manifest));
    const blob = await zip.generateAsync({ type: 'blob' });
    return blob;
  }

  test('parses valid bundle with config and manifest', async () => {
    const blob = await createValidBundle();
    const { config, state } = await parseSurgeBundle(blob);

    expect(config).toBeDefined();
    expect(config.platform).toBe('unraid');
    expect(config.mediaServer).toBe('plex');
    expect(state).toBeNull();
  });

  test('returns null state when state.json missing', async () => {
    const blob = await createValidBundle();
    const { state } = await parseSurgeBundle(blob);
    expect(state).toBeNull();
  });

  test('parses valid state.json when present', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', JSON.stringify({
      platform: 'docker',
      docker: { rootPath: '/srv' },
    }));
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    const stateData = { secrets: { sonarr: { apiKey: 'test123' } } };
    zip.file('surge-deploy/.surge/state.json', JSON.stringify(stateData));
    const blob = await zip.generateAsync({ type: 'blob' });

    const { state } = await parseSurgeBundle(blob);
    expect(state).toEqual(stateData);
  });

  test('ignores malformed state.json and logs warning', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', JSON.stringify({
      platform: 'unraid',
    }));
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    zip.file('surge-deploy/.surge/state.json', 'not valid json {');
    const blob = await zip.generateAsync({ type: 'blob' });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { config, state } = await parseSurgeBundle(blob);
    expect(config).toBeDefined();
    expect(state).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('state.json was not valid JSON'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  test('throws when config.json missing', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      /Missing config.json/
    );
  });

  test('throws when manifest.json missing', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', JSON.stringify({
      platform: 'unraid',
    }));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      /Missing.*manifest/
    );
  });

  test('throws when config.json is not a JSON object', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', 'null');
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      /config.json is not a JSON object/
    );
  });

  test('throws when config.json is not valid JSON', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', '{invalid json');
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      expect.any(SyntaxError)
    );
  });

  test('throws when manifest.json is not valid JSON', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', JSON.stringify({ platform: 'docker' }));
    zip.file('surge-deploy/manifest.json', '{not valid');
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      expect.any(SyntaxError)
    );
  });

  test('parses complex config with all fields', async () => {
    const complexConfig = {
      platform: 'unraid',
      unraid: { useCacheDrive: true, cachePath: '/mnt/cache', appdataPath: '/mnt/user/appdata' },
      mediaServer: 'plex',
      plexSettings: { PLEX_CLAIM: 'claim-xyz', ADVERTISE_IP: '192.168.1.100' },
      contentEnhancement: { sonarr: true, radarr: true },
      tmdbApiKey: 'test-key',
    };
    const blob = await createValidBundle(complexConfig);
    const { config } = await parseSurgeBundle(blob);

    expect(config.platform).toBe('unraid');
    expect(config.contentEnhancement.sonarr).toBe(true);
    expect(config.tmdbApiKey).toBe('test-key');
  });

  test('handles bundle with empty services manifest', async () => {
    const blob = await createValidBundle({
      manifest: { services: {} },
    });
    const { config } = await parseSurgeBundle(blob);
    expect(config).toBeDefined();
  });

  test('returns both config and state when both present', async () => {
    const zip = new JSZip();
    const configData = { platform: 'docker', docker: { rootPath: '/data' } };
    const stateData = { secrets: { test: 'value' } };
    zip.file('surge-deploy/config.json', JSON.stringify(configData));
    zip.file('surge-deploy/manifest.json', JSON.stringify({ services: {} }));
    zip.file('surge-deploy/.surge/state.json', JSON.stringify(stateData));
    const blob = await zip.generateAsync({ type: 'blob' });

    const result = await parseSurgeBundle(blob);
    expect(result.config).toEqual(configData);
    expect(result.state).toEqual(stateData);
  });

  test('handles array in state.json', async () => {
    const zip = new JSZip();
    zip.file('surge-deploy/config.json', JSON.stringify({ platform: 'docker' }));
    zip.file('surge-deploy/manifest.json', JSON.stringify({}));
    const stateArray = [{ name: 'item1' }, { name: 'item2' }];
    zip.file('surge-deploy/.surge/state.json', JSON.stringify(stateArray));
    const blob = await zip.generateAsync({ type: 'blob' });

    const { state } = await parseSurgeBundle(blob);
    expect(Array.isArray(state)).toBe(true);
    expect(state).toHaveLength(2);
  });

  test('throws when bundle has no surge-deploy directory structure', async () => {
    const zip = new JSZip();
    zip.file('config.json', JSON.stringify({ platform: 'docker' }));
    zip.file('manifest.json', JSON.stringify({}));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseSurgeBundle(blob)).rejects.toThrow(
      /Missing config.json/
    );
  });
});
