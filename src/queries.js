/**
 * Dentiva Pro v1.4.0 — shared query registry (read side of the API).
 * Runtime-agnostic: works against SqlRepo (Electron) and LocalRepo (browser).
 * Every query is paginated or bounded — no query ever hydrates a full
 * collection. Money leaves this layer in integer cents; the renderer formats.
 *
 * Query results are plain data. Presentation (tables, charts, i18n labels)
 * belongs to the renderer.
 */

import { APP_VERSION } from './migrate-state.js';
import { CURRENT_SCHEMA_VERSION, clinicDate, timeZoneOf, DEFAULT_TIMEZONE } from './core.js';
import { statementEntries, periodBounds } from './domain.js';
import { normalizeNotificationRules } from './notifications.js';

const DAY = 86400000;
const iso = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const isoDate = (value) => iso(value).slice(0, 10);
/* `today` always means the clinic's calendar day (settings.timezone). */
const todayFor = (repo, value = new Date()) => clinicDate(value, timeZoneOf(repo));
const clampPage = (value, fallback = 1) => Math.max(1, Number(value) || fallback);
const clampPageSize = (value, fallback = 25) => Math.min(500, Math.max(1, Number(value) || fallback));
const num = (value) => Number(value || 0);

/* ── range resolution (ports v1.3.0 dateRange) ── */
export function resolveRange(rangeKey, from, to, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  // Ranges are anchored on the clinic's day (settings.timezone), the same day
  // the renderer and the SQLite runtime use.
  const todayStr = clinicDate(now, timeZone || DEFAULT_TIMEZONE);
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
  patients: 'patients.view', visits: 'patients.view', dentalRecords: 'patients.view', prescriptions: 'patients.view',
  treatmentPlans: 'patients.view', attachments: 'patients.view', followUpTasks: 'patients.view',
  appointments: 'appointments.view', invoices: 'billing.view', payments: 'billing.view', paymentAdjustments: 'billing.view',
  expenses: 'accounting.view', inventory: 'inventory.view', stockMovements: 'inventory.view', suppliers: 'inventory.view',
  staff: 'settings.view', referrals: 'patients.view', users: 'settings.view', notifications: null,
  savedFilters: null, medicationCatalog: 'patients.view', rooms: 'appointments.view', notificationRules: 'settings.view',
  savedReports: 'reports.view', audit: 'audit.view', treatments: 'settings.view',
};

export const QUERY_PERMISSION = {
  bootstrap: null, list: null, settings: null, users: 'settings.view', workspace: null, directory: null, record: null,
  patientAggregate: 'patients.view', patientStatement: 'patients.view', patientDuplicates: 'patients.view',
  patientTimeline: 'patients.view',
  patientLedgerQuery: 'billing.view', patientFinancialSummary: 'billing.view', patientLedgerRollups: 'billing.view', visitBilling: 'patients.view',
  patientLookup: 'patients.view',
  dentalHistory: 'patients.view', invoiceDetail: 'billing.view', appointmentDay: 'appointments.view',
  appointmentsBetween: 'appointments.view', dashboard: null, analytics: 'reports.view',
  report: 'reports.view', accountingSummary: 'accounting.view', inventoryAnalytics: 'inventory.view',
  globalSearch: null, notifications: null, auditList: 'audit.view',
};

export function authorizeQuery(name, permissions) {
  const required = QUERY_PERMISSION[name];
  if (required === undefined) return { ok: false, error: 'Unknown query', code: 'query-unknown' };
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
    if (required && !((ctx && ctx.permissions) || []).includes(required)) {
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
  async patientAggregate(repo, params = {}) {
    const patientId = String(params.patientId || '');
    const patient = await repo.get('patients', patientId);
    if (!patient) return { ok: false, error: 'Patient not found' };
    const timelinePage = clampPage(params.timelinePage);
    const timelineSize = clampPageSize(params.timelineSize, 20);
    const [timeline, statement, counts, plans, dental, duplicates] = await Promise.all([
      QUERIES.patientTimeline(repo, { patientId, page: timelinePage, pageSize: timelineSize }),
      QUERIES.patientStatement(repo, { patientId, page: 1, pageSize: 50 }),
      repo.patientRecordCounts ? repo.patientRecordCounts(patientId) : Promise.resolve({}),
      repo.listCollection('treatmentPlans', { page: 1, pageSize: 5, filters: { patientId, status: 'Active' } }),
      repo.listCollection('dentalRecords', { page: 1, pageSize: 100, filters: { patientId, currentOnly: true } }),
      repo.findPatientDuplicates ? repo.findPatientDuplicates(patient) : Promise.resolve([]),
    ]);
    return {
      ok: true, patient, timeline, statement, counts,
      activePlans: plans.rows,
      chart: dental.rows,
      duplicates: (duplicates || []).filter((candidate) => candidate.id !== patientId).slice(0, 10),
      balanceCents: Number(patient.balanceCents || 0),
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
    const sources = await Promise.all([
      repo.visitsByPatient(patientId, perType),
      repo.appointmentsByPatient(patientId, perType),
      repo.listCollection('invoices', { page: 1, pageSize: perType, filters: { patientId } }),
      repo.listCollection('payments', { page: 1, pageSize: perType, filters: { patientId } }),
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
    for (const invoice of sources[2].rows) push('invoice', invoice.date, invoice, `${invoice.invoiceNumber} · ${invoice.paymentStatus}`);
    for (const payment of sources[3].rows) push('payment', payment.date, payment, `${payment.method} payment`);
    for (const prescription of sources[4].rows) push('prescription', prescription.date, prescription, prescription.doctor ? `Prescribed by ${prescription.doctor}` : 'Prescription');
    for (const plan of sources[5].rows) push('plan', plan.date, plan, `${plan.title || 'Treatment plan'} · ${plan.status}`);
    for (const referral of sources[6].rows) push('referral', referral.date, referral, `Referral to ${referral.referralTo || 'specialist'} · ${referral.status}`);
    for (const attachment of sources[7].rows) push('attachment', (attachment.uploadedAt || '').slice(0, 10) || attachment.date, attachment, attachment.name || 'Attachment');
    for (const task of sources[8].rows) push('followup', task.dueDate || task.date, task, `${task.title || 'Follow-up'} · ${task.status}`);
    events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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
      balanceCents: ledger.rows.length ? ledger.rows[ledger.rows.length - 1].balanceCents : (summary.dueCents || 0),
      billedCents: summary.billedCents, paidCents: summary.paidCents,
      refundedCents: summary.refundedCents, adjustedCents: summary.adjustedCents,
    };
  },

  async patientFinancialSummary(repo, params = {}) {
    const patientId = String(params.patientId || '');
    if (typeof repo.patientFinancialSummary !== 'function') {
      // Both shipping runtimes implement this accessor (LocalRepo and SqlRepo),
      // so this branch exists only for an adapter that has no ledger at all —
      // there a zero summary is the honest answer rather than an error.
      return { ok: true, source: 'no-ledger', billedCents: 0, paidCents: 0, netPaidCents: 0, dueCents: 0, refundedCents: 0, adjustedCents: 0, discountCents: 0 };
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
    const date = String(params.date || todayFor(repo));
    const appointments = await repo.appointmentsOnDate(date);
    return { date, appointments };
  },

  async appointmentsBetween(repo, params = {}) {
    const rows = await repo.appointmentsInRange(String(params.from || ''), String(params.to || ''));
    return { rows };
  },

  async dashboard(repo, params = {}, ctx) {
    const settings = await repo.getSettings();
    const today = todayFor(repo);
    const range = resolveRange(params.range || 'month', undefined, undefined, new Date(), timeZoneOf(repo));
    const permissions = (ctx && ctx.permissions) || [];
    const can = (permission) => permissions.includes(permission);
    const [appointments, tasks, aggregates, counts] = await Promise.all([
      repo.appointmentsOnDate(today),
      repo.listCollection('followUpTasks', { page: 1, pageSize: 10, filters: { status: 'Pending', dueBefore: today } }),
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
      lowStock: lowStock.rows,
      lowStockTotal: lowStock.total,
      aggregates,
      canViewFinancials: can('reports.view'),
    };
  },

  /* Analytics — SQL-side aggregates when available (desktop), JS otherwise. */
  async analytics(repo, params = {}, ctx) {
    const settings = await repo.getSettings();
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), timeZoneOf(repo));
    if (range.invalid) return { ok: false, error: 'Invalid custom range' };
    const stats = await repo.reportStats('analytics', range.from, range.to);
    const topServices = await repo.reportStats('services', range.from, range.to);
    const topDentists = await repo.reportStats('dentists', range.from, range.to);
    return { ok: true, range, settings, ...stats, topServices: topServices.rows, topDentists: topDentists.rows };
  },

  /* Reports: KPI stats + paginated row data. Rows come from listCollection so
   * even 'all records' stays paginated. */
  async report(repo, params = {}) {
    const type = ['revenue', 'patients', 'visits', 'appointments', 'outstanding', 'inventory', 'expenses'].includes(params.type) ? params.type : 'revenue';
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), timeZoneOf(repo));
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
    const range = resolveRange(params.rangeKey || 'month', params.from, params.to, new Date(), timeZoneOf(repo));
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
      repo.listCollection('inventory', { page: 1, pageSize: 25, filters: { expiringBefore: clinicDate(new Date(Date.now() + 60 * DAY), timeZoneOf(repo)) } }),
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

  /* Lightweight lookup directory for the renderer: display names and form
   * options without hydrating full records. Capped, indexed, permission-neutral
   * (names are already visible in every list the user may open). */
  async directory(repo) {
    const [patients, staff, treatments, medications] = await Promise.all([
      repo.listCollection('patients', { page: 1, pageSize: 2000, sort: 'name' }),
      repo.listCollection('staff', { page: 1, pageSize: 2000, sort: 'name' }),
      repo.listCollection('treatments', { page: 1, pageSize: 2000, sort: 'name' }),
      repo.listCollection('medicationCatalog', { page: 1, pageSize: 500, sort: 'name' })
    ]);
    return {
      patients: (patients.rows || []).map((patient) => ({ id: patient.id, fullName: patient.fullName, patientCode: patient.patientCode, phone: patient.phone })),
      staff: (staff.rows || []).map((member) => ({ id: member.id, name: member.name, role: member.role })),
      treatments: (treatments.rows || []).map((item) => ({ id: item.id, name: item.name, code: item.code, defaultPrice: item.defaultPrice, duration: item.duration, toothRequired: Boolean(item.toothRequired) })),
      medicationCatalog: (medications.rows || []).map((item) => ({ id: item.id, name: item.name, strength: item.strength, dosage: item.dosage, frequency: item.frequency, duration: item.duration, active: item.active }))
    };
  },

  /* Uncapped server-side patient lookup for the combobox picker (V2-08).
   * The picker used to be filled from a capped client directory, so in a
   * lifetime practice every patient past the cap was unselectable — and the
   * query the v2.0.0 picker calls had no implementation at all. This searches
   * the workspace itself: `total` is the true number of matches, page/pageSize
   * are honoured up to the same 500-row ceiling every other list uses, and
   * archived patients are returned (flagged) so historical documents can still
   * resolve the name on an old invoice. Works identically on both engines. */
  async patientLookup(repo, params = {}) {
    const query = String(params.query || '').trim();
    const page = clampPage(params.page);
    const size = clampPageSize(params.pageSize, 20);
    const result = await repo.listCollection('patients', {
      page, pageSize: size, query, sort: 'name', filters: { status: 'all' }
    });
    return {
      ok: true,
      rows: (result.rows || []).map((patient) => ({
        id: patient.id,
        fullName: patient.fullName || '',
        patientCode: patient.patientCode || '',
        phone: patient.phone || '',
        archived: Boolean(patient.archived),
        balanceCents: Number(patient.balanceCents || 0)
      })),
      total: result.total || 0,
      page,
      pageSize: size
    };
  },

  async globalSearch(repo, params = {}) {
    const query = String(params.query || '').trim();
    if (query.length < 2) return { query, results: {} };
    const limit = clampPageSize(params.limit, 8);
    // `count: false`: the palette renders the first few rows per group and never
    // shows a total, so paying for an exact COUNT per group (a second full scan
    // each) would double the cost of every keystroke search.
    const scoped = (collection) => repo.listCollection(collection, { page: 1, pageSize: limit, query, count: false });
    const results = {};
    // Only the groups the command palette actually renders are searched: the
    // palette has no inventory/staff sections, so querying them was pure
    // latency on a keystroke path.
    const groups = ['patients', 'appointments', 'invoices', 'payments', 'visits', 'prescriptions'];
    const found = await Promise.all(groups.map(async (name) => {
      try { return [name, await scoped(name)]; } catch { return [name, null]; }
    }));
    for (const [name, result] of found) if (result && result.rows.length) results[name] = result;
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
    const [storage, integrity, counts, settings] = await Promise.all([
      repo.storageInfo(), repo.integrityCheck(), repo.counts(), repo.getSettings(),
    ]);
    return {
      appVersion: APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      storage, integrity, counts,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      applicationLock: settings.applicationLock,
    };
  },
};

/* ---- patient display names on every query payload -----------------------
 * Lists, agendas, dashboards and search results all reference patients by id.
 * Resolving those ids from a client-side cache only works while the practice
 * is small (the directory snapshot is paged like every other list), so a
 * lifetime database would render "Unassigned patient" for most rows. Instead
 * every query payload is enriched here with the patient's display name/code
 * through one batched primary-key lookup — identical for both runtimes. */
function collectPatientIds(value, ids, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPatientIds(item, ids, depth + 1);
    return;
  }
  if (typeof value.patientId === 'string' && value.patientId && !value.patientName) ids.add(value.patientId);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectPatientIds(child, ids, depth + 1);
  }
}

function attachPatientNames(value, names, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) attachPatientNames(item, names, depth + 1);
    return;
  }
  if (typeof value.patientId === 'string' && names.has(value.patientId)) {
    const patient = names.get(value.patientId);
    if (!value.patientName) value.patientName = patient.fullName || '';
    if (!value.patientCode) value.patientCode = patient.patientCode || '';
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') attachPatientNames(child, names, depth + 1);
  }
}

function enrichPatientNames(repo, payload) {
  try {
    const ids = new Set();
    collectPatientIds(payload, ids);
    if (!ids.size) return payload;
    const names = new Map();
    for (const patient of repo.byIds('patients', [...ids]) || []) {
      if (patient && patient.id) names.set(patient.id, patient);
    }
    if (!names.size) return payload;
    attachPatientNames(payload, names);
  } catch { /* enrichment is best-effort; ids in the payload stay authoritative */ }
  return payload;
}

export async function runQuery(repo, name, params, ctx) {
  const handler = QUERIES[name];
  if (!handler) return { ok: false, error: 'Unknown query', code: 'query-unknown' };
  const authorized = authorizeQuery(name, ctx ? ctx.permissions : null);
  if (!authorized.ok) return authorized;
  try {
    const result = await handler(repo, params || {}, ctx || null);
    if (result && result.ok === false) return result;
    return enrichPatientNames(repo, { ok: true, ...(result && typeof result === 'object' ? result : { value: result }) });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'query-failed' };
  }
}

export { periodBounds };
