/**
 * Tag upgrade utilities extracted from TagUpgradePanel.js.
 * Image parsing and semver pin selection logic.
 */

/**
 * Parse `namespace/repo:tag` (or `registry/namespace/repo:tag`) into
 * the components we need to query Docker Hub. Returns null when the
 * image isn't on Hub or its mirror.
 */
export function parseImageRef(image) {
  if (!image) return null;
  const [refNoTag, tag = 'latest'] = image.split(':');
  const parts = refNoTag.split('/');

  // Strip lscr.io prefix — it mirrors Docker Hub.
  let namespace, repo, isHub = false, registry = null;
  if (parts.length === 3 && parts[0] === 'lscr.io') {
    namespace = parts[1];
    repo      = parts[2];
    isHub     = true;
    registry  = 'lscr.io';
  } else if (parts.length === 2) {
    namespace = parts[0];
    repo      = parts[1];
    isHub     = true;
    registry  = 'docker.io';
  } else if (parts.length === 3 && parts[0].includes('.')) {
    // Other registry, e.g. ghcr.io/foo/bar
    namespace = parts[1];
    repo      = parts[2];
    isHub     = false;
    registry  = parts[0];
  } else if (parts.length === 1) {
    // bare image name — `library/<name>` on Hub.
    namespace = 'library';
    repo      = parts[0];
    isHub     = true;
    registry  = 'docker.io';
  }

  return { namespace, repo, tag, isHub, registry };
}

/**
 * Pick the "best" few tags to suggest as pin targets.
 *   1. Anything matching a semver-ish pattern (X.Y.Z, X.Y.Z.W, etc.)
 *   2. Sorted by last_updated desc — newest first
 *   3. Top 5
 * We deliberately exclude `:latest`, `:nightly`, `:edge` since those
 * are exactly what users are pinning *away* from.
 */
export function suggestPins(tags) {
  const SEMVER = /^v?\d+(\.\d+){1,3}([._-][\w.]+)?$/;
  const EXCLUDE = new Set(['latest', 'nightly', 'edge', 'develop', 'main',
                           'master', 'beta', 'alpha', 'stable']);
  return tags
    .filter((t) => SEMVER.test(t.name) && !EXCLUDE.has(t.name.toLowerCase()))
    .slice(0, 5);
}
