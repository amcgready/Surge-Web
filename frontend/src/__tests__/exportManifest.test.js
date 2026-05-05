/**
 * Exports the schema (serviceMeta + mediaServerMeta) to a JSON file
 * the Python orchestrator consumes. Runs as part of `npm test`.
 *
 * The output lands at `../orchestrator/test_fixtures/manifest.json`,
 * relative to frontend/ — same path the orchestrator's --manifest
 * argument expects.
 *
 * This isn't really a "test" — it's a build-time export that piggy-
 * backs on Jest's Babel setup so we don't need a separate
 * @babel/register install at the repo root. The single assertion
 * verifies the file got written.
 */

import fs from 'fs';
import path from 'path';
import { serviceMeta } from '../AdditionalServicesStep';
import { mediaServerMeta } from '../mediaServerMeta';


function stripLogos(meta) {
  // Logos are webpack-resolved imports — they'd serialize as
  // bare-string filenames, useless to the orchestrator. Strip them.
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    const { logo, ...rest } = v;
    out[k] = rest;
  }
  return out;
}


test('export schema manifest for orchestrator', () => {
  const manifest = {
    serviceMeta:     stripLogos(serviceMeta),
    mediaServerMeta: stripLogos(mediaServerMeta),
  };

  // Write to orchestrator/test_fixtures/manifest.json (relative to repo root).
  const outPath = path.resolve(__dirname, '../../../orchestrator/test_fixtures/manifest.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  // Sanity-check: at least every service we expect is present.
  expect(Object.keys(manifest.serviceMeta)).toContain('sonarr');
  expect(Object.keys(manifest.serviceMeta)).toContain('radarr');
  expect(Object.keys(manifest.serviceMeta)).toContain('cinesync');
  expect(Object.keys(manifest.mediaServerMeta)).toEqual(
    expect.arrayContaining(['plex', 'jellyfin', 'emby']),
  );

  // File should exist now.
  expect(fs.existsSync(outPath)).toBe(true);
});
