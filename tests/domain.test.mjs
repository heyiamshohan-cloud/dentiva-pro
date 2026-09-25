import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentsOverlap } from '../src/core.js';
import {
  DASHBOARD_PERIODS,
  analyticsSnapshot,
  buildTimelineEvents,
  inDateRange,
  normaliseTags,
  periodBounds,
  statementEntries,
  validatePatientInput,
  validateTreatmentPlanInput
} from '../src/domain.js';

test('commercial period bounds are deterministic and reject inverted custom ranges', () => {
  const now = new Date('2026-09-22T10:00:00Z');
  assert.deepEqual(periodBounds('7d', now), { from: '2026-09-16', to: '2026-09-22', invalid: false });
  assert.deepEqual(periodBounds('custom', now, '2026-09-20', '2026-09-19'), { from: '2026-09-20', to: '2026-09-19', invalid: true });
  assert.equal(DASHBOARD_PERIODS.includes('custom'), true);
  assert.equal(inDateRange('2026-09-20', periodBounds('7d', now)), true);
  assert.deepEqual(periodBounds('today', new Date('2026-09-21T18:30:00Z')), { from: '2026-09-22', to: '2026-09-22', invalid: false }, 'periods use the Bangladesh local calendar');
});

test('statement entries reconcile charges, collections and refunds in cents', () => {
  const entries = statementEntries({
    invoices: [{ id: 'i1', patientId: 'p1', invoiceNumber: 'INV-1', date: '2026-09-01', total: 1000 }],
    payments: [{ id: 'pay1', patientId: 'p1', invoiceId: 'i1', date: '2026-09-02', amount: 600, method: 'Cash' }],
    adjustments: [{ id: 'adj1', patientId: 'p1', paymentId: 'pay1', type: 'Refund', date: '2026-09-03', amount: 100, reason: 'Correction' }]
  }, 'p1');
  assert.deepEqual(entries.map(({ type, balance }) => [type, balance]), [['Invoice', 1000], ['Payment', 400], ['Refund', 500]]);
});

test('analytics is sourced from saved records and exposes meaningful rates', () => {
  const result = analyticsSnapshot({
    patients: [{ id: 'p1', registrationDate: '2026-09-20' }],
    visits: [{ id: 'v1', date: '2026-09-21' }],
    appointments: [{ id: 'a1', date: '2026-09-21', status: 'Completed' }, { id: 'a2', date: '2026-09-21', status: 'No Show' }],
    payments: [{ id: 'pay1', date: '2026-09-21', amount: 1200, method: 'bKash' }],
    invoices: [{ id: 'i1', date: '2026-09-21', total: 1500 }],
    expenses: [{ id: 'e1', date: '2026-09-21', amount: 200 }]
  }, 'month', new Date('2026-09-22T10:00:00Z'));
  assert.equal(result.revenue, 1200);
  assert.equal(result.billed, 1500);
  assert.equal(result.net, 1000);
  assert.equal(result.completionRate, 50);
  assert.equal(result.noShowRate, 50);
  assert.deepEqual(result.byMethod, [{ label: 'bKash', value: 1200 }]);
});

test('timeline projections include clinical, financial and document events', () => {
  const events = buildTimelineEvents({
    appointments: [{ id: 'a1', patientId: 'p1', date: '2026-09-01', status: 'Completed' }],
    visits: [{ id: 'v1', patientId: 'p1', date: '2026-09-02', reason: 'Review' }],
    prescriptions: [{ id: 'rx1', patientId: 'p1', date: '2026-09-03', medications: [{ medicine: 'Amoxicillin' }] }],
    invoices: [{ id: 'i1', patientId: 'p1', date: '2026-09-04', total: 500 }],
    payments: [{ id: 'pay1', patientId: 'p1', date: '2026-09-05', amount: 250 }],
    referrals: [], attachments: [], followUpTasks: []
  }, 'p1');
  assert.deepEqual(events.map((event) => event.type), ['Payment', 'Invoice', 'Prescription', 'Visit', 'Appointment']);
});

test('room-aware scheduling permits separate rooms but flags shared resources', () => {
  const existing = { id: 'a1', date: '2026-09-22', time: '10:00', duration: 45, chair: 'Chair 1', room: 'Room 1', dentistId: 'd1', status: 'Scheduled' };
  assert.equal(appointmentsOverlap({ id: 'a2', date: '2026-09-22', time: '10:15', duration: 30, chair: 'Chair 1', room: 'Room 1', dentistId: 'd2' }, existing), true);
  assert.equal(appointmentsOverlap({ id: 'a3', date: '2026-09-22', time: '10:15', duration: 30, chair: 'Chair 1', room: 'Room 2', dentistId: 'd2' }, existing), false);
  assert.equal(appointmentsOverlap({ id: 'a4', date: '2026-09-22', time: '10:15', duration: 30, chair: 'Chair 2', room: 'Room 2', dentistId: 'd1' }, existing), true);
});

test('patient and treatment plan validation protects commercial workflows', () => {
  assert.equal(validatePatientInput({ fullName: 'Amina', phone: '01700000000', email: 'amina@example.com' }).valid, true);
  assert.equal(validatePatientInput({ fullName: '', phone: '01700000000' }).errors[0], 'Full name is required.');
  assert.equal(validatePatientInput({ fullName: 'Amina', phone: '01700000000', email: 'bad' }).valid, false);
  assert.equal(validateTreatmentPlanInput({ patientId: 'p1', title: 'Restoration', startDate: '2026-09-20', reviewDate: '2026-09-19' }).valid, false);
});

test('patient tags are normalized, deduplicated and bounded', () => {
  assert.deepEqual(normaliseTags(' Recall, High priority, Recall '), ['Recall', 'High priority']);
  assert.equal(normaliseTags(Array.from({ length: 30 }, (_, index) => `tag-${index}`)).length, 20);
});
