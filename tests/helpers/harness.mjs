// Shared test harness (v2.0.0): boots the real SQLite repository and the
// browser fallback repository side by side so both runtimes can be driven
// through the SAME shared operation/query registries and compared.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../../electron/lib/db.mjs';
import { migrateWorkspace } from '../../electron/lib/migrate.mjs';
import { SqlRepo } from '../../electron/lib/repo-sql.mjs';
import { LocalRepo } from '../../src/repo-local.js';
import { defaultState } from '../../src/migrate-state.js';

export function tempDir(prefix = 'dentiva-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Minimal localStorage-compatible shim for LocalRepo in Node. */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

/**
 * Open a workspace the way the desktop app does. Production always runs the
 * migration engine before opening the file (electron/main.mjs), and that step
 * seeds baseline data (the default room, meta keys). Opening the raw file
 * instead would test a state the product never ships.
 */
export function openSqlWorkspace(directory) {
  migrateWorkspace(directory);
  const ws = new Workspace(directory);
  ws.open();
  return ws;
}

export function makeSqlRepo(directory) {
  const ws = openSqlWorkspace(directory);
  return { ws, repo: new SqlRepo(ws) };
}

export function makeLocalRepo() {
  const storage = new MemoryStorage();
  const repo = new LocalRepo({ storage });
  repo.state = { ...defaultState(), ...repo.state };
  return { storage, repo };
}

export const CTX = {
  userId: 'u_test',
  userName: 'Test Administrator',
  role: 'Administrator',
  permissions: null, // filled by adminContext()
  firstRun: false,
  now: () => new Date('2026-09-25T09:00:00.000Z').toISOString(),
  today: () => '2026-09-25',
};

export function adminContext(permissions) {
  return { ...CTX, permissions: permissions || null };
}
