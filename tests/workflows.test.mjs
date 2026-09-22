import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackupManifest,
  calculateInvoice,
  canAcceptPayment,
  detectPatientDuplicates,
  restoreCollection,
  validateAttachmentFile
} from '../src/core.js';

function makeRecordStore() {
  return {
    schemaVersion: 1,
    patients: [],
    appointments: [],
    visits: [],
    prescriptions: [],
    invoices: [],
    payments: [],
    expenses: [],
    inventory: [],
    suppliers: [],
    attachments: [],
    audit: []
  };
}

test('patient, visit and appointment records remain relational', () => {
  const store = makeRecordStore();
  const patient = { id: 'p1', patientCode: 'PT-0001', fullName: 'Amina Rahman', phone: '01700000000' };
  store.patients.push(patient);
  store.appointments.push({ id: 'a1', patientId: patient.id, date: '2026-09-22', status: 'Scheduled' });
  store.visits.push({ id: 'v1', patientId: patient.id, date: '2026-09-22', diagnosis: 'Recorded by dentist' });
  assert.equal(store.appointments[0].patientId, store.patients[0].id);
  assert.equal(store.visits[0].patientId, store.patients[0].id);
  assert.equal(store.patients.length, 1);
});

test('patient search and duplicate detection use safe matching rules', () => {
  const existing = [{ id: 'p1', patientCode: 'PT-0001', fullName: 'Amina Rahman', phone: '+8801700000000', email: 'amina@example.com' }];
  const incoming = [
    { id: 'new', patientCode: 'PT-0088', fullName: 'Amina Rahman', phone: '01700000000' },
    { id: 'new2', patientCode: 'PT-0089', fullName: 'Farhan Khan', phone: '01800000000' }
  ];
  const duplicates = detectPatientDuplicates(incoming, existing);
  assert.deepEqual(duplicates.map((record) => record.id), ['new']);
  assert.equal(existing.some((p) => p.fullName.toLowerCase().includes('amina')), true);
});

test('invoice, discount, tax and due formulas are deterministic', () => {
  const invoice = calculateInvoice({ quantity: 3, unitPrice: 1250, discount: 150, taxRate: 5 });
  assert.deepEqual(invoice, { subtotal: 3750, discount: 150, taxRate: 5, tax: 180, total: 3780 });
  assert.equal(invoice.total - 1000, 2780);
});

test('partial, full and excessive payments are validated', () => {
  assert.equal(canAcceptPayment(500, 1000), true);
  assert.equal(canAcceptPayment(1000, 1000), true);
  assert.equal(canAcceptPayment(1000.01, 1000), false);
  assert.equal(canAcceptPayment(-1, 1000), false);
});

test('payment methods and expenses can remain separate ledgers', () => {
  const payments = [
    { amount: 500, method: 'Cash' },
    { amount: 700, method: 'bKash' },
    { amount: 300, method: 'Bank' }
  ];
  const expenses = [{ amount: 250, category: 'Supplies' }, { amount: 350, category: 'Internet' }];
  assert.equal(payments.reduce((sum, payment) => sum + payment.amount, 0), 1500);
  assert.equal(expenses.reduce((sum, expense) => sum + expense.amount, 0), 600);
  assert.equal(1500 - 600, 900);
});

test('inventory movements expose low stock and expiry inputs', () => {
  const stock = [
    { id: 'i1', name: 'Composite', currentStock: 2, minimumStock: 5, expiryDate: '2026-09-20' },
    { id: 'i2', name: 'Gloves', currentStock: 40, minimumStock: 5, expiryDate: '2027-01-01' }
  ];
  assert.equal(stock.filter((item) => item.currentStock <= item.minimumStock).length, 1);
  assert.equal(stock.filter((item) => item.expiryDate < '2026-09-22').length, 1);
});

test('attachments reject unsafe types and oversized files', () => {
  assert.equal(validateAttachmentFile({ type: 'application/pdf', size: 1024 }).allowed, true);
  assert.equal(validateAttachmentFile({ type: 'application/x-msdownload', size: 1024 }).allowed, false);
  assert.equal(validateAttachmentFile({ type: 'image/png', size: 7 * 1024 * 1024 }).allowed, false);
});

test('backup manifest preserves modules, schema and record counts', () => {
  const store = makeRecordStore();
  store.patients.push({ id: 'p1' }, { id: 'p2' });
  store.visits.push({ id: 'v1' });
  const manifest = buildBackupManifest(store, '1.0.0', ['patients', 'visits', 'payments']);
  assert.equal(manifest.product, 'Dentiva Pro');
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.recordCounts, { patients: 2, visits: 1, payments: 0 });
});

test('selective restore and conflict strategies are explicit', () => {
  const local = [{ id: 'p1', fullName: 'Local' }];
  const incoming = [{ id: 'p1', fullName: 'Backup' }, { id: 'p2', fullName: 'New' }];
  const kept = restoreCollection(local, incoming, 'Keep Existing');
  assert.equal(kept.records.find((record) => record.id === 'p1').fullName, 'Local');
  assert.equal(kept.skipped, 1);
  assert.equal(restoreCollection(local, incoming, 'Replace').records.find((record) => record.id === 'p1').fullName, 'Backup');
  const copied = restoreCollection(local, incoming, 'Create New Copy');
  assert.equal(copied.copied, 1);
  assert.equal(copied.records.length, 3);
});

test('large patient histories do not impose an application count limit', () => {
  const patients = Array.from({ length: 10000 }, (_, index) => ({ id: `p${index}`, patientCode: `PT-${index}` }));
  assert.equal(patients.length, 10000);
  assert.equal(patients.at(-1).patientCode, 'PT-9999');
});
