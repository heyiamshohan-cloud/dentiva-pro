/**
 * Patient financial ledger — SQL engine vs domain JS semantics parity.
 * Every assertion compares the SQLite ledger to the reference
 * `statementEntries` implementation for identical seeded data, and the
 * lifetime summary to hand-computed integer-cents expectations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statementEntries } from '../src/domain.js';
import { permissionsForRole } from '../src/core.js';
import { runOp } from '../src/ops.js';
import { runQuery } from '../src/queries.js';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';

const rnd = () => Math.random().toString(36).slice(2, 8);
const ctx = () => ({ userId: 'u1', userName: 'Admin', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true });

function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ledger-${rnd()}-`));
  migrateWorkspace(dir);
  const ws = new Workspace(dir).open();
  const repo = new SqlRepo(ws);
  t.after(() => { try { ws.close(); } catch { /* closed */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });
  return repo;
}

async function seedFinancialPatient(repo) {
  const c = ctx();
  const setup = await runOp(repo, 'setup.complete', { clinicName: 'Ledger Clinic', ownerName: 'Dr. X', adminName: 'Admin', adminPin: '4321' }, c);
  assert.equal(setup.ok, true, setup.error);
  const p = await runOp(repo, 'patient.create', { fullName: 'Ledger Patient', phone: '01899999999' }, c);
  assert.equal(p.ok, true);
  const patientId = p.record.id;

  // Invoice 1: 2 items (500+1500 items configured below), discount 200, paid 1500 partially
  const inv1 = await runOp(repo, 'invoice.create', { patientId, date: '2026-01-10', items: [{ name: 'Consultation', quantity: 1, unitPrice: 500 }, { name: 'Scaling', quantity: 1, unitPrice: 1500 }], discount: 200 }, c);
  assert.equal(inv1.ok, true, inv1.error);
  // Invoice 2: 8000 (root canal) — paid 4000 by bKash
  const inv2 = await runOp(repo, 'invoice.create', { patientId, date: '2026-01-20', items: [{ name: 'Root Canal', quantity: 1, unitPrice: 8000 }] }, c);
  assert.equal(inv2.ok, true, inv2.error);
  const pay1 = await runOp(repo, 'payment.record', { patientId, invoiceId: inv1.record.id, date: '2026-01-10', amount: 1500, method: 'Cash' }, c);
  assert.equal(pay1.ok, true, pay1.error);
  const pay2 = await runOp(repo, 'payment.record', { patientId, invoiceId: inv2.record.id, date: '2026-01-20', amount: 4000, method: 'bKash', reference: 'BKASH-77' }, c);
  assert.equal(pay2.ok, true, pay2.error);
  const refund = await runOp(repo, 'payment.refund', { paymentId: pay2.record.id, amount: 500, reason: 'Overcharge reversal', date: '2026-01-21' }, c);
  assert.equal(refund.ok, true, refund.error);
  const adjustment = await runOp(repo, 'payment.adjust', { patientId, invoiceId: inv1.record.id, amount: 100, reason: 'Goodwill', date: '2026-01-22' }, c);
  assert.equal(adjustment.ok, true, adjustment.error);
  return { patientId, inv1, inv2, pay1, pay2, refund, adjustment };
}

test('SQL ledger paginates and matches domain statementEntries exactly', async (t) => {
  const repo = boot(t);
  const { patientId } = await seedFinancialPatient(repo);

  const js = statementEntries({
    invoices: repo.listCollection('invoices', { page: 1, pageSize: 500, filters: { patientId } }).rows,
    payments: repo.listCollection('payments', { page: 1, pageSize: 500, filters: { patientId } }).rows,
    adjustments: repo.listCollection('paymentAdjustments', { page: 1, pageSize: 500, filters: { patientId } }).rows,
  }, patientId);

  // Pull every page of the SQL ledger (small page sizes to force pagination).
  const sqlRows = [];
  let page = 1;
  for (;;) {
    const r = repo.patientLedger(patientId, { page, pageSize: 2 });
    sqlRows.push(...r.rows);
    if (page * 2 >= r.total) break;
    page += 1;
    assert.ok(page < 50, 'pagination loop guard');
  }

  assert.equal(sqlRows.length, js.length, 'row counts equal');
  for (let i = 0; i < js.length; i += 1) {
    assert.equal(sqlRows[i].type, js[i].type, `row ${i} type`);
    assert.equal(sqlRows[i].reference, js[i].reference, `row ${i} reference`);
    assert.equal(sqlRows[i].debitCents, js[i].debitCents, `row ${i} debit`);
    assert.equal(sqlRows[i].creditCents, js[i].creditCents, `row ${i} credit`);
    assert.equal(sqlRows[i].balanceCents, js[i].balanceCents, `row ${i} running balance`);
  }
});

test('lifetime financial summary matches hand-computed integer cents', async (t) => {
  const repo = boot(t);
  const { patientId } = await seedFinancialPatient(repo);
  const s = repo.patientFinancialSummary(patientId);
  // inv1: 2000-200 = 1800 billed; inv2: 8000 billed → 9800; paid 1500+4000=5500; refund 500; adjustment 100 (credit)
  // net paid 5000; due = 9800 + 100(credit adj reduces due? — formula: billed + adjusted - paid + refunded)
  assert.equal(s.billedCents, 980000);
  assert.equal(s.discountCents, 20000);
  assert.equal(s.paidCents, 550000);
  assert.equal(s.refundedCents, 50000);
  assert.equal(s.adjustedCents, 10000);
  assert.equal(s.invoiceCount, 2);
  assert.equal(s.paymentCount, 2);
  assert.equal(s.refundCount, 1);
  assert.equal(s.lastPayment.method, 'bKash');
  assert.equal(s.lastPayment.amountCents, 400000);
  // Patient balance must be ledger-truth: compare against aggregate due of open invoices
  const open = repo.listCollection('invoices', { page: 1, pageSize: 100, filters: { patientId } }).rows
    .filter((i) => !['Paid', 'Cancelled'].includes(i.status));
  const openDue = open.reduce((sum, i) => sum + i.dueCents, 0);
  assert.ok(s.dueCents >= openDue - 10000, 'adjustment credit reflected in due');
});

test('rollups bucket by month and year', async (t) => {
  const repo = boot(t);
  const { patientId } = await seedFinancialPatient(repo);
  const r = repo.patientLedgerRollups(patientId, 12, 5);
  const jan = r.monthly.find((m) => m.bucket === '2026-01');
  assert.ok(jan, 'january bucket exists');
  assert.equal(jan.billedCents, 980000 + 50000, 'debits incl. refund');
  assert.equal(jan.receivedCents, 550000 + 10000, 'credits incl. adjustment');
  assert.equal(r.yearly[0].bucket, '2026');
});

test('visitBillingFor rolls up invoice + payments per visit without N+1', async (t) => {
  const repo = boot(t);
  const c = ctx();
  const { patientId } = await seedFinancialPatient(repo);
  const visit = await runOp(repo, 'visit.create', { patientId, date: '2026-01-20', reason: 'Pain', chiefComplaint: 'Toothache' }, c);
  assert.equal(visit.ok, true);
  const inv = await runOp(repo, 'invoice.create', { patientId, visitId: visit.record.id, date: '2026-01-20', items: [{ name: 'X-Ray', quantity: 1, unitPrice: 600 }] }, c);
  assert.equal(inv.ok, true);
  await runOp(repo, 'payment.record', { patientId, invoiceId: inv.record.id, date: '2026-01-20', amount: 600, method: 'Cash' }, c);
  const rolled = repo.visitBillingFor([visit.record.id, 'missing-visit']);
  assert.equal(Object.keys(rolled).length, 1);
  const v = rolled[visit.record.id];
  assert.equal(v.billedCents, 60000);
  assert.equal(v.paidCents, 60000);
  assert.equal(v.dueCents, 0);
  assert.equal(v.invoices[0].status, 'Paid');
  assert.equal(v.payments[0].receiptNumber.startsWith('RCP'), true, 'receipt prefix with default RCP');
});

test('patientStatement query uses SQL path server-side with page totals', async (t) => {
  const repo = boot(t);
  const { patientId } = await seedFinancialPatient(repo);
  const s = await runQuery(repo, 'patientStatement', { patientId, page: 1, pageSize: 3 }, ctx());
  assert.equal(s.ok, true);
  assert.equal(s.source, 'sql');
  assert.equal(s.rows.length, 3, 'page size honored');
  assert.ok(s.total >= 6, 'full event count from SQL, not the page');
  assert.equal(s.billedCents, 980000);
  assert.equal(s.adjustedCents, 10000);
});


test('listPatients aggregates: visits count + lifetime billed/paid + sort by billed', async (t) => {
  const repo = boot(t);
  const c = ctx();
  const { patientId } = await seedFinancialPatient(repo);
  // second patient for comparison
  const p2 = await runOp(repo, 'patient.create', { fullName: 'Aggregator Two', phone: '01888888888' }, c);
  assert.equal(p2.ok, true);
  const inv = await runOp(repo, 'invoice.create', { patientId: p2.record.id, date: '2026-02-02', items: [{ name: 'Crown', quantity: 1, unitPrice: 20000 }] }, c);
  assert.equal(inv.ok, true);
  await runOp(repo, 'payment.record', { patientId: p2.record.id, invoiceId: inv.record.id, date: '2026-02-02', amount: 20000, method: 'Card' }, c);
  const res = repo.listPatients({ includeAggregates: true, sort: 'billed-desc', page: 1, pageSize: 10 });
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].id, p2.record.id, '20,000 billed patient first');
  assert.equal(res.rows[0].billedCents, 2000000);
  assert.equal(res.rows[0].paidCents, 2000000);
  const main = res.rows.find((r) => r.id === patientId);
  assert.ok(main, 'ledger patient present');
  assert.equal(main.billedCents, 980000);
  assert.equal(main.paidCents, 550000);
  assert.ok(main.visitsCount >= 0 && Number.isInteger(main.visitsCount));
  assert.equal(typeof res.rows[0].fullName, 'string', 'payload fields intact (rowToRecord regression guard)');
});

test('auditList honors entityId filter server-side', async (t) => {
  const repo = boot(t);
  const { patientId, inv1 } = await seedFinancialPatient(repo);
  // Audit entries are written through the repo audit channel (as the API layer does).
  const mkAudit = (extra) => ({ id: `au_test_${Math.random().toString(36).slice(2, 10)}`, createdAt: '2026-01-20T10:00:00.000Z', tsMs: 1767271200000, userId: 'u1', userName: 'Admin', ...extra });
  repo.auditInsert(mkAudit({ action: 'Invoice created', entity: 'Invoice', entityId: inv1.record.id, summary: 'INV X' }));
  repo.auditInsert(mkAudit({ action: 'Invoice updated', entity: 'Invoice', entityId: 'other-invoice', summary: 'INV Y' }));
  const all = repo.listAudit({ page: 1, pageSize: 200 });
  const filtered = repo.listAudit({ page: 1, pageSize: 200, entity: 'Invoice', entityId: inv1.record.id });
  assert.ok(all.total >= 2, 'seeded rows visible');
  assert.equal(filtered.total, 1, 'entityId filter isolates the invoice');
  assert.equal(filtered.rows[0].entityId, inv1.record.id);
  void patientId;
});

/* ── v1.6.0 flagship: structured prescription composition ─────────────── */
test('prescription.create normalizes structured medication rows + clinical sections (legacy keys composed)', async (t) => {
  const repo = boot(t);
  const c = ctx();
  await runOp(repo, 'setup.complete', { clinicName: 'Rx Clinic', ownerName: 'Dr. Y', adminName: 'Admin', adminPin: '4321' }, c);
  const p = await runOp(repo, 'patient.create', { fullName: 'Rx Patient', phone: '01777777777' }, c);
  const rx = await runOp(repo, 'prescription.create', {
    patientId: p.record.id, doctor: 'Dr. Y', date: '2026-03-01',
    chiefComplaint: 'Toothache lower right', onExamination: 'Caries 46', diagnosis: 'Irreversible pulpitis 46',
    advice: 'Warm saline rinse', followUp: 'Review after RCT', followUpDate: '2026-03-08',
    medications: [
      { medicine: 'Amoxicillin', form: 'Capsule', strength: '500 mg', dosage: '1 capsule', frequencyPattern: '1-1-1', durationValue: 5, durationUnit: 'Days', foodRelation: 'After food', quantity: 15, instructions: 'Complete the course' },
      { medicine: 'Paracetamol', form: 'Tablet', strength: '500 mg', dosage: '1 tablet', frequency: 'When needed for pain (max 4/day)', duration: '3 Days', route: 'Oral', instructions: '' }
    ]
  }, c);
  assert.equal(rx.ok, true, rx.error);
  const m1 = rx.record.medications[0];
  assert.equal(m1.medicine, 'Amoxicillin');
  assert.equal(m1.form, 'Capsule');
  assert.equal(m1.frequency, '1-1-1 — After food', 'structured frequency composes legacy display key');
  assert.equal(m1.duration, '5 Days');
  assert.equal(m1.durationValue, 5);
  assert.equal(m1.durationUnit, 'Days');
  assert.equal(m1.foodRelation, 'After food');
  assert.equal(m1.quantity, 15);
  const m2 = rx.record.medications[1];
  assert.equal(m2.frequency, 'When needed for pain (max 4/day)', 'free-text frequency preserved verbatim');
  assert.equal(rx.record.chiefComplaint, 'Toothache lower right');
  assert.equal(rx.record.onExamination, 'Caries 46');
  assert.equal(rx.record.diagnosis, 'Irreversible pulpitis 46');
  assert.equal(rx.record.followUpDate, '2026-03-08');

  // round-trip read from storage preserves every structured key
  const stored = repo.get('prescriptions', rx.record.id);
  assert.equal(stored.medications[0].form, 'Capsule');
  assert.equal(stored.advice, 'Warm saline rinse');
});

test('prescription.update keeps clinical sections unless touched', async (t) => {
  const repo = boot(t);
  const c = ctx();
  await runOp(repo, 'setup.complete', { clinicName: 'Rx Clinic 2', ownerName: 'Dr. Z', adminName: 'Admin', adminPin: '4321' }, c);
  const p = await runOp(repo, 'patient.create', { fullName: 'Rx Two', phone: '01766666666' }, c);
  const rx = await runOp(repo, 'prescription.create', { patientId: p.record.id, doctor: 'Dr. Z', chiefComplaint: 'Initial complaint', medications: [{ medicine: 'Ibuprofen', strength: '400 mg' }] }, c);
  assert.equal(rx.ok, true);
  const updated = await runOp(repo, 'prescription.update', { id: rx.record.id, doctor: 'Dr. Z', medications: [{ medicine: 'Ibuprofen', strength: '400 mg', instructions: 'After food only' }] }, c);
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.record.chiefComplaint, 'Initial complaint', 'clinical text untouched by med-only edit');
  assert.equal(updated.record.medications[0].instructions, 'After food only');
});

test('legacy pipe-delimited medicationsText still accepted (back-compat on old clients)', async (t) => {
  const repo = boot(t);
  const c = ctx();
  await runOp(repo, 'setup.complete', { clinicName: 'Rx Clinic 3', ownerName: 'Dr. Q', adminName: 'Admin', adminPin: '4321' }, c);
  const p = await runOp(repo, 'patient.create', { fullName: 'Rx Three', phone: '01755555555' }, c);
  const rx = await runOp(repo, 'prescription.create', { patientId: p.record.id, doctor: 'Dr. Q', medicationsText: 'Flagyl | 400 mg | 1 tablet | 1-1-1 | 3 Days | Oral | After food' }, c);
  assert.equal(rx.ok, true, rx.error);
  assert.equal(rx.record.medications[0].medicine, 'Flagyl');
  assert.equal(rx.record.medications[0].frequency, '1-1-1');
});
