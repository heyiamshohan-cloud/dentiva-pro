/**
 * PACKAGING INTEGRITY GATE (hotfix for the v1.5.0 ASAR defect).
 *
 * The v1.5.0 installers passed every suite + CI while the installed app died
 * on startup with ERR_MODULE_NOT_FOUND (src/** excluded from app.asar while
 * electron/lib/records.mjs imports ../../src/core.js). This test computes the
 * real production module graph (shared with scripts/verify-packaged-runtime.mjs
 * so the unit gate and the installed-artifact gate can never disagree) and
 * fails if ANY runtime module is not covered by electron-builder's `files`
 * config. It never inspects "source intent" — it resolves the same way Node
 * would resolve at-execution in a packaged tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronRuntimeClosure } from '../scripts/runtime-module-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/* Matches ONLY the glob shapes this project is allowed to use in build.files —
 * isolated so a purely cosmetic edit cannot silently widen the allowance. */
function filesCoverage() {
  const patterns = pkg.build?.files || [];
  const covered = (rel) => patterns.some((pattern) => {
    const p = String(pattern).replace(/\\/g, '/');
    if (p === rel) return true;
    if (p.endsWith('/**/*')) return rel.startsWith(p.slice(0, -5) + '/');
    if (p.endsWith('/**')) return rel.startsWith(p.slice(0, -3));
    if (p.endsWith('/*')) return rel.startsWith(p.slice(0, -2)) && !rel.slice(p.length - 2).includes('/');
    if (p.startsWith('-!')) return false;
    return false;
  });
  return { patterns, covered };
}

test('packaging: every runtime module reachable from electron entry points is covered by build.files', () => {
  const closure = electronRuntimeClosure(root);
  const { patterns, covered } = filesCoverage();
  const missing = closure
    .filter((node) => !node.broken)
    .map((node) => node.rel)
    .filter((rel) => rel && !covered(rel));
  assert.deepEqual(missing, [], `Packaged runtime module(s) absent from build.files ${JSON.stringify(patterns)}: ${missing.join(', ')}`);
});

test('packaging: no unresolved relative imports in the runtime module graph', () => {
  const closure = electronRuntimeClosure(root);
  const unresolved = closure.filter((node) => node.broken).map((node) => node.rel);
  assert.deepEqual(unresolved, [], `Unresolved imports in runtime graph: ${unresolved.join(', ')}`);
});

test('packaging: main entry + preload exist and use import.meta-derived paths only (no cwd hacks)', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
  assert.match(main, /fileURLToPath\(import\.meta\.url\)/, 'main.mjs must derive __dirname from import.meta.url');
  assert.doesNotMatch(main, /from ['"]\.\.\/\.\.\/dist\//, 'renderer must load through dist file URL, not dev paths');
  const preload = path.join(root, 'electron', 'preload.cjs');
  assert.ok(fs.existsSync(preload), 'preload.cjs exists');
});

test('packaging: asar is enabled and service layer (src/**) ships inside it', () => {
  assert.equal(pkg.build?.asar, true);
  assert.ok((pkg.build?.files || []).some((p) => p === 'src/**/*' || p === 'src/**'), 'src/** must be packaged (v1.5.0 ASAR defect)');
  assert.ok((pkg.build?.files || []).some((p) => String(p).startsWith('electron/')), 'electron/** must be packaged');
  assert.ok((pkg.build?.files || []).some((p) => String(p).startsWith('dist/')), 'dist/** (renderer build) must be packaged');
});
