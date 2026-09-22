// Dentiva Pro v1.4.0 — renderer data service.
//
// The renderer never talks to storage directly. `createApi()` returns either:
//   - DesktopApi: every call crosses the validated IPC bridge into the main
//     process, where the session, RBAC and audit live (production).
//   - LocalApi: the same operations/queries executed in-page against LocalRepo
//     (vite dev mode, visual tests). The business logic is the SAME code —
//     only the repository and the KDF differ.
//
// Every method is async and returns a plain result object; errors are values
// ({ ok: false, error, code }), never exceptions, so the UI handles them in
// one place.

import { runOp } from './ops.js';
import { runQuery } from './queries.js';
import { LocalRepo } from './repo-local.js';
import { permissionsForRole } from './core.js';
import { APP_VERSION, migrateState } from './migrate-state.js';

/* ------------------------------------------------------------------ */
/* Browser-side PIN KDF (WebCrypto PBKDF2-SHA-256, same parameters as  */
/* the main process). Legacy v1.3.0 renderer hashes (120k iterations)  */
/* are verified and transparently upgraded on first successful login.  */
/* ------------------------------------------------------------------ */

const KDF_ID = 'PBKDF2-SHA-256-v2';
const ITERATIONS_V2 = 210_000;
const LEGACY_ITERATIONS = 120_000;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveBits(pin, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex || randomHex(32)), iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(bits);
}
function randomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToHex(values);
}

async function browserHashPin(pin) {
  const salt = randomHex(32);
  const hash = await deriveBits(pin, salt, ITERATIONS_V2);
  return { salt, hash, kdf: KDF_ID, iterations: ITERATIONS_V2 };
}

async function browserVerifyPin(pin, user) {
  if (!user || !user.pinHash) return { ok: false };
  const iterations = Number(user.iterations) || (user.kdf === KDF_ID ? ITERATIONS_V2 : LEGACY_ITERATIONS);
  const hash = await deriveBits(pin, user.pinSalt, iterations);
  if (hash === user.pinHash) {
    return { ok: true, upgradeNeeded: user.kdf !== KDF_ID || iterations !== ITERATIONS_V2 };
  }
  return { ok: false };
}

/* ------------------------------------------------------------------ */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export function createApi({ desktopBridge = (typeof window !== 'undefined' ? window.dentiva : null) } = {}) {
  if (desktopBridge && typeof desktopBridge.invoke === 'function') {
    return new DesktopApi(desktopBridge);
  }
  return new LocalApi();
}

class DesktopApi {
  constructor(bridge) {
    this.bridge = bridge;
    this.mode = 'desktop';
  }

  async bootstrap() {
    return this.bridge.invoke('auth:bootstrap');
  }
  async session() {
    return this.bridge.invoke('auth:session');
  }
  async login(userId, pin) {
    return this.bridge.invoke('auth:login', { userId, pin });
  }
  async logout() {
    return this.bridge.invoke('auth:logout');
  }
  async runOp(name, payload = {}) {
    return this.bridge.invoke('ops:invoke', { name, payload });
  }
  async runQuery(name, params = {}) {
    return this.bridge.invoke('query:run', { name, params });
  }
  async readAttachment(id) {
    return this.bridge.invoke('attachment:read', { id });
  }
  async createBackup(label = '') {
    return this.bridge.invoke('backup:create', { label });
  }
  async validateBackup(path) {
    return this.bridge.invoke('backup:validate', { path });
  }
  async listBackups() {
    return this.bridge.invoke('backup:list');
  }
  async restoreBackup(path) {
    return this.bridge.invoke('backup:restore', { path });
  }
  async deleteBackup(name) {
    return this.bridge.invoke('backup:delete', { name });
  }
  async pruneBackups(keep = 10) {
    return this.bridge.invoke('backup:prune', { keep });
  }
  async diagnostics() {
    return this.bridge.invoke('diagnostics:run');
  }
  async workspaceInfo() {
    return this.bridge.invoke('workspace:info');
  }
  async appInfo() {
    return this.bridge.invoke('app:info');
  }
  async pickFolder() {
    return this.bridge.invoke('backup:pick-folder');
  }
  async pickFile() {
    return this.bridge.invoke('backup:pick-file');
  }
  async restoreJson(text, options = {}) {
    return this.bridge.invoke('backup:restore-json', { text, options });
  }
  async exportWorkspace() {
    return this.bridge.invoke('workspace:export');
  }
  async printPdf(options = {}) {
    return this.bridge.invoke('print:pdf', options);
  }
  async printHtmlPdf(html, options = {}) {
    return this.bridge.invoke('print:html-pdf', { html, options });
  }
}

class LocalApi {
  constructor() {
    this.mode = 'local';
    this.repo = new LocalRepo();
    this.session = null;
    this.now = () => Date.now();
  }

  #firstRun() {
    return !this.repo.anyPinSet();
  }

  #timeoutMs() {
    const minutes = Number(this.repo.getSettings().sessionTimeoutMinutes ?? 30);
    return Math.max(1, minutes) * 60_000;
  }

  #context() {
    if (this.session) {
      if (this.now() - this.session.lastActivity > this.#timeoutMs()) {
        this.session = null;
      } else {
        this.session.lastActivity = this.now();
        return {
          userId: this.session.userId,
          userName: this.session.userName,
          role: this.session.role,
          permissions: this.session.permissions,
          firstRun: false
        };
      }
    }
    if (this.#firstRun()) {
      return { userId: '', userName: 'Setup', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true };
    }
    return null;
  }

  #publicSession() {
    if (!this.session) return null;
    return {
      userId: this.session.userId,
      userName: this.session.userName,
      role: this.session.role,
      permissions: this.session.permissions,
      startedAt: this.session.startedAt,
      timeoutMinutes: Math.round(this.#timeoutMs() / 60000)
    };
  }

  async #applyPinToSet(result) {
    if (!result || !result.ok || !result.pinToSet) return;
    const { userId, pin } = result.pinToSet;
    const derived = await browserHashPin(pin);
    this.repo.setUserSecrets(userId, { ...derived, failedAttempts: 0, lockedUntil: 0 });
    delete result.pinToSet;
  }

  async bootstrap() {
    const settings = this.repo.getSettings();
    const storage = this.repo.storageInfo();
    return {
      ok: true,
      appVersion: APP_VERSION,
      firstRun: this.#firstRun(),
      setupComplete: Boolean(this.repo.getMeta('setupComplete', false)),
      session: this.#publicSession(),
      settings,
      unsupportedSchema: false,
      migrationError: '',
      counts: this.repo.counts(),
      storage: {
        bytes: storage.bytes,
        attachmentBytes: storage.attachmentBytes,
        attachmentFiles: storage.attachmentFiles,
        recordCounts: storage.recordCounts,
        journalMode: storage.journalMode,
        lastBackupAt: this.repo.getMeta('lastBackupAt', null),
        lastRestoreAt: this.repo.getMeta('lastRestoreAt', null)
      }
    };
  }

  async session() {
    const session = this.#publicSession();
    return { ok: true, session, locked: !session };
  }

  async login(userId, pin) {
    const pinString = String(pin || '');
    if (!/^\d{4,12}$/.test(pinString)) return { ok: false, error: 'Enter your 4–12 digit local PIN.' };
    const user = this.repo.userGet(String(userId || ''), { includeSecrets: true });
    if (!user) return { ok: false, error: 'That local account is unavailable.' };
    if (user.active === false) return { ok: false, error: 'This account is deactivated. Contact an Administrator.' };
    if (!user.pinHash) return { ok: false, error: 'This account has no PIN set. Ask an Administrator to assign one.' };
    if (Number(user.lockedUntil || 0) > this.now()) {
      const seconds = Math.ceil((user.lockedUntil - this.now()) / 1000);
      return { ok: false, error: `This account is temporarily locked. Try again in ${seconds} seconds.` };
    }
    const verification = await browserVerifyPin(pinString, user);
    if (!verification.ok) {
      const attempts = Number(user.failedAttempts || 0) + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? this.now() + LOCKOUT_MS : 0;
      this.repo.setUserSecrets(user.id, { failedAttempts: lockedUntil ? 0 : attempts, lockedUntil });
      return {
        ok: false,
        error: lockedUntil ? 'Too many failed attempts. This account is locked for 30 seconds.' : 'That PIN is not correct.',
        remaining: Math.max(0, MAX_FAILED_ATTEMPTS - attempts)
      };
    }
    const secrets = { failedAttempts: 0, lockedUntil: 0, lastLogin: new Date(this.now()).toISOString() };
    if (verification.upgradeNeeded) {
      const upgraded = await browserHashPin(pinString);
      Object.assign(secrets, upgraded);
    }
    this.repo.setUserSecrets(user.id, secrets);
    this.session = {
      userId: user.id,
      userName: user.name,
      role: user.role,
      permissions: permissionsForRole(user.role, user.permissions),
      startedAt: this.now(),
      lastActivity: this.now()
    };
    return { ok: true, session: this.#publicSession() };
  }

  async logout() {
    this.session = null;
    return { ok: true };
  }

  async runOp(name, payload = {}) {
    const context = this.#context();
    // setup.complete stays open only during first-run, otherwise settings.edit.
    if (name === 'setup.complete' && context && !context.firstRun) {
      if (!(context.permissions || []).includes('settings.edit')) {
        return { ok: false, code: 'permission-denied', error: 'Your account is not allowed to perform this action.' };
      }
    }
    const result = runOp(this.repo, name, payload && typeof payload === 'object' ? payload : {}, context || {});
    if (result.ok) {
      for (const entry of result.audit || []) {
        this.repo.auditInsert({
          id: `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
          createdAt: new Date().toISOString(),
          userId: context?.userId || '',
          userName: context?.userName || '',
          ...entry
        });
      }
    }
    await this.#applyPinToSet(result);
    return result;
  }

  async runQuery(name, params = {}) {
    return runQuery(this.repo, name, params && typeof params === 'object' ? params : {}, this.#context());
  }

  async readAttachment(id) {
    const record = this.repo.get('attachments', String(id || ''));
    if (!record) return { ok: false, code: 'not-found', error: 'That attachment no longer exists.' };
    const bytes = this.repo.readAttachmentFile(record.filePath);
    if (!bytes) return { ok: false, code: 'missing-file', error: 'The attachment file is missing.' };
    const base64 = LocalApi.#base64(bytes);
    return {
      ok: true,
      id: record.id,
      name: record.name,
      type: record.type,
      bytes: bytes.length,
      base64,
      dataUrl: `data:${record.type || 'application/octet-stream'};base64,${base64}`
    };
  }

  static #base64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  async createBackup(label = '') {
    const report = this.repo.integrityCheck();
    if (!report.ok) return { ok: false, error: 'The workspace failed its integrity check; resolve the reported issues before backing up.' };
    const manifest = {
      format: 'dentiva-local-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      label: String(label || ''),
      appVersion: APP_VERSION,
      recordCounts: this.repo.counts(),
      stateBytes: this.repo.storageInfo().bytes
    };
    const json = JSON.stringify({ manifest, state: this.repo.state, attachments: this.repo.attachments }, null, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (typeof document === 'undefined') return { ok: false, error: 'File export is unavailable in this environment.' };
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `dentiva-backup-${stamp}${label ? `-${String(label).replace(/[^a-zA-Z0-9._-]/g, '-')}` : ''}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
      this.repo.setMeta('lastBackupAt', manifest.createdAt);
      return { ok: true, manifest, exported: true };
    } catch (error) {
      return { ok: false, error: `Backup export failed: ${error.message}` };
    }
  }

  async validateBackup(path) {
    return { ok: false, error: 'Restore a downloaded backup file from the browser UI; the selected path is not accessible here.', problems: [] };
  }

  async listBackups() {
    return { ok: true, backups: [] };
  }

  /** Browser restore: import the exported JSON file (caller passes its text). */
  async restoreFromJson(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'The backup file is not valid JSON.' }; }
    if (!parsed || !parsed.state || typeof parsed.state !== 'object') return { ok: false, error: 'The backup file does not contain a Dentiva state payload.' };
    const incoming = migrateStateLike(parsed.state);
    if (!Array.isArray(incoming.audit)) incoming.audit = [];
    this.repo.state = incoming;
    if (parsed.attachments && typeof parsed.attachments === 'object') {
      this.repo.attachments = parsed.attachments;
    }
    this.repo.save();
    this.session = null;
    return { ok: true, recordCounts: this.repo.counts() };
  }

  async restoreBackup(path) {
    return { ok: false, error: 'Browser development mode restores from a downloaded backup file.' };
  }

  async deleteBackup() {
    return { ok: true };
  }
  async pruneBackups() {
    return { ok: true, removed: [] };
  }

  async diagnostics() {
    const integrity = this.repo.integrityCheck();
    const storage = this.repo.storageInfo();
    return {
      ok: integrity.ok,
      checkedAt: new Date().toISOString(),
      versions: { appVersion: APP_VERSION, schemaVersion: this.repo.schemaVersion, dbLayoutVersion: null },
      integrity,
      storage,
      recordCounts: storage.recordCounts,
      freeDiskBytes: null,
      orphanAttachmentFiles: 0,
      issues: integrity.ok ? [] : [{ severity: 'error', code: 'foreign-keys', message: `${integrity.foreignKeyViolationCount} dangling reference(s) found.` }]
    };
  }

  async workspaceInfo() {
    return {
      ok: true,
      directory: 'browser local storage',
      appVersion: APP_VERSION,
      storage: this.repo.storageInfo(),
      integrity: this.repo.integrityCheck(),
      lastBackupAt: this.repo.getMeta('lastBackupAt', null),
      lastRestoreAt: this.repo.getMeta('lastRestoreAt', null)
    };
  }

  async appInfo() {
    return { version: APP_VERSION, platform: 'browser', arch: 'wasm', isDesktop: false, packaged: false, storage: 'Local storage' };
  }

  async pickFolder() {
    return { ok: true, canceled: true, path: '' }; // native folder picker needs the desktop shell
  }
  async pickFile() {
    if (typeof document === 'undefined') return { ok: true, canceled: true, path: '', text: '' };
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve({ ok: true, canceled: true, path: '', text: '' });
        const reader = new FileReader();
        reader.onload = () => resolve({ ok: true, canceled: false, path: file.name, text: String(reader.result) });
        reader.onerror = () => resolve({ ok: false, error: 'Could not read the file.' });
        reader.readAsText(file);
      };
      input.click();
    });
  }
  async restoreJson(text, options = {}) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'The backup file is not valid JSON.' }; }
    const root = parsed && typeof parsed === 'object' ? parsed : null;
    const rawState = root?.state && typeof root.state === 'object' ? root.state : root;
    if (!rawState || typeof rawState !== 'object') return { ok: false, error: 'The backup does not contain a state payload.' };
    const incoming = migrateStateLike(rawState);
    const modules = Array.isArray(options.modules) ? options.modules : null;
    if (modules && modules.length) {
      const { buildRestorePlan, applyRestorePlan, ARRAY_COLLECTIONS } = await import('./core.js');
      const current = { ...this.repo.state };
      for (const key of ARRAY_COLLECTIONS) if (!Array.isArray(current[key])) current[key] = [];
      const plan = buildRestorePlan(current, incoming, { modules, strategy: options.strategy || 'Replace', patientIds: Array.isArray(options.patientIds) ? options.patientIds : null });
      const applied = applyRestorePlan(current, plan);
      this.repo.state = applied.state || applied;
    } else {
      this.repo.state = incoming;
    }
    if (root?.attachments && typeof root.attachments === 'object') this.repo.attachments = root.attachments;
    this.repo.save();
    this.session = null;
    return { ok: true, mode: modules && modules.length ? 'modules' : 'full', recordCounts: this.repo.counts() };
  }
  async exportWorkspace() {
    const result = await this.createBackup('preserved-export');
    return result;
  }

  async printPdf(options = {}) {
    // Development fallback: native print of the current document.
    try { window.print(); } catch { /* no-op */ }
    return { ok: true, fallback: 'print' };
  }

  async printHtmlPdf(html, options = {}) {
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) return { ok: false, error: 'Pop-up blocked; allow pop-ups for the dev server to print.' };
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dentiva Pro print</title></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* no-op */ } }, 250);
    return { ok: true, fallback: 'print-window' };
  }
}

/** Shape a v1.3.0-style state object into the v1.4.0 state shape. */
function migrateStateLike(state) {
  return migrateState(state && typeof state === 'object' ? state : null);
}

export { createApi as default };
