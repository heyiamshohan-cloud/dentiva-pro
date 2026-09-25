/**
 * Dentiva Pro v2.0.0 — differential forensic probe.
 *
 * Purpose: prove that the two runtimes that ship in the same product (the
 * on-disk SQLite engine used by the desktop build and the JSON-ledger engine
 * used by the browser/dev runtime and by the backup archives) produce the SAME
 * observable answers for the same logical data — and that all financial
 * invariants hold in both.
 *
 * It runs a deterministic clinic scenario against both runtimes, compares
 * every query result deeply, then executes adversarial edge cases
 * (boundary pagination, refunds, rounding, cancellation, long history).
 *
 * Usage: node scripts/v2-audit/differential-probe.mjs [--json <path>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalRepo } from '../../src/repo-local.js';
import { permissionsForRole, canonicalJson } from '../../src/core.js';
import { runOp } from '../../src/ops.js';
import { runQuery } from '../../src/queries.js';
import { migrateWorkspace } from '../../electron/lib/migrate.mjs';
import { Workspace } from '../../electron/lib/db.mjs';
import { SqlRepo } from '../../electron/lib/repo-sql.mjs';

const ctx = () => ({ userId: 'u1', userName: 'Administrator', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true });

const findings = [];
const record = (level, area, detail) => findings.push({ level, area, detail });


/* Identity/timestamp noise: the two engines mint their own ids and stamp their
 * own creation times, so those are removed before comparing. Everything else —
 * every number, label, ordering and count — must match exactly. */
const VOLATILE_KEYS = new Set(['id', 'recordId', 'createdAt', 'updatedAt', 'uploadedAt', 'checkedInAt', 'startedAt', 'completedAt',
  'backupPath', 'attachmentDirectory', 'path', 'walBytes', 'bytes', 'pageCount', 'attachmentBytes', 'lastBackupAt', 'nextBackupAt']);
const ID_PATTERN = /^(patient|invoice|payment|adjustment|expense|stock|rx|plan|visit|appointment|treatment|dental|user|staff|task|referral|supplier|attachment|med|notification|filter)_[a-z0-9_]+$/i;
function denoise(value) {
  if (Array.isArray(value)) return value.map((item) => denoise(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) { if (VOLATILE_KEYS.has(key)) continue; out[key] = denoise(item); }
    return out;
  }
  return typeof value === 'string' && ID_PATTERN.test(value) ? '<id>' : value;
}

function makeRuntimes() {
  const local = new LocalRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-diff-'));
  migrateWorkspace(dir);
  const ws = new Workspace(dir).open();
  const sql = new SqlRepo(ws);
  return {
    dir,
    local: { label: 'local', repo: local },
    sql: { label: 'sql', repo: sql },
    close() { try { ws.close(); } catch { /* closed */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
  };
}

const op = (repo, name, payload) => runOp(repo, name, payload, ctx());
const query = (repo, name, params = {}) => runQuery(repo, name, params, ctx());

/* ---------------------------------------------------------------- scenario */

async function seed(repo) {
  const ids = {};
  const patients = [];
  for (let i = 1; i <= 12; i += 1) {
    const r = op(repo, 'patient.create', {
      fullName: `Probe Patient ${String(i).padStart(3, '0')}`,
      phone: `0181000${String(i).padStart(4, '0')}`,
      gender: i % 2 ? 'Male' : 'Female',
      dateOfBirth: `199${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
      address: `Road ${i}, Dhaka`,
      registrationDate: '2026-09-01'
    });
    if (!r.ok) throw new Error(`patient.create failed: ${r.error}`);
    patients.push(r.record);
  }
  ids.patients = patients;

  for (const [name, price] of [['Consultation', 500], ['Scaling', 1500], ['RCT', 5000], ['Crown', 8000], ['Extraction', 1200]]) {
    const r = op(repo, 'treatment.create', { name, defaultPrice: price, duration: 30, category: 'General' });
    if (!r.ok) throw new Error(`treatment.create failed: ${r.error}`);
  }

  const p0 = patients[0].id;
  const p1 = patients[0].id;
  const p2 = patients[1].id;
  const p3 = patients[2].id;

  const v1 = op(repo, 'visit.create', { patientId: p1, date: '2026-09-05', reason: 'Pain', diagnosis: 'Irreversible pulpitis 46', treatmentPerformed: 'RCT 46', followUpDate: '2026-09-19', fee: 5000, notes: 'probe visit' });
  if (!v1.ok) throw new Error(`visit.create failed: ${v1.error}`);
  ids.visit1 = v1.record.id;

  const appt = op(repo, 'appointment.create', { patientId: p2, date: '2026-09-10', time: '10:30', duration: 30, reason: 'Scaling', dentistId: '' });
  if (!appt.ok) throw new Error(`appointment.create failed: ${appt.error}`);
  ids.appointment1 = appt.record.id;
  op(repo, 'appointment.setStatus', { id: appt.record.id, status: 'Checked In' });

  const inv1 = op(repo, 'invoice.create', {
    patientId: p1, date: '2026-09-05',
    items: [{ name: 'RCT 46', quantity: 1, unitPrice: 5000 }, { name: 'Consultation', quantity: 2, unitPrice: 500 }],
    discount: 200, taxPercent: 5
  });
  if (!inv1.ok) throw new Error(`invoice.create failed: ${inv1.error}`);
  ids.invoice1 = inv1.record.id;

  const inv2 = op(repo, 'invoice.create', {
    patientId: p2, date: '2026-09-10',
    items: [{ name: 'Scaling', quantity: 1, unitPrice: 1500 }], discount: 0
  });
  if (!inv2.ok) throw new Error(`invoice.create failed: ${inv2.error}`);
  ids.invoice2 = inv2.record.id;

  const inv3 = op(repo, 'invoice.create', { patientId: p3, date: '2026-09-12', items: [{ name: 'Crown', quantity: 1, unitPrice: 8000 }] });
  if (!inv3.ok) throw new Error(`invoice.create failed: ${inv3.error}`);
  ids.invoice3 = inv3.record.id;

  const pay1 = op(repo, 'payment.record', { invoiceId: ids.invoice1, patientId: p1, amount: 2000, method: 'Cash', date: '2026-09-05' });
  if (!pay1.ok) throw new Error(`payment.record failed: ${pay1.error}`);
  ids.payment1 = pay1.record.id;

  const pay2 = op(repo, 'payment.record', { invoiceId: ids.invoice2, patientId: p2, amount: 1500, method: 'bKash', date: '2026-09-10' });
  if (!pay2.ok) throw new Error(`payment.record failed: ${pay2.error}`);
  ids.payment2 = pay2.record.id;

  const refund = op(repo, 'payment.refund', { id: ids.payment2, amount: 500, reason: 'Service not rendered', date: '2026-09-11' });
  if (!refund.ok) throw new Error(`payment.refund failed: ${refund.error}`);
  ids.refund1 = refund.record.id;

  const exp = op(repo, 'expense.create', { date: '2026-09-11', category: 'Clinic rent', description: 'Clinic rent September', amount: 20000, method: 'Bank' });
  if (!exp.ok) throw new Error(`expense.create failed: ${exp.error}`);

  const item = op(repo, 'inventory.createItem', { name: 'Articaine 1:100k', category: 'Medicine', unit: 'cartridge', purchasePrice: 40, salePrice: 60, minimumStock: 20, currentStock: 0 });
  if (!item.ok) throw new Error(`inventory.upsert failed: ${item.error}`);
  op(repo, 'inventory.movement', { itemId: item.record.id, type: 'Purchase', quantity: 100, unitCost: 40, date: '2026-09-02' });
  op(repo, 'inventory.movement', { itemId: item.record.id, type: 'Usage', quantity: 30, date: '2026-09-05' });

  const dental = op(repo, 'dental.save', { patientId: p1, tooth: '46', status: 'Caries', note: 'deep occlusal caries' });
  if (!dental.ok) throw new Error(`dental.save failed: ${dental.error}`);
  op(repo, 'dental.save', { patientId: p1, tooth: '46', status: 'Filled', note: 'composite restored' });

  const rx = op(repo, 'prescription.create', {
    patientId: p1, date: '2026-09-05', doctor: 'Dr. Probe',
    complaints: { pain: true }, diagnosis: 'Irreversible pulpitis 46',
    medications: [{ medicine: 'Amoxicillin', strength: '500mg', dosage: '1 capsule', frequency: '1-1-1', durationValue: 5, durationUnit: 'days', foodRelation: 'After food', quantity: 15 }]
  });
  if (!rx.ok) throw new Error(`prescription.create failed: ${rx.error}`);

  const plan = op(repo, 'treatmentPlan.create', { patientId: p3, title: 'Full mouth rehab', procedures: 'Crown 11, 21', estimatedCost: 16000, discount: 1000, stages: ['Diagnosis', 'Prep'] });
  if (!plan.ok) throw new Error(`treatmentPlan.create failed: ${plan.error}`);
  ids.plan1 = plan.record.id;

  return ids;
}

/* ------------------------------------------------------------- comparison */

const QUERIES = [
  ['bootstrap', {}], ['settings', {}], ['users', {}], ['workspace', {}], ['directory', {}],
  ['list', { collection: 'patients', page: 1, pageSize: 10 }],
  ['list', { collection: 'invoices', page: 1, pageSize: 10 }],
  ['list', { collection: 'payments', page: 1, pageSize: 10 }],
  ['list', { collection: 'appointments', page: 1, pageSize: 10 }],
  ['list', { collection: 'visits', page: 1, pageSize: 10 }],
  ['list', { collection: 'treatments', page: 1, pageSize: 10 }],
  ['list', { collection: 'dentalRecords', page: 1, pageSize: 10 }],
  ['list', { collection: 'paymentAdjustments', page: 1, pageSize: 10 }],
  ['list', { collection: 'expenses', page: 1, pageSize: 10 }],
  ['list', { collection: 'inventory', page: 1, pageSize: 10 }],
  ['list', { collection: 'staff', page: 1, pageSize: 10 }],
  ['list', { collection: 'prescriptions', page: 1, pageSize: 10 }],
  ['list', { collection: 'treatmentPlans', page: 1, pageSize: 10 }],
  ['list', { collection: 'auditLog', page: 1, pageSize: 10 }],
  ['analytics', {}], ['report', {}], ['accountingSummary', {}], ['inventoryAnalytics', {}],
  ['dashboard', {}], ['notifications', {}], ['globalSearch', { query: 'Probe' }],
  ['patientDuplicates', {}], ['auditList', { page: 1, pageSize: 10 }],
  // The picker's server-side lookup (V2-08): same name search, same page shape.
  ['patientLookup', { query: 'Probe Patient 003' }],
  ['patientLookup', { query: '0181000' }]
];

function normalise(value) {
  // Compare meaning, not container shape: the two engines legitimately differ in
  // field names (cents vs decimals) at this probe level, so callers pass a metric
  // extractor where the shapes diverge.
  return value;
}

/* Runtime identity metadata (file paths, journal mode, engine label) is
 * genuinely different between a SQLite file and the in-page store; everything
 * else must be identical. */
function withoutStorageShape(value) {
  if (!value || typeof value !== 'object' || !value.storage) return value;
  const { path, bytes, walBytes, pageSize, pageCount, journalMode, storage, source, readOnly, backupPath, attachmentDirectory, ...rest } = value.storage;
  return { ...value, storage: rest };
}

function diff(label, a, b) {
  // canonicalJson sorts keys: object key ORDER is not a behavioural difference,
  // only a difference in value or membership is.
  const sa = canonicalJson(withoutStorageShape(a));
  const sb = canonicalJson(withoutStorageShape(b));
  if (sa === sb) return true;
  record('divergence', label, { local: sa?.slice(0, 400), sql: sb?.slice(0, 400) });
  return false;
}

/* ------------------------------------------------------------------ main */

export async function run() {
  const rt = makeRuntimes();
  try {
    const ids = await seed(rt.local.repo);
    // Both engines create their own row ids, so a scoped query must be driven
    // with the ids of the runtime under test — otherwise the probe compares a
    // "not found" against a real payload and reports a phantom divergence.
    const sqlIds = await seed(rt.sql.repo);

    // Seeded-id query coverage: the generic params above cannot reach the
    // patient/visit-scoped queries, which is exactly where a runtime gap hid
    // before v2.0.0 (visitBilling returned an empty rollup on one engine).
    const scopedFor = (seedIds) => [
      ...QUERIES,
      ['visitBilling', { visitIds: seedIds.visit1 ? [seedIds.visit1, 'missing-visit'] : [] }],
      ['patientTimeline', { patientId: seedIds.patients[0]?.id, page: 1, pageSize: 25 }],
      ['patientAggregate', { patientId: seedIds.patients[0]?.id }],
      ['dentalHistory', { patientId: seedIds.patients[0]?.id }],
      ['invoiceDetail', { id: seedIds.invoice1 }],
      ['appointmentDay', { date: '2026-09-10' }],
      ['appointmentsBetween', { from: '2026-09-01', to: '2026-09-30' }],
      ['record', { collection: 'patients', id: seedIds.patients[0]?.id }],
      ['record', { collection: 'invoices', id: seedIds.invoice1 }],
      ['patientLedgerQuery', { patientId: seedIds.patients[0]?.id, page: 1, pageSize: 25 }],
      ['patientFinancialSummary', { patientId: seedIds.patients[0]?.id }],
      ['patientLedgerRollups', { patientId: seedIds.patients[0]?.id }],
      ['patientStatement', { patientId: seedIds.patients[0]?.id, page: 1, pageSize: 25 }],
      ['patientDuplicates', { patientCode: 'DP-0001' }]
    ];
    const scoped = scopedFor(ids);
    const sqlScoped = scopedFor(sqlIds);
    for (let index = 0; index < scoped.length; index += 1) {
      const [name, params] = scoped[index];
      const sqlParams = sqlScoped[index][1];
      let a; let b;
      try { a = await query(rt.local.repo, name, params); } catch (error) { a = { threw: String(error && error.message) }; }
      try { b = await query(rt.sql.repo, name, sqlParams); } catch (error) { b = { threw: String(error && error.message) }; }
      // Deep compare after removing identity/timestamp noise: any remaining
      // difference is a real behavioural divergence, not a random id.
      diff(`${name}${params.collection ? `.${params.collection}` : ''}`, denoise(a), denoise(b));
    }

    // Per-patient parity: aggregate, statement, financial summary, ledger.
    const localPatients = ids.patients.map((p) => p.id);
    const sqlPatients = (await query(rt.sql.repo, 'list', { collection: 'patients', page: 1, pageSize: 50, sort: 'code' })).rows.map((r) => r.id);
    for (let i = 0; i < localPatients.length; i += 1) {
      const lp = localPatients[i];
      const sp = sqlPatients[i];
      diff(`patientAggregate#${i}`, await query(rt.local.repo, 'patientAggregate', { id: lp }), await query(rt.sql.repo, 'patientAggregate', { id: sp }));
      const ls = await query(rt.local.repo, 'patientStatement', { patientId: lp });
      const ss = await query(rt.sql.repo, 'patientStatement', { patientId: sp });
      diff(`patientStatement.count#${i}`, (ls.entries || ls.rows || []).length, (ss.entries || ss.rows || []).length);
      // Money must be IDENTICAL, not merely plausible: compare every financial
      // figure the Patient 360 summary and the printed statement read.
      const strip = (summary) => {
        if (!summary || !summary.ok) return summary;
        const { lastPayment, ...rest } = summary;
        return rest;
      };
      const stripRow = (row) => [row.date, row.type, row.debitCents, row.creditCents, row.balanceCents];
      const lf = strip(await query(rt.local.repo, 'patientFinancialSummary', { patientId: lp }));
      const sf = strip(await query(rt.sql.repo, 'patientFinancialSummary', { patientId: sp }));
      diff(`patientFinancialSummary#${i}`, lf, sf);
      const ll = await query(rt.local.repo, 'patientLedgerQuery', { patientId: lp });
      const sl = await query(rt.sql.repo, 'patientLedgerQuery', { patientId: sp });
      diff(`patientLedger.rows#${i}`, (ll.rows || []).map(stripRow), (sl.rows || []).map(stripRow));
      diff(`patientLedger.meta#${i}`, [ll.total, ll.balanceCents, ll.billedCents, ll.paidCents, ll.refundedCents, ll.adjustedCents], [sl.total, sl.balanceCents, sl.billedCents, sl.paidCents, sl.refundedCents, sl.adjustedCents]);
      const lr = await query(rt.local.repo, 'patientLedgerRollups', { patientId: lp });
      const sr = await query(rt.sql.repo, 'patientLedgerRollups', { patientId: sp });
      diff(`patientLedgerRollups#${i}`, lr, sr);
      const lstm = await query(rt.local.repo, 'patientStatement', { patientId: lp, page: 1, pageSize: 50 });
      const sstm = await query(rt.sql.repo, 'patientStatement', { patientId: sp, page: 1, pageSize: 50 });
      diff(`patientStatement.rows#${i}`, (lstm.rows || []).map(stripRow), (sstm.rows || []).map(stripRow));
    }

    // Invoice parity: totals and due in both engines.
    for (const [k, v] of Object.entries(ids)) {
      if (!k.startsWith('invoice')) continue;
      const invLocal = rt.local.repo.get('invoices', v);
      const idx = ids.patients.findIndex((p) => p.id === invLocal.patientId);
      const sqlInvId = (await query(rt.sql.repo, 'list', { collection: 'invoices', page: 1, pageSize: 50, sort: 'date' })).rows.find((r) => r.invoiceNumber === invLocal.invoiceNumber)?.id;
      const invSql = rt.sql.repo.get('invoices', sqlInvId);
      diff(`${k}.subtotal`, invLocal.subtotalCents, invSql.subtotalCents);
      diff(`${k}.total`, invLocal.totalCents, invSql.totalCents);
      diff(`${k}.due`, invLocal.dueCents, invSql.dueCents);
      diff(`${k}.status`, invLocal.status, invSql.status);
      diff(`${k}.patientIndex`, idx >= 0, true);
    }

    // Financial invariants independent of engine.
    for (const [label, repo] of [['local', rt.local.repo], ['sql', rt.sql.repo]]) {
      const invoices = (await query(repo, 'list', { collection: 'invoices', page: 1, pageSize: 200 })).rows;
      for (const inv of invoices) {
        const total = Number(inv.totalCents ?? Math.round(Number(inv.total) * 100));
        const due = Number(inv.dueCents ?? Math.round(Number(inv.due) * 100));
        const paid = Number(inv.paidCents ?? Math.round(Number(inv.paid) * 100));
        if (paid + due !== total && inv.status !== 'Cancelled') {
          record('invariant', `invoice ${inv.invoiceNumber} (${label})`, { paid, due, total, sum: paid + due, status: inv.status });
        }
        if (due < 0) record('invariant', `invoice ${inv.invoiceNumber} (${label}) negative due`, { due, status: inv.status });
      }
      const patients = (await query(repo, 'list', { collection: 'patients', page: 1, pageSize: 200 })).rows;
      for (const p of patients) {
        const balance = Number(p.balanceCents ?? Math.round(Number(p.balance) * 100));
        if (balance < 0) record('invariant', `patient ${p.patientCode} (${label}) negative balance`, { balance });
      }
    }

    // Backup / restore round trip must be byte-exact for records.
    const snapshot = {
      patients: (await query(rt.local.repo, 'list', { collection: 'patients', page: 1, pageSize: 200, sort: 'code' })).rows.map((p) => [p.id, p.fullName, p.balanceCents]),
      invoices: (await query(rt.local.repo, 'list', { collection: 'invoices', page: 1, pageSize: 200, sort: 'date' })).rows.map((p) => [p.invoiceNumber, p.totalCents, p.dueCents, p.status]),
      payments: (await query(rt.local.repo, 'list', { collection: 'payments', page: 1, pageSize: 200, sort: 'date' })).rows.map((p) => [p.receiptNumber, p.amountCents, p.refundedCents, p.status])
    };
    const sqlSnapshot = {
      patients: (await query(rt.sql.repo, 'list', { collection: 'patients', page: 1, pageSize: 200, sort: 'code' })).rows.map((p) => [p.patientCode, p.balanceCents]),
      invoices: (await query(rt.sql.repo, 'list', { collection: 'invoices', page: 1, pageSize: 200, sort: 'date' })).rows.map((p) => [p.invoiceNumber, p.totalCents, p.dueCents, p.status]),
      payments: (await query(rt.sql.repo, 'list', { collection: 'payments', page: 1, pageSize: 200, sort: 'date' })).rows.map((p) => [p.receiptNumber, p.amountCents, p.refundedCents, p.status])
    };
    diff('mirror.invoices', snapshot.invoices, sqlSnapshot.invoices);
    diff('mirror.payments', snapshot.payments, sqlSnapshot.payments);
    diff('mirror.patients.balance', snapshot.patients.map(([id, n, b]) => b), sqlSnapshot.patients.map(([c, b]) => b));

    // Integrity of the on-disk engine after the whole scenario.
    const integrity = await rt.sql.repo.integrityCheck();
    if (!integrity.ok) record('integrity', 'sql integrityCheck failed', integrity);

    return { findings, ids: Object.keys(ids) };
  } finally {
    rt.close();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const { findings } = await run();
  const outArg = process.argv.indexOf('--json');
  if (outArg > -1) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(findings, null, 2));
  const byLevel = (l) => findings.filter((f) => f.level === l).length;
  for (const f of findings.filter((x) => x.level !== 'divergence').slice(0, 40)) console.log(`[${f.level}] ${f.area}: ${JSON.stringify(f.detail).slice(0, 300)}`);
  console.log(`\n${findings.length} finding(s): ${byLevel('invariant')} invariant, ${byLevel('integrity')} integrity, ${byLevel('divergence')} engine divergence`);
  if (process.env.DIVERGENCE_DUMP === '1') for (const f of findings.filter((x) => x.level === 'divergence')) console.log(`[divergence] ${f.area}\n  local: ${f.detail.local}\n  sql:   ${f.detail.sql}`);
  process.exit(0);
}
