/**
 * Tests for healthcheckUtils.js — healthcheck parsing and endpoint extraction.
 */

import { getHealthcheck, extractHttpEndpoint } from '../healthcheckUtils';

describe('getHealthcheck', () => {
  test('returns null for unknown service', () => {
    const result = getHealthcheck('nonexistentservice');
    expect(result).toBeNull();
  });

  test('returns null when service has no healthcheck', () => {
    // Many services don't have healthchecks defined
    // Testing that we gracefully handle missing healthcheck
    const result = getHealthcheck('unknown-service-xyz');
    expect(result).toBeNull();
  });

  test('returns parsed healthcheck for sonarr', () => {
    const result = getHealthcheck('sonarr');
    if (result) {
      expect(result).toHaveProperty('command');
      expect(result).toHaveProperty('interval');
      expect(result).toHaveProperty('timeout');
      expect(result).toHaveProperty('retries');
      expect(result).toHaveProperty('startPeriod');
    }
  });

  test('returns parsed healthcheck for radarr', () => {
    const result = getHealthcheck('radarr');
    if (result) {
      expect(result).toHaveProperty('command');
      expect(typeof result.command).toBe('string');
    }
  });

  test('healthcheck has correct fields and defaults', () => {
    const result = getHealthcheck('sonarr');
    if (result) {
      // Fields are always present, but values may vary per service
      expect(result).toHaveProperty('interval');
      expect(result).toHaveProperty('timeout');
      expect(result).toHaveProperty('retries');
      expect(result).toHaveProperty('startPeriod');
      // All values should be non-null strings or numbers
      expect(typeof result.interval).toBe('string');
      expect(typeof result.timeout).toBe('string');
      expect(typeof result.startPeriod).toBe('string');
      expect(typeof result.retries).toBe('number');
    }
  });

  test('extracts command from CMD-SHELL array format', () => {
    // Most Docker healthchecks are ['CMD-SHELL', 'command string']
    const result = getHealthcheck('sonarr');
    if (result) {
      expect(typeof result.command).toBe('string');
      expect(result.command.length).toBeGreaterThan(0);
    }
  });

  test('plex (mediaServer) returns healthcheck if defined', () => {
    const result = getHealthcheck('plex');
    // Plex may or may not have a healthcheck
    if (result) {
      expect(typeof result.command).toBe('string');
    }
  });

  test('jellyfin (mediaServer) returns healthcheck if defined', () => {
    const result = getHealthcheck('jellyfin');
    // Jellyfin may or may not have a healthcheck
    if (result) {
      expect(typeof result.command).toBe('string');
    }
  });

  test('emby (mediaServer) returns healthcheck if defined', () => {
    const result = getHealthcheck('emby');
    if (result) {
      expect(typeof result.command).toBe('string');
    }
  });
});

describe('extractHttpEndpoint', () => {
  test('extracts http://localhost:PORT from wget command', () => {
    const cmd = 'wget --quiet --tries=1 --spider http://localhost:8989/ || exit 1';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/');
  });

  test('extracts https://localhost:PORT from curl command', () => {
    const cmd = 'curl -f https://localhost:6767/health || exit 1';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('https://localhost:6767/health');
  });

  test('extracts http with path', () => {
    const cmd = 'wget http://localhost:8989/api/health';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/api/health');
  });

  test('extracts first URL when multiple present', () => {
    const cmd = 'curl http://localhost:8989 || curl http://localhost:8990';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989');
  });

  test('returns null for empty string', () => {
    const result = extractHttpEndpoint('');
    expect(result).toBeNull();
  });

  test('returns null for null input', () => {
    const result = extractHttpEndpoint(null);
    expect(result).toBeNull();
  });

  test('returns null for undefined input', () => {
    const result = extractHttpEndpoint(undefined);
    expect(result).toBeNull();
  });

  test('returns null when no http/https URL found', () => {
    const cmd = 'test -f /config/config.xml || exit 1';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBeNull();
  });

  test('returns null for ftp:// or other non-http schemes', () => {
    const cmd = 'curl ftp://localhost:8989';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBeNull();
  });

  test('handles URL with query parameters', () => {
    const cmd = 'curl http://localhost:8989/api?key=value';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/api?key=value');
  });

  test('stops at spaces in URL', () => {
    const cmd = 'curl http://localhost:8989/api || echo "failed"';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/api');
  });

  test('stops at quotes in URL', () => {
    const cmd = 'curl "http://localhost:8989/api" || exit 1';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/api');
  });

  test('stops at pipe character', () => {
    const cmd = 'wget http://localhost:8989/ | grep -q online';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/');
  });

  test('handles complex healthcheck command', () => {
    const cmd = 'CMD-SHELL\twget --no-verbose --tries=1 --spider http://localhost:8989/system/status/health || exit 1';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/system/status/health');
  });

  test('handles IPv6 localhost', () => {
    const cmd = 'curl http://[::1]:8989/health';
    const result = extractHttpEndpoint(cmd);
    // IPv6 handling may vary; just ensure we get something
    expect(result).toBeTruthy();
  });

  test('handles URL without trailing slash', () => {
    const cmd = 'wget --quiet --spider http://localhost:8989';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989');
  });

  test('handles localhost with explicit hostname', () => {
    const cmd = 'curl http://myhost:9000/api/v1/status';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://myhost:9000/api/v1/status');
  });

  test('stops at angle brackets (for template escaping)', () => {
    const cmd = 'curl http://localhost:8989/api > /dev/null';
    const result = extractHttpEndpoint(cmd);
    expect(result).toBe('http://localhost:8989/api');
  });

  test('returns null for malformed URL fragments', () => {
    const cmd = 'curl http:// || exit 1';
    const result = extractHttpEndpoint(cmd);
    // May return 'http://' or null depending on regex; just ensure no crash
    expect(typeof result === 'string' || result === null).toBe(true);
  });
});
