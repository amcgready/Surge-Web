/**
 * deployBundle.test.js — verifies the deploy bundle assembly produces
 * a well-formed ZIP with all expected files.
 *
 * Mocks `fetch` so the test doesn't depend on `frontend/public/deploy_assets/`
 * being populated — we stub a minimal inventory + script payload and
 * verify the bundle structure.
 */

import JSZip from 'jszip';
import { buildDeployBundle, buildManifest } from '../deployBundle';


// ---------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------

const FAKE_INVENTORY = {
  scripts: [
    'scripts/configure-sonarr.py',
    'scripts/fetch-plex-secrets.py',
  ],
  orchestrator: [
    'orchestrator/surge_orchestrator.py',
  ],
};

const FAKE_PAYLOADS = {
  '/deploy_assets/inventory.json': JSON.stringify(FAKE_INVENTORY),
  '/deploy_assets/scripts/configure-sonarr.py':
    '#!/usr/bin/env python3\n# fake configure-sonarr.py\n',
  '/deploy_assets/scripts/fetch-plex-secrets.py':
    '#!/usr/bin/env python3\n# fake fetch-plex-secrets.py\n',
  '/deploy_assets/orchestrator/surge_orchestrator.py':
    '#!/usr/bin/env python3\n# fake orchestrator\n',
};


beforeEach(() => {
  global.fetch = jest.fn(async (url) => {
    if (FAKE_PAYLOADS[url]) {
      const body = FAKE_PAYLOADS[url];
      return {
        ok: true,
        status: 200,
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  });
});


// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('buildManifest', () => {
  test('strips logo fields from both registries', () => {
    const m = buildManifest();
    for (const meta of Object.values(m.serviceMeta)) {
      expect(meta).not.toHaveProperty('logo');
    }
    for (const meta of Object.values(m.mediaServerMeta)) {
      expect(meta).not.toHaveProperty('logo');
    }
  });

  test('includes every expected service', () => {
    const m = buildManifest();
    expect(Object.keys(m.serviceMeta)).toEqual(
      expect.arrayContaining(['sonarr', 'radarr', 'cinesync', 'episeerr']),
    );
    expect(Object.keys(m.mediaServerMeta)).toEqual(
      expect.arrayContaining(['plex', 'jellyfin', 'emby']),
    );
  });
});


describe('buildDeployBundle', () => {
  const baseConfig = {
    platform: 'unraid',
    unraid:   { useCacheDrive: true, cachePath: '/mnt/cache' },
    mediaServer: 'plex',
    plexSettings: { PLEX_CLAIM: 'test-claim', ADVERTISE_IP: '' },
    contentEnhancement: { sonarr: true, radarr: true },
  };

  test('produces a ZIP Blob with the expected file tree', async () => {
    const blob = await buildDeployBundle({ config: baseConfig });

    expect(blob).toBeInstanceOf(Blob);

    // Re-open the ZIP to inspect contents.
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toEqual(expect.arrayContaining([
      'surge-deploy/manifest.json',
      'surge-deploy/config.json',
      'surge-deploy/README.md',
      'surge-deploy/run.sh',
      'surge-deploy/scripts/configure-sonarr.py',
      'surge-deploy/scripts/fetch-plex-secrets.py',
      'surge-deploy/orchestrator/surge_orchestrator.py',
    ]));
    // No state.json without one provided.
    expect(names).not.toContain('surge-deploy/.surge/state.json');
  });

  test('manifest.json round-trips as valid JSON with the schema shape', async () => {
    const blob = await buildDeployBundle({ config: baseConfig });
    const zip = await JSZip.loadAsync(blob);
    const manifestText = await zip.file('surge-deploy/manifest.json').async('string');
    const manifest = JSON.parse(manifestText);
    expect(manifest).toHaveProperty('serviceMeta');
    expect(manifest).toHaveProperty('mediaServerMeta');
    expect(manifest.serviceMeta.sonarr).toBeDefined();
    expect(manifest.serviceMeta.sonarr.compose).toBeDefined();
  });

  test('config.json round-trips identically', async () => {
    const blob = await buildDeployBundle({ config: baseConfig });
    const zip = await JSZip.loadAsync(blob);
    const configText = await zip.file('surge-deploy/config.json').async('string');
    expect(JSON.parse(configText)).toEqual(baseConfig);
  });

  test('priorState lands at .surge/state.json when provided', async () => {
    const priorState = {
      secrets:        { 'sonarr.apiKey': 'fake-persisted-key' },
      runtimeValues:  { 'plex.plexToken': 'fake-token' },
    };
    const blob = await buildDeployBundle({ config: baseConfig, priorState });
    const zip = await JSZip.loadAsync(blob);
    const stateFile = zip.file('surge-deploy/.surge/state.json');
    expect(stateFile).not.toBeNull();
    const stateText = await stateFile.async('string');
    expect(JSON.parse(stateText)).toEqual(priorState);
  });

  test('README mentions Unraid quickstart when platform=unraid', async () => {
    const blob = await buildDeployBundle({ config: baseConfig });
    const zip = await JSZip.loadAsync(blob);
    const readme = await zip.file('surge-deploy/README.md').async('string');
    expect(readme).toMatch(/Unraid quickstart/);
    expect(readme).toMatch(/Compose Manager/);
    expect(readme).not.toMatch(/Docker host quickstart/);
  });

  test('README switches to Docker quickstart when platform=docker', async () => {
    const blob = await buildDeployBundle({
      config: { ...baseConfig, platform: 'docker',
                docker: { rootPath: '/srv/surge' } },
    });
    const zip = await JSZip.loadAsync(blob);
    const readme = await zip.file('surge-deploy/README.md').async('string');
    expect(readme).toMatch(/Docker host quickstart/);
    expect(readme).not.toMatch(/Unraid quickstart/);
  });

  test('run.sh is executable and invokes the orchestrator', async () => {
    const blob = await buildDeployBundle({ config: baseConfig });
    const zip = await JSZip.loadAsync(blob);
    const run = zip.file('surge-deploy/run.sh');
    expect(run).not.toBeNull();
    const text = await run.async('string');
    expect(text).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(text).toMatch(/surge_orchestrator\.py/);
    expect(text).toMatch(/--manifest\s+manifest\.json/);
    expect(text).toMatch(/--config\s+config\.json/);
  });
});
