// Dentiva Pro v2.0.0 — the privileged request surface, independent of Electron.
//
// `createIpcHandlers()` returns one async handler per channel. Electron wires
// them to ipcMain (electron/lib/ipc.mjs, with sender validation); the dev/test
// server wires the SAME handlers to HTTP (scripts/dev-server.mjs) — so every
// browser preview and end-to-end test exercises the real engine.
//
// Every handler:
//   1. resolves the caller from the in-memory SessionManager (never from
//      renderer-supplied identity) and rejects unauthenticated callers,
//   2. enforces permissions server-side (the renderer only hides UI),
//   3. runs each operation in ONE database transaction together with its audit
//      entries — an operation commits completely or not at all,
//   4. returns plain JSON results; failures are values, never exceptions.

import path from 'node:path';
import { runOp, authorizeOp, BACKGROUND_OPS } from '../../src/ops.js';
import { runQuery, BACKGROUND_QUERIES } from '../../src/queries.js';
import { hashPin, verifyPin } from './auth.mjs';
import {
  createBackup, restoreBackup, validateBackup, listBackups, deleteBackup, pruneBackups,
  parseBackupJson, restoreJsonBackup, backupRoots
} from './backup.mjs';
import { diagnoseWorkspace } from './diagnostics.mjs';
import { APP_VERSION } from '../../src/migrate-state.js';

export const PUBLIC_CHANNELS = new Set(['auth:bootstrap', 'auth:login', 'auth:session', 'auth:logout']);

export const HANDLER_CHANNELS = [
  'auth:bootstrap', 'auth:login', 'auth:logout', 'auth:session',
  'ops:invoke', 'query:run', 'attachment:read',
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete', 'backup:validate', 'backup:prune',
  'backup:restore-json', 'backup:pick-folder', 'backup:pick-file',
  'diagnostics:run', 'workspace:info', 'workspace:export'
];

const fail = (code, message, extra = {}) => ({ ok: false, code, error: message, ...extra });

class OpRejected extends Error {
  constructor(result) {
    super(result?.error || 'Operation rejected');
    this.result = result;
  }
}

/** Translate storage-layer exceptions into messages a clinician can act on. */
export function friendlyStorageError(error) {
  const message = String(error?.message || error || '');
  if (/UNIQUE constraint failed/i.test(message)) return 'A record with the same code or number already exists. No changes were saved.';
  if (/FOREIGN KEY constraint failed/i.test(message)) return 'This change would break a link between records (for example a payment and its invoice). No changes were saved.';
  if (/CHECK constraint failed/i.test(message)) return 'This change would create an invalid amount, balance or stock level. No changes were saved.';
  if (/database is locked|SQLITE_BUSY/i.test(message)) return 'The workspace is busy. Please try again in a moment. No changes were saved.';
  if (/disk|SQLITE_FULL|ENOSPC/i.test(message)) return 'The disk is full or unavailable. No changes were saved.';
  return 'The operation could not be completed. No changes were saved.';
}

const PUBLIC_SETTING_KEYS = ['clinicName', 'chamberName', 'logo', 'accent', 'density', 'dateFormat', 'timeFormat', 'currency', 'timezone'];

export function createIpcHandlers({ repo, ws, sessions, dialogs = {}, log = () => {}, readFile = null }) {
  const nowIso = () => new Date().toISOString();
  const pickedFolders = new Set();
  const backupDirectory = () => String(repo.getSettings().backupDirectory || '').trim();

  const requirePermission = (context, permission) => {
    if (!context) return fail('auth-required', 'Your session has ended. Sign in to continue.');
    if (context.firstRun) return { ok: true };
    const needed = Array.isArray(permission) ? permission : [permission];
    if (needed.some((entry) => (context.permissions || []).includes(entry))) return { ok: true };
    return fail('permission-denied', 'Your account is not allowed to perform this action.');
  };

  const writeAudit = (result, context) => {
    for (const entry of result.audit || []) {
      repo.auditInsert({
        id: `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: nowIso(),
        userId: context?.userId || '',
        userName: context?.userName || '',
        ...entry
      });
    }
  };

  const auditEvent = (context, action, summary, entity = 'Workspace') => {
    try {
      repo.auditInsert({ id: `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, createdAt: nowIso(), userId: context?.userId || '', userName: context?.userName || '', action, entity, entityId: '', summary });
    } catch (error) {
      log(`audit write failed: ${error.message}`);
    }
  };

  const applyPinToSet = (result) => {
    if (!result || !result.pinToSet) return;
    const { userId, pin } = result.pinToSet;
    const derived = hashPin(pin);
    repo.setUserSecrets(userId, { pinHash: derived.hash, pinSalt: derived.salt, kdf: derived.kdf, failedAttempts: 0, lockedUntil: 0, lockoutCount: 0 });
    delete result.pinToSet;
  };

  /** Restore/validate only managed backups or folders the user picked in a native dialog. */
  const allowedBackupPath = (candidate) => {
    const resolved = path.resolve(String(candidate || ''));
    if (!candidate) return false;
    if (pickedFolders.has(resolved)) return true;
    return backupRoots(ws, backupDirectory()).some((root) => path.dirname(resolved) === root);
  };

  const bootstrapPayload = () => {
    const settings = repo.getSettings();
    const session = sessions.publicSession();
    const firstRun = sessions.firstRun();
    const authenticated = Boolean(session) || firstRun;
    const userDirectory = repo.usersList()
      .filter((user) => user.active !== false && user.hasPin)
      .map((user) => ({ id: user.id, name: user.name, role: user.role, hasPin: true, active: true }));
    const base = {
      ok: true,
      appVersion: APP_VERSION,
      firstRun,
      setupComplete: Boolean(repo.getMeta('setupComplete', false)),
      session,
      lastEnded: sessions.lastEnded ? { userId: sessions.lastEnded.userId, reason: sessions.lastEnded.reason } : null,
      unsupportedSchema: Boolean(repo.getMeta('unsupportedSchema', false)),
      migrationError: repo.getMeta('migrationError', '') || '',
      userDirectory,
      settings: authenticated ? settings : Object.fromEntries(PUBLIC_SETTING_KEYS.map((key) => [key, settings[key]]))
    };
    if (!authenticated) return base;
    const storage = ws.storageInfo({ includeCounts: false });
    return {
      ...base,
      counts: repo.counts(),
      storage: {
        bytes: storage.bytes,
        attachmentBytes: storage.attachmentBytes,
        attachmentFiles: storage.attachmentFiles,
        journalMode: storage.journalMode,
        lastBackupAt: repo.getMeta('lastBackupAt', null),
        lastRestoreAt: repo.getMeta('lastRestoreAt', null)
      }
    };
  };

  const handlers = {
    'auth:bootstrap': () => bootstrapPayload(),

    'auth:session': () => {
      const session = sessions.publicSession({ touch: false });
      return { ok: true, session, locked: !session, firstRun: sessions.firstRun(), lastEnded: sessions.lastEnded ? { reason: sessions.lastEnded.reason } : null };
    },

    'auth:login': (_event, { userId, pin } = {}) => sessions.login(String(userId || ''), String(pin || '')),

    'auth:logout': (_event, { reason } = {}) => {
      sessions.logout(['lock', 'idle', 'user'].includes(reason) ? reason : 'user');
      return { ok: true };
    },

    'ops:invoke': (_event, { name, payload } = {}) => {
      const operation = String(name || '');
      const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const context = sessions.context({ touch: !BACKGROUND_OPS.has(operation) });
      if (!context) return fail('auth-required', 'Your session has ended. Sign in to continue.');
      const authorization = authorizeOp(operation, safePayload, context);
      if (!authorization.ok) return authorization;
      if (operation === 'user.changeOwnPin') {
        const user = repo.userGet(context.userId, { includeSecrets: true });
        if (user?.pinHash && !verifyPin(String(safePayload.currentPin || ''), user).ok) {
          return fail('pin-mismatch', 'Your current PIN is not correct.');
        }
      }
      let safety = null;
      if (operation === 'workspace.reset' && safePayload.confirmToken === 'RESET') {
        safety = createBackup(ws, { label: 'pre-reset', kind: 'safety', createdBy: context.userName || '' });
        if (!safety.ok) return fail('backup-failed', `A safety backup could not be created, so nothing was erased: ${safety.error}`);
      }
      try {
        const result = repo.transaction(() => {
          const outcome = runOp(repo, operation, safePayload, context);
          if (!outcome || !outcome.ok) throw new OpRejected(outcome || fail('op-failed', 'The operation returned no result.'));
          writeAudit(outcome, context);
          applyPinToSet(outcome);
          return outcome;
        });
        if (operation === 'workspace.reset') {
          ws.cleanupOrphanAttachmentFiles();
          result.safetyBackup = safety?.path || null;
        }
        delete result.audit;
        return result;
      } catch (error) {
        if (error instanceof OpRejected) return error.result;
        log(`operation ${operation} failed: ${error?.stack || error?.message || error}`);
        return fail('op-failed', friendlyStorageError(error));
      }
    },

    'query:run': async (_event, { name, params } = {}) => {
      const operation = String(name || '');
      const context = sessions.context({ touch: !BACKGROUND_QUERIES.has(operation) });
      if (!context) return fail('auth-required', 'Your session has ended. Sign in to continue.');
      return runQuery(repo, operation, params && typeof params === 'object' ? params : {}, context);
    },

    'attachment:read': (_event, { id } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'patients.view');
      if (!gate.ok) return gate;
      const record = repo.get('attachments', String(id || ''));
      if (!record) return fail('not-found', 'That attachment no longer exists.');
      const bytes = ws.readAttachmentFile(record.filePath);
      if (!bytes) return fail('missing-file', 'The attachment file is missing from disk. Restore it from a backup.');
      return {
        ok: true,
        id: record.id,
        name: record.name,
        type: record.type,
        bytes: bytes.length,
        dataUrl: `data:${record.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`
      };
    },

    'backup:create': (_event, { label } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.create');
      if (!gate.ok) return gate;
      const result = createBackup(ws, { label: String(label || ''), createdBy: context?.userName || '', kind: 'manual', directory: backupDirectory() });
      if (result.ok) auditEvent(context, 'Backup created', result.name);
      return result.ok ? { ok: true, ...result } : fail('backup-failed', result.error);
    },

    'backup:validate': (_event, { path: backupPath } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, ['backup.validate', 'backup.restore']);
      if (!gate.ok) return gate;
      if (!allowedBackupPath(backupPath)) return fail('path-not-allowed', 'Choose the backup folder with “Browse…” first.');
      return validateBackup(path.resolve(String(backupPath)));
    },

    'backup:list': () => {
      const context = sessions.context();
      const gate = requirePermission(context, ['backup.create', 'backup.restore', 'backup.history']);
      if (!gate.ok) return { ...gate, backups: [] };
      return { ok: true, backups: listBackups(ws, { extraDirectory: backupDirectory() }), roots: backupRoots(ws, backupDirectory()) };
    },

    'backup:restore': (_event, { path: backupPath } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      if (!allowedBackupPath(backupPath)) return fail('path-not-allowed', 'Choose the backup folder with “Browse…” first.');
      const result = restoreBackup(ws, path.resolve(String(backupPath)), { autoSafetyBackup: true });
      if (!result.ok) return { ...result, ok: false };
      // The restored workspace has its own accounts and permissions: everyone signs in again.
      auditEvent(context, 'Workspace restored from backup', path.basename(String(backupPath)));
      sessions.logout('restore');
      return { ...result, ok: true, reauth: true, session: null };
    },

    'backup:restore-json': (_event, { text, options } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      const body = typeof text === 'string' ? text : '';
      if (!body) return fail('bad-request', 'The backup file is empty.');
      let parsed;
      try { parsed = parseBackupJson(body); } catch (error) { return fail('invalid-backup', error.message); }
      const opts = options && typeof options === 'object' ? options : {};
      const safety = createBackup(ws, { label: 'pre-json-restore', kind: 'safety', createdBy: context?.userName || '' });
      if (!safety.ok) return fail('backup-failed', `A safety backup could not be created, so nothing was restored: ${safety.error}`);
      try {
        const result = restoreJsonBackup(ws, parsed, {
          modules: Array.isArray(opts.modules) ? opts.modules : null,
          strategy: ['Keep Existing', 'Replace', 'Create New Copy'].includes(opts.strategy) ? opts.strategy : 'Replace',
          patientIds: Array.isArray(opts.patientIds) ? opts.patientIds : null
        });
        auditEvent(context, 'JSON backup restored', `${result.mode} restore`);
        sessions.logout('restore');
        return { ok: true, ...result, safetyBackup: safety.path, reauth: true, session: null };
      } catch (error) {
        return fail('restore-failed', `Restore failed and nothing was changed: ${error.message}`, { safetyBackup: safety.path });
      }
    },

    'backup:pick-folder': async (event) => {
      const context = sessions.context();
      const gate = requirePermission(context, ['backup.restore', 'backup.validate', 'settings.edit']);
      if (!gate.ok) return gate;
      if (typeof dialogs.showOpenDialog !== 'function') return fail('unsupported', 'Folder selection is available in the desktop app.');
      const result = await dialogs.showOpenDialog(event, { title: 'Choose a Dentiva backup folder', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true, path: '' };
      const chosen = path.resolve(result.filePaths[0]);
      pickedFolders.add(chosen);
      return { ok: true, canceled: false, path: chosen };
    },

    'backup:pick-file': async (event) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      if (typeof dialogs.showOpenDialog !== 'function') return fail('unsupported', 'File selection is available in the desktop app.');
      const result = await dialogs.showOpenDialog(event, {
        title: 'Choose a Dentiva JSON backup',
        properties: ['openFile'],
        filters: [{ name: 'Dentiva backup', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true, path: '', text: '' };
      const reader = readFile || (async (file) => (await import('node:fs/promises')).readFile(file, 'utf8'));
      const text = await reader(result.filePaths[0]);
      return { ok: true, canceled: false, path: result.filePaths[0], text };
    },

    'backup:delete': (_event, { name } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      const result = deleteBackup(ws, String(name || ''), { extraDirectory: backupDirectory() });
      if (result.ok) auditEvent(context, 'Backup deleted', String(name || ''));
      return result;
    },

    'backup:prune': (_event, { keep } = {}) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      return pruneBackups(ws, Number(keep) || 10, { extraDirectory: backupDirectory() });
    },

    'diagnostics:run': () => {
      const context = sessions.context();
      const gate = requirePermission(context, 'diagnostics.view');
      if (!gate.ok) return gate;
      return diagnoseWorkspace(ws);
    },

    'workspace:export': async (event) => {
      const context = sessions.context();
      const gate = requirePermission(context, 'backup.create');
      if (!gate.ok) return gate;
      if (typeof dialogs.showOpenDialog !== 'function') return fail('unsupported', 'Folder selection is available in the desktop app.');
      const picked = await dialogs.showOpenDialog(event, { title: 'Choose where to export a copy of the workspace', properties: ['openDirectory', 'createDirectory'] });
      if (picked.canceled || !picked.filePaths.length) return { ok: true, canceled: true };
      const result = createBackup(ws, { label: 'workspace-export', kind: 'export', directory: picked.filePaths[0], createdBy: context?.userName || '' });
      if (result.ok) auditEvent(context, 'Workspace exported', result.path);
      return result.ok ? { ok: true, path: result.path } : fail('export-failed', result.error);
    },

    'workspace:info': () => {
      const context = sessions.context();
      const gate = requirePermission(context, ['settings.view', 'backup.create', 'diagnostics.view']);
      if (!gate.ok) return gate;
      const storage = ws.storageInfo();
      return {
        ok: true,
        directory: ws.directory,
        appVersion: APP_VERSION,
        storage,
        integrity: ws.quickCheck(),
        lastBackupAt: repo.getMeta('lastBackupAt', null),
        lastRestoreAt: repo.getMeta('lastRestoreAt', null),
        lastAutoBackupStatus: normalizeStatus(repo.getMeta('lastAutoBackupStatus', null)),
        backupRoots: backupRoots(ws, backupDirectory())
      };
    }
  };

  for (const channel of Object.keys(handlers)) {
    if (!HANDLER_CHANNELS.includes(channel)) throw new Error(`Unlisted channel handler: ${channel}`);
  }
  return handlers;
}

function normalizeStatus(value) {
  if (!value) return null;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value;
}
