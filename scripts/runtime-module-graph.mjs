/**
 * Shared production module-graph walker (v1.5.1 hotfix tooling).
 *
 * Computes the exact set of repo-local modules the Electron main process and
 * preload will resolve at runtime in a PACKAGED tree (dev-only conveniences
 * such as Vite dev servers do not count — only static import/export-from and
 * require() specifiers matter in production). This single implementation is
 * the source of truth for:
 *   - tests/packaging.test.mjs   (build.files coverage regression gate)
 *   - scripts/verify-packaged-runtime.mjs (actual app.asar content check in CI)
 *
 * Keeping one walker guarantees the unit test and the installed-artifact gate
 * can never silently disagree about what "the runtime needs" means.
 */
import fs from 'node:fs';
import path from 'node:path';

const UNRESOLVED_MARK = ' [UNRESOLVED]';
const UNREADABLE_MARK = ' [UNREADABLE]';

export function repoRootFrom(fromUrl) {
  return path.resolve(path.dirname(new URL(fromUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
}

/** Resolve a relative specifier the way Node ESM/CJS resolution would against on-disk files. */
export function resolveImport(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // Node builtins / externals are not repo files
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.js', '.mjs', '.cjs', '.json']) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return path.normalize(base + ext);
  }
  for (const idx of ['index.mjs', 'index.js', 'index.cjs']) {
    if (fs.existsSync(path.join(base, idx))) return path.normalize(path.join(base, idx));
  }
  return path.normalize(base + ' [UNRESOLVED]');
}

/**
 * Walk the static module graph from `entries` (repo-relative or absolute paths).
 * Returns absolute normalized paths; unresolved/unreadable targets carry markers.
 */
export function moduleClosure(entries) {
  const seen = new Set();
  const walk = (file) => {
    file = path.normalize(file);
    if (seen.has(file)) return;
    seen.add(file);
    if (file.includes(UNRESOLVED_MARK) || file.includes(UNREADABLE_MARK)) return;
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      seen.add(file + UNREADABLE_MARK);
      return;
    }
    const re = /(?:import|export)\s+(?:[\w{},*\s]+\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const target = resolveImport(file, m[1] || m[2] || m[3]);
      if (target) walk(target);
    }
  };
  for (const entry of entries) walk(entry);
  return [...seen];
}

/**
 * Normalize an app.asar member path to the repo-relative forward-slash form.
 * @electron/asar's listPackage() returns platform-flavoured separators
 * ("/dist/…" on POSIX, "\dist\…" on Windows) — the closure comparison must be
 * OS-invariant or a Windows CI run reports the entire tree as absent.
 */
export function normalizePackedMember(entry) {
  return String(entry).replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Convenience: closure reachable from the production Electron entry points. */
export function electronRuntimeClosure(root) {
  const entries = ['electron/main.mjs', 'electron/preload.cjs'].map((f) => path.join(root, f));
  return moduleClosure(entries).map((absolute) => ({
    absolute,
    rel: path.relative(root, absolute).replace(/\\/g, '/'),
    broken: absolute.includes(UNRESOLVED_MARK) || absolute.includes(UNREADABLE_MARK),
  }));
}
