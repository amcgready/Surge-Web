/**
 * Bundle parsing utilities extracted from BundleInspector.js.
 * Client-side ZIP parsing — no network, no upload.
 */

import JSZip from 'jszip';

/**
 * Parse a surge-deploy.zip Blob into the structured payload.
 * Returns { config, state } or throws on parse failure.
 */
export async function parseSurgeBundle(blob) {
  const zip = await JSZip.loadAsync(blob);
  const requireFile = async (path, label) => {
    const f = zip.file(path);
    if (!f) {
      throw new Error(`Missing ${label} (expected at ${path}). ` +
                      `Is this a Surge deploy bundle?`);
    }
    return f.async('string');
  };

  const configText   = await requireFile('surge-deploy/config.json', 'config.json');
  const manifestText = await requireFile('surge-deploy/manifest.json', 'manifest.json');
  const config = JSON.parse(configText);
  // Validate basic shape — wizard config has at minimum platform.
  if (typeof config !== 'object' || config === null) {
    throw new Error('config.json is not a JSON object — corrupt bundle?');
  }
  // Sanity-check manifest is parseable but don't load it into state
  // (the wizard re-derives the manifest from its in-memory schema).
  JSON.parse(manifestText);

  // state.json is optional — present only when the bundle was rebuilt
  // with prior secrets carried over.
  let state = null;
  const stateFile = zip.file('surge-deploy/.surge/state.json');
  if (stateFile) {
    try {
      state = JSON.parse(await stateFile.async('string'));
    } catch (err) {
      // Bad JSON in state.json — treat as missing, log a warning.
      console.warn('Bundle\'s state.json was not valid JSON:', err);
    }
  }

  return { config, state };
}
