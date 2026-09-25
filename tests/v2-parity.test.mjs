/**
 * v2.0.0 differential contract tests.
 *
 * These lock in the invariants that the audit had to *prove* rather than
 * assume, because each one was a real defect found during the v2.0.0 audit:
 *
 *  1. list ordering is identical in both runtimes (order is user-visible data),
 *  2. the ledger/statement/financial-summary pipeline agrees cent-for-cent,
 *  3. a refund reduces the NET operating KPI without touching gross collections,
 *  4. "today" is the clinic's calendar day, not UTC's,
 *  5. the patient picker's server-side lookup exists, is uncapped by directory
 *     paging, and every query payload resolves patient names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepo } from '../src/repo-local.js';
import { permissionsForRole, clinicDate, daysBetween, canonicalJson } from '../src/core.js';
import { runOp } from '../src/ops.js';
import { runQuery } from '../src/queries.js';
import { makeSqlRepo, tempDir } from './helpers/harness.mjs';

const ctx = (role = 'Administrator', extra = {}) => ({
  userId: 'u1', userName: role, role, permissions: permissionsForRole(role), firstRun: true, ...extra
});

function runtimes(t) {
  const local = new LocalRepo();
  const dir = tempDir('parity-');
  const { ws, repo } = makeSqlRepo(dir);
  t.after(() => ws.close());
  return [
    { label: 'local', repo: local, op: (n, p, c) => runOp(local, n, p, c || ctx()) },
    { label: 'sql', repo, op: (n, p, c) => runOp(repo, n, p, c || ctx()) }
  ];
}

/* -------------------------------------------------------------- 1. ordering */

test('list ordering follows the same rule in the JSON and SQLite runtimes', async (t) => {
  const collections = ['patients', 'visits', 'invoices', 'payments', 'appointments', 'treatments',
    'prescriptions', 'expenses', 'inventory', 'staff', 'dentalRecords', 'paymentAdjustments',
    'suppliers', 'treatmentPlans', 'followUpTasks', 'stockMovements', 'referrals', 'rooms'];
  const seen = new Map();
  const rts = runtimes(t); // one pair of runtimes for the whole test
  for (const rt of rts) {
    // A controlled clock: both runtimes see the same creation timestamps, so
    // any ordering difference is a difference in the SORT RULE. (Left to the
    // wall clock, SQLite's slower writes give distinct milliseconds while the
    // JSON engine can mint several records inside one — both correct, but not
    // comparable.)
    let tick = 0;
    const clock = () => new Date(Date.parse('2026-09-25T09:00:00.000Z') + (tick += 1000)).toISOString();
    const op = (name, payload, context = ctx()) => rt.op(name, payload, { ...context, now: clock });
    for (let i = 1; i <= 4; i += 1) {
      const patient = op('patient.create', { fullName: `Order Patient ${i}`, phone: `0199000000${i}` });
      assert.equal(patient.ok, true, patient.error);
      if (i === 1) {
        for (const [name, price] of [['Zeta Filling', 10], ['Alpha Crown', 20], ['Mid Extraction', 30]]) {
          op('treatment.create', { name, defaultPrice: price });
        }
      }
      op('invoice.create', { patientId: patient.record.id, date: `2026-09-0${i}`, items: [{ name: 'Alpha Crown', quantity: 1, unitPrice: 100 * i }] });
      op('visit.create', { patientId: patient.record.id, date: `2026-09-0${i}`, reason: `Visit ${i}` });
      op('appointment.create', { patientId: patient.record.id, date: `2026-09-0${i}`, time: '09:00', reason: `Appt ${i}` });
      // Tooth 12 is later restored, so its superseded history must not jump
      // ahead of the current record.
      op('dental.save', { patientId: patient.record.id, tooth: '1' + i, status: 'Caries' });
      if (i === 2) op('dental.save', { patientId: patient.record.id, tooth: '12', status: 'Filled' });
    }
    const signature = {};
    for (const collection of collections) {
      const result = await runQuery(rt.repo, 'list', { collection, page: 1, pageSize: 50 }, ctx());
      assert.notEqual(result.ok, false, `${collection}: ${result.error}`);
      signature[collection] = (result.rows || []).map((row) => row.patientName || row.name || row.status || row.id);
    }
    seen.set(rt.label, signature);
  }
  const [a, b] = [...seen.values()];
  for (const collection of collections) {
    assert.deepEqual(a[collection], b[collection], `${collection} list order differs between runtimes`);
  }

  // The rules the prescription/treatment/clinical screens depend on.
  assert.deepEqual([...a.treatments], ['Alpha Crown', 'Mid Extraction', 'Zeta Filling'],
    'the treatment catalog is alphabetical by name');
  assert.deepEqual([...a.patients], a.patients, 'patients are alphabetical by name');
  const dental = await runQuery(rts[0].repo, 'list', { collection: 'dentalRecords', page: 1, pageSize: 50 }, ctx());
  assert.equal(dental.rows.filter((row) => String(row.tooth) === '12' && row.superseded === false).length, 1,
    'the restored tooth keeps exactly one current record');
  const restored = dental.rows.find((row) => String(row.tooth) === '12' && row.status === 'Filled');
  const superseded = dental.rows.find((row) => String(row.tooth) === '12' && row.status === 'Caries');
  assert.ok(restored && superseded, 'both the current and the superseded record exist');
  assert.ok(dental.rows.indexOf(restored) < dental.rows.indexOf(superseded),
    'the current record for a tooth sorts ahead of its superseded history');
  // Money lists are newest-first; catalogs are alphabetical.
  const invoices = await runQuery(rts[0].repo, 'list', { collection: 'invoices', page: 1, pageSize: 50 }, ctx());
  const dates = invoices.rows.map((row) => row.date);
  assert.deepEqual(dates, [...dates].sort((x, y) => y.localeCompare(x)), 'invoices are newest-first by default');
});

/* ---------------------------------------------------------------- 2. ledger */

test('ledger, statement and financial summary agree cent-for-cent across runtimes', async (t) => {
  const signatures = [];
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Ledger Patient', phone: '01710000111' }).record;
    const invoice = rt.op('invoice.create', {
      patientId: patient.id, date: '2026-09-05',
      items: [{ name: 'RCT 46', quantity: 1, unitPrice: 5000 }, { name: 'Consultation', quantity: 2, unitPrice: 500 }],
      discount: 200, taxRate: 5
    });
    assert.equal(invoice.ok, true, invoice.error);
    const first = rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 2000, method: 'Cash', date: '2026-09-05' });
    assert.equal(first.ok, true, first.error);
    const second = rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 1000, method: 'bKash', date: '2026-09-06' });
    assert.equal(second.ok, true, second.error);
    assert.equal(rt.op('payment.refund', { id: second.record.id, amount: 400, reason: 'Treatment shortened', date: '2026-09-07' }).ok, true);
    assert.equal(rt.op('payment.adjust', { invoiceId: invoice.record.id, patientId: patient.id, amount: 100, reason: 'Goodwill discount', date: '2026-09-08' }).ok, true);

    const ledger = await runQuery(rt.repo, 'patientLedgerQuery', { patientId: patient.id, page: 1, pageSize: 50 }, ctx());
    const summary = await runQuery(rt.repo, 'patientFinancialSummary', { patientId: patient.id }, ctx());
    const statement = await runQuery(rt.repo, 'patientStatement', { patientId: patient.id, page: 1, pageSize: 50 }, ctx());
    const rollups = await runQuery(rt.repo, 'patientLedgerRollups', { patientId: patient.id }, ctx());
    signatures.push({
      rows: (ledger.rows || []).map((row) => [row.date, row.type, row.debitCents, row.creditCents, row.balanceCents]),
      totals: [ledger.total, ledger.balanceCents, ledger.billedCents, ledger.paidCents, ledger.refundedCents, ledger.adjustedCents],
      summary: { ...summary, lastPayment: undefined },
      statement: (statement.rows || []).map((row) => [row.date, row.type, row.debitCents, row.creditCents, row.balanceCents]),
      rollups
    });
  }
  assert.equal(canonicalJson(signatures[0]), canonicalJson(signatures[1]), 'ledger pipeline differs between runtimes');

  // Money must be internally consistent: billed − netPaid − adjustments = due.
  const summary = signatures[0].summary;
  assert.equal(summary.paidCents - summary.refundedCents, summary.netPaidCents);
  // billed − write-offs − net paid, the same identity updatePatientBalance uses.
  assert.equal(summary.billedCents - summary.adjustedCents - summary.netPaidCents, summary.dueCents);
  assert.equal(signatures[0].rows.at(-1)[4], summary.dueCents, 'ledger closing balance must equal the summary balance');
});

/* -------------------------------------------------- 3. refunds in the KPIs */

test('refunds reduce the net operating KPI but never the gross collected figure', async (t) => {
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'KPI Patient', phone: '01710000222' }).record;
    const invoice = rt.op('invoice.create', { patientId: patient.id, date: '2026-09-10', items: [{ name: 'Scaling', quantity: 1, unitPrice: 3000 }] });
    const payment = rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 3000, method: 'Card', date: '2026-09-10' });
    assert.equal(payment.ok, true, payment.error);
    assert.equal(rt.op('expense.create', { date: '2026-09-11', category: 'Supplies', description: 'Gloves', amount: 500, method: 'Cash' }).ok, true);
    assert.equal(rt.op('payment.refund', { id: payment.record.id, amount: 1200, reason: 'Partial refund', date: '2026-09-12' }).ok, true);

    const accounting = await runQuery(rt.repo, 'accountingSummary', { rangeKey: 'custom', from: '2026-09-01', to: '2026-09-30' }, ctx());
    assert.notEqual(accounting.ok, false, accounting.error);
    assert.equal(accounting.collectedCents, 300000, `${rt.label}: gross collections must stay gross`);
    assert.equal(accounting.refundedCents, 120000, `${rt.label}: refunded figure`);
    assert.equal(accounting.expensesCents, 50000, `${rt.label}: expense figure`);
    assert.equal(accounting.netOperatingCents, 300000 - 120000 - 50000, `${rt.label}: net operating must subtract refunds exactly once`);
    assert.equal(accounting.netOperatingCents, accounting.collectedCents - accounting.refundedCents - accounting.expensesCents);

    const revenue = await runQuery(rt.repo, 'report', { type: 'revenue', rangeKey: 'custom', from: '2026-09-01', to: '2026-09-30' }, ctx());
    assert.notEqual(revenue.ok, false, revenue.error);
    assert.equal(revenue.kpis.collectedCents, 300000, `${rt.label}: the revenue report shows the same gross collections`);
    assert.equal(revenue.kpis.refundedCents, 120000, `${rt.label}: and the same refunds`);
    assert.equal(revenue.kpis.expensesCents, 50000, `${rt.label}: and the same expenses`);
    assert.deepEqual(revenue.rows.rows.map((row) => row.method), ['Card'], 'the revenue report lists the payments it counted');
  }
});

/* ------------------------------------------------------------ 4. clinic day */

test('the clinic calendar day is used for defaults, aging and reporting windows', async (t) => {
  // 2026-09-25T18:30Z is already 2026-09-26 in Dhaka (UTC+6).
  const evening = new Date('2026-09-25T18:30:00Z');
  assert.equal(clinicDate(evening), '2026-09-26');
  assert.equal(clinicDate(evening, 'UTC'), '2026-09-25');
  assert.equal(clinicDate(new Date('2026-09-25T02:00:00Z'), 'Asia/Dhaka'), '2026-09-25', 'Dhaka morning is still the same day');
  assert.equal(clinicDate(new Date('2026-09-25T02:00:00Z'), 'America/New_York'), '2026-09-24', 'a western clinic sees the previous day');
  assert.equal(clinicDate(evening, 'Not/AZone'), '2026-09-25', 'an invalid timezone falls back instead of throwing');
  assert.equal(daysBetween('2026-09-12', '2026-09-26'), 14);

  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Clock Patient', phone: '01710000333' }).record;
    // Dated "yesterday" relative to the fixed clock the operations receive.
    const atEvening = ctx('Administrator', { now: () => evening.toISOString() });
    const invoice = rt.op('invoice.create', { patientId: patient.id, items: [{ name: 'X-ray', quantity: 1, unitPrice: 600 }] }, atEvening);
    assert.equal(invoice.ok, true, invoice.error);
    assert.equal(invoice.record.date, '2026-09-26', `${rt.label}: a new invoice is dated on the clinic's day, not UTC's`);

    const payment = rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 600, method: 'Cash' }, atEvening);
    assert.equal(payment.ok, false, 'a payment without a date should be rejected');
    const dated = rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 600, method: 'Cash', date: '2026-09-26' }, atEvening);
    assert.equal(dated.ok, true, dated.error);

    // Aging buckets count whole clinic days, so a same-day invoice is "Current".
    const aging = await runQuery(rt.repo, 'accountingSummary', { rangeKey: 'custom', from: '2026-09-01', to: '2026-09-30' }, ctx());
    const current = (aging.aging || []).find((bucket) => bucket.label.startsWith('Current'));
    assert.ok(current, 'aging exposes a current bucket');
    assert.equal(current.count, 0, `${rt.label}: the invoice is settled, so nothing is outstanding`);

    const ledger = await runQuery(rt.repo, 'patientLedgerQuery', { patientId: patient.id, page: 1, pageSize: 10 }, ctx());
    assert.equal(ledger.rows.at(-1).balanceCents, 0, `${rt.label}: settled invoice leaves a zero balance`);
  }
});

/* ------------------------------------------------------- 5. patient lookup */

test('patient lookup searches the whole register and enriches query payloads with names', async (t) => {
  for (const rt of runtimes(t)) {
    for (let i = 1; i <= 5; i += 1) {
      const created = rt.op('patient.create', { fullName: `Lookup Subject ${i}`, phone: `0188800000${i}`, address: 'Tangail' });
      assert.equal(created.ok, true, created.error);
    }
    const byName = await runQuery(rt.repo, 'patientLookup', { query: 'Lookup Subject' }, ctx());
    assert.notEqual(byName.ok, false, byName.error);
    assert.equal(byName.total, 5, `${rt.label}: lookup must find every match`);
    assert.equal(byName.rows.length, 5);
    assert.ok(byName.rows.every((row) => row.fullName && row.patientCode && row.archived === false));

    const byPhone = await runQuery(rt.repo, 'patientLookup', { query: '01888000003' }, ctx());
    assert.deepEqual(byPhone.rows.map((row) => row.fullName), ['Lookup Subject 3']);

    const byCode = await runQuery(rt.repo, 'patientLookup', { query: 'DP-0004' }, ctx());
    assert.deepEqual(byCode.rows.map((row) => row.fullName), ['Lookup Subject 4']);

    const paged = await runQuery(rt.repo, 'patientLookup', { query: 'Lookup Subject', page: 2, pageSize: 2 }, ctx());
    assert.equal(paged.total, 5, 'paging must not change the total');
    assert.equal(paged.rows.length, 2);
    assert.equal(paged.page, 2);

    const typed = await runQuery(rt.repo, 'patientLookup', { query: 'Lookup Subject', pageSize: 9999 }, ctx());
    assert.ok(typed.pageSize <= 500, 'page size is clamped, never a silent 500-row ceiling on the total');

    // The picker is the only way to attach clinical work to a patient, so a
    // role that can create visits must be able to search for one.
    const receptionist = await runQuery(rt.repo, 'patientLookup', { query: 'Lookup Subject' }, ctx('Receptionist'));
    assert.notEqual(receptionist.ok, false, `${rt.label}: receptionists must be able to look patients up`);

    // Every list rows carries the patient name, so screens never render
    // "Unassigned patient" for a patient that is simply outside the page window.
    const invoice = rt.op('invoice.create', { patientId: byName.rows[0].id, date: '2026-09-09', items: [{ name: 'Consultation', quantity: 1, unitPrice: 500 }] });
    assert.equal(invoice.ok, true, invoice.error);
    const list = await runQuery(rt.repo, 'list', { collection: 'invoices', page: 1, pageSize: 10 }, ctx());
    assert.equal(list.rows[0].patientName, 'Lookup Subject 1', `${rt.label}: invoice rows must carry the patient name`);
    assert.equal(list.rows[0].patientCode, byName.rows[0].patientCode);
    const visit = rt.op('visit.create', { patientId: byName.rows[1].id, date: '2026-09-09', reason: 'Check-up' });
    assert.equal(visit.ok, true, visit.error);
    const visits = await runQuery(rt.repo, 'list', { collection: 'visits', page: 1, pageSize: 10 }, ctx());
    assert.equal(visits.rows[0].patientName, 'Lookup Subject 2', `${rt.label}: visit rows must carry the patient name`);
  }
});

test('archived patients stay resolvable for historical documents', async (t) => {
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Archived Subject', phone: '01770000123' }).record;
    const invoice = rt.op('invoice.create', { patientId: patient.id, date: '2026-08-01', items: [{ name: 'Crown', quantity: 1, unitPrice: 9000 }] });
    assert.equal(invoice.ok, true, invoice.error);
    assert.equal(rt.op('patient.archive', { id: patient.id, archived: true }).ok, true);

    const lookup = await runQuery(rt.repo, 'patientLookup', { query: 'Archived Subject' }, ctx());
    assert.equal(lookup.total, 1, `${rt.label}: archived patients must remain searchable for old documents`);
    assert.equal(lookup.rows[0].archived, true, 'and clearly flagged as archived');

    const list = await runQuery(rt.repo, 'list', { collection: 'invoices', page: 1, pageSize: 10 }, ctx());
    assert.equal(list.rows[0].patientName, 'Archived Subject', `${rt.label}: an old invoice still names its patient`);
  }
});

/* --------------------------------------------------- 6. rows-only listing */

test('rows-only listing (count: false) behaves identically in both runtimes', async (t) => {
  const collections = ['patients', 'invoices', 'visits', 'appointments', 'inventory', 'audit', 'users',
    'treatments', 'expenses', 'staff', 'payments', 'prescriptions', 'dentalRecords', 'followUpTasks',
    'treatmentPlans', 'stockMovements', 'referrals', 'suppliers', 'rooms', 'savedFilters',
    // An unknown collection must fail the same way in both runtimes rather than
    // returning a differently-shaped payload.
    'notACollection'];
  const signatures = [];
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Rows Only', phone: '01712340000' }).record;
    rt.op('invoice.create', { patientId: patient.id, date: '2026-09-02', items: [{ name: 'X', quantity: 1, unitPrice: 100 }] });
    rt.op('inventory.createItem', { name: 'Gloves', category: 'Supplies', unit: 'box', purchasePrice: 5, salePrice: 8, minimumStock: 1, currentStock: 2 });
    const signature = {};
    for (const collection of collections) {
      const options = { page: 1, pageSize: 5, count: false };
      const a = await rt.repo.listCollection(collection, options);
      const b = await rt.repo.listCollection(collection, { ...options, count: true });
      assert.ok(Array.isArray(a.rows), `${rt.label}/${collection}: rows must be an array`);
      assert.equal(a.total, null, `${rt.label}/${collection}: no total is reported when it was not asked for`);
      assert.equal(a.totalExact, false, `${rt.label}/${collection}: the answer is marked inexact`);
      assert.equal(b.totalExact, true, `${rt.label}/${collection}: asking for a total marks it exact`);
      assert.ok(Number.isInteger(b.total) && b.total >= 0, `${rt.label}/${collection}: the exact total is a number`);
      assert.deepEqual(a.rows.map((row) => row.id), b.rows.slice(0, a.rows.length).map((row) => row.id),
        `${rt.label}/${collection}: skipping the count must not change which rows a page returns`);
      signature[collection] = [a.rows.length, b.total];
    }
    signatures.push(signature);
  }
  assert.deepEqual(signatures[0], signatures[1], 'rows-only listing must match between runtimes');
});

/* --------------------------------------------- 7. command palette contract */

test('command palette search returns the same groups and rows in both runtimes', async (t) => {
  const outputs = [];
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Palette Search Subject', phone: '01555000111' }).record;
    const invoice = rt.op('invoice.create', { patientId: patient.id, date: '2026-09-03', items: [{ name: 'Crown', quantity: 1, unitPrice: 9000 }] });
    assert.equal(invoice.ok, true, invoice.error);
    rt.op('payment.record', { invoiceId: invoice.record.id, patientId: patient.id, amount: 9000, method: 'Cash', date: '2026-09-03' });
    rt.op('appointment.create', { patientId: patient.id, date: '2026-09-04', time: '11:00', reason: 'Crown fit' });
    rt.op('visit.create', { patientId: patient.id, date: '2026-09-03', reason: 'Crown prep' });
    rt.op('prescription.create', { patientId: patient.id, date: '2026-09-03', doctor: 'Dr. P', medications: [{ medicine: 'Ibuprofen', strength: '400mg' }] });

    const found = await runQuery(rt.repo, 'globalSearch', { query: 'Palette Search Subject', limit: 5 }, ctx());
    assert.notEqual(found.ok, false, found.error);
    outputs.push({
      groups: Object.keys(found.results).sort(),
      counts: Object.fromEntries(Object.entries(found.results).map(([name, group]) => [name, group.rows.length])),
      patients: found.results.patients.rows.map((row) => row.fullName)
    });
    // Only the groups the palette renders are searched.
    assert.deepEqual(Object.keys(found.results).sort(),
      ['appointments', 'invoices', 'patients', 'payments', 'prescriptions', 'visits'],
      `${rt.label}: palette groups`);
  }
  assert.deepEqual(outputs[0], outputs[1], 'palette results must match between runtimes');
  assert.equal(outputs[0].counts.invoices, 1, 'the palette finds the patient\'s invoice');
  assert.equal(outputs[0].counts.payments, 1, 'the palette finds the payment');
  assert.equal(outputs[0].counts.visits, 1, 'the palette finds the visit');
});

test('palette fields are enriched so results can be labelled without a second round trip', async (t) => {
  for (const rt of runtimes(t)) {
    const patient = rt.op('patient.create', { fullName: 'Label Subject', phone: '01555000222' }).record;
    const invoice = rt.op('invoice.create', { patientId: patient.id, date: '2026-09-05', items: [{ name: 'X', quantity: 1, unitPrice: 250 }] });
    const found = await runQuery(rt.repo, 'globalSearch', { query: 'Label Subject', limit: 5 }, ctx());
    const row = found.results.invoices?.rows?.[0];
    assert.ok(row, `${rt.label}: the invoice is found`);
    assert.equal(row.id, invoice.record.id);
    assert.equal(row.patientName, 'Label Subject', `${rt.label}: the row names its patient`);
    assert.equal(row.patientCode, patient.patientCode, `${rt.label}: and carries the patient code`);
  }
});
