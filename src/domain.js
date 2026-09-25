// Commercial workflow projections kept outside the renderer. These helpers are deterministic,
// serializable and safe to exercise in Node tests without Electron or a browser.

import { centsToMoney, moneyToCents, toNumber } from './core.js';

export const DASHBOARD_PERIODS = ['today', '7d', 'month', 'quarter', '6m', 'year', 'custom', 'all'];

export function periodBounds(period = 'today', now = new Date(), customFrom = '', customTo = '') {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const endKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const end = new Date(`${endKey}T00:00:00Z`);
  const iso = (value) => value.toISOString().slice(0, 10);
  if (period === 'custom') {
    const from = customFrom || endKey;
    const to = customTo || endKey;
    return { from, to, invalid: to < from };
  }
  if (period === 'all') return { from: null, to: endKey, invalid: false };
  let start = new Date(end);
  if (period === '7d') start.setUTCDate(start.getUTCDate() - 6);
  if (period === 'month') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (period === 'quarter') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  if (period === '6m') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  if (period === 'year') start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  return { from: iso(start), to: endKey, invalid: false };
}

export function inDateRange(value, bounds) {
  if (!value || !bounds || bounds.invalid) return false;
  return (!bounds.from || value >= bounds.from) && (!bounds.to || value <= bounds.to);
}

export function statementEntries({ invoices = [], payments = [], adjustments = [] } = {}, patientId = '') {
  // Reference implementation of the patient ledger (the SQL ledger in
  // electron/lib/ledger-sql.mjs must match it row for row):
  //   Invoice = debit (issued only: drafts and cancelled never debit),
  //   Payment = gross credit, Refund = debit, Adjustment = credit.
  // Running balance = Σ debit − Σ credit, never clamped (negative = credit).
  // Order: date, creation time, event rank, reference, id.
  const totalCentsOf = (record) => (record.totalCents !== undefined ? Math.max(0, Number(record.totalCents || 0)) : moneyToCents(record.total));
  const amountCentsOf = (record) => (record.amountCents !== undefined ? Math.max(0, Number(record.amountCents || 0)) : moneyToCents(record.amount));
  const patientInvoices = invoices.filter((record) => (!patientId || record.patientId === patientId) && !['Cancelled', 'Draft'].includes(record.status));
  const invoiceNumber = new Map(invoices.map((record) => [record.id, record.invoiceNumber || '']));
  const patientPayments = payments.filter((record) => (!patientId || record.patientId === patientId) && record.status !== 'Voided' && record.status !== 'Cancelled');
  const paymentById = new Map(payments.map((record) => [record.id, record]));
  const liveIds = new Set(patientPayments.map((record) => record.id));
  const patientAdjustments = adjustments.filter((record) => (!patientId || record.patientId === patientId) && (!record.paymentId || liveIds.has(record.paymentId)));
  const dateOf = (record) => record.date || String(record.createdAt || '').slice(0, 10);
  const entries = [
    ...patientInvoices.map((record) => ({ date: record.date, createdAt: record.createdAt || '', rank: 1, id: record.id, type: 'Invoice', reference: record.invoiceNumber || record.id, debitCents: totalCentsOf(record), creditCents: 0, note: `${record.items?.length || 0} item(s)` })),
    ...patientPayments.map((record) => ({ date: record.date, createdAt: record.createdAt || '', rank: 2, id: record.id, type: 'Payment', reference: record.receiptNumber || record.id, debitCents: 0, creditCents: amountCentsOf(record), note: [record.method || 'Payment', invoiceNumber.get(record.invoiceId)].filter(Boolean).join(' · ') })),
    ...patientAdjustments.filter((record) => record.type === 'Refund').map((record) => ({ date: dateOf(record), createdAt: record.createdAt || '', rank: 3, id: record.id, type: 'Refund', reference: `Refund · ${paymentById.get(record.paymentId)?.receiptNumber || 'payment'}`, debitCents: amountCentsOf(record), creditCents: 0, note: record.reason || 'Refund' })),
    ...patientAdjustments.filter((record) => record.type === 'Adjustment').map((record) => ({ date: dateOf(record), createdAt: record.createdAt || '', rank: 4, id: record.id, type: 'Adjustment', reference: `Adjustment · ${invoiceNumber.get(record.invoiceId) || 'balance'}`, debitCents: 0, creditCents: amountCentsOf(record), note: record.reason || 'Balance adjustment' }))
  ];
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  entries.sort((a, b) => cmp(a.date || '', b.date || '') || cmp(a.createdAt, b.createdAt) || a.rank - b.rank || cmp(a.reference, b.reference) || cmp(a.id, b.id));
  let runningCents = 0;
  return entries.map(({ rank, createdAt, id, ...entry }) => {
    runningCents += entry.debitCents - entry.creditCents;
    return { ...entry, recordId: id, balanceCents: runningCents, debit: centsToMoney(entry.debitCents), credit: centsToMoney(entry.creditCents), balance: centsToMoney(runningCents) };
  });
}

export function analyticsSnapshot(state, period = 'month', now = new Date(), customFrom = '', customTo = '') {
  const bounds = periodBounds(period, now, customFrom, customTo);
  const activeRecords = (key) => (Array.isArray(state?.[key]) ? state[key] : []).filter((record) => !record.archived && inDateRange(record.date || record.registrationDate, bounds));
  const appointments = activeRecords('appointments');
  const payments = activeRecords('payments');
  const invoices = activeRecords('invoices');
  const expenses = activeRecords('expenses');
  const visits = activeRecords('visits');
  const patients = activeRecords('patients');
  const revenueCents = payments.reduce((sum, record) => sum + Math.max(0, moneyToCents(record.amount) - moneyToCents(record.refundedAmount || 0)), 0);
  const expenseCents = expenses.reduce((sum, record) => sum + Math.max(0, moneyToCents(record.amount)), 0);
  const billedCents = invoices.reduce((sum, record) => sum + Math.max(0, moneyToCents(record.total)), 0);
  const completed = appointments.filter((record) => record.status === 'Completed').length;
  const noShows = appointments.filter((record) => record.status === 'No Show').length;
  const byMethod = Object.entries(payments.reduce((result, record) => { const key = record.method || 'Other'; result[key] = (result[key] || 0) + Math.max(0, moneyToCents(record.amount)); return result; }, {})).map(([label, cents]) => ({ label, value: centsToMoney(cents) })).sort((a, b) => b.value - a.value);
  return {
    bounds,
    counts: { patients: patients.length, visits: visits.length, appointments: appointments.length, completed, noShows },
    revenue: centsToMoney(revenueCents),
    billed: centsToMoney(billedCents),
    expenses: centsToMoney(expenseCents),
    net: centsToMoney(revenueCents - expenseCents),
    completionRate: appointments.length ? Math.round((completed / appointments.length) * 100) : 0,
    noShowRate: appointments.length ? Math.round((noShows / appointments.length) * 100) : 0,
    byMethod
  };
}

export function buildTimelineEvents(state, patientId) {
  const list = [];
  const add = (collection, type, icon, title, text, record) => {
    if (record?.patientId === patientId && record.date) list.push({ id: `${type}:${record.id}`, type, icon, date: record.date, title, text, recordId: record.id });
  };
  (state.appointments || []).forEach((record) => add('appointments', 'Appointment', 'calendar', `${record.status || 'Scheduled'} appointment`, record.reason || 'Appointment', record));
  (state.visits || []).forEach((record) => add('visits', 'Visit', 'activity', record.reason || 'Clinical visit', record.diagnosis || record.treatmentPerformed || 'Clinical notes recorded', record));
  (state.prescriptions || []).forEach((record) => add('prescriptions', 'Prescription', 'file', 'Prescription issued', `${record.medications?.length || 0} medication item(s)`, record));
  (state.invoices || []).forEach((record) => add('invoices', 'Invoice', 'receipt', `Invoice ${record.invoiceNumber || ''}`.trim(), `Total ${record.total ?? 0}`, record));
  (state.payments || []).forEach((record) => add('payments', 'Payment', 'credit', 'Payment recorded', `${record.amount ?? 0} · ${record.method || 'Payment'}`, record));
  (state.referrals || []).forEach((record) => add('referrals', 'Referral', 'flag', 'Referral recorded', record.referralTo || record.specialty || 'Referral', record));
  (state.attachments || []).forEach((record) => add('attachments', 'Attachment', 'file', 'Attachment added', record.name || 'Clinical file', record));
  (state.followUpTasks || []).forEach((record) => add('follow-up', 'Follow-up', 'clock', 'Follow-up task', record.title || record.note || 'Follow-up', record));
  return list.sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`));
}

export function validatePatientInput(patient = {}) {
  const errors = [];
  if (!String(patient.fullName || '').trim()) errors.push('Full name is required.');
  if (!String(patient.phone || '').trim()) errors.push('Phone number is required.');
  if (patient.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(patient.email).trim())) errors.push('Enter a valid email address.');
  if (patient.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth)) errors.push('Date of birth must be a valid date.');
  return { valid: errors.length === 0, errors };
}

export function validateTreatmentPlanInput(plan = {}) {
  const errors = [];
  if (!String(plan.patientId || '').trim()) errors.push('A patient is required.');
  if (!String(plan.title || '').trim()) errors.push('A plan title is required.');
  if (plan.estimatedTotal !== undefined && toNumber(plan.estimatedTotal) < 0) errors.push('Estimated total cannot be negative.');
  if (plan.reviewDate && plan.startDate && plan.reviewDate < plan.startDate) errors.push('Review date cannot be before the start date.');
  return { valid: errors.length === 0, errors };
}

export function normaliseTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(values.map((tag) => String(tag).trim().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 20);
}

export function deriveOperationalNotifications(state, today = new Date().toISOString().slice(0, 10)) {
  const notifications = [];
  const push = (id, type, title, message, page, recordId = '') => notifications.push({ id, type, title, message, page, recordId, date: today, read: false });
  (state.appointments || []).filter((record) => !record.archived && record.date === today && ['Checked In', 'Waiting'].includes(record.status)).forEach((record) => push(`wait:${record.id}`, 'queue', 'Queue attention', `${record.patientName || record.patientId || 'Patient'} is waiting.`, 'queue', record.id));
  (state.inventory || []).filter((record) => !record.archived && Number(record.currentStock) <= Number(record.minimumStock ?? state.settings?.lowStockThreshold ?? 0)).forEach((record) => push(`stock:${record.id}`, 'inventory', 'Low stock', `${record.name || 'Item'} needs review.`, 'inventory', record.id));
  (state.inventory || []).filter((record) => !record.archived && record.expiryDate && record.expiryDate <= today).forEach((record) => push(`expiry:${record.id}`, 'inventory', 'Expiry review', `${record.name || 'Item'} has reached its expiry date.`, 'inventory', record.id));
  (state.visits || []).filter((record) => !record.archived && record.followUpDate && record.followUpDate <= today).forEach((record) => push(`followup:${record.id}`, 'clinical', 'Follow-up due', 'A clinical follow-up is due.', 'clinical', record.id));
  return notifications;
}
