#!/usr/bin/env node
/**
 * copy-deploy-assets.js — runs as a prebuild/prestart hook to copy
 * Surge's Python deploy artifacts into the frontend's public/ tree
 * so the deploy-bundle generator can fetch them at runtime.
 *
 * Source files:
 *   ../../scripts/*.py        — every configure-* and fetch-* script
 *   ../../orchestrator/*.py   — the orchestrator + helpers
 *
 * Destination:
 *   public/deploy_assets/scripts/...
 *   public/deploy_assets/orchestrator/...
 *
 * The destination directory is .gitignored — these are derived
 * artifacts. Re-running this script is idempotent: it wipes
 * public/deploy_assets/ first, then repopulates.
 *
 * Wired into frontend/package.json's prebuild + prestart hooks so
 * dev and prod builds both pick up the latest scripts.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const SCRIPTS_SRC = path.join(REPO_ROOT, 'scripts');
const ORCH_SRC    = path.join(REPO_ROOT, 'orchestrator');
const DEST_ROOT   = path.resolve(__dirname, '..', 'public', 'deploy_assets');

function copyPyFiles(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.py')) continue;
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    fs.copyFileSync(src, dst);
    copied += 1;
  }
  return copied;
}

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  rimraf(DEST_ROOT);
  fs.mkdirSync(DEST_ROOT, { recursive: true });

  const scriptsCount = copyPyFiles(SCRIPTS_SRC, path.join(DEST_ROOT, 'scripts'));
  const orchCount    = copyPyFiles(ORCH_SRC,    path.join(DEST_ROOT, 'orchestrator'));

  // Emit a manifest of what's in the bundle so the deploy-bundle
  // generator can fetch the file list dynamically rather than
  // hardcoding service names. Keeps dev iteration fast.
  const allScripts = fs.readdirSync(path.join(DEST_ROOT, 'scripts'))
    .filter((n) => n.endsWith('.py'));
  const allOrch = fs.readdirSync(path.join(DEST_ROOT, 'orchestrator'))
    .filter((n) => n.endsWith('.py'));
  const inventory = {
    scripts:      allScripts.map((n) => `scripts/${n}`),
    orchestrator: allOrch.map((n) => `orchestrator/${n}`),
  };
  fs.writeFileSync(
    path.join(DEST_ROOT, 'inventory.json'),
    JSON.stringify(inventory, null, 2),
  );

  console.log(
    `Copied ${scriptsCount} scripts + ${orchCount} orchestrator file(s) ` +
    `to public/deploy_assets/`,
  );
}

main();
