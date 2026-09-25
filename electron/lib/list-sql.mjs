// SQL-side generic listing and report statistics for SqlRepo.
// All queries are indexed/scoped and paginated — COUNT(*) + LIMIT/OFFSET — so
// 100k+ record collections never hydrate fully. Text search optionally joins
// patients so appointment/invoice/visit searches match patient name, code or
// phone exactly like the v1.3.0 in-memory filters did.

import { COLLECTION_TABLES } from './schema.mjs';
import { rowToRecord } from './records.mjs';

const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

function likeClause(columns, query) {
  const like = `%${escapeLike(String(query).toLowerCase())}%`;
  return {
    sql: `(${columns.map((column) => `LOWER(${column}) LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    params: columns.map(() => like)
  };
}

// Per-collection list specifications. `text` columns are searched with LIKE;
// `joinPatient` adds patient name/code/phone to the search when a query is set.
const SPECS = {
  appointments: {
    text: ['t.reason', 't.treatment', 't.appointment_code', 't.serial'], joinPatient: true,
    sorts: { date: 't.date ASC, t.time ASC', 'date-desc': 't.date DESC, t.time DESC', recent: 't.created_at DESC' },
    defaultOrder: 't.date ASC, t.time ASC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.date) { where.push('t.date = ?'); params.push(f.date); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.dentistId) { where.push('t.dentist_id = ?'); params.push(f.dentistId); }
      if (f.chair) { where.push('t.chair = ?'); params.push(f.chair); }
      if (f.room) { where.push('t.room = ?'); params.push(f.room); }
    }
  },
  visits: {
    text: ['t.visit_code', 't.reason', 't.chief_complaint', 't.diagnosis', 't.treatment_performed', 't.findings'], joinPatient: true,
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC', recent: 't.created_at DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.dentistId) { where.push('t.dentist_id = ?'); params.push(f.dentistId); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.withFollowUp) { where.push("t.follow_up_date <> ''"); }
    }
  },
  invoices: {
    text: ['t.invoice_number', 't.notes'], joinPatient: true,
    sorts: {
      date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC',
      'total-desc': 't.total_cents DESC', 'due-desc': 't.due_cents DESC', recent: 't.created_at DESC'
    },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.dentistId) { where.push('t.dentist_id = ?'); params.push(f.dentistId); }
      if (f.visitId) { where.push('t.visit_id = ?'); params.push(f.visitId); }
      if (f.planId) { where.push('t.plan_id = ?'); params.push(f.planId); }
      if (f.outstanding) { where.push("t.status NOT IN ('Paid','Cancelled','Draft') AND t.due_cents > 0"); }
    }
  },
  payments: {
    text: ['t.receipt_number', 't.reference', 't.transaction_id', 't.notes'], joinPatient: true,
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC', 'amount-desc': 't.amount_cents DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.invoiceId) { where.push('t.invoice_id = ?'); params.push(f.invoiceId); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.method) { where.push('t.method = ?'); params.push(f.method); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
    }
  },
  paymentAdjustments: {
    text: ['t.reason'],
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.invoiceId) { where.push('t.invoice_id = ?'); params.push(f.invoiceId); }
      if (f.paymentId) { where.push('t.payment_id = ?'); params.push(f.paymentId); }
      if (f.type) { where.push('t.type = ?'); params.push(f.type); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
    }
  },
  expenses: {
    text: ['t.description', 't.reference', 't.notes'],
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC', 'amount-desc': 't.amount_cents DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.category) { where.push('t.category = ?'); params.push(f.category); }
      if (f.method) { where.push('t.method = ?'); params.push(f.method); }
    }
  },
  stockMovements: {
    text: ['t.reason', 't.notes'],
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.itemId) { where.push('t.item_id = ?'); params.push(f.itemId); }
      if (f.supplierId) { where.push('t.supplier_id = ?'); params.push(f.supplierId); }
      if (f.type) { where.push('t.type = ?'); params.push(f.type); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
    }
  },
  suppliers: {
    text: ['t.name', 't.code', 't.contact_person', 't.phone', 't.email'],
    sorts: { name: 't.name ASC', 'name-desc': 't.name DESC', recent: 't.created_at DESC' },
    defaultOrder: 't.name ASC',
    filter(where, params, f) {
      where.push('t.archived = 0');
      if (f.active === true || f.active === 'only') where.push('t.active = 1');
      if (f.active === false || f.active === 'exclude') where.push('t.active = 0');
    }
  },
  staff: {
    text: ['t.name', 't.staff_code', 't.role', 't.specialization', 't.phone', 't.email'],
    sorts: { name: 't.name ASC', 'name-desc': 't.name DESC', recent: 't.created_at DESC' },
    defaultOrder: 't.name ASC',
    filter(where, params, f) {
      where.push('t.archived = 0');
      if (f.role) { where.push('t.role = ?'); params.push(f.role); }
      if (f.active === true || f.active === 'only') where.push('t.active = 1');
      if (f.active === false || f.active === 'exclude') where.push('t.active = 0');
    }
  },
  referrals: {
    text: ['t.referral_to', 't.specialty', 't.reason', 't.response'], joinPatient: true,
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
    }
  },
  attachments: {
    text: ['t.name', 't.notes'], joinPatient: true,
    sorts: { recent: 't.created_at DESC', name: 't.name ASC', 'size-desc': 't.size_bytes DESC' },
    defaultOrder: 't.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.visitId) { where.push('t.visit_id = ?'); params.push(f.visitId); }
      if (f.category) { where.push('t.category = ?'); params.push(f.category); }
    }
  },
  followUpTasks: {
    text: ['t.title', 't.reason', 't.notes'], joinPatient: true,
    sorts: { due: 't.due_date ASC', 'due-desc': 't.due_date DESC', recent: 't.created_at DESC' },
    defaultOrder: "CASE WHEN t.due_date = '' THEN 1 ELSE 0 END, t.due_date ASC",
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.open) where.push("t.status IN ('Open','Contacted','Scheduled')");
      if (f.dueBefore) { where.push("t.due_date <> '' AND t.due_date <= ?"); params.push(f.dueBefore); }
      if (f.dueAfter) { where.push('t.due_date >= ?'); params.push(f.dueAfter); }
    }
  },
  treatmentPlans: {
    text: ['t.title', 't.goal', 't.notes'], joinPatient: true,
    sorts: { recent: 't.created_at DESC', start: 't.start_date DESC', 'total-desc': 't.estimated_total_cents DESC' },
    defaultOrder: 't.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.dentistId) { where.push('t.dentist_id = ?'); params.push(f.dentistId); }
    }
  },
  prescriptions: {
    text: ['t.prescription_code', 't.doctor', 't.medications', 't.notes'], joinPatient: true,
    sorts: { date: 't.date ASC', 'date-desc': 't.date DESC, t.created_at DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      if (f.from) { where.push('t.date >= ?'); params.push(f.from); }
      if (f.to) { where.push('t.date <= ?'); params.push(f.to); }
      if (f.dentistId) { where.push('t.dentist_id = ?'); params.push(f.dentistId); }
    }
  },
  dentalRecords: {
    text: ['t.note', 't.procedure_name', 't.tooth'], joinPatient: true,
    sorts: { recent: 't.created_at DESC', tooth: 't.dentition ASC, t.tooth ASC' },
    defaultOrder: 't.created_at DESC',
    filter(where, params, f) {
      if (f.patientId) { where.push('t.patient_id = ?'); params.push(f.patientId); }
      const tooth = f.tooth || f.toothNumber;
      if (tooth) { where.push('t.tooth = ?'); params.push(String(tooth)); }
      if (f.dentition) { where.push('t.dentition = ?'); params.push(f.dentition); }
      if (f.status) { where.push('t.status = ?'); params.push(f.status); }
      if (f.currentOnly) where.push('t.superseded = 0');
    }
  },
  treatments: {
    text: ['t.name', 't.code', 't.category', 't.description'],
    sorts: { name: 't.name ASC', 'price-desc': 't.default_price_cents DESC', recent: 't.created_at DESC' },
    defaultOrder: 't.name ASC',
    filter(where, params, f) {
      // The catalogue has no archive state; retired treatments are `active = 0`.
      if (f.category) { where.push('t.category = ?'); params.push(f.category); }
      if (f.active === true || f.active === 'only') where.push('t.active = 1');
      if (f.active === false || f.active === 'exclude') where.push('t.active = 0');
    }
  },
  notifications: {
    text: ['t.title', 't.message'],
    sorts: { recent: 't.date DESC, t.created_at DESC' },
    defaultOrder: 't.date DESC, t.created_at DESC',
    filter(where, params, f) {
      if (f.read === true) where.push('t.read = 1');
      if (f.read === false) where.push('t.read = 0');
      if (f.dismissed === true) where.push('t.dismissed = 1');
      if (f.dismissed !== true) where.push('t.dismissed = 0');
      if (f.kind) { where.push('t.kind = ?'); params.push(f.kind); }
    }
  },
  medicationCatalog: {
    text: ['t.name', 't.strength', 't.dosage', 't.frequency'],
    sorts: { name: 't.name ASC' },
    defaultOrder: 't.name ASC',
    filter(where, params, f) {
      if (f.favorite) where.push('t.favorite = 1');
    }
  },
  rooms: {
    text: ['t.name'],
    sorts: { name: 't.name ASC' },
    defaultOrder: 't.name ASC',
    filter(where, params, f) {
      if (f.active === true || f.active === 'only') where.push('t.active = 1');
    }
  },
  savedFilters: {
    text: ['t.name', 't.query'],
    sorts: { recent: 't.created_at DESC', name: 't.name ASC' },
    defaultOrder: 't.created_at DESC',
    filter(where, params, f) {
      if (f.entity) { where.push('t.entity = ?'); params.push(f.entity); }
    }
  },
  savedReports: {
    text: ['t.name'],
    sorts: { name: 't.name ASC' },
    defaultOrder: '',
    filter(where, params, f) {
      if (f.type) { where.push('t.type = ?'); params.push(f.type); }
    }
  },
  notificationRules: {
    text: ['t.kind'],
    sorts: {},
    defaultOrder: '',
    filter(where, params, f) {
      if (f.kind) { where.push('t.kind = ?'); params.push(f.kind); }
      if (f.enabled === true) where.push('t.enabled = 1');
      if (f.enabled === false) where.push('t.enabled = 0');
    }
  }
};

export function listCollectionSql(repo, collection, { page = 1, pageSize = 25, query = '', sort = '', filters = {} } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Math.min(500, Number(pageSize) || 25));
  const empty = { rows: [], total: 0, page: safePage, pageSize: safeSize };
  const f = filters && typeof filters === 'object' ? filters : {};

  // Delegated collections with dedicated optimised listers.
  if (collection === 'patients') {
    const result = repo.listPatients({
      query, page: safePage, pageSize: safeSize, sort: sort || 'name',
      status: f.status || 'all', balance: f.balance || 'all',
      dateFrom: f.dateFrom || '', dateTo: f.dateTo || '',
      registeredFrom: f.registeredFrom || '', registeredTo: f.registeredTo || '',
      hasPhone: Boolean(f.hasPhone), toothStatus: f.toothStatus || '', tag: f.tag || '',
      includeAggregates: Boolean(f.includeAggregates)
    });
    return { ...result, page: safePage, pageSize: safeSize };
  }
  if (collection === 'inventory') {
    const result = repo.listInventory({
      query, page: safePage, pageSize: safeSize, sort: sort || 'name',
      category: f.category || '', supplierId: f.supplierId || '',
      lowStock: Boolean(f.lowStock), lowStockThreshold: Number(f.lowStockThreshold || 0),
      expiringBefore: f.expiringBefore || '', archived: f.archived || 'exclude'
    });
    return { ...result, page: safePage, pageSize: safeSize };
  }
  if (collection === 'audit') {
    return repo.listAudit({ query, page: safePage, pageSize: safeSize, entity: f.entity || '', entityId: f.entityId || '', userId: f.userId || '', from: f.from || '', to: f.to || '' });
  }
  if (collection === 'users') {
    const all = repo.usersList();
    const q = String(query || '').toLowerCase();
    const filtered = all.filter((user) => {
      if (f.active === true && !user.active) return false;
      if (f.active === false && user.active) return false;
      if (f.role && user.role !== f.role) return false;
      if (q && !`${user.name} ${user.role}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return { rows: filtered.slice((safePage - 1) * safeSize, safePage * safeSize), total: filtered.length, page: safePage, pageSize: safeSize };
  }

  const spec = SPECS[collection];
  const table = COLLECTION_TABLES[collection];
  if (!spec || !table) return empty;

  const where = [];
  const params = [];
  const joinPatient = Boolean(spec.joinPatient) && Boolean(query);
  const from = joinPatient ? `${table} t JOIN patients p ON p.id = t.patient_id` : `${table} t`;
  if (query) {
    const columns = [...spec.text];
    if (joinPatient) columns.push('p.full_name', 'p.patient_code', 'p.phone');
    const like = likeClause(columns, query);
    where.push(like.sql);
    params.push(...like.params);
  }
  spec.filter(where, params, f);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = spec.sorts[sort] || spec.defaultOrder;
  // A unique trailing key keeps OFFSET pagination deterministic.
  const orderSql = order ? `ORDER BY ${order}, t.id ASC` : 'ORDER BY t.id ASC';

  const total = Number(repo.ws.queryOne(`SELECT COUNT(*) AS total FROM ${from} ${whereSql}`, params)?.total ?? 0);
  const rows = repo.ws.query(`SELECT t.* FROM ${from} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, [...params, safeSize, (safePage - 1) * safeSize])
    .map(rowToRecord).filter(Boolean);
  return { rows, total, page: safePage, pageSize: safeSize };
}

// ---- report statistics (SQL aggregates; scalars + grouped rows) -------------

const money = (repo, sql, params = []) => Number(repo.ws.queryOne(sql, params)?.cents ?? 0);

/** Refunds are cash out on the REFUND date (not the original payment date). */
function refundsInRange(repo, from, to) {
  const where = ["a.type = 'Refund'", "(a.payment_id IS NULL OR a.payment_id = '' OR EXISTS (SELECT 1 FROM payments p WHERE p.id = a.payment_id AND p.status NOT IN ('Voided','Cancelled')))"];
  const params = [];
  if (from) { where.push('a.date >= ?'); params.push(from); }
  if (to) { where.push('a.date <= ?'); params.push(to); }
  return Number(repo.ws.queryOne(`SELECT COALESCE(SUM(a.amount_cents),0) AS cents FROM payment_adjustments a WHERE ${where.join(' AND ')}`, params)?.cents ?? 0);
}
const count = (repo, sql, params = []) => Number(repo.ws.queryOne(sql, params)?.total ?? 0);
const dateBound = (from, to, column = 'date') => {
  const where = []; const params = [];
  if (from) { where.push(`${column} >= ?`); params.push(from); }
  if (to) { where.push(`${column} <= ?`); params.push(to); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

export function reportStatsSql(repo, kind, from = '', to = '') {
  const range = dateBound(from, to);
  const rangeAnd = range.sql ? `${range.sql} AND` : 'WHERE';
  switch (kind) {
    case 'revenue': {
      const activePayments = `${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled')`;
      const liveInvoices = `${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Cancelled','Draft')`;
      const collectedCents = money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payments ${activePayments}`, range.params);
      const refundedCents = refundsInRange(repo, from, to);
      return {
        collectedCents,
        refundedCents,
        netCollectedCents: collectedCents - refundedCents,
        billedCents: money(repo, `SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices ${liveInvoices}`, range.params),
        expensesCents: money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM expenses ${range.sql}`, range.params),
        adjustedCents: money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payment_adjustments ${range.sql ? `${range.sql} AND` : 'WHERE'} type = 'Adjustment'`, range.params),
        paymentCount: count(repo, `SELECT COUNT(*) AS total FROM payments ${activePayments}`, range.params),
        invoiceCount: count(repo, `SELECT COUNT(*) AS total FROM invoices ${liveInvoices}`, range.params),
        expenseCount: count(repo, `SELECT COUNT(*) AS total FROM expenses ${range.sql}`, range.params)
      };
    }
    case 'patients': {
      const reg = dateBound(from, to, 'registration_date');
      return {
        registered: count(repo, `SELECT COUNT(*) AS total FROM patients ${reg.sql ? `${reg.sql} AND` : 'WHERE'} archived = 0`, reg.params),
        totalActive: count(repo, 'SELECT COUNT(*) AS total FROM patients WHERE archived = 0'),
        withPhone: count(repo, `SELECT COUNT(*) AS total FROM patients ${reg.sql ? `${reg.sql} AND` : 'WHERE'} archived = 0 AND phone <> ''`, reg.params),
        upcoming: count(repo, "SELECT COUNT(*) AS total FROM patients WHERE archived = 0 AND next_visit <> '' AND next_visit >= date('now')")
      };
    }
    case 'visits':
      return {
        visits: count(repo, `SELECT COUNT(*) AS total FROM visits ${range.sql}`, range.params),
        uniquePatients: count(repo, `SELECT COUNT(DISTINCT patient_id) AS total FROM visits ${range.sql}`, range.params),
        withFollowUp: count(repo, `SELECT COUNT(*) AS total FROM visits ${range.sql ? `${range.sql} AND` : 'WHERE'} follow_up_date <> ''`, range.params),
        withTreatment: count(repo, `SELECT COUNT(*) AS total FROM visits ${range.sql ? `${range.sql} AND` : 'WHERE'} treatment_performed <> ''`, range.params)
      };
    case 'appointments': {
      const total = count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql}`, range.params);
      const completed = count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Completed'`, range.params);
      return {
        appointments: total, completed,
        noShows: count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'No Show'`, range.params),
        cancelled: count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Cancelled'`, range.params),
        completionPct: total ? Math.round((completed / total) * 100) : 0
      };
    }
    case 'outstanding':
      return {
        dueCents: money(repo, `SELECT COALESCE(SUM(due_cents),0) AS cents FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Paid','Cancelled','Draft') AND due_cents > 0`, range.params),
        openInvoices: count(repo, `SELECT COUNT(*) AS total FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Paid','Cancelled','Draft') AND due_cents > 0`, range.params),
        partiallyPaid: count(repo, `SELECT COUNT(*) AS total FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Partially Paid'`, range.params),
        unpaid: count(repo, `SELECT COUNT(*) AS total FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Issued'`, range.params),
        adjusted: count(repo, `SELECT COUNT(*) AS total FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Adjusted'`, range.params)
      };
    case 'inventory':
      return {
        itemsTracked: count(repo, 'SELECT COUNT(*) AS total FROM inventory WHERE archived = 0'),
        lowStock: count(repo, 'SELECT COUNT(*) AS total FROM inventory WHERE archived = 0 AND current_stock <= MAX(minimum_stock, reorder_threshold)'),
        expired: count(repo, "SELECT COUNT(*) AS total FROM inventory WHERE archived = 0 AND expiry_date <> '' AND expiry_date < date('now')"),
        unitsOnHand: count(repo, 'SELECT COALESCE(SUM(current_stock),0) AS total FROM inventory WHERE archived = 0'),
        stockValueCents: money(repo, 'SELECT COALESCE(SUM(current_stock * purchase_price_cents),0) AS cents FROM inventory WHERE archived = 0')
      };
    case 'expenses': {
      const totalCents = money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM expenses ${range.sql}`, range.params);
      const transactions = count(repo, `SELECT COUNT(*) AS total FROM expenses ${range.sql}`, range.params);
      return {
        totalCents, transactions,
        categories: count(repo, `SELECT COUNT(DISTINCT category) AS total FROM expenses ${range.sql}`, range.params),
        averageCents: transactions ? Math.round(totalCents / transactions) : 0
      };
    }
    case 'accounting': {
      const collectedCents = money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payments ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled')`, range.params);
      const refundedCents = refundsInRange(repo, from, to);
      const expensesCents = money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM expenses ${range.sql}`, range.params);
      const methods = repo.ws.query(`SELECT method AS label, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS total FROM payments ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled') GROUP BY method ORDER BY cents DESC, method ASC`, range.params);
      return {
        billedCents: money(repo, `SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Cancelled','Draft')`, range.params),
        collectedCents, refundedCents, expensesCents,
        netCollectedCents: collectedCents - refundedCents,
        adjustedCents: money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payment_adjustments ${range.sql ? `${range.sql} AND` : 'WHERE'} type = 'Adjustment'`, range.params),
        netOperatingCents: collectedCents - refundedCents - expensesCents,
        receivablesCents: money(repo, "SELECT COALESCE(SUM(due_cents),0) AS cents FROM invoices WHERE status NOT IN ('Paid','Cancelled','Draft')"),
        byMethod: methods.map((row) => ({ label: row.label || 'Other', cents: Number(row.cents || 0), count: Number(row.total || 0) }))
      };
    }
    case 'aging': {
      const bucket = (label, lo, hi) => ({
        label,
        cents: money(repo, `SELECT COALESCE(SUM(due_cents),0) AS cents FROM invoices WHERE status NOT IN ('Paid','Cancelled','Draft') AND due_cents > 0 AND (julianday('now') - julianday(date)) ${lo === null ? '<=' : '>='} ${lo === null ? hi : lo}${hi === null ? '' : ` AND (julianday('now') - julianday(date)) <= ${hi}`}`),
        count: count(repo, `SELECT COUNT(*) AS total FROM invoices WHERE status NOT IN ('Paid','Cancelled','Draft') AND due_cents > 0 AND (julianday('now') - julianday(date)) ${lo === null ? '<=' : '>='} ${lo === null ? hi : lo}${hi === null ? '' : ` AND (julianday('now') - julianday(date)) <= ${hi}`}`)
      });
      return { rows: [bucket('Current (0–30 days)', null, 30), bucket('31–60 days', 31, 60), bucket('61–90 days', 61, 90), bucket('Over 90 days', 91, null)] };
    }
    case 'expenseCategories':
      return {
        rows: repo.ws.query(`SELECT category AS label, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS total FROM expenses ${range.sql} GROUP BY category ORDER BY cents DESC LIMIT 25`, range.params)
          .map((row) => ({ label: row.label || 'Other', cents: Number(row.cents || 0), count: Number(row.total || 0) }))
      };
    case 'analytics': {
      const collectedCents = money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payments ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled')`, range.params);
      const months = repo.ws.query(`SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount_cents),0) AS cents FROM payments ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled') GROUP BY month ORDER BY month DESC LIMIT 36`, range.params).reverse();
      const visitMonths = repo.ws.query(`SELECT strftime('%Y-%m', date) AS month, COUNT(*) AS total FROM visits ${range.sql} GROUP BY month ORDER BY month DESC LIMIT 36`, range.params).reverse();
      const methods = repo.ws.query(`SELECT method AS label, COALESCE(SUM(amount_cents),0) AS cents FROM payments ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Voided','Cancelled') GROUP BY method ORDER BY cents DESC LIMIT 12`, range.params);
      const regRange = dateBound(from, to, 'registration_date');
      return {
        totals: {
          collectedCents,
          refundedCents: refundsInRange(repo, from, to),
          billedCents: money(repo, `SELECT COALESCE(SUM(total_cents),0) AS cents FROM invoices ${range.sql ? `${range.sql} AND` : 'WHERE'} status NOT IN ('Cancelled','Draft')`, range.params),
          expensesCents: money(repo, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM expenses ${range.sql}`, range.params),
          outstandingCents: money(repo, "SELECT COALESCE(SUM(due_cents),0) AS cents FROM invoices WHERE status NOT IN ('Paid','Cancelled','Draft')")
        },
        counts: {
          patients: count(repo, 'SELECT COUNT(*) AS total FROM patients WHERE archived = 0'),
          newPatients: count(repo, `SELECT COUNT(*) AS total FROM patients ${regRange.sql ? `${regRange.sql} AND` : 'WHERE'} archived = 0`, regRange.params),
          visits: count(repo, `SELECT COUNT(*) AS total FROM visits ${range.sql}`, range.params),
          appointments: count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql}`, range.params),
          completed: count(repo, `SELECT COUNT(*) AS total FROM appointments ${range.sql ? `${range.sql} AND` : 'WHERE'} status = 'Completed'`, range.params),
          invoices: count(repo, `SELECT COUNT(*) AS total FROM invoices ${range.sql}`, range.params),
          payments: count(repo, `SELECT COUNT(*) AS total FROM payments ${range.sql}`, range.params)
        },
        monthly: months.map((row) => ({ month: row.month, cents: Number(row.cents || 0) })),
        visitMonthly: visitMonths.map((row) => ({ month: row.month, count: Number(row.total || 0) })),
        byMethod: methods.map((row) => ({ label: row.label || 'Other', cents: Number(row.cents || 0) }))
      };
    }
    case 'services': {
      const createdRange = dateBound(from, to, 'created_at');
      return {
        rows: repo.ws.query(`SELECT procedure_name AS label, COUNT(*) AS total FROM dental_records ${createdRange.sql ? `${createdRange.sql} AND` : 'WHERE'} procedure_name <> '' GROUP BY procedure_name ORDER BY total DESC LIMIT 10`, createdRange.params)
          .map((row) => ({ label: row.label, count: Number(row.total || 0) }))
      };
    }
    case 'dentists': {
      const visitRange = dateBound(from, to, 'v.date');
      return {
        rows: repo.ws.query(`SELECT COALESCE(NULLIF(s.name,''), NULLIF(v.dentist_id,''), 'Unassigned') AS label, COUNT(*) AS total FROM visits v LEFT JOIN staff s ON s.id = v.dentist_id ${visitRange.sql ? `${visitRange.sql} AND` : 'WHERE'} v.dentist_id <> '' GROUP BY label ORDER BY total DESC LIMIT 10`, visitRange.params)
          .map((row) => ({ label: row.label, count: Number(row.total || 0) }))
      };
    }
    case 'movements': {
      const moveRange = dateBound(from, to, 'm.date');
      return {
        rows: repo.ws.query(`SELECT COALESCE(NULLIF(i.name,''), m.item_id) AS label, COALESCE(SUM(ABS(m.quantity)),0) AS total, COUNT(*) AS moves FROM stock_movements m LEFT JOIN inventory i ON i.id = m.item_id ${moveRange.sql} GROUP BY m.item_id ORDER BY total DESC LIMIT 10`, moveRange.params)
          .map((row) => ({ label: row.label, quantity: Number(row.total || 0), count: Number(row.moves || 0) }))
      };
    }
    case 'inventoryValue':
      return {
        stockValueCents: money(repo, 'SELECT COALESCE(SUM(current_stock * purchase_price_cents),0) AS cents FROM inventory WHERE archived = 0'),
        retailValueCents: money(repo, 'SELECT COALESCE(SUM(current_stock * sale_price_cents),0) AS cents FROM inventory WHERE archived = 0'),
        unitsOnHand: count(repo, 'SELECT COALESCE(SUM(current_stock),0) AS total FROM inventory WHERE archived = 0'),
        itemsTracked: count(repo, 'SELECT COUNT(*) AS total FROM inventory WHERE archived = 0')
      };
    default:
      return {};
  }
}

const PATIENT_LINKED_TABLES = ['visits', 'appointments', 'invoices', 'payments', 'prescriptions', 'treatment_plans', 'referrals', 'attachments', 'follow_up_tasks', 'dental_records'];

export function patientRecordCountsSql(repo, patientId) {
  if (!patientId) return {};
  const countsOut = {};
  for (const table of PATIENT_LINKED_TABLES) {
    countsOut[table] = count(repo, `SELECT COUNT(*) AS total FROM ${table} WHERE patient_id = ?`, [patientId]);
  }
  return {
    visits: countsOut.visits, appointments: countsOut.appointments, invoices: countsOut.invoices,
    payments: countsOut.payments, prescriptions: countsOut.prescriptions, treatmentPlans: countsOut.treatment_plans,
    referrals: countsOut.referrals, attachments: countsOut.attachments, followUpTasks: countsOut.follow_up_tasks,
    dentalRecords: countsOut.dental_records
  };
}
