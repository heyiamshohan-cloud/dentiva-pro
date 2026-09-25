// Forensic sweep (v2.0.0 audit): executes EVERY registered query and op against
// the real SQLite repository and reports any that fail, return a non-ok result,
// or throw. Nothing here is a substitute for behavioural tests — it exists to
// guarantee no registered capability is dead on the shipping runtime.
//
// Usage: node scripts/v2-audit/surface-sweep.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../../electron/lib/db.mjs';
import { SqlRepo } from '../../electron/lib/repo-sql.mjs';
import { runOp, OPS } from '../../src/ops.js';
import { runQuery, QUERIES } from '../../src/queries.js';
import { PERMISSIONS } from '../../src/core.js';
import { defaultState } from '../../src/migrate-state.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-sweep-'));
const ws = new Workspace(dir); ws.open();
const repo = new SqlRepo(ws);
const now = () => new Date('2026-09-25T09:00:00.000Z').toISOString();
const today = () => '2026-09-25';
const ctx = { userId: 'u_admin', userName: 'Admin', role: 'Administrator', permissions: PERMISSIONS, firstRun: false, now, today };
const failures = [];
const record = (kind, name, detail) => { failures.push({ kind, name, detail }); console.log(`  ✗ ${kind} ${name}: ${detail}`); };

// ---- seed a realistic workspace through the shared ops ---------------------
const seed = (name, payload) => {
  const res = runOp(repo, name, payload, ctx);
  if (!res.ok) throw new Error(`seed ${name} failed: ${res.error}`);
  return res.record || res;
};
seed('patient.create', { fullName: 'Amina Rahman', phone: '01700000000', gender: 'Female', dateOfBirth: '1990-04-12', email: 'amina@example.com', address: '12 Dhanmondi', city: 'Dhaka', district: 'Dhaka', notes: 'Prefers morning slots', tags: ['vip'] });
const patient = repo.all('patients')[0];
const patientId = patient.id;
seed('patient.create', { fullName: 'Karim Uddin', phone: '01800000000' });
const patient2 = repo.all('patients').find((p) => p.id !== patientId);
seed('staff.create', { name: 'Dr Nusrat Jahan', role: 'Dentist', specialization: 'Endodontics', phone: '01911111111', email: 'nusrat@example.com' });
const staff = repo.all('staff')[0];
seed('supplier.create', { name: 'Dhaka Dental Supply', code: 'SUP-01', contactPerson: 'Rakib', phone: '01722222222', email: 'sales@dds.example' });
const supplier = repo.all('suppliers')[0];
seed('inventory.createItem', { name: 'Composite A2', category: 'Consumable', unit: 'syringe', purchasePrice: 800, salePrice: 1200, currentStock: 25, minimumStock: 5, supplierId: supplier.id, expiryDate: '2027-01-31', batch: 'B-1', itemCode: 'IT-01' });
const item = repo.all('inventory')[0];
seed('inventory.movement', { itemId: item.id, movementType: 'Usage', quantity: 3, reason: 'Procedure use' });
seed('treatment.create', { name: 'Composite filling', code: 'TR-01', category: 'Restorative', defaultPrice: 1500, duration: 45, toothRequired: true });
const treatment = repo.all('treatments')[0];
seed('appointment.create', { patientId, date: '2026-09-25', time: '10:00', duration: 30, reason: 'Tooth pain', dentistId: staff.id, chair: 'Chair 1', room: 'Room 1' });
const appointment = repo.all('appointments')[0];
seed('appointment.setStatus', { id: appointment.id, status: 'Checked In' });
const visit = seed('visit.create', { patientId, appointmentId: appointment.id, reason: 'Tooth pain', chiefComplaint: 'Pain on cold', findings: 'Caries 36', diagnosis: 'Dental caries', treatmentPerformed: 'Composite filling', procedures: 'Filling', teeth: '36', date: '2026-09-25', followUpDate: '2026-10-10', dentistId: staff.id });
seed('dental.save', { patientId, tooth: 36, dentition: 'adult', status: 'Filled', procedure: 'Composite', note: 'Occlusal caries', visitId: visit.id });
seed('treatmentPlan.create', { patientId, title: 'Full mouth rehabilitation', goal: 'Restore function', procedures: 'Crown, implant', teeth: '11,21', estimatedCost: 60000, discount: 5000, startDate: '2026-09-25', reviewDate: '2026-11-25', dentistId: staff.id, stages: [{ title: 'Diagnosis', estimatedCost: 5000, status: 'Completed' }, { title: 'Restoration', estimatedCost: 55000, status: 'Planned' }] });
const plan = repo.all('treatmentPlans')[0];
seed('referral.create', { patientId, date: '2026-09-25', referralTo: 'Bangabandhu Dental', specialty: 'Oral surgery', reason: 'Impacted 38' });
const referral = repo.all('referrals')[0];
seed('medicationCatalog.save', { name: 'Amoxicillin', strength: '500 mg', dosage: '1 capsule', frequency: '1-0-1', duration: '5 Days', active: true });
seed('prescription.create', { patientId, visitId: visit.id, date: '2026-09-25', doctor: 'Dr Nusrat Jahan', chiefComplaint: 'Pain on cold', onExamination: 'Carries / G Carries', advice: 'Warm saline rinse', medications: [{ medicine: 'Amoxicillin', form: 'Capsule', strength: '500 mg', dosage: '1 capsule', frequencyPattern: '1-0-1', foodRelation: 'After food', durationValue: 5, durationUnit: 'Days', quantity: 10, instructions: 'Complete the course' }] });
const invoice = seed('invoice.create', { patientId, visitId: visit.id, date: '2026-09-25', items: [{ name: 'Composite filling', quantity: 2, unitPrice: 1500, tooth: '36' }, { name: 'X-ray', quantity: 1, unitPrice: 500 }], discount: 100, taxRate: 5 });
const payment = seed('payment.record', { invoiceId: invoice.id, patientId, amount: 1000, method: 'bKash', reference: 'TRX123', date: '2026-09-25' });
seed('payment.record', { invoiceId: invoice.id, patientId, amount: 500, method: 'Cash', date: '2026-09-25' });
seed('expense.create', { description: 'Gloves box', amount: 1200, date: '2026-09-25', category: 'Supplies', method: 'Cash' });
seed('followup.create', { patientId, title: 'Review filling', dueDate: '2026-10-10', reason: 'Check occlusion' });
seed('attachment.add', { patientId, name: 'xray.png', type: 'image/png', size: 2048, data: `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`, notes: 'Periapical' });
seed('user.create', { name: 'Workspace Administrator', role: 'Administrator', pin: '1234', confirmPin: '1234' });
seed('user.create', { name: 'Front Desk', role: 'Receptionist', pin: '1234', confirmPin: '1234' });
seed('setup.complete', { clinicName: 'Dentiva Test Clinic', dentistName: 'Dr Nusrat Jahan', professionalTitle: 'BDS, FCPS', phone: '01711111111', email: 'clinic@example.com', address: 'House 1, Road 2', city: 'Dhaka', currency: 'BDT', timezone: 'Asia/Dhaka' });
seed('dashboard.setLayout', { layout: ['schedule', 'queue', 'financial'] });
seed('navigation.setFavorites', { favorites: ['patients', 'billing'] });
seed('savedFilter.save', { name: 'Outstanding', page: 'patients', filters: { balance: 'outstanding' } });

// ---- sweep every query ----------------------------------------------------
const queryParams = {
  bootstrap: {}, settings: {}, users: {}, list: { collection: 'patients', page: 1, pageSize: 10 },
  auditList: { page: 1, pageSize: 10 }, patientAggregate: { patientId },
  patientTimeline: { patientId, page: 1, pageSize: 10 }, patientStatement: { patientId, page: 1, pageSize: 10 },
  patientLedgerQuery: { patientId, page: 1, pageSize: 10 }, patientFinancialSummary: { patientId },
  patientLedgerRollups: { patientId }, visitBilling: { visitIds: [visit.id] }, patientDuplicates: { patientId },
  dentalHistory: { patientId }, invoiceDetail: { id: invoice.id }, appointmentDay: { date: '2026-09-25' },
  appointmentsBetween: { from: '2026-09-01', to: '2026-09-30' }, dashboard: {}, analytics: { rangeKey: 'year' },
  report: { type: 'revenue', rangeKey: 'year' }, accountingSummary: { rangeKey: 'year' },
  inventoryAnalytics: {}, globalSearch: { query: 'Ami' }, notifications: {}, workspace: {},
  record: { collection: 'patients', id: patientId }, directory: {},
};
console.log('\n=== query registry sweep ===');
for (const name of Object.keys(QUERIES)) {
  const params = queryParams[name] ?? {};
  try {
    const res = await runQuery(repo, name, params, ctx);
    if (!res || res.ok !== true) record('query', name, JSON.stringify({ error: res?.error, code: res?.code }));
    else console.log(`  ✓ query ${name}`);
  } catch (error) { record('query', name, `threw: ${error.message}`); }
}
// every collection through the generic list query
for (const collection of Object.keys((await import('../../src/queries.js')).COLLECTION_PERMISSION)) {
  try {
    const res = await runQuery(repo, 'list', { collection, page: 1, pageSize: 10 }, ctx);
    if (res.ok !== true) record('list', collection, JSON.stringify({ error: res.error, code: res.code }));
    else console.log(`  ✓ list ${collection} (${res.total} rows)`);
  } catch (error) { record('list', collection, `threw: ${error.message}`); }
}
// every sort key through the patient list
for (const sort of ['name', 'name-desc', 'recent', 'oldest', 'balance', 'billed-desc', 'billed', 'paid-desc', 'visits-desc', 'code', 'visits', 'paid']) {
  try {
    const res = await runQuery(repo, 'list', { collection: 'patients', page: 1, pageSize: 5, sort }, ctx);
    if (res.ok !== true) record('patient-sort', sort, res.error || 'not ok');
    else console.log(`  ✓ patient sort ${sort} → ${res.rows.length} row(s)`);
  } catch (error) { record('patient-sort', sort, `threw: ${error.message}`); }
}
// every collection × every declared sort key
const specsSrc = fs.readFileSync(new URL('../../electron/lib/list-sql.mjs', import.meta.url), 'utf8');
for (const [, coll, sorts] of specsSrc.matchAll(/^  (\w+): \{[\s\S]*?sorts: \{([^}]*)\}/gm)) {
  for (const key of [...sorts.matchAll(/'([\w-]+)':/g)].map((m) => m[1])) {
    try {
      const res = await runQuery(repo, 'list', { collection: coll, page: 1, pageSize: 5, sort: key }, ctx);
      if (res.ok !== true) record('sort', `${coll}/${key}`, res.error || 'not ok');
    } catch (error) { record('sort', `${coll}/${key}`, `threw: ${error.message}`); }
  }
}
console.log('  (collection × sort sweep complete)');

// ---- sweep every op (valid payloads where feasible, junk otherwise) -------
console.log('\n=== op registry sweep (junk payloads must fail SAFELY, never throw) ===');
for (const name of Object.keys(OPS)) {
  try {
    const res = runOp(repo, name, { id: 'missing', patientId: 'missing', invoiceId: 'missing', paymentId: 'missing', itemId: 'missing', visitId: 'missing', userId: 'missing', name: '', amount: 1, description: '', reason: '', date: '2026-09-25', quantity: 1, medicine: 'x', medications: [{ medicine: 'x' }], doctor: 'd', fullName: 'x', phone: '017', pin: '1234', records: [], collection: 'patients' }, ctx);
    if (!res || typeof res.ok !== 'boolean') record('op', name, 'did not return an { ok } result');
    else console.log(`  ✓ op ${name} → ok=${res.ok}`);
  } catch (error) { record('op', name, `THREW: ${error.message}`); }
}

// ---- integrity after all of that -----------------------------------------
const integrity = repo.integrityCheck();
if (!integrity.ok) record('integrity', 'foreign keys', JSON.stringify(integrity.foreignKeyViolations));
else console.log('\n  ✓ integrity check clean after full surface sweep');

console.log(`\n=== ${failures.length} failure(s) ===`);
fs.writeFileSync('/tmp/surface-sweep.json', JSON.stringify(failures, null, 2));
ws.close();
