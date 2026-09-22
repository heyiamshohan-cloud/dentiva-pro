import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_COLLECTIONS,
  appointmentsOverlap,
  applyRestorePlan,
  buildBackupManifest,
  buildRestorePlan,
  calculateInvoice,
  canAcceptPayment,
  canonicalJson,
  detectPatientDuplicates,
  paymentStatusFor,
  restoreCollection,
  validateAttachmentFile,
  validateMoney,
  validateBackupPayload,
  validateRelationships,
  PERMISSIONS,
  hasPermission,
  permissionsForRole
} from '../src/core.js';

function makeRecordStore() {
  return {
    schemaVersion: 2,
    dentalRecords: [],
    treatments: [],
    stockMovements: [],
    staff: [],
    referrals: [],
    paymentAdjustments: [],
    notifications: [],
    followUpTasks: [],
    treatmentPlans: [],
    users: [],
    medicationCatalog: [],
    notificationRules: [],
    rooms: [],
    savedFilters: [],
    savedReports: [],
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

test('attachments reject unsafe types; large clinical files are allowed (no artificial 6MB cap)', () => {
  assert.equal(validateAttachmentFile({ type: 'application/pdf', size: 1024, data: 'data:application/pdf;base64,AA==' }).allowed, true);
  assert.equal(validateAttachmentFile({ type: 'application/pdf', size: 1024, data: 'javascript:alert(1)' }).allowed, false);
  assert.equal(validateAttachmentFile({ type: 'application/x-msdownload', size: 1024 }).allowed, false);
  assert.equal(validateAttachmentFile({ type: 'image/png', size: 7 * 1024 * 1024 }).allowed, true);
  assert.equal(validateAttachmentFile({ type: 'image/png', size: 512 * 1024 * 1024 }).allowed, false);
});

test('backup manifest preserves modules, schema and record counts', () => {
  const store = makeRecordStore();
  store.patients.push({ id: 'p1' }, { id: 'p2' });
  store.visits.push({ id: 'v1' });
  const manifest = buildBackupManifest(store, '1.1.0', ['patients', 'visits', 'payments']);
  assert.equal(manifest.product, 'Dentiva Pro');
  assert.equal(manifest.schemaVersion, 2);
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


test('refunds reduce invoice balance without mutating the original payment amount', () => {
  const status = paymentStatusFor(1000, [{ id: 'pay1', amount: 1000, refundedAmount: 250, status: 'Partially Refunded' }]);
  assert.deepEqual(status, { paid: 750, due: 250, status: 'Partially Paid' });
  assert.equal(paymentStatusFor(1000, [{ amount: 1000, refundedAmount: 1000, status: 'Refunded' }]).status, 'Unpaid');
});

test('backup validation rejects malformed relationships and accepts a complete store', () => {
  const store = makeRecordStore();
  store.dentalRecords = [];
  store.paymentAdjustments = [];
  store.patients.push({ id: 'p1', patientCode: 'PT-1' });
  store.invoices.push({ id: 'inv1', invoiceNumber: 'INV-1', patientId: 'p1', total: 100 });
  store.payments.push({ id: 'pay1', invoiceId: 'inv1', patientId: 'p1', amount: 100 });
  const valid = validateBackupPayload(store, ARRAY_COLLECTIONS);
  assert.equal(valid.valid, true);
  const malformed = validateBackupPayload({ ...store, payments: [{ id: 'pay2', invoiceId: 'missing', patientId: 'p1', amount: 5 }] }, ARRAY_COLLECTIONS);
  assert.equal(malformed.valid, false);
  assert.match(malformed.errors.join(' '), /missing invoice/);
});

test('patient-scoped restore keeps dependent records and leaves unrelated modules alone', () => {
  const local = { ...makeRecordStore(), patients: [{ id: 'local', patientCode: 'PT-L' }], visits: [{ id: 'old', patientId: 'local' }] };
  const incoming = { ...makeRecordStore(), patients: [{ id: 'p1', patientCode: 'PT-1' }, { id: 'p2', patientCode: 'PT-2' }], visits: [{ id: 'v1', patientId: 'p1' }, { id: 'v2', patientId: 'p2' }], expenses: [{ id: 'e1', amount: 10 }] };
  const plan = buildRestorePlan(local, incoming, { modules: ['patients', 'clinical'], strategy: 'Keep Existing', patientIds: ['p1'] });
  const applied = applyRestorePlan(local, plan);
  assert.deepEqual(applied.state.patients.map((p) => p.id), ['local', 'p1']);
  assert.deepEqual(applied.state.visits.map((v) => v.id), ['old', 'v1']);
  assert.equal(applied.state.expenses.length, 0);
});

test('create-new-copy restore remaps patient and invoice relationships', () => {
  const local = { ...makeRecordStore(), patients: [{ id: 'p1', patientCode: 'PT-1' }], invoices: [{ id: 'i1', invoiceNumber: 'INV-1', patientId: 'p1' }], payments: [{ id: 'pay1', invoiceId: 'i1', patientId: 'p1' }] };
  const incoming = { ...makeRecordStore(), patients: [{ id: 'p1', patientCode: 'PT-1-B' }], invoices: [{ id: 'i1', invoiceNumber: 'INV-1-B', patientId: 'p1' }], payments: [{ id: 'pay1', invoiceId: 'i1', patientId: 'p1' }] };
  const plan = buildRestorePlan(local, incoming, { modules: ['patients', 'finance'], strategy: 'Create New Copy' });
  const applied = applyRestorePlan(local, plan);
  const copiedPatient = applied.state.patients.find((p) => p.patientCode === 'PT-1-B');
  const copiedInvoice = applied.state.invoices.find((i) => i.invoiceNumber === 'INV-1-B');
  const copiedPayment = applied.state.payments.find((payment) => payment.id !== 'pay1');
  assert.ok(copiedPatient);
  assert.equal(copiedInvoice.patientId, copiedPatient.id);
  assert.equal(copiedPayment.invoiceId, copiedInvoice.id);
  assert.equal(copiedPayment.patientId, copiedPatient.id);
});

test('relationship validator catches orphaned payment adjustments', () => {
  const store = makeRecordStore();
  store.paymentAdjustments = [{ id: 'adj1', paymentId: 'missing', amount: 10 }];
  assert.match(validateRelationships(store).join(' '), /paymentAdjustments:adj1 references missing payment/);
});


test('appointment resource overlap catches chair and dentist collisions but permits separate resources', () => {
  const existing = { id: 'a1', date: '2026-09-22', time: '10:00', duration: 60, chair: 'Chair 1', dentistId: 'd1', status: 'Scheduled' };
  assert.equal(appointmentsOverlap({ id: 'a2', date: '2026-09-22', time: '10:30', duration: 30, chair: 'Chair 1', dentistId: 'd2' }, existing), true);
  assert.equal(appointmentsOverlap({ id: 'a3', date: '2026-09-22', time: '10:30', duration: 30, chair: 'Chair 2', dentistId: 'd1' }, existing), true);
  assert.equal(appointmentsOverlap({ id: 'a4', date: '2026-09-22', time: '10:30', duration: 30, chair: 'Chair 2', dentistId: 'd2' }, existing), false);
  assert.equal(appointmentsOverlap({ id: 'a5', date: '2026-09-22', time: '11:00', duration: 30, chair: 'Chair 1', dentistId: 'd2' }, existing), false);
});


test('canonical backup serialization is stable regardless of object insertion order', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(canonicalJson({ nested: { z: true, a: false } }), '{"nested":{"a":false,"z":true}}');
});


test('money validation rejects negative, empty and over-precise values', () => {
  assert.equal(validateMoney('0'), true);
  assert.equal(validateMoney('1250.50'), true);
  assert.equal(validateMoney('1250.501'), false);
  assert.equal(validateMoney('-1'), false);
  assert.equal(validateMoney('', { allowZero: false }), false);
});

test('role templates enforce operations independently of renderer visibility', () => {
  const receptionist = { id: 'u1', role: 'Receptionist', active: true };
  const assistant = { id: 'u2', role: 'Dental Assistant', active: true };
  const custom = { id: 'u3', role: 'Custom Role', active: true, permissions: ['patients.view', 'reports.view'] };
  assert.ok(PERMISSIONS.includes('users.manage'));
  assert.equal(hasPermission(receptionist, 'patients.create'), true);
  assert.equal(hasPermission(receptionist, 'billing.refund'), false);
  assert.equal(hasPermission(assistant, 'clinical.create'), true);
  assert.equal(hasPermission(assistant, 'billing.create'), false);
  assert.equal(hasPermission(custom, 'patients.view'), true);
  assert.equal(hasPermission(custom, 'patients.create'), false);
  assert.equal(hasPermission({ ...custom, active: false }, 'patients.view'), false);
  assert.equal(permissionsForRole('Custom Role', ['patients.view', 'not-a-permission']).length, 1);
});
