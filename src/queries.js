/**
 * Dentiva Pro v2.0.0 — query registry (the read side of the domain).
 * Executes in the Electron main process against SqlRepo. Every query requires
 * an authenticated context and enforces its own permission; list queries are
 * paginated, and "complete" reads (statements, exports) page through all rows.
 * Money leaves this layer in integer cents; the renderer formats.
 */

import { APP_VERSION } from './migrate-state.js';
import { CURRENT_SCHEMA_VERSION, localDateInTimeZone, addDaysIso } from './core.js';
import { statementEntries, periodBounds } from './domain.js';
import { normalizeNotificationRules } from './notifications.js';

const DAY = 86400000;
const iso = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const isoDate = (value) => iso(value).slice(0, 10);
const clampPage = (value, fallback = 1) => Math.max(1, Number(value) || fallback);
const clampPageSize = (value, fallback = 25) => Math.min(500, Math.max(1, Number(value) || fallback));
const num = (value) => Number(value || 0);

/* ── range resolution (clinic-local calendar) ── */
export function resolveRange(rangeKey, from, to, now = new Date(), timeZone = '') {
  const todayStr = now instanceof Date ? localDateInTimeZone(timeZone, now) : String(now).slice(0, 10);
  const endStr = rangeKey === 'custom' && to ? String(to).slice(0, 10) : todayStr;
  const end = new Date(`${endStr}T00:00:00Z`);
  let start = null;
  if (rangeKey === 'day') start = end;
  if (rangeKey === '7d') start = new Date(end.getTime() - 6 * DAY);
  if (rangeKey === 'month') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (rangeKey === 'quarter') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  if (rangeKey === '6m') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  if (rangeKey === 'year') start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  if (rangeKey === 'custom' && from) start = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  const fromStr = start ? isoDate(start) : null;
  return { from: fromStr, to: endStr, invalid: rangeKey === 'custom' && (!fromStr || endStr < fromStr) };
}

export const COLLECTION_PERMISSION = {
  patients: 'patients.view', visits: 'patients.view', dentalRecords: 'patients.view', prescriptions: 'prescriptions.view',
  treatmentPlans: 'patients.view', attachments: 'patients.view', followUpTasks: 'patients.view',
  appointments: 'appointments.view', invoices: 'billing.view', payments: 'billing.view', paymentAdjustments: 'billing.view',
  expenses: 'accounting.view', inventory: 'inventory.view', stockMovements: 'inventory.view', suppliers: 'inventory.view',
  staff: ['staff.view', 'settings.view'], referrals: 'patients.view', users: 'settings.view', notifications: null,
  savedFilters: null, medicationCatalog: 'patients.view', rooms: 'appointments.view', notificationRules: 'settings.view',
  savedReports: 'reports.view', audit: 'audit.view', treatments: 'settings.view',
};

// null = any authenticated user (the query itself scopes what it returns).
export const QUERY_PERMISSION = {
  bootstrap: null, list: null, settings: null, users: 'settings.view', workspace: 'diagnostics.view', directory: null, record: null,
  patientSearch: 'patients.view', patientBrief: 'patients.view',
  patientAggregate: 'patients.view', patientStatement: 'billing.view', patientDuplicates: 'patients.view',
  patientLedgerQuery: 'billing.view', patientFinancialSummary: 'billing.view', patientLedgerRollups: 'billing.view', visitBilling: 'billing.view',
  dentalHistory: 'patients.view', invoiceDetail: 'billing.view', receiptDetail: ['payments.view', 'billing.view'], appointmentDay: 'appointments.view',
  appointmentsBetween: 'appointments.view', dashboard: null, analytics: 'reports.view',
  report: 'reports.view', accountingSummary: 'accounting.view', inventoryAnalytics: 'inventory.view',
  globalSearch: null, notifications: null, auditList: 'audit.view',
};

/** Queries that are background polling — they never count as user activity. */
export const BACKGROUND_QUERIES = new Set(['notifications']);

export function authorizeQuery(name, permissions, authenticated = true) {
  const required = QUERY_PERMISSION[name];
  if (required === undefined) return { ok: false, error: 'Unknown query', code: 'query-unknown' };
  if (!authenticated) return { ok: false, error: 'Sign in to continue.', code: 'auth-required' };
  if (required === null) return { ok: true };
  const list = Array.isArray(required) ? required : [required];
  if (!list.some((permission) => (permissions || []).includes(permission))) {
    return { ok: false, error: 'You do not have permission to view this data.', code: 'permission-denied' };
  }
  return { ok: true };
}

/* ── the registry ── */
export const QUERIES = {
  /* Everything the shell needs for a first paint, in one round trip. */
  async bootstrap(repo, params = {}, ctx) {
    const settings = await repo.getSettings();
    const session = ctx ? { userId: ctx.userId, userName: ctx.userName, role: ctx.role, permissions: ctx.permissions } : null;
    const counts = await repo.counts ? await repo.counts() : {};
    const out = {
      appVersion: APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings,
      session,
      counts,
      dashboardLayout: (await repo.getMeta('dashboardLayout')) || { widgets: [], hidden: [] },
      favorites: (await repo.getMeta('favorites')) || [],
      recent: (await repo.getMeta('recent')) || [],
      savedFilters: session ? await repo.listCollection('savedFilters', { page: 1, pageSize: 100 }) : { rows: [], total: 0 },
      notifications: session ? await QUERIES.notifications(repo, {}, ctx) : { items: [], unread: 0 },
      firstRun: ctx ? Boolean(ctx.firstRun) : true,
    };
    return out;
  },

  async settings(repo) {
    const settings = await repo.getSettings();
    return { settings, appVersion: APP_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION };
  },

  async users(repo) {
    const rows = await repo.usersList();
    return { users: rows, activeAdmins: await repo.activeAdminCount() };
  },

  /* Generic paginated list. */
  async list(repo, params = {}, ctx) {
    const collection = String(params.collection || '');
    if (!Object.prototype.hasOwnProperty.call(COLLECTION_PERMISSION, collection)) {
      return { rows: [], total: 0, page: 1, pageSize: clampPageSize(params.pageSize), collection, ok: false, error: 'Unknown collection', code: 'collection-unknown' };
    }
    const required = COLLECTION_PERMISSION[collection];
    const held = (ctx && ctx.permissions) || [];
    if (required && !(Array.isArray(required) ? required : [required]).some((entry) => held.includes(entry))) {
      return { rows: [], total: 0, page: 1, pageSize: clampPageSize(params.pageSize), collection, ok: false, error: 'You do not have permission to view this data.', code: 'permission-denied' };
    }
    return repo.listCollection(collection, {
      page: clampPage(params.page),
      pageSize: clampPageSize(params.pageSize),
      query: params.query ? String(params.query) : '',
      sort: params.sort || '',
      filters: params.filters || {},
    });
  },

  async auditList(repo, params = {}) {
    return repo.listCollection('audit', {
      page: clampPage(params.page), pageSize: clampPageSize(params.pageSize, 50),
      query: params.query || '', sort: '', filters: { from: params.from || '', to: params.to || '', entity: params.entity || '', entityId: params.entityId || '', userId: params.userId || '' },
    });
  },

  /* Patient 360 — bounded per section, timeline paginated. */
  async patientAggregate(repo, params = {}, ctx = null) {
    const patientId = String(params.patientId || '');
    const patient = await repo.get('patients', patientId);
    if (!patient) return { ok: false, error: 'Patient not found' };
    const permissions = (ctx && ctx.permissions) || [];
    const canBilling = permissions.includes('billing.view');
    const timelinePage = clampPage(params.timelinePage);
    const timelineSize = clampPageSize(params.timelineSize, 20);
    const [timeline, statement, counts, plans, dental, duplicates] = await Promise.all([
      QUERIES.patientTimeline(repo, { patientId, page: timelinePage, pageSize: timelineSize, includeFinancial: canBilling }),
      canBilling ? QUERIES.patientStatement(repo, { patientId, page: 1, pageSize: 50 }) : Promise.resolve(null),
      repo.patientRecordCounts ? repo.patientRecordCounts(patientId) : Promise.resolve({}),
      repo.listCollection('treatmentPlans', { page: 1, pageSize: 5, filters: { patientId, status: 'Active' } }),
      repo.listCollection('dentalRecords', { page: 1, pageSize: 100, filters: { patientId, currentOnly: true } }),
      repo.findPatientDuplicates ? repo.findPatientDuplicates(patient) : Promise.resolve([]),
    ]);
    return {
      ok: true, patient: canBilling ? patient : { ...patient, balanceCents: undefined }, timeline, statement, counts,
      activePlans: plans.rows,
      chart: dental.rows,
      duplicates: (duplicates || []).filter((candidate) => candidate.id !== patientId).slice(0, 10),
      balanceCents: canBilling ? Number(patient.balanceCents || 0) : null,
      canViewFinancials: canBilling,
    };
  },

  /* Unified timeline (v1.4.0): visits, appointments, invoices, payments,
   * prescriptions, plans, referrals, attachments, follow-ups — merged,
   * newest first, paginated. */
  async patientTimeline(repo, params = {}) {
    const patientId = String(params.patientId || '');
    const page = clampPage(params.page);
    const size = clampPageSize(params.pageSize, 20);
    const perType = page * size + 10; // bounded fetch window per collection
    const financial = params.includeFinancial !== false;
    const none = Promise.resolve({ rows: [] });
    const sources = await Promise.all([
      repo.visitsByPatient(patientId, perType),
      repo.appointmentsByPatient(patientId, perType),
      financial ? repo.listCollection('invoices', { page: 1, pageSize: perType, filters: { patientId } }) : none,
      financial ? repo.listCollection('payments', { page: 1, pageSize: perType, filters: { patientId } }) : none,
      repo.listCollection('prescriptions', { page: 1, pageSize: perType, filters: { patientId } }),
      repo.listCollection('treatmentPlans', { page: 1, pageSize: perType, filters: { patientId } }),
      repo.listCollection('referrals', { page: 1, pageSize: perType, filters: { patientId } }),
      repo.listCollection('attachments', { page: 1, pageSize: perType, filters: { patientId } }),
      repo.listCollection('followUpTasks', { page: 1, pageSize: perType, filters: { patientId } }),
    ]);
    const events = [];
    const push = (type, date, record, summary) => { if (date) events.push({ type, date, id: record.id, summary, record }); };
    for (const visit of sources[0]) push('visit', visit.date, visit, `${visit.reason || 'Visit'}${visit.diagnosis ? ` · ${visit.diagnosis}` : ''}`);
    for (const appointment of sources[1]) push('appointment', appointment.date, appointment, `${appointment.reason || 'Appointment'} · ${appointment.time || ''} · ${appointment.status}`);
    for (const invoice of sources[2].rows) push('invoice', invoice.date, invoice, `${invoice.invoiceNumber} · ${invoice.status}`);
    for (const payment of sources[3].rows) push('payment', payment.date, payment, `${payment.method} payment`);
    for (const prescription of sources[4].rows) push('prescription', prescription.date, prescription, prescription.doctor ? `Prescribed by ${prescription.doctor}` : 'Prescription');
    for (const plan of sources[5].rows) push('plan', plan.startDate || (plan.createdAt || '').slice(0, 10), plan, `${plan.title || 'Treatment plan'} · ${plan.status}`);
    for (const referral of sources[6].rows) push('referral', referral.date, referral, `Referral to ${referral.referralTo || 'specialist'} · ${referral.status}`);
    for (const attachment of sources[7].rows) push('attachment', (attachment.createdAt || attachment.uploadedAt || '').slice(0, 10) || attachment.date, attachment, attachment.name || 'Attachment');
    for (const task of sources[8].rows) push('followup', task.dueDate || task.date, task, `${task.title || 'Follow-up'} · ${task.status}`);
    // Newest first; ties broken by creation time, type and id so paging is stable.
    const stamp = (event) => `${event.date}|${event.record?.createdAt || ''}|${event.type}|${event.id}`;
    events.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));
    const total = events.length;
    const rows = events.slice((page - 1) * size, page * size);
    return { rows, total, page, pageSize: size, complete: total <= perType };
  },

  /* Unified statement (v1.4.0): invoice debits, payment credits, refund and
   * adjustment debits — one ledger with running balance in cents. */
  async patientStatement(repo, params = {}) {
    const patientId = String(params.patientId || '');
    const page = clampPage(params.page);
    const size = clampPageSize(params.pageSize, 50);
    if (typeof repo.patientLedger === 'function') {
      return QUERIES.patientLedgerQuery(repo, params);
    }
    const [invoices, payments, adjustments] = await Promise.all([
      repo.listCollection('invoices', { page: 1, pageSize: 500, filters: { patientId } }),
      repo.listCollection('payments', { page: 1, pageSize: 500, filters: { patientId } }),
      repo.listCollection('paymentAdjustments', { page: 1, pageSize: 500, filters: { patientId } }),
    ]);
    const entries = statementEntries({ invoices: invoices.rows, payments: payments.rows, adjustments: adjustments.rows }, patientId);
    const total = entries.length;
    const rows = entries.slice((page - 1) * size, page * size);
    const patient = await repo.get('patients', patientId);
    return {
      rows, total, page, pageSize: size,
      balanceCents: patient ? num(patient.balanceCents) : entries.length ? entries[entries.length - 1].balanceCents : 0,
      billedCents: invoices.rows.filter((invoice) => invoice.status !== 'Cancelled').reduce((sum, invoice) => sum + num(invoice.totalCents), 0),
      paidCents: payments.rows.reduce((sum, payment) => sum + num(payment.amountCents), 0),
      refundedCents: payments.rows.reduce((sum, payment) => sum + num(payment.refundedCents), 0),
      adjustedCents: adjustments.rows.filter((adjustment) => adjustment.type === 'Adjustment').reduce((sum, adjustment) => sum + num(adjustment.amountCents), 0),
    };
  },

  /** SQL-native ledger (v1.6.0): server-side pagination + lifetime totals. */
  async patientLedgerQuery(repo, params = {}) {
    const patientId = String(params.patientId || '');
    const ledger = repo.patientLedger(patientId, {
      page: clampPage(params.page), pageSize: clampPageSize(params.pageSize, 50),
      from: String(params.from || ''), to: String(params.to || ''),
    });
    if (!ledger.ok) return ledger;
    const summary = typeof repo.patientFinancialSummary === 'function'
      ? repo.patientFinancialSummary(patientId)
      : {};
    return {
      ok: true, source: 'sql',
      rows: ledger.rows, total: ledger.total, page: ledger.page, pageSize: ledger.pageSize,
      openingBalanceCents: ledger.openingBalanceCents,
      closingBalanceCents: ledger.closingBalanceCents,
      periodDebitCents: ledger.periodDebitCents, periodCreditCents: ledger.periodCreditCents,
      periodInvoicedCents: ledger.periodInvoicedCents, periodPaidCents: ledger.periodPaidCents,
      periodRefundedCents: ledger.periodRefundedCents, periodAdjustedCents: ledger.periodAdjustedCents,
      balanceCents: summary.balanceCents ?? ledger.closingBalanceCents,
      billedCents: summary.billedCents, paidCents: summary.paidCents,
      refundedCents: summary.refundedCents, adjustedCents: summary.adjustedCents,
    };
  },

  async patientFinancialSummary(repo, params = {}) {
    const patientId = String(params.patientId || '');
    if (typeof repo.patientFinancialSummary !== 'function') {
      // Browser/demo adapters have no SQL engine: a zero summary is the
      // honest answer for a patient with no ledger there (v1.6.1 D6). The
      // desktop app always ships the on-disk engine and never hits this.
      return { ok: true, source: 'fallback', billedCents: 0, paidCents: 0, netPaidCents: 0, dueCents: 0, refundedCents: 0, adjustedCents: 0, discountCents: 0 };
    }
    return repo.patientFinancialSummary(patientId);
  },

  async patientLedgerRollups(repo, params = {}) {
    const patientId = String(params.patientId || '');
    if (typeof repo.patientLedgerRollups !== 'function') return { monthly: [], yearly: [] };
    return repo.patientLedgerRollups(patientId, 12, 5);
  },

  /** Per-visit billing rollup for the given visit ids (Patient 360). */
  async visitBilling(repo, params = {}) {
    const ids = Array.isArray(params.visitIds) ? params.visitIds : [];
    if (typeof repo.visitBillingFor !== 'function') return { byVisit: {} };
    return { ok: true, byVisit: repo.visitBillingFor(ids) };
  },

  async patientDuplicates(repo, params = {}) {
    const patient = await repo.get('patients', String(params.patientId || ''));
    if (!patient) return { candidates: [] };
    return { candidates: (await repo.findPatientDuplicates(patient)).slice(0, 25) };
  },

  async dentalHistory(repo, params = {}) {
    const rows = await repo.dentalHistory
      ? repo.dentalHistory(String(params.patientId || ''), params.toothNumber || '')
      : (await repo.listCollection('dentalRecords', { page: 1, pageSize: 100, filters: { patientId: String(params.patientId || ''), toothNumber: params.toothNumber || '' } })).rows;
    return { rows };
  },

  async invoiceDetail(repo, params = {}) {
    const id = String(params.id || '');
    const invoice = await repo.get('invoices', id);
    if (!invoice) return { ok: false, error: 'Invoice not found' };
    const [payments, adjustments, patient] = await Promise.all([
      repo.paymentsByInvoice(id),
      repo.adjustmentsByInvoice(id),
      invoice.patientId ? repo.get('patients', invoice.patientId) : Promise.resolve(null),
    ]);
    const paidCents = payments.reduce((sum, payment) => sum + num(payment.amountCents), 0);
    const refundedCents = payments.reduce((sum, payment) => sum + num(payment.refundedCents), 0);
    const netPaidCents = Math.max(0, paidCents - refundedCents);
    const adjustedCents = adjustments.filter((entry) => entry.type === 'Adjustment').reduce((sum, entry) => sum + num(entry.amountCents), 0);
    const dueCents = Math.max(0, num(invoice.totalCents) - netPaidCents - adjustedCents);
    return { ok: true, invoice, payments, adjustments, patient, paidCents, netPaidCents, adjustedCents, refundedCents, dueCents };
  },

  async appointmentDay(repo, params = {}) {
    const date = String(params.date || localDateInTimeZone((await repo.getSettings()).timezone));
    const appointments = await repo.appointmentsOnDate(date);
    return { date, appointments };
  },

  async appointmentsBetween(repo, params = {}) {
    const rows = await repo.appointmentsInRange(String(params.from || ''), String(params.to || ''));
    return { rows };
  },

  async dashboard(repo, params = {}, ctx) {
    const settings = await repo.getSettings();
    const today = localDateInTimeZone(settings.timezone);
    const range = resolveRange(params.range || 'month', params.from, params.to, new Date(), settings.timezone);
    const permissions = (ctx && ctx.permissions) || [];
    const can = (permission) => permissions.includes(permission);
    const [appointments, tasks, aggregates, counts] = await Promise.all([
      can('appointments.view') ? repo.appointmentsOnDate(today) : Promise.resolve([]),
      can('patients.view') ? repo.listCollection('followUpTasks', { page: 1, pageSize: 10, filters: { open: true, dueBefore: today } }) : Promise.resolve({ rows: [], total: 0 }),
      can('reports.view') ? repo.sqlAggregates(range.from, range.to) : Promise.resolve(null),
      repo.counts(),
    ]);
    const lowStock = can('inventory.view')
      ? await repo.listCollection('inventory', { page: 1, pageSize: 10, filters: { lowStock: true, lowStockThreshold: settings.lowStockThreshold } })
      : { rows: [], total: 0 };
    return {
      today, range, counts,
      appointmentsToday: appointments,
      dueTasks: tasks.rows,
      dueTasksTotal: tasks.total || 0,
      lowStock: lowStock.rows,
      lowStockTotal: lowStock.total,
      aggregates,
      canViewFinancials: can('reports.view'),
    };
  },

  /* Analytics — SQL-side aggregates when available (desktop), JS otherwise. */
  async analytics(repo, params = {}, ctx) {
    const settings = await repo.getSettings();
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), settings.timezone);
    if (range.invalid) return { ok: false, error: 'Invalid custom range' };
    const stats = await repo.reportStats('analytics', range.from, range.to);
    const topServices = await repo.reportStats('services', range.from, range.to);
    const topDentists = await repo.reportStats('dentists', range.from, range.to);
    return { ok: true, range, ...stats, topServices: topServices.rows, topDentists: topDentists.rows };
  },

  /* Reports: KPI stats + paginated row data. Rows come from listCollection so
   * even 'all records' stays paginated. */
  async report(repo, params = {}) {
    const type = ['revenue', 'patients', 'visits', 'appointments', 'outstanding', 'inventory', 'expenses'].includes(params.type) ? params.type : 'revenue';
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), (await repo.getSettings()).timezone);
    if (range.invalid) return { ok: false, error: 'Invalid custom range' };
    const page = clampPage(params.page);
    const size = clampPageSize(params.pageSize, 25);
    const kpis = await repo.reportStats(type, range.from, range.to);
    let rows = { rows: [], total: 0, page, pageSize: size };
    const dateFilters = { from: range.from || '', to: range.to || '' };
    if (type === 'revenue') rows = await repo.listCollection('payments', { page, pageSize: size, filters: dateFilters, sort: 'date-desc' });
    if (type === 'patients') rows = await repo.listCollection('patients', { page, pageSize: size, filters: { registeredFrom: range.from || '', registeredTo: range.to || '' }, sort: 'recent' });
    if (type === 'visits') rows = await repo.listCollection('visits', { page, pageSize: size, filters: dateFilters, sort: 'date-desc' });
    if (type === 'appointments') rows = await repo.listCollection('appointments', { page, pageSize: size, filters: dateFilters, sort: 'date-desc' });
    if (type === 'outstanding') rows = await repo.listCollection('invoices', { page, pageSize: size, filters: { ...dateFilters, outstanding: true }, sort: 'date-desc' });
    if (type === 'inventory') rows = await repo.listCollection('inventory', { page, pageSize: size, filters: {}, sort: 'name' });
    if (type === 'expenses') rows = await repo.listCollection('expenses', { page, pageSize: size, filters: dateFilters, sort: 'date-desc' });
    return { ok: true, type, range, kpis, rows };
  },

  async accountingSummary(repo, params = {}) {
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), (await repo.getSettings()).timezone);
    if (range.invalid) return { ok: false, error: 'Invalid custom range' };
    const [summary, aging, expenseCategories] = await Promise.all([
      repo.reportStats('accounting', range.from, range.to),
      repo.reportStats('aging', '', ''),
      repo.reportStats('expenseCategories', range.from, range.to),
    ]);
    return { ok: true, range, ...summary, aging: aging.rows, expenseCategories: expenseCategories.rows };
  },

  async inventoryAnalytics(repo) {
    const settings = await repo.getSettings();
    const [lowStock, expiring, movements, value] = await Promise.all([
      repo.listCollection('inventory', { page: 1, pageSize: 25, filters: { lowStock: true, lowStockThreshold: settings.lowStockThreshold } }),
      repo.listCollection('inventory', { page: 1, pageSize: 25, filters: { expiringBefore: addDaysIso(localDateInTimeZone(settings.timezone), 60) } }),
      repo.reportStats('movements', '', ''),
      repo.reportStats('inventoryValue', '', ''),
    ]);
    return { lowStock: lowStock.rows, lowStockTotal: lowStock.total, expiring: expiring.rows, expiringTotal: expiring.total, topMovements: movements.rows, ...value };
  },

  /* Global search — capped per collection. */
  /* Single-record fetch for detail dialogs; enforces the collection's own
   * viewing permission so one generic channel cannot bypass RBAC. */
  async record(repo, params = {}, ctx = null) {
    const collection = String(params.collection || '');
    const id = String(params.id || '');
    if (!id) return { ok: false, error: 'No record chosen.' };
    const required = COLLECTION_PERMISSION[collection];
    if (required === undefined) return { ok: false, error: 'Unknown collection.' };
    if (required) {
      const permissions = (ctx && ctx.permissions) || [];
      const candidates = Array.isArray(required) ? required : [required];
      if (!candidates.some((entry) => permissions.includes(entry))) {
        return { ok: false, error: 'You do not have permission to view this data.', code: 'permission-denied' };
      }
    }
    const found = repo.get(collection, id);
    if (!found) return { ok: false, error: 'That record no longer exists.', code: 'not-found' };
    return { ok: true, record: found, collection };
  },

  /* Lookup directory for form options: staff, treatment catalogue and the
   * medication catalogue (bounded clinic configuration lists). Patients are
   * NEVER preloaded — pickers search the server (patientSearch), so a clinic
   * with 100k patients selects any of them. Each list pages to completion. */
  async directory(repo, params = {}, ctx = null) {
    const all = async (collection, sort) => {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const batch = await repo.listCollection(collection, { page, pageSize: 500, sort });
        rows.push(...(batch.rows || []));
        if (!batch.rows || batch.rows.length < 500 || rows.length >= (batch.total || 0)) break;
      }
      return rows;
    };
    const [staff, treatments, medications] = await Promise.all([all('staff', 'name'), all('treatments', 'name'), all('medicationCatalog', 'name')]);
    return {
      staff: staff.map((member) => ({ id: member.id, name: member.name, role: member.role, active: member.active !== false })),
      treatments: treatments.map((item) => ({ id: item.id, name: item.name, code: item.code, category: item.category, defaultPrice: item.defaultPrice, defaultPriceCents: item.defaultPriceCents, duration: item.duration, toothRequired: Boolean(item.toothRequired), active: item.active !== false })),
      medicationCatalog: medications.map((item) => ({ id: item.id, name: item.name, strength: item.strength, dosage: item.dosage, frequency: item.frequency, duration: item.duration, route: item.route, active: item.active !== false }))
    };
  },

  /* Server-side patient picker search (name, code, phone, email, address). */
  async patientSearch(repo, params = {}) {
    const query = String(params.query || '').trim();
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
    const result = await repo.listCollection('patients', {
      page: 1, pageSize: limit, query, sort: query ? 'name' : 'recent',
      filters: { status: params.includeArchived ? 'all' : 'active' }
    });
    return {
      query,
      total: result.total || 0,
      rows: (result.rows || []).map(patientBrief)
    };
  },

  async patientBrief(repo, params = {}) {
    const patient = await repo.get('patients', String(params.id || ''));
    if (!patient) return { ok: false, error: 'That patient no longer exists.', code: 'not-found' };
    return { ok: true, patient: patientBrief(patient) };
  },

  /* Point-in-time receipt data: who received it and the balance right after it. */
  async receiptDetail(repo, params = {}) {
    const payment = await repo.get('payments', String(params.id || ''));
    if (!payment) return { ok: false, error: 'That payment no longer exists.', code: 'not-found' };
    const patient = payment.patientId ? await repo.get('patients', payment.patientId) : null;
    const invoice = payment.invoiceId ? await repo.get('invoices', payment.invoiceId) : null;
    let receivedBy = payment.receivedBy || '';
    if (!receivedBy && repo.ws) {
      const audit = repo.ws.queryOne("SELECT user_name FROM audit WHERE entity_id = ? AND action = 'Payment recorded' ORDER BY seq ASC LIMIT 1", [payment.id]);
      receivedBy = audit?.user_name || '';
    }
    let dueAfterCents = Number.isFinite(Number(payment.invoiceDueAfterCents)) && payment.invoiceDueAfterCents !== null ? Number(payment.invoiceDueAfterCents) : null;
    if (invoice && dueAfterCents === null) {
      // Historical payments: reconstruct the invoice due immediately after this
      // payment (earlier payments and adjustments in ledger order).
      const payments = (await repo.paymentsByInvoice(invoice.id)).filter((row) => !['Voided', 'Cancelled'].includes(row.status))
        .sort((a, b) => `${a.date}|${a.createdAt || ''}|${a.id}`.localeCompare(`${b.date}|${b.createdAt || ''}|${b.id}`));
      const adjustments = (await repo.adjustmentsByInvoice(invoice.id)).filter((row) => row.type === 'Adjustment');
      const key = `${payment.date}|${payment.createdAt || ''}|${payment.id}`;
      const paidBefore = payments.filter((row) => `${row.date}|${row.createdAt || ''}|${row.id}` <= key).reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
      const adjustedBefore = adjustments.filter((row) => String(row.date || '') <= String(payment.date || '')).reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
      dueAfterCents = Math.max(0, Number(invoice.totalCents || 0) - paidBefore - adjustedBefore);
    }
    const refunds = repo.adjustmentsByPayment ? (await repo.adjustmentsByPayment(payment.id)).filter((row) => row.type === 'Refund') : [];
    return { ok: true, payment, patient: patient ? patientBrief(patient) : null, invoice, receivedBy, dueAfterCents, refunds, currentInvoiceDueCents: invoice ? Number(invoice.dueCents || 0) : null };
  },

  async globalSearch(repo, params = {}, ctx = null) {
    const query = String(params.query || '').trim();
    if (query.length < 2) return { query, results: {} };
    const limit = clampPageSize(params.limit, 8);
    const permissions = (ctx && ctx.permissions) || [];
    const results = {};
    // Each collection is searched only when the caller may view it.
    const collections = ['patients', 'appointments', 'invoices', 'payments', 'visits', 'prescriptions', 'inventory', 'staff'];
    for (const name of collections) {
      const required = COLLECTION_PERMISSION[name];
      if (required && !(Array.isArray(required) ? required : [required]).some((entry) => permissions.includes(entry))) continue;
      const found = await repo.listCollection(name, { page: 1, pageSize: limit, query, filters: name === 'patients' ? { status: 'all' } : {} });
      if (found.total) results[name] = found;
    }
    return { query, results };
  },

  async notifications(repo, params, ctx) {
    const settings = await repo.getSettings();
    const persisted = await repo.notificationsActive();
    const unread = persisted.filter((item) => !item.read && !item.dismissed).length;
    return { items: persisted, unread, rules: normalizeNotificationRules(settings.notificationRules) };
  },

  /* Workspace health (diagnostics page data). */
  async workspace(repo) {
    const storage = repo.storageInfo({ includeCounts: false });
    const integrity = repo.quickCheck ? repo.quickCheck() : repo.integrityCheck();
    const counts = repo.counts();
    const settings = repo.getSettings();
    return {
      appVersion: APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      storage, integrity, counts,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      autoLockMinutes: settings.autoLockMinutes,
    };
  },
};

function patientBrief(patient) {
  return {
    id: patient.id, fullName: patient.fullName, patientCode: patient.patientCode, phone: patient.phone || '',
    gender: patient.gender || '', dateOfBirth: patient.dateOfBirth || '', archived: Boolean(patient.archived),
    balanceCents: Number(patient.balanceCents || 0), allergies: patient.allergies || '', importantAlerts: patient.importantAlerts || ''
  };
}

export async function runQuery(repo, name, params, ctx) {
  const handler = QUERIES[name];
  if (!handler) return { ok: false, error: 'Unknown query', code: 'query-unknown' };
  const authenticated = Boolean(ctx && (ctx.userId || ctx.firstRun === true) && Array.isArray(ctx.permissions));
  const authorized = authorizeQuery(name, ctx ? ctx.permissions : null, authenticated);
  if (!authorized.ok) return authorized;
  try {
    const result = await handler(repo, params || {}, ctx || null);
    return result && result.ok === false ? result : { ok: true, ...(result && typeof result === 'object' ? result : { value: result }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'query-failed' };
  }
}

export { periodBounds };
