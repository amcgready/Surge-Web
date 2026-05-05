/**
 * Schema validator tests.
 *
 * Walks every entry in serviceMeta + mediaServerMeta and asserts:
 *   - Structural invariants (required fields, lowercase keys, etc).
 *   - Cross-reference integrity (fromService points at a real service,
 *     fromServiceSecret points at a real secret on a real service,
 *     ${name} substitutions in env literals match a declared secret,
 *     dependsOn keys reference real sub-containers, etc).
 *
 * Run via `npm test -- --watchAll=false` from frontend/.
 */

import {
  serviceMeta,
  categories,
  allServices,
  resolveMount,
  containerNameFor,
} from '../AdditionalServicesStep';
import { mediaServerMeta } from '../mediaServerMeta';

// Combined registry — useful for cross-reference checks that don't
// care which source a service comes from.
const allMeta = { ...serviceMeta, ...mediaServerMeta };

// Tokens our resolveMount knows how to substitute. Anything else
// in a mount.src position is a bare path (no token) — also valid.
const KNOWN_PATH_TOKENS = new Set(['mediaRoot', 'configRoot', 'userSharesRoot']);

// Categories declared in the categories array. Used to validate
// service.category values.
const VALID_CATEGORIES = new Set(categories.map(c => c.key).filter(k => k !== 'all'));

const VALID_MEDIA_SERVERS = new Set(['plex', 'jellyfin', 'emby']);

// Known user-wizard config keys — anywhere ${name} appears in file
// content or env literals, the backend's resolver will look it up in
// the user's wizard config (config.<key>) in addition to the service's
// own secrets. This list mirrors the initial state in App.js.
// Update when new wizard fields are added.
const KNOWN_CONFIG_KEYS = new Set([
  'tmdbApiKey',
  'rdApiToken',
  'adApiToken',
  'premiumizeApiToken',
  'fanartApiKey',
  'tvdbApiKey',
  'mdblistApiKey',
  'discordWebhook',
  // Dotted paths into nested config objects — substitution resolver
  // walks these via readDottedPath. Add new entries when wizard fields
  // referenced from compose.files.content or env literals get added.
  'cinesyncSettings.animeSeparation',
  'cinesyncSettings.fourKSeparation',
]);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function leadingToken(src) {
  // Returns the leading-word token of a mount source, e.g.
  // "mediaRoot/media/Intake" -> "mediaRoot", "/home" -> "/home".
  if (!src) return '';
  const first = src.split('/')[0];
  return first;
}

function walkEnvMarkers(meta, visit) {
  // Iterate every env marker on a service entry, calling
  // visit(envName, marker, containerKey) for each.
  // containerKey is the sub-container key for multi-container, or null
  // for single-container.
  const compose = meta.compose;
  if (!compose) return;
  if (compose.env) {
    for (const [name, marker] of Object.entries(compose.env)) {
      visit(name, marker, null);
    }
  }
  if (compose.services) {
    for (const [subKey, sub] of Object.entries(compose.services)) {
      if (sub.env) {
        for (const [name, marker] of Object.entries(sub.env)) {
          visit(name, marker, subKey);
        }
      }
    }
  }
  if (compose.fetchScript?.env) {
    for (const [name, marker] of Object.entries(compose.fetchScript.env)) {
      visit(name, marker, '__fetchScript__');
    }
  }
  if (compose.postDeployScript?.env) {
    for (const [name, marker] of Object.entries(compose.postDeployScript.env)) {
      visit(name, marker, '__postDeployScript__');
    }
  }
}

function walkMounts(meta, visit) {
  // Iterate every mount, calling visit(mount, containerKey).
  const compose = meta.compose;
  if (!compose) return;
  if (compose.mounts) {
    for (const m of compose.mounts) visit(m, null);
  }
  if (compose.services) {
    for (const [subKey, sub] of Object.entries(compose.services)) {
      if (sub.mounts) {
        for (const m of sub.mounts) visit(m, subKey);
      }
    }
  }
}

function getDeclaredSecrets(meta) {
  // Returns a Set of declared secret names on a service.
  return new Set(Object.keys(meta?.compose?.secrets || {}));
}

// ---------------------------------------------------------------------
// Service-key naming
// ---------------------------------------------------------------------

describe('service key naming', () => {
  test('every serviceMeta key is lowercase + hyphens-only', () => {
    for (const key of Object.keys(serviceMeta)) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('every mediaServerMeta key is lowercase', () => {
    for (const key of Object.keys(mediaServerMeta)) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('mediaServerMeta keys are exactly plex/jellyfin/emby', () => {
    expect(new Set(Object.keys(mediaServerMeta))).toEqual(VALID_MEDIA_SERVERS);
  });

  test('containerNameFor returns lowercase verbatim', () => {
    for (const key of Object.keys(allMeta)) {
      expect(containerNameFor(key)).toBe(key.toLowerCase());
    }
  });

  test('serviceMeta keys all appear in allServices array (no orphans)', () => {
    expect(new Set(Object.keys(serviceMeta))).toEqual(new Set(allServices));
  });
});

// ---------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------

describe('required fields', () => {
  test.each(Object.entries(serviceMeta))(
    'serviceMeta.%s has name/desc/category/repo',
    (key, meta) => {
      expect(meta.name).toBeTruthy();
      expect(meta.desc).toBeTruthy();
      expect(meta.category).toBeTruthy();
      expect(meta.repo).toBeTruthy();
    },
  );

  test.each(Object.entries(serviceMeta))(
    'serviceMeta.%s has compose template',
    (key, meta) => {
      expect(meta.compose).toBeDefined();
      expect(meta.compose).not.toBeNull();
    },
  );

  test.each(Object.entries(serviceMeta))(
    'serviceMeta.%s.category is a known category',
    (key, meta) => {
      expect(VALID_CATEGORIES.has(meta.category)).toBe(true);
    },
  );

  test.each(Object.entries(mediaServerMeta))(
    'mediaServerMeta.%s has name/desc/repo',
    (key, meta) => {
      expect(meta.name).toBeTruthy();
      expect(meta.desc).toBeTruthy();
      expect(meta.repo).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------
// Mount source tokens
// ---------------------------------------------------------------------

describe('mount source tokens', () => {
  test('every mount.src uses a known token or is an absolute path', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkMounts(meta, (mount) => {
        const tok = leadingToken(mount.src);
        const isKnownToken = KNOWN_PATH_TOKENS.has(tok);
        const isAbsolutePath = mount.src.startsWith('/');
        if (!isKnownToken && !isAbsolutePath) {
          throw new Error(
            `${key}: unknown mount source token "${tok}" in "${mount.src}"`,
          );
        }
      });
    }
  });

  test('every mount has both src and dst', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkMounts(meta, (mount, containerKey) => {
        expect(mount.src).toBeTruthy();
        expect(mount.dst).toBeTruthy();
      });
    }
  });

  test('every mount.dst is an absolute path', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkMounts(meta, (mount) => {
        if (!mount.dst.startsWith('/')) {
          throw new Error(`${key}: mount dst "${mount.dst}" must be absolute`);
        }
      });
    }
  });
});

// ---------------------------------------------------------------------
// Cross-references (fromSecret, fromServiceSecret, fromService, etc)
// ---------------------------------------------------------------------

describe('env marker cross-references', () => {
  test('fromSecret references a secret on the same service', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const declared = getDeclaredSecrets(meta);
      walkEnvMarkers(meta, (envName, marker) => {
        if (marker && typeof marker === 'object' && 'fromSecret' in marker) {
          if (!declared.has(marker.fromSecret)) {
            throw new Error(
              `${key}: env ${envName} references unknown secret "${marker.fromSecret}" ` +
                `(declared: ${[...declared].join(', ') || 'none'})`,
            );
          }
        }
      });
    }
  });

  test('fromServiceSecret references a real service + secret', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkEnvMarkers(meta, (envName, marker) => {
        if (marker && typeof marker === 'object' && 'fromServiceSecret' in marker) {
          const target = allMeta[marker.fromServiceSecret];
          if (!target) {
            throw new Error(
              `${key}: env ${envName} references unknown service "${marker.fromServiceSecret}"`,
            );
          }
          const targetSecrets = getDeclaredSecrets(target);
          if (!targetSecrets.has(marker.secret)) {
            throw new Error(
              `${key}: env ${envName} references "${marker.fromServiceSecret}.${marker.secret}" ` +
                `but ${marker.fromServiceSecret} declares: ` +
                `${[...targetSecrets].join(', ') || 'none'}`,
            );
          }
        }
      });
    }
  });

  test('fromService references a service that has a fetchScript', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkEnvMarkers(meta, (envName, marker) => {
        // Some markers nest fromService under whenMediaServer
        const inner = marker?.whenMediaServer ? marker : marker;
        if (inner && typeof inner === 'object' && 'fromService' in inner && inner.fromService) {
          const target = allMeta[inner.fromService];
          if (!target) {
            throw new Error(
              `${key}: env ${envName} fromService references unknown service "${inner.fromService}"`,
            );
          }
          if (!target.compose?.fetchScript) {
            throw new Error(
              `${key}: env ${envName} fromService "${inner.fromService}" but that service ` +
                `has no fetchScript declared (so the field can't be runtime-fetched)`,
            );
          }
        }
      });
    }
  });

  test('whenMediaServer values are valid', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkEnvMarkers(meta, (envName, marker) => {
        if (marker && typeof marker === 'object' && 'whenMediaServer' in marker) {
          if (!VALID_MEDIA_SERVERS.has(marker.whenMediaServer)) {
            throw new Error(
              `${key}: env ${envName} whenMediaServer="${marker.whenMediaServer}" — ` +
                `must be one of plex/jellyfin/emby`,
            );
          }
        }
      });
    }
  });

  test('whenService references a known service', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      walkEnvMarkers(meta, (envName, marker) => {
        if (marker && typeof marker === 'object' && 'whenService' in marker) {
          if (!serviceMeta[marker.whenService]) {
            throw new Error(
              `${key}: env ${envName} whenService="${marker.whenService}" — ` +
                `must reference a key in serviceMeta`,
            );
          }
        }
      });
    }
  });

  test('${name} substitutions in env literals reference declared secrets', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const declared = getDeclaredSecrets(meta);
      walkEnvMarkers(meta, (envName, marker, containerKey) => {
        if (typeof marker !== 'string') return;
        const matches = [...marker.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g)];
        for (const m of matches) {
          const refName = m[1];
          // Allow references to compose-time substitution markers like
          // ${TZ:-UTC} that don't resolve to secrets — those are pre-
          // expanded by the shell. We only flag secret-style refs that
          // don't match anything declared.
          if (!declared.has(refName)) {
            // Special case: literal ${TZ:-UTC} is a docker-compose
            // env-default expression, not a secret reference. Skip.
            if (refName === 'TZ') continue;
            throw new Error(
              `${key}: env ${envName} contains \${${refName}} but service ` +
                `declares no secret "${refName}" (declared: ${[...declared].join(', ') || 'none'})`,
            );
          }
        }
      });
    }
  });
});

// ---------------------------------------------------------------------
// Multi-container internal references
// ---------------------------------------------------------------------

describe('multi-container internal references', () => {
  test('dependsOn keys reference real sub-containers', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const subKeys = new Set(Object.keys(meta?.compose?.services || {}));
      if (subKeys.size === 0) continue;
      for (const [subKey, sub] of Object.entries(meta.compose.services)) {
        if (!sub.dependsOn) continue;
        for (const depKey of Object.keys(sub.dependsOn)) {
          if (!subKeys.has(depKey)) {
            throw new Error(
              `${key}.services.${subKey}: dependsOn references "${depKey}" ` +
                `but no such sub-container exists ` +
                `(available: ${[...subKeys].join(', ')})`,
            );
          }
        }
      }
    }
  });

  test('postDeployScript.blocks reference real sub-containers', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const blocks = meta?.compose?.postDeployScript?.blocks || [];
      const subKeys = new Set(Object.keys(meta?.compose?.services || {}));
      for (const blocked of blocks) {
        if (!subKeys.has(blocked)) {
          throw new Error(
            `${key}: postDeployScript.blocks lists "${blocked}" but ` +
              `no such sub-container exists ` +
              `(available: ${[...subKeys].join(', ') || 'none'})`,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------
// compose.files structural checks
// ---------------------------------------------------------------------

describe('compose.files', () => {
  test('every file has hostPath and content', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const files = meta?.compose?.files || {};
      for (const [name, file] of Object.entries(files)) {
        expect(file.hostPath).toBeTruthy();
        expect(file.content).toBeTruthy();
      }
    }
  });

  test('hostPath uses a known token', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const files = meta?.compose?.files || {};
      for (const [name, file] of Object.entries(files)) {
        const tok = leadingToken(file.hostPath);
        if (!KNOWN_PATH_TOKENS.has(tok) && !file.hostPath.startsWith('/')) {
          throw new Error(
            `${key}.files.${name}: hostPath "${file.hostPath}" uses unknown token "${tok}"`,
          );
        }
      }
    }
  });

  test('${name} substitutions in literal file content reference a declared secret OR a known user-config key', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const declared = getDeclaredSecrets(meta);
      const files = meta?.compose?.files || {};
      for (const [name, file] of Object.entries(files)) {
        const content = typeof file.content === 'string' ? file.content : null;
        if (!content) continue;
        const matches = [...content.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g)];
        for (const m of matches) {
          const refName = m[1];
          if (refName === 'TZ') continue;
          if (declared.has(refName)) continue;
          if (KNOWN_CONFIG_KEYS.has(refName)) continue;
          throw new Error(
            `${key}.files.${name}: content contains \${${refName}} but ` +
              `service declares no secret "${refName}" and it's not a ` +
              `known user-config key (declared secrets: ` +
              `${[...declared].join(', ') || 'none'})`,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------
// Script paths exist
// ---------------------------------------------------------------------

describe('script paths', () => {
  // We can't easily check filesystem from a Jest test inside the React
  // app (no fs module access in CRA's default setup without escape
  // hatches). Instead we just verify the path strings look sane.

  test('postDeployScript.path and fetchScript.path are non-empty strings', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const post = meta?.compose?.postDeployScript;
      if (post) {
        expect(typeof post.path).toBe('string');
        expect(post.path.length).toBeGreaterThan(0);
      }
      const fetch = meta?.compose?.fetchScript;
      if (fetch) {
        expect(typeof fetch.path).toBe('string');
        expect(fetch.path.length).toBeGreaterThan(0);
      }
    }
  });

  test('script paths follow scripts/<name>.{py,sh} convention', () => {
    for (const [key, meta] of Object.entries(allMeta)) {
      const post = meta?.compose?.postDeployScript;
      if (post) {
        expect(post.path).toMatch(/^scripts\/[a-z0-9_-]+\.(py|sh)$/);
      }
      const fetch = meta?.compose?.fetchScript;
      if (fetch) {
        expect(fetch.path).toMatch(/^scripts\/[a-z0-9_-]+\.(py|sh)$/);
      }
    }
  });
});
