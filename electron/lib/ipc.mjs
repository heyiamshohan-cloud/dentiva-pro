// Dentiva Pro v1.4.0 — main-process IPC surface.
//
// The renderer talks to the store through exactly two data channels plus a
// small set of privileged channels, every one of which:
//   1. resolves the caller's session from the in-memory SessionManager (never
//      from renderer-supplied identity),
//   2. enforces permissions server-side (the renderer only hides UI),
//   3. attributes audit entries to the session that made the call.
//
// Channels are allowlisted in the preload; anything else is rejected here as
// well. Results are plain JSON — no functions, no handles, no secrets.

import { ipcMain } from 'electron';
import { runOp } from '../../src/ops.js';
import { runQuery } from '../../src/queries.js';
import { hashPin } from './auth.mjs';
import { createBackup, restoreBackup, validateBackup, listBackups, deleteBackup, pruneBackups } from './backup.mjs';
import { diagnoseWorkspace } from './diagnostics.mjs';
import { APP_VERSION } from '../../src/migrate-state.js';

const DATA_CHANNELS = new Set(['ops:invoke', 'query:run']);
const PRIVILEGED_CHANNELS = new Set([
  'auth:bootstrap', 'auth:login', 'auth:logout', 'auth:session',
  'attachment:read',
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete', 'backup:validate', 'backup:prune',
  'diagnostics:run', 'workspace:info'
]);

const fail = (code, message) => ({ ok: false, code, error: message });

/** Require a permission on the live session (or first-run setup authority). */
function requirePermission(ctx, permission) {
  if (!ctx) return fail('auth-required', 'Sign in to continue.');
  if (ctx.firstRun) return { ok: true };
  if ((ctx.permissions || []).includes(permission)) return { ok: true };
  return fail('permission-denied', 'Your account is not allowed to perform this action.');
}

export function registerIpc({ repo, ws, sessions }) {
  const nowIso = () => new Date().toISOString();

  const ctx = () => sessions.context();

  const writeAudit = (result, context) => {
    if (!result || !result.ok) return;
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

  /** Persist the KDF result for ops that return pinToSet (Node-side crypto). */
  const applyPinToSet = (result) => {
    if (!result || !result.ok || !result.pinToSet) return;
    const { userId, pin } = result.pinToSet;
    const derived = hashPin(pin);
    repo.setUserSecrets(userId, { pinHash: derived.hash, pinSalt: derived.salt, kdf: derived.kdf, failedAttempts: 0, lockedUntil: 0 });
    delete result.pinToSet;
  };

  const bootstrapPayload = () => {
    const settings = repo.getSettings();
    const session = sessions.publicSession();
    const storage = ws.storageInfo();
    return {
      ok: true,
      appVersion: APP_VERSION,
      firstRun: sessions.firstRun(),
      setupComplete: Boolean(repo.getMeta('setupComplete', false)),
      session,
      settings,
      unsupportedSchema: Boolean(repo.getMeta('unsupportedSchema', false)),
      migrationError: repo.getMeta('migrationError', '') || '',
      counts: repo.recordCounts ? repo.recordCounts() : storage.recordCounts,
      storage: {
        bytes: storage.bytes,
        attachmentBytes: storage.attachmentBytes,
        attachmentFiles: storage.attachmentFiles,
        recordCounts: storage.recordCounts,
        journalMode: storage.journalMode,
        lastBackupAt: repo.getMeta('lastBackupAt', null),
        lastRestoreAt: repo.getMeta('lastRestoreAt', null)
      }
    };
  };

  const handlers = {
    'auth:bootstrap': () => bootstrapPayload(),

    'auth:session': () => {
      const session = sessions.publicSession();
      return { ok: true, session, locked: !session };
    },

    'auth:login': (_event, { userId, pin } = {}) => {
      const result = sessions.login(String(userId || ''), String(pin || ''));
      if (!result.ok) return { ...result, lockedOut: result.lockedOut !== false && /locked/i.test(result.error || '') };
      return result;
    },

    'auth:logout': () => {
      sessions.logout('user');
      return { ok: true };
    },

    'ops:invoke': (_event, { name, payload } = {}) => {
      const operation = String(name || '');
      const context = ctx();
      // setup.complete stays open only during first-run, otherwise it is a
      // settings.edit action — the op itself is permission-neutral by design.
      if (operation === 'setup.complete' && context && !context.firstRun) {
        const gate = requirePermission(context, 'settings.edit');
        if (!gate.ok) return gate;
      }
      const result = runOp(repo, operation, payload && typeof payload === 'object' ? payload : {}, context || {});
      if (result.ok) writeAudit(result, context);
      applyPinToSet(result);
      return result;
    },

    'query:run': async (_event, { name, params } = {}) => {
      const operation = String(name || '');
      const context = ctx();
      return runQuery(repo, operation, params && typeof params === 'object' ? params : {}, context);
    },

    'attachment:read': (_event, { id } = {}) => {
      const context = ctx();
      const gate = context ? requirePermission(context, 'patients.view') : fail('auth-required', 'Sign in to continue.');
      if (!gate.ok) return gate;
      const record = repo.get('attachments', String(id || ''));
      if (!record) return fail('not-found', 'That attachment no longer exists.');
      const bytes = ws.readAttachmentFile(record.filePath);
      if (!bytes) return fail('missing-file', 'The attachment file is missing from disk.');
      return {
        ok: true,
        id: record.id,
        name: record.name,
        type: record.type,
        bytes: bytes.length,
        base64: bytes.toString('base64'),
        dataUrl: `data:${record.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`
      };
    },

    'backup:create': (_event, { label } = {}) => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.create');
      if (!gate.ok) return gate;
      const result = createBackup(ws, { label: String(label || ''), createdBy: context?.userName || '' });
      return result.ok ? { ok: true, ...result } : { ok: false, error: result.error };
    },

    'backup:validate': (_event, { path: backupPath } = {}) => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.validate');
      if (!gate.ok) return gate;
      return validateBackup(String(backupPath || ''));
    },

    'backup:list': () => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.create');
      if (!gate.ok) return { ok: false, code: gate.code, backups: [] };
      return { ok: true, backups: listBackups(ws) };
    },

    'backup:restore': (_event, { path: backupPath } = {}) => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      const result = restoreBackup(ws, String(backupPath || ''), { autoSafetyBackup: true });
      return {
        ok: result.ok,
        ...(result.ok ? result : { error: result.error, problems: result.problems || [], hint: result.hint || '' }),
        session: result.ok ? sessions.publicSession() : null
      };
    },

    'backup:delete': (_event, { name } = {}) => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      return deleteBackup(ws, String(name || ''));
    },

    'backup:prune': (_event, { keep } = {}) => {
      const context = ctx();
      const gate = requirePermission(context, 'backup.restore');
      if (!gate.ok) return gate;
      return pruneBackups(ws, Number(keep) || 10);
    },

    'diagnostics:run': () => {
      const context = ctx();
      const gate = requirePermission(context, 'diagnostics.view');
      if (!gate.ok) return gate;
      return diagnoseWorkspace(ws);
    },

    'workspace:info': () => {
      const context = ctx();
      if (!context) return fail('auth-required', 'Sign in to continue.');
      const storage = ws.storageInfo();
      return {
        ok: true,
        directory: ws.directory,
        appVersion: APP_VERSION,
        storage,
        integrity: ws.integrityCheck(),
        lastBackupAt: repo.getMeta('lastBackupAt', null),
        lastRestoreAt: repo.getMeta('lastRestoreAt', null)
      };
    }
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    if (!PRIVILEGED_CHANNELS.has(channel) && !DATA_CHANNELS.has(channel)) throw new Error(`IPC channel not allowlisted: ${channel}`);
    ipcMain.handle(channel, handler);
  }
}

export { DATA_CHANNELS, PRIVILEGED_CHANNELS };
