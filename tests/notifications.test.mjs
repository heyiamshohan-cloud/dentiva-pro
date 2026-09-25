/**
 * Notification engine + RBAC hardening verification (both runtimes).
 *
 * The engine is a workspace signal feed: it converges the stored
 * `notifications` collection to the live truth — deduplicated by stable ids,
 * preserving read/dismissed user state, and disappearing when the underlying
 * condition clears. These tests prove that end-to-end on LocalRepo (browser
 * runtime) and SqlRepo (Electron runtime), alongside the v1.5.0 RBAC fixes:
 * the expenses-view permission alignment and the real Accountant role.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalRepo } from '../src/repo-local.js';
import { runOp } from '../src/ops.js';
import { runQuery } from '../src/queries.js';
import { permissionsForRole, hasPermission } from '../src/core.js';
import { normalizeNotificationRules } from '../src/notifications.js';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';

// Clinic-day arithmetic: the product's "today" is the clinic's calendar day
// (settings timezone), so seeding from the host's UTC date would flake after
// 18:00 UTC / midnight in Dhaka.
import { clinicDate } from '../src/core.js';
const dayString = (offset = 0) => new Date(Date.parse(`${clinicDate()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const today = () => dayString(0);
const tomorrow = () => dayString(1);
const yesterday = () => dayString(-1);

const adminCtx = () => ({ userId: 'u-admin', userName: 'Admin', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true });

async function seedSignals(repo, ctx) {
  const patient = (await runOp(repo, 'patient.create', { fullName: 'Signal Patient', phone: '01799999999' }, ctx)).record;
  await runOp(repo, 'appointment.create', { patientId: patient.id, date: today(), time: '10:00', reason: 'Check-up' }, ctx);
  await runOp(repo, 'appointment.create', { patientId: patient.id, date: today(), time: '11:00', reason: 'Filling', status: 'Checked In' }, ctx);
  await runOp(repo, 'invoice.create', { patientId: patient.id, date: yesterday(), items: [{ name: 'Scaling', quantity: 1, unitPrice: 800 }], discount: 0, taxRate: 0 }, ctx);
  await runOp(repo, 'followup.create', { patientId: patient.id, dueDate: yesterday(), reason: 'Post-extraction check' }, ctx);
  await runOp(repo, 'inventory.createItem', { name: 'Lidocaine', unit: 'ampoule', category: 'Anaesthesia', currentStock: 2, minimumStock: 10, expiryDate: tomorrow() }, ctx);
  return patient;
}

const kinds = (repo) => repo.listCollection('notifications', { page: 1, pageSize: 100 }).rows.map((row) => row.kind).sort();

test('notification engine derives every rule kind from live state and converges without duplicates', async () => {
  const repo = new LocalRepo();
  const ctx = adminCtx();
  await seedSignals(repo, ctx);
  const first = await runOp(repo, 'notifications.scan', {}, ctx);
  assert.equal(first.ok, true);
  const found = kinds(repo);
  for (const kind of ['appointments', 'followups', 'payments', 'stock', 'expiry', 'backup']) {
    assert.ok(found.includes(kind), `expected ${kind} signal, got ${found.join(',')}`);
  }
  const countAfterFirst = repo.listCollection('notifications', { page: 1, pageSize: 100 }).total;
  const second = await runOp(repo, 'notifications.scan', {}, ctx);
  assert.equal(second.ok, true);
  assert.equal(repo.listCollection('notifications', { page: 1, pageSize: 100 }).total, countAfterFirst, 're-scan must not duplicate rows');
});

test('dismissed notifications stay dismissed; resolved conditions disappear', async () => {
  const repo = new LocalRepo();
  const ctx = adminCtx();
  await seedSignals(repo, ctx);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const rows = repo.listCollection('notifications', { page: 1, pageSize: 100 }).rows;
  const stock = rows.find((row) => row.kind === 'stock');
  await runOp(repo, 'notification.dismiss', { id: stock.id }, ctx);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const afterDismiss = repo.listCollection('notifications', { page: 1, pageSize: 100, filters: { dismissed: true } }).rows;
  assert.ok(afterDismiss.some((row) => row.id === stock.id), 'dismissed row must survive re-scans');
  // Resolve the stock condition: raise quantity above threshold.
  await runOp(repo, 'inventory.movement', { itemId: repo.listCollection('inventory', { page: 1, pageSize: 10 }).rows[0]?.id, movementType: 'Purchase', quantity: 50, date: today(), reason: 'Restock' }, ctx);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const resolved = repo.listCollection('notifications', { page: 1, pageSize: 100 }).rows;
  assert.ok(!resolved.some((row) => row.kind === 'stock'), 'cleared condition must remove the signal');
});

test('settings.notifications=false drops auto rows; per-kind rule silences one kind only', async () => {
  const repo = new LocalRepo();
  const ctx = adminCtx();
  await seedSignals(repo, ctx);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const saved = await runOp(repo, 'settings.update', { notificationRules: { ...normalizeNotificationRules(null), payments: false } }, ctx);
  assert.equal(saved.ok, true);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const afterRuleOff = kinds(repo);
  assert.ok(!afterRuleOff.includes('payments'), 'payments rule off must silence that signal');
  assert.ok(afterRuleOff.includes('backup'), 'other kinds stay active');
  await runOp(repo, 'settings.update', { notifications: false }, ctx);
  const scan = await runOp(repo, 'notifications.scan', {}, ctx);
  assert.equal(scan.disabled, true);
  assert.equal(repo.listCollection('notifications', { page: 1, pageSize: 100 }).rows.filter((row) => row.auto).length, 0, 'auto rows are dropped while disabled');
});

test('notifications query returns items, unread and normalized rules', async () => {
  const repo = new LocalRepo();
  const ctx = adminCtx();
  await seedSignals(repo, ctx);
  await runOp(repo, 'notifications.scan', {}, ctx);
  const page = await runQuery(repo, 'notifications', {}, ctx);
  assert.ok(Array.isArray(page.items));
  assert.ok(page.unread >= 5);
  assert.equal(page.rules.payments, true);
});

test('rbac: expenses list is visible to Administrator (accounting.view alignment)', async () => {
  const repo = new LocalRepo();
  const result = await runQuery(repo, 'list', { collection: 'expenses', page: 1, pageSize: 10 }, adminCtx());
  assert.notEqual(result.ok, false, `expenses list must not be permission-blocked: ${result.error || ''}`);
});

test('rbac: Accountant can record payments and see financial data but cannot create patients/users or run diagnostics', async () => {
  const repo = new LocalRepo();
  const admin = adminCtx();
  const patient = (await runOp(repo, 'patient.create', { fullName: 'Accountant Target', phone: '01788888888' }, admin)).record;
  const invoice = (await runOp(repo, 'invoice.create', { patientId: patient.id, date: today(), items: [{ name: 'RCT', quantity: 1, unitPrice: 5000 }], discount: 0, taxRate: 0 }, admin)).record;
  const accountant = { userId: 'u-acc', userName: 'Accountant', role: 'Accountant', permissions: permissionsForRole('Accountant') };
  assert.ok(permissionsForRole('Accountant').length > 0, 'Accountant must have a real permission set');
  const payment = await runOp(repo, 'payment.record', { patientId: patient.id, invoiceId: invoice.id, amount: 500, date: today(), method: 'Cash' }, accountant);
  assert.equal(payment.ok, true, `Accountant payment should be allowed: ${payment.error || ''}`);
  const expenses = await runQuery(repo, 'list', { collection: 'expenses', page: 1, pageSize: 10 }, accountant);
  assert.notEqual(expenses.ok, false, 'Accountant may view expenses');
  const audit = await runQuery(repo, 'auditList', { page: 1, pageSize: 10 }, accountant);
  assert.notEqual(audit.ok, false, 'Accountant may view audit trail');
  const deniedOps = [
    ['patient.create', { fullName: 'Denied', phone: '01500000000' }],
    ['user.create', { name: 'Denied User', role: 'Receptionist', pin: '4444', confirmPin: '4444' }],
    ['workspace.reset', { confirmToken: 'RESET' }],
    ['settings.update', { clinicName: 'Nope' }]
  ];
  for (const [name, payload] of deniedOps) {
    const result = await runOp(repo, name, payload, accountant);
    assert.equal(result.ok, false, `${name} must be denied for Accountant`);
    assert.equal(result.code, 'permission-denied');
  }
  const deniedQueries = await runQuery(repo, 'diagnostics', {}, accountant);
  assert.equal(deniedQueries.ok, false, 'diagnostics must be denied for Accountant');
  assert.equal(hasPermission({ active: true, role: 'Accountant', permissions: accountant.permissions }, 'users.manage'), false);
});

test('notification engine produces identical kinds on the SQL runtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-notify-sql-'));
  try {
    migrateWorkspace(dir);
    const ws = new Workspace(dir).open();
    const repo = new SqlRepo(ws);
    const ctx = adminCtx();
    await seedSignals(repo, ctx);
    const scan = await runOp(repo, 'notifications.scan', {}, ctx);
    assert.equal(scan.ok, true);
    const found = kinds(repo);
    for (const kind of ['appointments', 'followups', 'payments', 'stock', 'expiry', 'backup']) {
      assert.ok(found.includes(kind), `SQL runtime expected ${kind} signal, got ${found.join(',')}`);
    }
    const before = repo.listCollection('notifications', { page: 1, pageSize: 100 }).total;
    await runOp(repo, 'notifications.scan', {}, ctx);
    assert.equal(repo.listCollection('notifications', { page: 1, pageSize: 100 }).total, before, 'SQL re-scan must not duplicate');
    ws.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('notification signals key off the clinic calendar day, never the host clock', async () => {
  const repo = new LocalRepo();
  // 19:30 UTC on the 25th is 01:30 on the 26th in Asia/Dhaka: the clinic is
  // working on the 26th while the host clock is still on the 25th.
  const clinicCtx = { ...adminCtx(), now: () => '2026-09-25T19:30:00.000Z', today: () => '2026-09-26' };
  const patient = (await runOp(repo, 'patient.create', { fullName: 'Midnight Patient', phone: '01788888888' }, clinicCtx)).record;
  await runOp(repo, 'appointment.create', { patientId: patient.id, date: '2026-09-25', time: '22:00', reason: 'Host-day appointment' }, clinicCtx);
  await runOp(repo, 'appointment.create', { patientId: patient.id, date: '2026-09-26', time: '00:30', reason: 'Clinic-day appointment' }, clinicCtx);
  const scan = await runOp(repo, 'notifications.scan', {}, clinicCtx);
  assert.equal(scan.ok, true);
  const appointments = repo.listCollection('notifications', { page: 1, pageSize: 100 }).rows.find((row) => row.kind === 'appointments');
  assert.ok(appointments, 'the clinic-day appointment must raise a signal');
  assert.equal(appointments.id, 'auto_appointments_2026-09-26');
  assert.equal(appointments.date, '2026-09-26');
  assert.equal(appointments.title, '1 appointment scheduled today', 'only the clinic-day appointment may be counted');
  assert.equal(appointments.updatedAt, '2026-09-25T19:30:00.000Z', 'timestamps still come from the caller clock');
});
