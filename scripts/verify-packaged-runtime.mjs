#!/usr/bin/env node
/**
 * PACKAGED-RUNTIME VERIFIER — inspects the ACTUAL app.asar shipped inside the
 * built packages and fails if any module in the production Electron runtime
 * graph is missing. This is the gate that would have caught the v1.5.0
 * "ERR_MODULE_NOT_FOUND: app.asar/src/core.js" startup crash before release.
 *
 * Usage (CI, after `npm run dist:win`):
 *   node scripts/verify-packaged-runtime.mjs [path/to/app.asar]
 *
 * When no path is given the script auto-discovers the unpacked app resources
 * under the electron-builder output directory (default: release/win-unpacked).
 * Exit code 1 with an explicit missing-module list on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { electronRuntimeClosure, normalizePackedMember } from './runtime-module-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`verify-packaged-runtime: FAIL — ${message}`);
  process.exit(1);
}

function discoverAsar() {
  const explicit = process.argv[2] || process.env.PACKAGED_ASAR;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) fail(`specified asar not found: ${resolved}`);
    return resolved;
  }
  const outDir = path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build?.directories?.output || 'release');
  const named = [
    path.join(outDir, 'win-unpacked', 'resources', 'app.asar'),
    path.join(outDir, 'windows-unpacked', 'resources', 'app.asar'),
    path.join(outDir, 'win32-unpacked', 'resources', 'app.asar'),
  ];
  const found = named.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  // Fallback: bounded recursive search under the packaging output dir
  // (installer/portable staging dirs vary by electron-builder target mix).
  const hits = [];
  (function scan(dir, depth) {
    if (hits.length >= 3 || depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full, depth + 1);
      else if (entry.name === 'app.asar') hits.push(full);
    }
  })(outDir, 0);
  console.error(`verify-packaged-runtime: named locations empty. Output dir scan (${outDir}): ${hits.length ? hits.join('; ') : '<no app.asar anywhere>'}`);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) fail(`multiple app.asar candidates found (${hits.join('; ')}) — pass PACKAGED_ASAR=... explicitly`);
  fail('run this after the electron-builder packaging step, or pass the asar path explicitly');
}

const asarPath = discoverAsar();
let asar;
try {
  asar = require('@electron/asar');
} catch {
  fail('@electron/asar is unavailable (npm ci must run before this script)');
}

const members = asar.listPackage(asarPath).map(normalizePackedMember);
if (members.length < 10) fail(`app.asar looks suspiciously empty (${members.length} entries): ${asarPath}`);

const closure = electronRuntimeClosure(root);
const brokenGraph = closure.filter((node) => node.broken).map((node) => node.rel);
if (brokenGraph.length) {
  fail(`runtime module graph itself cannot resolve in the source tree: ${brokenGraph.join(', ')}`);
}

const asarSet = new Set(members);
const missing = closure
  .map((node) => node.rel)
  .filter((rel) => rel && !asarSet.has(rel));

const mustAlwaysShip = ['package.json', 'src/core.js', 'src/ops.js', 'electron/lib/records.mjs', 'electron/preload.cjs'];
const missingCritical = mustAlwaysShip.filter((rel) => !asarSet.has(rel));

const srcFilesOnDisk = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else srcFilesOnDisk.push(path.relative(root, full).replace(/\\/g, '/'));
  }
})(path.join(root, 'src'));
const missingSrc = srcFilesOnDisk.filter((rel) => !asarSet.has(rel));

if (missing.length || missingCritical.length || missingSrc.length) {
  const lines = [
    `runtime modules REQUIRED but ABSENT from ${asarPath}:`,
    ...missing.map((rel) => `  [runtime-graph] ${rel}`),
    ...missingCritical.map((rel) => `  [always-ship ] ${rel}`),
    ...missingSrc.map((rel) => `  [src tree    ] ${rel}`),
    '',
    'This is exactly the v1.5.0 startup-crash defect (ERR_MODULE_NOT_FOUND inside app.asar).',
    'Fix electron-builder build.files so every runtime module is packaged — do NOT retry by hand.',
  ].join('\n');
  console.error(lines);
  process.exit(1);
}

const uiShell = members.filter((rel) => rel.startsWith('dist/')).length;
console.log(`verify-packaged-runtime: OK — ${members.length} asar entries inspected`);
console.log(`  runtime graph: ${closure.length} modules, all present in app.asar`);
console.log(`  service layer: ${srcFilesOnDisk.length} src files, all present in app.asar`);
console.log(`  renderer shell: ${uiShell} dist entries present`);
console.log(`  asar: ${asarPath}`);
