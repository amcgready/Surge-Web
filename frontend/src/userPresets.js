/**
 * userPresets.js — localStorage-backed user-defined wizard presets.
 *
 * Built-in presets (PRESETS array in AdditionalServicesStep.js) are
 * shipped with the wizard and never change. User presets sit
 * alongside them: same shape (`{ key, name, mediaServer, services }`)
 * plus a `userDefined: true` flag and a `savedAt` ISO timestamp.
 *
 * Storage key: `surge-presets` (also exported by SettingsBackup so it
 * travels with settings exports).
 *
 * Schema versioning: stored object is `{ schema: 1, presets: [...] }`.
 * If the format changes, bump schema and migrate inside loadPresets.
 */

const STORAGE_KEY = 'surge-presets';

export function loadPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== 1 || !Array.isArray(parsed.presets)) {
      return [];
    }
    return parsed.presets;
  } catch (err) {
    return [];
  }
}

export function savePresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schema: 1,
      presets,
    }));
  } catch (err) {
    // Storage full or unavailable. Surface to caller via thrown error
    // so they can show an alert; silent failures here would be
    // confusing.
    throw new Error('Could not save presets — localStorage unavailable.');
  }
}

/**
 * Build a user-preset record from the current wizard state.
 *
 * Sanitizes: only includes services that are explicitly true (no
 * point storing the implicit-false defaults).
 */
export function buildPresetFromCurrent({ name, mediaServer, contentEnhancement }) {
  const services = {};
  for (const [key, enabled] of Object.entries(contentEnhancement || {})) {
    if (enabled) services[key] = true;
  }
  return {
    // Slugified key — used for de-duplication and the React key prop.
    key:         'user-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-+|-+$/g, ''),
    name,
    desc:        `${Object.keys(services).length} service${
                    Object.keys(services).length === 1 ? '' : 's'
                  } · ${mediaServer || 'no media server'}`,
    mediaServer,
    services,
    userDefined: true,
    savedAt:     new Date().toISOString(),
  };
}

/** Add or update (replace by key) a preset. Returns the new list. */
export function upsertPreset(presets, preset) {
  const others = (presets || []).filter((p) => p.key !== preset.key);
  return [...others, preset];
}

/** Remove a preset by key. Returns the new list. */
export function deletePreset(presets, key) {
  return (presets || []).filter((p) => p.key !== key);
}
