// v2.0.0 domain proof suite: money, statements, receipts, codes, clinical
// rules, restore rollback and the v1.6.1 → v2.0.0 upgrade — all through the
// real IPC handlers and a real on-disk SQLite workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHarness, makePatient, ADMIN_PIN } from './helpers/harness.mjs';
import { restoreBackup, createBackup } from '../electron/lib/backup.mjs';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { SessionManager } from '../electron/lib/auth.mjs';
import { statementEntries } from '../src/domain.js';

const cents = (value) => Math.round(Number(value) * 100);

async function adminWithPatient(t) {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const patient = await makePatient(h, { fullName: 'Money Patient' });
  return { h, patient };
}

test('invoice math: total = subtotal − discount + tax in exact integer cents', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const created = await h.op('invoice.create', {
    patientId: patient.id, date: '2026-09-01', discount: '10.05', taxRate: 7.5,
    items: [{ name: 'Filling', quantity: 3, unitPrice: '33.33' }, { name: 'X-Ray', quantity: '1.5', unitPrice: '99.99' }]
  });
  assert.equal(created.ok, true, created.error);
  const inv = h.repo.get('invoices', created.record.id);
  // 3 × 33.33 = 99.99 ; 1.5 × 99.99 = 149.985 → 149.99 (half-up on the line)
  assert.equal(inv.items[0].lineTotalCents, 9999);
  assert.equal(inv.items[1].lineTotalCents, 14999);
  assert.equal(inv.items[1].unitPriceCents, 9999, 'unit price is never re-derived from a rounded line total');
  assert.equal(inv.subtotalCents, 24998);
  assert.equal(inv.discountCents, 1005);
  const taxable = 24998 - 1005;
  assert.equal(inv.taxCents, Math.round(taxable * 7.5 / 100));
  assert.equal(inv.totalCents, taxable + inv.taxCents);
  assert.equal(inv.dueCents, inv.totalCents);
  assert.equal(inv.status, 'Issued');
});

test('invalid money is rejected, never silently altered', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const cases = [
    [{ items: [{ name: 'A', quantity: 1, unitPrice: 'abc' }] }, /unit price/i],
    [{ items: [{ name: 'A', quantity: 1, unitPrice: '10.005' }] }, /unit price/i],
    [{ items: [{ name: 'A', quantity: 1, unitPrice: '-5' }] }, /unit price/i],
    [{ items: [{ name: 'A', quantity: 0, unitPrice: '5' }] }, /quantity/i],
    [{ items: [{ name: '', quantity: 1, unitPrice: '5' }] }, /description/i],
    [{ items: [{ name: 'A', quantity: 1, unitPrice: '50' }], discount: '60' }, /discount/i],
    [{ items: [{ name: 'A', quantity: 1, unitPrice: '50' }], taxRate: 150 }, /tax rate/i],
    [{ items: [] }, /line item/i]
  ];
  for (const [payload, message] of cases) {
    const result = await h.op('invoice.create', { patientId: patient.id, ...payload });
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.match(result.error, message);
  }
  assert.equal(h.ws.queryOne('SELECT COUNT(*) AS n FROM invoices').n, 0, 'no invoice persisted by rejected attempts');
});

test('payment lifecycle: partial → paid → refund → re-pay; statuses are derived, never manual', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const inv = (await h.op('invoice.create', { patientId: patient.id, date: '2026-09-01', items: [{ name: 'Crown', quantity: 1, unitPrice: '1000.00' }] })).record;
  const over = await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-02', amount: '1000.01', method: 'Cash' });
  assert.equal(over.ok, false, 'overpayment rejected');
  const p1 = await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-02', amount: '400.00', method: 'Cash' });
  assert.equal(p1.ok, true, p1.error);
  assert.equal(h.repo.get('invoices', inv.id).status, 'Partially Paid');
  assert.equal(p1.record.invoiceDueAfterCents, 60000);
  assert.equal(p1.record.receivedBy, 'Dr. Admin');
  const p2 = await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-03', amount: '600.00', method: 'Card' });
  assert.equal(p2.ok, true, p2.error);
  let fresh = h.repo.get('invoices', inv.id);
  assert.equal(fresh.status, 'Paid');
  assert.equal(fresh.dueCents, 0);
  const manual = await h.op('invoice.update', { id: inv.id, status: 'Issued' });
  assert.equal(manual.ok, false, 'manual status change refused');
  const refund = await h.op('payment.refund', { id: p2.record.id, amount: '600.00', reason: 'Crown remade by lab', date: '2026-09-10' });
  assert.equal(refund.ok, true, refund.error);
  fresh = h.repo.get('invoices', inv.id);
  assert.equal(fresh.status, 'Partially Paid');
  assert.equal(fresh.dueCents, 60000);
  const p3 = await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-11', amount: '600.00', method: 'Cash' });
  assert.equal(p3.ok, true, p3.error);
  assert.equal(h.repo.get('invoices', inv.id).status, 'Paid');
});

test('FIN-01: invoices with money cannot be cancelled or repriced through update', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const inv = (await h.op('invoice.create', { patientId: patient.id, items: [{ name: 'Scaling', quantity: 1, unitPrice: '1500.00' }] })).record;
  await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-02', amount: '500.00', method: 'Cash' });
  assert.equal((await h.op('invoice.update', { id: inv.id, status: 'Cancelled' })).code, 'use-cancel');
  assert.equal((await h.op('invoice.update', { id: inv.id, status: 'Paid' })).code, 'status-locked');
  assert.equal((await h.op('invoice.update', { id: inv.id, items: [{ name: 'Scaling', quantity: 1, unitPrice: '100.00' }] })).code, 'invoice-locked');
  const cancel = await h.op('invoice.cancel', { id: inv.id, reason: 'Duplicate' });
  assert.match(cancel.error, /Refund/);
  assert.equal(h.repo.get('invoices', inv.id).status, 'Partially Paid');
});

test('drafts: no payments until issued; drafts never count as receivables', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const draft = (await h.op('invoice.create', { patientId: patient.id, status: 'Draft', items: [{ name: 'Plan', quantity: 1, unitPrice: '2000.00' }] })).record;
  assert.equal(draft.status, 'Draft');
  assert.equal(h.repo.get('patients', patient.id).balanceCents, 0, 'draft not billed');
  const pay = await h.op('payment.record', { patientId: patient.id, invoiceId: draft.id, date: '2026-09-02', amount: '100.00', method: 'Cash' });
  assert.match(pay.error, /Issue this draft/);
  const issued = await h.op('invoice.update', { id: draft.id, status: 'Issued' });
  assert.equal(issued.ok, true, issued.error);
  assert.equal(h.repo.get('patients', patient.id).balanceCents, 200000);
});

test('adjustments: cannot exceed due; reduce due; balance identity holds everywhere', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const inv = (await h.op('invoice.create', { patientId: patient.id, date: '2026-09-01', items: [{ name: 'Extraction', quantity: 1, unitPrice: '1000.00' }] })).record;
  await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-02', amount: '800.00', method: 'Cash' });
  const tooMuch = await h.op('payment.adjust', { invoiceId: inv.id, amount: '250.00', reason: 'Goodwill' });
  assert.equal(tooMuch.ok, false, 'adjustment larger than due rejected, not clamped');
  const adj = await h.op('payment.adjust', { invoiceId: inv.id, amount: '200.00', reason: 'Goodwill', date: '2026-09-03' });
  assert.equal(adj.ok, true, adj.error);
  const invoice = h.repo.get('invoices', inv.id);
  assert.equal(invoice.dueCents, 0);
  assert.equal(invoice.status, 'Paid');
  const summary = h.repo.patientFinancialSummary(patient.id);
  assert.equal(summary.dueCents, 0, 'FIN-02: adjustment reduces due (no sign error)');
  assert.equal(summary.balanceCents, 0);
  assert.equal(h.repo.get('patients', patient.id).balanceCents, 0);
  const ledger = h.repo.patientLedger(patient.id, { page: 1, pageSize: 50 });
  assert.equal(ledger.closingBalanceCents, 0);
});

test('statement: opening + period debits − credits = closing; rows match the reference ledger; credit shown', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const a = (await h.op('invoice.create', { patientId: patient.id, date: '2026-01-10', items: [{ name: 'Consult', quantity: 1, unitPrice: '500.00' }] })).record;
  await h.op('payment.record', { patientId: patient.id, invoiceId: a.id, date: '2026-01-10', amount: '500.00', method: 'Cash' });
  const b = (await h.op('invoice.create', { patientId: patient.id, date: '2026-02-05', items: [{ name: 'RCT', quantity: 1, unitPrice: '8000.00' }] })).record;
  const pb = await h.op('payment.record', { patientId: patient.id, invoiceId: b.id, date: '2026-02-06', amount: '3000.00', method: 'Card' });
  await h.op('payment.refund', { id: pb.record.id, amount: '1000.00', reason: 'Partial service', date: '2026-02-20' });
  await h.op('payment.adjust', { invoiceId: b.id, amount: '500.00', reason: 'Senior discount', date: '2026-03-01' });
  const advance = await h.op('payment.record', { patientId: patient.id, date: '2026-03-15', amount: '7000.00', method: 'Cash', notes: 'Advance' });
  assert.equal(advance.ok, true, advance.error);
  const full = h.repo.patientLedger(patient.id, { page: 1, pageSize: 500 });
  const reference = statementEntries({
    invoices: h.repo.listCollection('invoices', { page: 1, pageSize: 500, filters: { patientId: patient.id } }).rows,
    payments: h.repo.listCollection('payments', { page: 1, pageSize: 500, filters: { patientId: patient.id } }).rows,
    adjustments: h.repo.listCollection('paymentAdjustments', { page: 1, pageSize: 500, filters: { patientId: patient.id } }).rows
  }, patient.id);
  assert.deepEqual(full.rows.map((row) => [row.type, row.reference, row.debitCents, row.creditCents, row.balanceCents]),
    reference.map((row) => [row.type, row.reference, row.debitCents, row.creditCents, row.balanceCents]));
  // 500 + 8000 − 500 − 3000 + 1000 − 500 − 7000 = −1500 (credit in the patient's favour)
  assert.equal(full.closingBalanceCents, -150000);
  assert.equal(full.rows.at(-1).balanceCents, -150000, 'credit balance is never clamped to zero');
  assert.ok(full.rows.every((row) => !/^adj(ustment)?_/.test(row.reference)), 'no internal ids on statements');
  const summary = h.repo.patientFinancialSummary(patient.id);
  assert.equal(summary.balanceCents, -150000);
  assert.equal(summary.creditCents, 150000);
  assert.equal(h.repo.get('patients', patient.id).balanceCents, -150000);
  // Windowed statement: February only.
  const feb = h.repo.patientLedger(patient.id, { page: 1, pageSize: 500, from: '2026-02-01', to: '2026-02-28' });
  assert.equal(feb.openingBalanceCents, 0);
  assert.equal(feb.closingBalanceCents, feb.openingBalanceCents + feb.periodDebitCents - feb.periodCreditCents);
  assert.equal(feb.closingBalanceCents, 800000 - 300000 + 100000);
  const march = h.repo.patientLedger(patient.id, { page: 1, pageSize: 500, from: '2026-03-01' });
  assert.equal(march.openingBalanceCents, feb.closingBalanceCents);
  assert.equal(march.closingBalanceCents, -150000);
});

test('receipts: point-in-time due-after and received-by, including reconstructed history', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const inv = (await h.op('invoice.create', { patientId: patient.id, date: '2026-09-01', items: [{ name: 'Bridge', quantity: 1, unitPrice: '9000.00' }] })).record;
  const p1 = (await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-02', amount: '2000.00', method: 'Cash' })).record;
  const p2 = (await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-09-05', amount: '3000.00', method: 'Card', reference: 'TXN-77' })).record;
  const first = await h.query('receiptDetail', { id: p1.id });
  assert.equal(first.dueAfterCents, 700000, 'balance right after the first payment, not today');
  assert.equal(first.receivedBy, 'Dr. Admin');
  assert.equal(first.currentInvoiceDueCents, 400000);
  // Simulate a v1.6.1 payment without snapshots: reconstructed from history + audit.
  h.repo.update('payments', { ...h.repo.get('payments', p2.id), invoiceDueAfterCents: null, invoiceDueBeforeCents: null, receivedBy: '' });
  const second = await h.query('receiptDetail', { id: p2.id });
  assert.equal(second.dueAfterCents, 400000);
  assert.equal(second.receivedBy, 'Dr. Admin', 'recovered from the audit trail');
  assert.notEqual(p1.receiptNumber, inv.invoiceNumber);
  assert.match(p1.receiptNumber, /^RCP-/);
  assert.match(inv.invoiceNumber, /^INV-/);
});

test('document codes: one prefix per kind, collisions skipped, duplicate prefixes refused', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const visit = await h.op('visit.create', { patientId: patient.id, date: '2026-09-01', reason: 'Checkup' });
  const appt = await h.op('appointment.create', { patientId: patient.id, date: '2026-09-02', time: '09:00', reason: 'Review' });
  const rx = await h.op('prescription.create', { patientId: patient.id, doctor: 'Dr. Admin', medications: [{ medicine: 'Paracetamol 500mg' }] });
  assert.match(visit.record.visitCode, /^VIS-/);
  assert.match(appt.record.appointmentCode, /^APT-/);
  assert.match(rx.record.prescriptionCode, /^RX-/);
  const dup = await h.op('settings.update', { receiptPrefix: 'INV' });
  assert.match(dup.error, /own prefix/);
  // Counter drift (e.g. an old counter after a restore) never produces a duplicate.
  h.repo.setMeta('counters', { ...h.repo.getCounters(), invoice: 1 });
  const a = await h.op('invoice.create', { patientId: patient.id, items: [{ name: 'A', quantity: 1, unitPrice: '1.00' }] });
  const b = await h.op('invoice.create', { patientId: patient.id, items: [{ name: 'B', quantity: 1, unitPrice: '1.00' }] });
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.record.invoiceNumber, b.record.invoiceNumber);
});

test('reports: refunds counted on the refund date; net operating = collected − refunds − expenses', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const inv = (await h.op('invoice.create', { patientId: patient.id, date: '2026-05-01', items: [{ name: 'Implant', quantity: 1, unitPrice: '20000.00' }] })).record;
  const pay = (await h.op('payment.record', { patientId: patient.id, invoiceId: inv.id, date: '2026-05-02', amount: '10000.00', method: 'Bank' })).record;
  await h.op('payment.refund', { id: pay.id, amount: '2500.00', reason: 'Material returned', date: '2026-06-10' });
  await h.op('expense.create', { description: 'Lab fee', amount: '1500.00', date: '2026-06-11', category: 'Supplies' });
  const may = h.repo.reportStats('accounting', '2026-05-01', '2026-05-31');
  const june = h.repo.reportStats('accounting', '2026-06-01', '2026-06-30');
  assert.equal(may.collectedCents, 1000000);
  assert.equal(may.refundedCents, 0, 'refund is not back-dated to the payment month');
  assert.equal(june.refundedCents, 250000);
  assert.equal(june.netOperatingCents, 0 - 250000 - 150000);
  assert.equal(may.netOperatingCents, 1000000);
});

test('dental chart: FDI validation and primary/adult separation', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  for (const bad of [0, 1, 9, 10, 19, 29, 49, 56, 90]) {
    const result = await h.op('dental.save', { patientId: patient.id, tooth: bad, status: 'Caries' });
    assert.equal(result.ok, false, `tooth ${bad} must be rejected`);
  }
  const ok = await h.op('dental.save', { patientId: patient.id, tooth: 36, status: 'Crown' });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.record.dentition, 'adult');
  const primary = await h.op('dental.save', { patientId: patient.id, tooth: 75, status: 'Caries' });
  assert.equal(primary.record.dentition, 'primary');
  const history = await h.query('dentalHistory', { patientId: patient.id });
  assert.deepEqual(history.rows.filter((row) => !row.superseded).map((row) => row.tooth).sort(), [36, 75]);
  // Clearing the current record keeps it as history (regression: removeCurrent always failed).
  const cleared = await h.op('dental.removeCurrent', { patientId: patient.id, tooth: 36 });
  assert.equal(cleared.ok, true, cleared.error);
  const after = await h.query('dentalHistory', { patientId: patient.id, tooth: 36 });
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].superseded, true);
  assert.equal((await h.op('dental.removeCurrent', { patientId: patient.id, tooth: 36 })).ok, false, 'nothing current left to clear');
});

test('patient merge: dental conflicts become history, records move, both balances recomputed', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const dup = await makePatient(h, { fullName: 'Money Patient Duplicate' });
  await h.op('dental.save', { patientId: patient.id, tooth: 11, status: 'Crown' });
  await h.op('dental.save', { patientId: dup.id, tooth: 11, status: 'Caries' });
  await h.op('dental.save', { patientId: dup.id, tooth: 46, status: 'Missing' });
  await h.op('invoice.create', { patientId: dup.id, items: [{ name: 'Filling', quantity: 1, unitPrice: '700.00' }] });
  const merged = await h.op('patient.merge', { primaryId: patient.id, duplicateId: dup.id, confirm: true });
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.supersededTeeth, 1);
  const current = h.ws.query('SELECT tooth, status FROM dental_records WHERE patient_id = ? AND superseded = 0 ORDER BY tooth', [patient.id]);
  assert.deepEqual(current.map((row) => [row.tooth, row.status]), [[11, 'Crown'], [46, 'Missing']]);
  assert.equal(h.repo.get('patients', patient.id).balanceCents, 70000);
  assert.equal(h.repo.get('patients', dup.id).balanceCents, 0);
  assert.equal(h.repo.get('patients', dup.id).mergedInto, patient.id);
});

test('appointments: transitions, cancel permission and queue serials', async (t) => {
  const { h, patient } = await adminWithPatient(t);
  const a = (await h.op('appointment.create', { patientId: patient.id, date: '2026-10-05', time: '09:00', reason: 'Checkup', chair: 'Chair 1' })).record;
  const b = (await h.op('appointment.create', { patientId: patient.id, date: '2026-10-05', time: '10:00', reason: 'Scaling', chair: 'Chair 2' })).record;
  assert.equal((await h.op('appointment.setStatus', { id: a.id, status: 'Checked In' })).record.serial, 'Q-001');
  assert.equal((await h.op('appointment.setStatus', { id: b.id, status: 'Checked In' })).record.serial, 'Q-002');
  assert.equal((await h.op('appointment.setStatus', { id: a.id, status: 'Completed' })).ok, true);
  const reopen = await h.op('appointment.setStatus', { id: a.id, status: 'Scheduled' });
  assert.equal(reopen.code, 'invalid-transition');
  const assistant = await h.createUser('Dental Assistant', { pin: '4444' });
  await h.loginAs(assistant.id, '4444');
  const cancel = await h.op('appointment.setStatus', { id: b.id, status: 'Cancelled' });
  assert.equal(cancel.code, 'permission-denied', 'cancelling needs appointments.cancel');
});

test('staged restore: injected failures roll back to the exact previous workspace', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  await makePatient(h, { fullName: 'In Backup' });
  const backup = createBackup(h.ws, { label: 'restore-source' });
  assert.equal(backup.ok, true, backup.error);
  await makePatient(h, { fullName: 'After Backup' });
  fs.writeFileSync(path.join(h.ws.attachmentDirectory, 'marker.bin'), 'current-attachment');
  const names = () => h.ws.query('SELECT full_name FROM patients ORDER BY full_name').map((row) => row.full_name);
  const before = names();
  for (const step of ['stage-db', 'stage-attachments', 'swap', 'reopen']) {
    const result = restoreBackup(h.ws, backup.path, { autoSafetyBackup: false, faultInjection: step });
    assert.equal(result.ok, false, step);
    assert.deepEqual(names(), before, `workspace unchanged after a failure at ${step}`);
    assert.ok(fs.existsSync(path.join(h.ws.attachmentDirectory, 'marker.bin')), `attachments intact after ${step}`);
    assert.equal(h.ws.quickCheck().ok, true);
  }
  const leftovers = fs.readdirSync(h.dir).filter((name) => /restore-|rollback-/.test(name));
  assert.deepEqual(leftovers, [], 'no staging debris left behind');
  const ok = await h.invoke('backup:restore', { path: backup.path });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.reauth, true, 'everyone signs in again after a restore');
  assert.deepEqual(names(), ['In Backup']);
  assert.equal(h.sessions.context(), null);
});

test('upgrade: a real v1.6.1 workspace migrates to layout 2 with a pre-upgrade backup and no data loss', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(new URL('./fixtures/v1.6.1-workspace.sqlite', import.meta.url), path.join(dir, 'dentiva-pro.sqlite'));
  const result = migrateWorkspace(dir);
  assert.equal(result.status, 'upgraded', JSON.stringify(result.errors));
  assert.ok(result.preUpgradeBackup && fs.existsSync(path.join(result.preUpgradeBackup, 'manifest.json')), 'pre-upgrade backup written');
  const ws = new Workspace(dir).open();
  t.after(() => ws.close());
  assert.equal(Number(ws.getMeta('dbLayoutVersion')), 2);
  const repo = new SqlRepo(ws);
  // Chart positions 1, 9, 11, 17, 25 → FDI 18, 21, 23, 38, 48; primary position 3 → FDI 53.
  const teeth = ws.query('SELECT tooth, dentition, status FROM dental_records WHERE superseded = 0 ORDER BY dentition, tooth').map((row) => [row.dentition, row.tooth, row.status]);
  assert.deepEqual(teeth, [['adult', 18, 'Missing'], ['adult', 21, 'Caries'], ['adult', 23, 'Restored'], ['adult', 38, 'Crown'], ['adult', 48, 'Root canal'], ['primary', 53, 'Caries']]);
  assert.equal(repo.getSettings().language, undefined, 'language setting retired');
  const sessions = new SessionManager({ repo });
  const admin = repo.usersList().find((user) => user.role === 'Administrator');
  assert.equal(sessions.login(admin.id, ADMIN_PIN).ok, true, 'existing PIN still works after upgrade');
  const invoice = ws.queryOne('SELECT total_cents, paid_cents, due_cents, status FROM invoices');
  assert.deepEqual({ ...invoice }, { total_cents: 850000, paid_cents: 500000, due_cents: 350000, status: 'Partially Paid' });
  assert.equal(ws.integrityCheck().ok, true);
  const again = migrateWorkspace(dir);
  assert.equal(again.status, 'current', 'second launch is a no-op');
});
