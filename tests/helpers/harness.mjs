// Test harness: a real workspace (node:sqlite on disk), the real repository,
// the real SessionManager and the real IPC handlers — exactly what the
// Electron main process wires, minus the window. Tests drive it through
// `invoke(channel, args)` like the renderer does.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateWorkspace } from '../../electron/lib/migrate.mjs';
import { Workspace } from '../../electron/lib/db.mjs';
import { SqlRepo } from '../../electron/lib/repo-sql.mjs';
import { SessionManager } from '../../electron/lib/auth.mjs';
import { createIpcHandlers } from '../../electron/lib/ipc-handlers.mjs';

export const ADMIN_PIN = '2468';

export function createHarness(t, { now = null, dialogs = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-harness-'));
  migrateWorkspace(dir);
  const ws = new Workspace(dir).open();
  const repo = new SqlRepo(ws);
  const clock = { value: now ?? Date.now() };
  const sessions = new SessionManager({ repo, now: () => clock.value });
  const logs = [];
  const handlers = createIpcHandlers({ repo, ws, sessions, dialogs, log: (message) => logs.push(message) });
  const invoke = async (channel, args = {}) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({ sender: null }, args);
  };
  const op = (name, payload = {}) => invoke('ops:invoke', { name, payload });
  const query = (name, params = {}) => invoke('query:run', { name, params });
  const harness = {
    dir, ws, repo, sessions, handlers, invoke, op, query, logs, clock,
    advance(ms) { clock.value += ms; },
    /** First-run: complete setup and create the first Administrator, then sign in. */
    async bootstrapAdmin({ name = 'Dr. Admin', pin = ADMIN_PIN, clinicName = 'Harness Dental Clinic' } = {}) {
      const setup = await op('setup.complete', { clinicName, dentistName: name });
      if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
      const created = await op('user.create', { name, role: 'Administrator', pin, confirmPin: pin });
      if (!created.ok) throw new Error(`admin create failed: ${created.error}`);
      const login = await invoke('auth:login', { userId: created.record.id, pin });
      if (!login.ok) throw new Error(`admin login failed: ${login.error}`);
      harness.adminId = created.record.id;
      return created.record;
    },
    async createUser(role, { name = `${role} User`, pin = '1357', permissions } = {}) {
      const created = await op('user.create', { name, role, pin, confirmPin: pin, permissions });
      if (!created.ok) throw new Error(`user create failed: ${created.error}`);
      return created.record;
    },
    async loginAs(userId, pin) {
      await invoke('auth:logout');
      const result = await invoke('auth:login', { userId, pin });
      if (!result.ok) throw new Error(`login failed: ${result.error}`);
      return result;
    },
    close() {
      try { ws.close(); } catch { /* already closed */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
    }
  };
  if (t && typeof t.after === 'function') t.after(() => harness.close());
  return harness;
}

/** Create a patient through the real op path; returns the record. */
export async function makePatient(h, overrides = {}) {
  const result = await h.op('patient.create', { fullName: 'Test Patient', phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`, gender: 'Female', dateOfBirth: '1990-04-12', ...overrides, confirmDuplicate: true });
  if (!result.ok) throw new Error(`patient create failed: ${result.error}`);
  return result.record;
}
