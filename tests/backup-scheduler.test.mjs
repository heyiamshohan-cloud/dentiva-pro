/**
 * Automatic backup scheduler verification.
 *
 * Covers the pure due-decision logic and the executor tick — including the
 * single-flight guard, retention prune, and failure recording — plus a real
 * end-to-end tick against a genuine workspace (real SQLite, real backup on
 * disk, real prune).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupDue, nextBackupAt, normalizeBackupSchedule } from '../src/backup-schedule.mjs';
import { runScheduledBackupTick } from '../electron/lib/backup-scheduler.mjs';
import { createBackup, listBackups } from '../electron/lib/backup.mjs';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { runOp } from '../src/ops.js';
import { permissionsForRole } from '../src/core.js';

const H = 3600000;

test('backupDue truth table', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(backupDue({ backupEnabled: false }, '', now).due, false);
  assert.equal(backupDue({}, '', now).reason, 'never-backed-up');
  assert.equal(backupDue({}, '2026-09-22T11:30:00Z', now).due, false, '30 min fresh with 24 h interval');
  assert.equal(backupDue({ backupIntervalHours: 24 }, '2026-09-21T11:59:00Z', now).due, true);
  assert.equal(backupDue({ backupIntervalHours: 168 }, '2026-09-16T12:00:00Z', now).due, false, 'weekly interval not due after 6 days');
  assert.equal(backupDue({ backupIntervalHours: 168 }, '2026-09-14T12:00:00Z', now).due, true, 'weekly interval due after 8 days');
  assert.equal(backupDue({}, 'not-a-date', now).reason, 'invalid-timestamp');
  assert.equal(backupDue({}, '2030-01-01T00:00:00Z', new Date('2026-01-01')).due, true, 'clock-skewed future stamp still backs up');
  const schedule = normalizeBackupSchedule({ backupIntervalHours: 0, backupRetention: 0 });
  assert.deepEqual([schedule.intervalHours, schedule.retention], [24, 10], 'clamps to sane defaults');
  assert.ok(nextBackupAt({}, '2026-09-01T00:00:00Z', now).startsWith('2026-09-02'));
  assert.equal(nextBackupAt({ backupEnabled: false }, '', now), '');
});

test('tick runs once when due, honours disabled/fresh, single-flights and records failures', async () => {
  const meta = new Map();
  const repo = { getSettings: () => ({ backupEnabled: true, backupIntervalHours: 24, backupRetention: 3 }), getMeta: (k, d) => meta.get(k) ?? d, setMeta: (k, v) => meta.set(k, v) };
  const state = { running: false };
  let created = 0;
  const create = () => { created += 1; return { ok: true, manifest: { name: `backup-${created}` } }; };
  const prune = () => ({ removed: 2 });

  const first = await runScheduledBackupTick({ repo, ws: {}, now: new Date(), createBackupFn: create, pruneBackupsFn: prune, state });
  assert.deepEqual([first.ran, created], [true, 1]);
  const status = meta.get('lastAutoBackupStatus');
  assert.equal(typeof status, 'object', 'status is stored as a structured object (not double-encoded JSON)');
  assert.equal(status.ok, true);
  assert.equal(status.pruned, 2);

  // Not due again right away: lastBackupAt written by the (faked) creator.
  meta.set('lastBackupAt', new Date().toISOString());
  const second = await runScheduledBackupTick({ repo, ws: {}, now: new Date(), createBackupFn: create, pruneBackupsFn: prune, state });
  assert.deepEqual([second.ran, created], [false, 1]);

  // Single-flight: a tick while running is skipped.
  state.running = true;
  meta.set('lastBackupAt', new Date(Date.now() - 48 * H).toISOString());
  const inflight = await runScheduledBackupTick({ repo, ws: {}, now: new Date(), createBackupFn: create, pruneBackupsFn: prune, state });
  assert.equal(inflight.reason, 'already-running');
  state.running = false;

  // Failure is recorded without throwing.
  const boom = await runScheduledBackupTick({ repo, ws: {}, now: new Date(), createBackupFn: () => { throw new Error('disk full'); }, pruneBackupsFn: prune, state });
  assert.equal(boom.reason, 'failed');
  assert.match(meta.get('lastAutoBackupStatus').error, /disk full/);

  // Disabled scheduler never runs.
  const disabledRepo = { ...repo, getSettings: () => ({ backupEnabled: false }) };
  const stopped = await runScheduledBackupTick({ repo: disabledRepo, ws: {}, now: new Date(), createBackupFn: create, pruneBackupsFn: prune, state });
  assert.equal(stopped.reason, 'disabled');
});

test('end-to-end: overdue workspace gets a real automatic backup and retention prune', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-autobackup-'));
  try {
    migrateWorkspace(dir);
    const ws = new Workspace(dir).open();
    const repo = new SqlRepo(ws);
    const ctx = { userId: 'u', userName: 'A', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true };
    await runOp(repo, 'patient.create', { fullName: 'Auto Backup', phone: '01700000000' }, ctx);
    // Overdue by 3 days; retention 1 so every automatic run prunes older copies.
    repo.setMeta('settings', { ...repo.getSettings(), backupRetention: 1 });
    ws.setMeta('lastBackupAt', new Date(Date.now() - 3 * 24 * H).toISOString());

    const first = await runScheduledBackupTick({ repo, ws, now: new Date() });
    assert.equal(first.ran, true, `first tick should back up: ${JSON.stringify(first)}`);
    let backups = listBackups(ws).filter((entry) => /automatic/i.test(entry.label || ''));
    assert.equal(backups.length, 1, 'retention keeps exactly one automatic backup');
    assert.ok(fs.statSync(path.join(dir, 'backups', first.name, 'dentiva-pro.sqlite')).size > 0);

    // Two days later: next tick runs again and prunes the previous automatic copy.
    ws.setMeta('lastBackupAt', new Date(Date.now() - 2 * 24 * H).toISOString());
    const second = await runScheduledBackupTick({ repo, ws, now: new Date() });
    assert.equal(second.ran, true);
    backups = listBackups(ws).filter((entry) => /automatic/i.test(entry.label || ''));
    assert.equal(backups.length, 1, 'older automatic backups are pruned to retention');
    const status = ws.getMeta('lastAutoBackupStatus') || {};
    assert.equal(status.ok, true);
    ws.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
