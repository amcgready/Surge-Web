/**
 * export_manifest.js — serializes serviceMeta + mediaServerMeta to JSON
 * so the Python orchestrator can consume them.
 *
 * Usage:
 *   node orchestrator/export_manifest.js > orchestrator/test_fixtures/manifest.json
 *
 * The two registries are pure data (no functions or class instances)
 * so JSON.stringify handles them cleanly. Run this whenever the schema
 * changes; the orchestrator's behavior is fully determined by the
 * serialized output here.
 *
 * Note: logo imports in the source modules are resolved by webpack at
 * build time. This Node script doesn't run through webpack, so we
 * stub `import x from './assets/...'` style imports out via the
 * Babel register hook below — logos aren't needed for orchestration.
 */

// Stub asset imports — Node can't load PNG/SVG/etc. via require().
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (/\.(png|svg|jpg|jpeg|gif|webp)$/i.test(request)) {
    return path.resolve(__dirname, 'export_manifest.js'); // dummy path
  }
  return origResolve.call(this, request, parent, ...rest);
};
require.cache[path.resolve(__dirname, 'export_manifest.js')] = {
  exports: 'logo-stub',  // Logo imports get this string; harmless.
};

// Configure Babel to transform ES modules in the frontend source.
require('@babel/register')({
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-react',
  ],
  extensions: ['.js', '.jsx'],
});

const { serviceMeta } = require('../frontend/src/AdditionalServicesStep');
const { mediaServerMeta } = require('../frontend/src/mediaServerMeta');

// Strip logo fields — they're imports, not relevant to orchestration,
// and would JSON-serialize as the literal string 'logo-stub' from
// the require shim above.
function stripLogos(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = { ...v };
    delete out[k].logo;
  }
  return out;
}

const manifest = {
  serviceMeta:     stripLogos(serviceMeta),
  mediaServerMeta: stripLogos(mediaServerMeta),
};

process.stdout.write(JSON.stringify(manifest, null, 2));
