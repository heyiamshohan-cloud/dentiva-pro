import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const main = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'electron/lib/db.mjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const auth = fs.readFileSync(path.join(root, 'electron/lib/auth.mjs'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'electron/lib/backup.mjs'), 'utf8');

test('Electron renderer boundary remains hardened (ESM main, sandboxed preload)', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /will-navigate/);
  assert.match(main, /frame-ancestors 'none'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /require\('fs'\)|require\('path'\)|process\.mainModule/);
  assert.doesNotMatch(preload, /sendSync/);
  assert.match(html, /Content-Security-Policy/);
});

test('print IPC blocks active and remote content', () => {
  const printLib = fs.readFileSync(new URL('../electron/lib/print.mjs', import.meta.url), 'utf8');
  assert.match(printLib, /script\\b|script\\\\b/);
  assert.match(printLib, /javascript:/);
  assert.match(printLib, /iframe\\b|<object\\b|<embed\\b/);
  assert.ok(printLib.includes('https?:'), 'blocks remote image sources');
  assert.match(main, /javascript:\s*false/);
  assert.match(main, /validatePrintHtml/);
  assert.match(main, /'print:html'/);
  assert.match(main, /webContents\.print\(/);
  assert.doesNotMatch(main, /print:html-pdf/);
});

test('production source has no cloud telemetry or diagnostic HTTP client', () => {
  assert.doesNotMatch(renderer, /fetch\s*\(|axios|firebase|sentry|posthog|segment|mixpanel/i);
  assert.doesNotMatch(renderer, /https:\/\/[^`'" ]+/i);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  assert.doesNotMatch(storage, /https?:\/\//i);
});

test('SQLite store writes are atomic and unbounded (no artificial caps)', () => {
  assert.match(storage, /fsyncSync/);
  assert.match(storage, /renameSync/);
  assert.match(storage, /wal_checkpoint/);
  assert.doesNotMatch(storage, /MAX_STORE_BYTES|MAX_DB_BYTES|maxStoreBytes/i);
  assert.match(backup, /sha256/);
  assert.match(backup, /integrity_check/);
});

test('PIN authentication is server-side with lockout and legacy upgrade', () => {
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /210_000|210000/);
  assert.match(auth, /120_000|120000/);
  assert.match(auth, /MAX_FAILED_ATTEMPTS/);
  assert.match(auth, /LOCKOUT_MS/);
});

test('future layouts are preserved and blocked from silent overwrite', () => {
  assert.match(main, /unsupportedSchema/);
  assert.match(renderer, /unsupportedSchema/);
  assert.match(renderer, /cannot be overwritten/);
  assert.match(renderer, /export-unsupported-store/);
});

test('PDF attachments are not embedded as active inline content', () => {
  assert.doesNotMatch(renderer, /attachment-preview-frame/);
  assert.match(renderer, /PDF active content is never embedded/);
});

test('restore UI uses named module groups that map to every collection', () => {
  assert.match(renderer, /modules\.push\('clinical'\)/);
  assert.match(renderer, /modules\.push\('finance'\)/);
  assert.match(renderer, /modules\.push\('operations'\)/);
  assert.match(renderer, /buildRestorePlan/);
  assert.match(renderer, /Keep Existing/);
  assert.match(renderer, /Create New Copy/);
});

test('renderer has authenticated account and operation-level authorization boundaries', () => {
  assert.match(renderer, /data-form="user-login"/);
  assert.match(renderer, /PBKDF2/);
  assert.match(renderer, /failedAttempts/);
  assert.match(renderer, /lastLogin/);
  assert.match(renderer, /requirePermission\('backup\.restore'\)/);
  assert.match(renderer, /formPermissions/);
  assert.match(renderer, /users\.manage/);
});

test('ops are authorized server-side, never only by UI visibility', () => {
  const ops = fs.readFileSync(path.join(root, 'src/ops.js'), 'utf8');
  const queries = fs.readFileSync(path.join(root, 'src/queries.js'), 'utf8');
  assert.match(ops, /permission-denied/);
  assert.match(ops, /export function authorizeOp/);
  assert.match(queries, /permission-denied/);
  assert.match(queries, /export function authorizeQuery/);
  const ipc = fs.readFileSync(path.join(root, 'electron/lib/ipc.mjs'), 'utf8');
  assert.match(ipc, /requirePermission/);
  assert.match(ipc, /auditInsert/);
});
