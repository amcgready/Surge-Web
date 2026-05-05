/**
 * dependencyWarnings.test.js — verifies the schema-derived warning
 * computation in AdditionalServicesStep matches the actual gating
 * markers we've wired throughout the schema.
 *
 * The component exports `walkEnvBlocks`/`collectGates`-style
 * helpers indirectly via its render, so this test re-derives the
 * peer set the same way and pins the expectation per service. Any
 * drift (a service gains/loses a whenService gate) will surface as
 * an assertion failure.
 */

import { serviceMeta } from '../AdditionalServicesStep';


// Re-derive the peer/media-server gate sets — same logic the component
// runs at render time. Kept minimal so it stays in sync without
// importing the full module's internals.
function getGates(serviceKey) {
  const meta = serviceMeta[serviceKey];
  if (!meta?.compose) return { peers: new Set(), mediaServers: new Set() };
  const peerSet = new Set();
  const mediaServerSet = new Set();

  const visit = (marker) => {
    if (!marker || typeof marker !== 'object') return;
    if (typeof marker.whenService === 'string') peerSet.add(marker.whenService);
    if (typeof marker.whenMediaServer === 'string') {
      mediaServerSet.add(marker.whenMediaServer);
    }
  };
  const visitDict = (env) => {
    if (!env) return;
    Object.values(env).forEach(visit);
  };

  const compose = meta.compose;
  visitDict(compose.env);
  visitDict(compose.fetchScript?.env);
  visitDict(compose.postDeployScript?.env);
  if (compose.services) {
    for (const sub of Object.values(compose.services)) visitDict(sub.env);
  }
  return { peers: peerSet, mediaServers: mediaServerSet };
}


describe('dependency-warning gates', () => {
  test('boxarr declares whenService:radarr', () => {
    const { peers } = getGates('boxarr');
    expect(peers.has('radarr')).toBe(true);
  });

  test('bazarr declares both *arr peers + plex media-server gate', () => {
    const { peers, mediaServers } = getGates('bazarr');
    expect(peers.has('sonarr')).toBe(true);
    expect(peers.has('radarr')).toBe(true);
    expect(mediaServers.has('plex')).toBe(true);
  });

  test('episeerr declares Sonarr + Radarr + Tautulli + every media server', () => {
    const { peers, mediaServers } = getGates('episeerr');
    expect(peers.has('sonarr')).toBe(true);
    expect(peers.has('radarr')).toBe(true);
    expect(peers.has('tautulli')).toBe(true);
    expect(peers.has('prowlarr')).toBe(true);  // postDeployScript.env
    expect(peers.has('sabnzbd')).toBe(true);   // postDeployScript.env
    expect(mediaServers.has('plex')).toBe(true);
    expect(mediaServers.has('jellyfin')).toBe(true);
    expect(mediaServers.has('emby')).toBe(true);
  });

  test('pulsarr declares Plex + sonarr + radarr', () => {
    const { peers, mediaServers } = getGates('pulsarr');
    expect(peers.has('sonarr')).toBe(true);
    expect(peers.has('radarr')).toBe(true);
    expect(mediaServers.has('plex')).toBe(true);
  });

  test('tautulli declares Plex media-server dependency', () => {
    const { mediaServers } = getGates('tautulli');
    expect(mediaServers.has('plex')).toBe(true);
  });

  test('flaresolverr has zero gates (truly standalone service)', () => {
    const { peers, mediaServers } = getGates('flaresolverr');
    expect(peers.size).toBe(0);
    expect(mediaServers.size).toBe(0);
  });

  test('sabnzbd has zero gates (downstream consumer, not a consumer of others)', () => {
    const { peers, mediaServers } = getGates('sabnzbd');
    expect(peers.size).toBe(0);
    expect(mediaServers.size).toBe(0);
  });

  test('every gated peer references a real serviceMeta entry', () => {
    // No typos in whenService values — catches schema drift.
    for (const key of Object.keys(serviceMeta)) {
      const { peers } = getGates(key);
      for (const peer of peers) {
        expect(serviceMeta[peer]).toBeDefined();
      }
    }
  });
});
