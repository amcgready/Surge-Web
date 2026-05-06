/**
 * Tests for "existing-services mode" — services flagged in
 * config.externalServices.<key>.external should be:
 *   1. Excluded from preview.services (no container emission)
 *   2. Excluded from preview.secrets (no auto-generated secret)
 *   3. Resolvable as cross-references via fromService/fromServiceSecret
 *      using the user-provided url + apiKey (NOT placeholder strings)
 *
 * Locked-in cases here keep the wizard preview and the orchestrator's
 * Python implementation aligned. If these drift you'll get bundles
 * that look right in the wizard but fail at deploy time.
 */
import { generateComposePreview } from '../composePreview';

function makeConfig(overrides = {}) {
  return {
    platform: 'docker',
    docker: { rootPath: '/srv/surge' },
    mediaServer: '',
    contentEnhancement: {},
    externalServices: {},
    ...overrides,
  };
}

describe('externalServices mode', () => {
  test('a normal service emits a container by default', () => {
    const result = generateComposePreview(makeConfig({
      contentEnhancement: { sonarr: true },
    }));
    expect(result.services).toHaveProperty('sonarr');
  });

  test('a service marked external is NOT emitted as a container', () => {
    const result = generateComposePreview(makeConfig({
      contentEnhancement: { sonarr: true },
      externalServices: {
        sonarr: { external: true, url: 'http://10.0.0.5:8989', apiKey: 'k1' },
      },
    }));
    expect(result.services).not.toHaveProperty('sonarr');
  });

  test('an external media server is NOT emitted as a container', () => {
    const result = generateComposePreview(makeConfig({
      mediaServer: 'plex',
      externalServices: {
        plex: { external: true, url: 'http://10.0.0.5:32400', apiKey: 't1' },
      },
    }));
    expect(result.services).not.toHaveProperty('plex');
  });

  test('a service marked external generates no secrets', () => {
    const result = generateComposePreview(makeConfig({
      contentEnhancement: { sonarr: true },
      externalServices: {
        sonarr: { external: true, url: 'http://10.0.0.5:8989', apiKey: 'k1' },
      },
    }));
    // sonarr's apiKey secret shouldn't appear when sonarr is external.
    expect(Object.keys(result.secrets || {})).not.toContain('sonarr.apiKey');
  });

  test('cross-reference fromServiceSecret resolves to external apiKey', () => {
    // Bazarr depends on Sonarr's apiKey via fromServiceSecret; with
    // sonarr external, bazarr's env should embed the user-supplied
    // key directly, not the <GENERATED:sonarr.apiKey> placeholder.
    const result = generateComposePreview(makeConfig({
      contentEnhancement: { sonarr: true, bazarr: true },
      externalServices: {
        sonarr: { external: true, url: 'http://10.0.0.5:8989', apiKey: 'real-sonarr-key' },
      },
    }));
    expect(result.services).toHaveProperty('bazarr');
    // Look at any postDeployScript env that references sonarr's apiKey.
    const bazarrScripts = result.postDeployScripts.filter(
      (s) => s.service === 'bazarr',
    );
    const allEnvValues = bazarrScripts.flatMap((s) => Object.values(s.env || {}));
    const hasRealKey = allEnvValues.some((v) =>
      typeof v === 'string' && v === 'real-sonarr-key',
    );
    const hasPlaceholder = allEnvValues.some((v) =>
      typeof v === 'string' && v.includes('<GENERATED:sonarr.apiKey>'),
    );
    expect(hasRealKey).toBe(true);
    expect(hasPlaceholder).toBe(false);
  });

  test('externalServices flag with no contentEnhancement entry is silent', () => {
    // Marking a service external without enabling it shouldn't
    // produce any container, secret, or warning.
    const result = generateComposePreview(makeConfig({
      externalServices: {
        sonarr: { external: true, url: 'http://10.0.0.5:8989', apiKey: 'k' },
      },
    }));
    expect(Object.keys(result.services)).toHaveLength(0);
  });

  test('external flag false acts identically to no entry', () => {
    const result = generateComposePreview(makeConfig({
      contentEnhancement: { sonarr: true },
      externalServices: {
        sonarr: { external: false, url: 'http://10.0.0.5:8989', apiKey: 'k' },
      },
    }));
    expect(result.services).toHaveProperty('sonarr');
  });
});
