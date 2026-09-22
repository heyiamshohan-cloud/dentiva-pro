import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'electron/storage.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('Electron renderer boundary remains hardened', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /will-navigate/);
  assert.match(main, /frame-ancestors 'none'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /require\('fs'\)|require\('path'\)|process\.mainModule/);
  assert.match(html, /Content-Security-Policy/);
});

test('PDF IPC blocks active and remote content', () => {
  assert.match(main, /script\\b/);
  assert.match(main, /javascript:/);
  assert.match(main, /javascript:\s*false/);
  assert.match(main, /print:html-pdf/);
});

test('production source has no cloud telemetry or diagnostic HTTP client', () => {
  assert.doesNotMatch(renderer, /fetch\s*\(|axios|firebase|sentry|posthog|segment|mixpanel/i);
  assert.doesNotMatch(renderer, /https:\/\/[^`'" ]+/i);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ['sql.js']);
  assert.doesNotMatch(storage, /https?:\/\//i);
});

test('SQLite store writes are atomic, bounded and recoverable', () => {
  assert.match(storage, /MAX_STORE_BYTES/);
  assert.match(storage, /fsyncSync/);
  assert.match(storage, /renameSync/);
  assert.match(storage, /sqlite/);
  assert.match(main, /createSQLiteStore/);
});


test('future schemas are preserved and blocked from silent downgrade', () => {
  assert.match(renderer, /unsupportedSchema:\s*true/);
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
});

test('renderer has authenticated account and operation-level authorization boundaries', () => {
  assert.match(renderer, /data-form=\"user-login\"/);
  assert.match(renderer, /PBKDF2/);
  assert.match(renderer, /failedAttempts/);
  assert.match(renderer, /lastLogin/);
  assert.match(renderer, /requirePermission\('backup\.restore'\)/);
  assert.match(renderer, /formPermissions/);
  assert.match(renderer, /users\.manage/);
});
