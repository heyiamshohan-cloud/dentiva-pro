// SQL repository: the persistence adapter consumed by the shared operation layer
// (src/ops.js). Every method is scoped/indexed — no method ever loads an entire
// collection into memory. The same operation logic runs against LocalRepo in the
// browser fallback, which keeps business rules single-sourced (§32, §69).

import { COLLECTION_TABLES } from './schema.mjs';
import { rowToRecord, phoneNorm } from './records.mjs';
import { DEFAULT_SETTINGS } from '../../src/migrate-state.js';
import { listCollectionSql, reportStatsSql, patientRecordCountsSql } from './list-sql.mjs';

const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

export class SqlRepo {
  constructor(workspace) {
    this.ws = workspace;
  }

  get db() { return this.ws.db; }

  // ---- meta / settings ----------------------------------------------------

  getMeta(key, fallback = null) { return this.ws.getMeta(key, fallback); }
  setMeta(key, value) { this.ws.setMeta(key, value); }
  getSettings() { return { ...DEFAULT_SETTINGS, ...(this.ws.getMeta('settings', {}) || {}) }; }
  getCounters() { return this.ws.getMeta('counters', {}) || {}; }

  nextCounter(kind) {
    const counters = this.getCounters();
    const value = Math.max(1, Number(counters[kind] || 1));
    counters[kind] = value + 1;
    this.setMeta('counters', counters);
    return value;
  }

  // ---- generic record access ------------------------------------------------

  get(collection, id) { return this.ws.getRecord(collection, id); }

  insert(collection, record, extra = {}) { return this.ws.upsertRecord(collection, record, extra); }

  update(collection, record, extra = {}) { return this.ws.upsertRecord(collection, record, extra); }

  remove(collection, id) { this.ws.deleteRecord(collection, id); }

  clearCollection(collection) { this.ws.run(`DELETE FROM ${tableFor(collection)}`); }

  transaction(fn) { return this.ws.transaction(fn); }

  all(collection, order = '') {
    return this.ws.listRecords(collection, { order, limit: 5000 });
  }

  byIds(collection, ids) {
    const list = [...new Set((ids || []).filter(Boolean).map(String))].slice(0, 2000);
    if (!list.length) return [];
    const table = COLLECTION_TABLES[collection];
    const rows = this.ws.query(`SELECT * FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`, list);
    return rows.map(rowToRecord).filter(Boolean);
  }

  // ---- patients -------------------------------------------------------------

  listPatients({ query = '', status = 'all', balance = 'all', dateFrom = '', dateTo = '', registeredFrom = '', registeredTo = '', hasPhone = false, toothStatus = '', tag = '', page = 1, pageSize = 50, sort = 'name' } = {}) {
    const where = [];
    const params = [];
    if (status === 'active') { where.push('archived = 0'); } else if (status === 'archived') { where.push('archived = 1'); }
    if (query) {
      const like = `%${escapeLike(query.toLowerCase())}%`;
      where.push('(LOWER(full_name) LIKE ? ESCAPE \'\\\' OR LOWER(patient_code) LIKE ? ESCAPE \'\\\' OR phone LIKE ? ESCAPE \'\\\' OR phone_norm LIKE ? ESCAPE \'\\\' OR LOWER(email) LIKE ? ESCAPE \'\\\' OR LOWER(COALESCE(json_extract(payload, \'$.address\'), \'\')) LIKE ? ESCAPE \'\\\')');
      params.push(like, like, like, escapeLike(phoneNorm(query)), like, like);
    }
    if (balance === 'outstanding') where.push('balance_cents > 0');
    if (balance === 'clear') where.push('balance_cents <= 0');
    if (dateFrom) { where.push("COALESCE(NULLIF(last_visit,''), registration_date) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("COALESCE(NULLIF(last_visit,''), registration_date) <= ?"); params.push(dateTo); }
    if (registeredFrom) { where.push('registration_date >= ?'); params.push(registeredFrom); }
    if (registeredTo) { where.push('registration_date <= ?'); params.push(registeredTo); }
    if (hasPhone) where.push("phone <> ''");
    if (tag) { where.push('payload LIKE ? ESCAPE \'\\\''); params.push(`%"${escapeLike(tag)}"%`); }
    if (toothStatus) {
      where.push('EXISTS (SELECT 1 FROM dental_records d WHERE d.patient_id = patients.id AND d.status = ? AND d.superseded = 0)');
      params.push(toothStatus);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = {
      name: 'full_name COLLATE NOCASE ASC',
      'name-desc': 'full_name COLLATE NOCASE DESC',
      recent: "COALESCE(NULLIF(last_visit,''), registration_date, created_at) DESC",
      oldest: "COALESCE(NULLIF(last_visit,''), registration_date, created_at) ASC",
      balance: 'balance_cents DESC',
      code: 'patient_code ASC'
    }[sort] || 'full_name COLLATE NOCASE ASC';
    const total = this.ws.countRecords('patients', { where: where.join(' AND '), params });
    const rows = this.ws.listRecords('patients', { where: where.join(' AND '), params, order: orderSql, limit: pageSize, offset: (Math.max(1, page) - 1) * pageSize });
    return { rows, total, page: Math.max(1, page), pageSize };
  }

  patientByCode(code) {
    const row = this.ws.queryOne('SELECT * FROM patients WHERE patient_code = ?', [String(code || '')]);
    return row ? rowToRecord(row) : null;
  }

  patientByPhoneNorm(phone) {
    const norm = phoneNorm(phone);
    if (!norm) return [];
    return this.ws.query('SELECT * FROM patients WHERE phone_norm = ? LIMIT 25', [norm]).map(rowToRecord).filter(Boolean);
  }

  findPatientDuplicates({ fullName = '', phone = '', email = '', dateOfBirth = '', patientCode = '', excludeId = '' }) {
    const nameNorm = String(fullName || '').trim().toLowerCase();
    const norm = phoneNorm(phone);
    const candidates = new Map();
    const add = (rows) => rows.forEach((row) => { const record = rowToRecord(row); if (record && record.id !== excludeId) candidates.set(record.id, record); });
    if (patientCode) add(this.ws.query('SELECT * FROM patients WHERE patient_code = ? LIMIT 10', [patientCode]));
    if (norm) add(this.ws.query('SELECT * FROM patients WHERE phone_norm = ? LIMIT 50', [norm]));
    if (email) add(this.ws.query("SELECT * FROM patients WHERE LOWER(email) = LOWER(?) LIMIT 50", [String(email).trim()]));
    if (dateOfBirth && nameNorm) add(this.ws.query("SELECT * FROM patients WHERE date_of_birth = ? AND LOWER(full_name) = ? LIMIT 50", [dateOfBirth, nameNorm]));
    return [...candidates.values()].filter((record) => {
      const sameCode = patientCode && record.patientCode && record.patientCode.toLowerCase() === patientCode.toLowerCase();
      const samePhone = norm && phoneNorm(record.phone) === norm;
      const sameNamePhone = samePhone && String(record.fullName || '').trim().toLowerCase() === nameNorm;
      const sameEmail = email && String(record.email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
      const sameDob = dateOfBirth && record.dateOfBirth === dateOfBirth && String(record.fullName || '').trim().toLowerCase() === nameNorm;
      return Boolean(sameCode || sameNamePhone || sameEmail || sameDob);
    });
  }

  updatePatientBalance(patientId) {
    if (!patientId) return 0;
    const charges = this.ws.queryOne("SELECT COALESCE(SUM(total_cents), 0) AS cents FROM invoices WHERE patient_id = ? AND status <> 'Cancelled'", [patientId])?.cents ?? 0;
    const credits = this.ws.queryOne("SELECT COALESCE(SUM(amount_cents - refunded_cents), 0) AS cents FROM payments WHERE patient_id = ? AND status NOT IN ('Voided','Cancelled')", [patientId])?.cents ?? 0;
    // Payments recorded without patient_id but linked to this patient's invoices.
    const linkedCredits = this.ws.queryOne(`SELECT COALESCE(SUM(p.amount_cents - p.refunded_cents), 0) AS cents
      FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE (p.patient_id IS NULL OR p.patient_id = '') AND i.patient_id = ? AND p.status NOT IN ('Voided','Cancelled')`, [patientId])?.cents ?? 0;
    // Forgiveness adjustments reduce what the patient owes. Refund-type adjustments are
    // already reflected through payments.refunded_cents and must not be double-counted.
    const forgiven = this.ws.queryOne(`SELECT COALESCE(SUM(a.amount_cents), 0) AS cents
      FROM payment_adjustments a LEFT JOIN invoices i ON i.id = a.invoice_id
      WHERE a.type = 'Adjustment' AND COALESCE(NULLIF(a.patient_id, ''), i.patient_id) = ?`, [patientId])?.cents ?? 0;
    const balance = Number(charges) - Number(credits) - Number(linkedCredits) - Number(forgiven);
    this.ws.run('UPDATE patients SET balance_cents = ? WHERE id = ?', [balance, patientId]);
    return balance;
  }

  reassignPatientRecords(fromPatientId, toPatientId) {
    const tables = ['appointments', 'visits', 'prescriptions', 'dental_records', 'treatment_plans', 'invoices', 'payments', 'payment_adjustments', 'referrals', 'attachments', 'follow_up_tasks'];
    let moved = 0;
    for (const table of tables) {
      const info = this.ws.run(`UPDATE ${table} SET patient_id = ? WHERE patient_id = ?`, [toPatientId, fromPatientId]);
      moved += Number(info?.changes ?? 0);
      // Keep payloads consistent with relational columns.
      for (const row of this.ws.query(`SELECT id, payload FROM ${table} WHERE patient_id = ?`, [toPatientId])) {
        try {
          const record = JSON.parse(row.payload);
          if (record && record.patientId === fromPatientId) {
            record.patientId = toPatientId;
            this.ws.run(`UPDATE ${table} SET payload = ? WHERE id = ?`, [JSON.stringify(record), row.id]);
          }
        } catch { /* payload left as-is */ }
      }
    }
    return moved;
  }

  // ---- appointments ------------------------------------------------------------

  appointmentsOnDate(date) {
    return this.ws.listRecords('appointments', { where: 'date = ?', params: [String(date || '')], order: 'time ASC, created_at ASC', limit: 500 });
  }

  appointmentsInRange(from, to) {
    const where = [];
    const params = [];
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    return this.ws.listRecords('appointments', { where: where.join(' AND '), params, order: 'date ASC, time ASC', limit: 5000 });
  }

  appointmentsByPatient(patientId, limit = 200) {
    return this.ws.listRecords('appointments', { where: 'patient_id = ?', params: [patientId], order: 'date DESC, time DESC', limit });
  }

  // ---- clinical ------------------------------------------------------------------

  visitsByPatient(patientId, limit = 500) {
    return this.ws.listRecords('visits', { where: 'patient_id = ?', params: [patientId], order: 'date DESC, created_at DESC', limit });
  }

  visitsInRange(from, to) {
    const where = []; const params = [];
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    return this.ws.listRecords('visits', { where: where.join(' AND '), params, order: 'date DESC', limit: 5000 });
  }

  dentalCurrent(patientId) {
    return this.ws.listRecords('dentalRecords', { where: 'patient_id = ? AND superseded = 0', params: [patientId], order: 'tooth ASC', limit: 100 });
  }

  dentalHistory(patientId, tooth = null) {
    const where = tooth === null ? 'patient_id = ?' : 'patient_id = ? AND tooth = ?';
    const params = tooth === null ? [patientId] : [patientId, Number(tooth)];
    return this.ws.listRecords('dentalRecords', { where, params, order: 'updated_at DESC, created_at DESC', limit: 500 });
  }

  supersedeDental(patientId, tooth, dentition) {
    this.ws.run('UPDATE dental_records SET superseded = 1 WHERE patient_id = ? AND tooth = ? AND dentition = ? AND superseded = 0', [patientId, Number(tooth), dentition]);
  }

  prescriptionsByPatient(patientId, limit = 300) {
    return this.ws.listRecords('prescriptions', { where: 'patient_id = ?', params: [patientId], order: 'date DESC', limit });
  }

  plansByPatient(patientId) {
    return this.ws.listRecords('treatmentPlans', { where: 'patient_id = ?', params: [patientId], order: 'updated_at DESC, created_at DESC', limit: 200 });
  }

  referralsByPatient(patientId) {
    return this.ws.listRecords('referrals', { where: 'patient_id = ?', params: [patientId], order: 'date DESC', limit: 200 });
  }

  attachmentsByPatient(patientId) {
    return this.ws.listRecords('attachments', { where: 'patient_id = ?', params: [patientId], order: 'created_at DESC', limit: 500 });
  }

  followupsByPatient(patientId) {
    return this.ws.listRecords('followUpTasks', { where: 'patient_id = ?', params: [patientId], order: 'due_date ASC', limit: 200 });
  }

  followupsOpen(today, limit = 300) {
    return this.ws.listRecords('followUpTasks', { where: "status IN ('Open','Contacted','Scheduled')", params: [], order: 'due_date ASC', limit });
  }

  visitsWithFollowupDue(today, limit = 300) {
    return this.ws.listRecords('visits', { where: "follow_up_date <> '' AND follow_up_date <= ?", params: [today], order: 'follow_up_date ASC', limit });
  }

  // ---- finance -------------------------------------------------------------------

  invoicesByPatient(patientId, limit = 500) {
    return this.ws.listRecords('invoices', { where: 'patient_id = ?', params: [patientId], order: 'date DESC, created_at DESC', limit });
  }

  paymentsByPatient(patientId, limit = 500) {
    return this.ws.listRecords('payments', { where: 'patient_id = ?', params: [patientId], order: 'date DESC, created_at DESC', limit });
  }

  paymentsByInvoice(invoiceId) {
    return this.ws.listRecords('payments', { where: 'invoice_id = ?', params: [invoiceId], order: 'date ASC, created_at ASC', limit: 200 });
  }

  adjustmentsByPatient(patientId, limit = 500) {
    return this.ws.listRecords('paymentAdjustments', { where: 'patient_id = ?', params: [patientId], order: 'date ASC', limit });
  }

  adjustmentsByPayment(paymentId) {
    return this.ws.listRecords('paymentAdjustments', { where: 'payment_id = ?', params: [paymentId], order: 'date ASC', limit: 200 });
  }

  adjustmentsByInvoice(invoiceId) {
    return this.ws.listRecords('paymentAdjustments', { where: 'invoice_id = ?', params: [invoiceId], order: 'date ASC', limit: 200 });
  }

  invoiceByNumber(number) {
    const row = this.ws.queryOne('SELECT * FROM invoices WHERE invoice_number = ?', [String(number || '')]);
    return row ? rowToRecord(row) : null;
  }

  // ---- inventory -------------------------------------------------------------------

  listInventory({ query = '', category = '', supplierId = '', lowStock = false, lowStockThreshold = 0, expiringBefore = '', archived = 'exclude', page = 1, pageSize = 50, sort = 'name' } = {}) {
    const where = []; const params = [];
    if (archived === 'exclude') where.push('archived = 0');
    if (archived === 'only') where.push('archived = 1');
    if (query) {
      const like = `%${escapeLike(query.toLowerCase())}%`;
      where.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(item_code) LIKE ? ESCAPE '\\' OR LOWER(brand) LIKE ? ESCAPE '\\' OR LOWER(batch) LIKE ? ESCAPE '\\' OR LOWER(lot) LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like, like);
    }
    if (category) { where.push('category = ?'); params.push(category); }
    if (supplierId) { where.push('supplier_id = ?'); params.push(supplierId); }
    if (lowStock) {
      where.push('current_stock <= MAX(COALESCE(NULLIF(minimum_stock, 0), ?), reorder_threshold)');
      params.push(Math.max(0, Number(lowStockThreshold) || 0));
    }
    if (expiringBefore) { where.push("expiry_date <> '' AND expiry_date <= ?"); params.push(expiringBefore); }
    const whereSql = where.join(' AND ');
    const orderSql = {
      name: 'name COLLATE NOCASE ASC',
      'name-desc': 'name COLLATE NOCASE DESC',
      'stock-asc': 'current_stock ASC',
      'stock-desc': 'current_stock DESC',
      expiry: "CASE WHEN expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC",
      'value-desc': 'current_stock * purchase_price_cents DESC',
      recent: 'created_at DESC'
    }[sort] || 'name COLLATE NOCASE ASC';
    const total = this.ws.countRecords('inventory', { where: whereSql, params });
    const rows = this.ws.listRecords('inventory', { where: whereSql, params, order: orderSql, limit: pageSize, offset: (Math.max(1, page) - 1) * pageSize });
    return { rows, total, page: Math.max(1, page), pageSize };
  }

  movementsByItem(itemId, limit = 200) {
    return this.ws.listRecords('stockMovements', { where: 'item_id = ?', params: [itemId], order: 'date DESC, created_at DESC', limit });
  }

  // ---- users / auth ------------------------------------------------------------------

  usersList({ includeSecrets = false } = {}) {
    const rows = includeSecrets
      ? this.ws.query('SELECT id, name, role, staff_id, active, permissions, pin_hash, pin_salt, kdf, failed_attempts, locked_until, last_login, created_at, updated_at FROM users ORDER BY created_at ASC')
      : this.ws.query('SELECT payload FROM users ORDER BY created_at ASC');
    return rows.map((row) => (includeSecrets
      ? {
        id: row.id, name: row.name, role: row.role, staffId: row.staff_id || '', active: row.active !== 0,
        permissions: JSON.parse(row.permissions || '[]'), pinHash: row.pin_hash || '', pinSalt: row.pin_salt || '',
        kdf: row.kdf || '', failedAttempts: Number(row.failed_attempts || 0), lockedUntil: Number(row.locked_until || 0),
        lastLogin: row.last_login || '', createdAt: row.created_at, updatedAt: row.updated_at,
        hasPin: Boolean(row.pin_hash)
      }
      : { ...rowToRecord(row), hasPin: undefined }));
  }

  userGet(id, { includeSecrets = false } = {}) {
    if (includeSecrets) return this.usersList({ includeSecrets: true }).find((user) => user.id === id) || null;
    return this.get('users', id);
  }

  /** Update authentication secrets/state. Secret columns live only in the table —
   *  the payload (what any reader sees) is re-sanitized on every write. */
  setUserSecrets(userId, fields = {}) {
    const columnMap = {
      pinHash: 'pin_hash', pinSalt: 'pin_salt', kdf: 'kdf',
      failedAttempts: 'failed_attempts', lockedUntil: 'locked_until', lastLogin: 'last_login'
    };
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      const column = columnMap[key];
      if (!column) continue;
      assignments.push(`${column} = ?`);
      params.push(value ?? (column === 'last_login' ? '' : 0));
    }
    if (!assignments.length) return;
    const record = this.get('users', userId) || { id: userId };
    const sanitized = { ...record, failedAttempts: fields.failedAttempts ?? record.failedAttempts ?? 0, lockedUntil: fields.lockedUntil ?? record.lockedUntil ?? 0, lastLogin: fields.lastLogin ?? record.lastLogin ?? null };
    assignments.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(JSON.stringify({ ...sanitized, pinHash: '', pinSalt: '' }));
    assignments.push('payload = ?');
    params.push(userId);
    this.ws.run(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  activeUserCount() {
    return Number(this.ws.queryOne('SELECT COUNT(*) AS total FROM users WHERE active = 1')?.total ?? 0);
  }

  activeAdminCount() {
    return Number(this.ws.queryOne("SELECT COUNT(*) AS total FROM users WHERE active = 1 AND role = 'Administrator'")?.total ?? 0);
  }

  anyPinSet() {
    return Number(this.ws.queryOne("SELECT COUNT(*) AS total FROM users WHERE pin_hash <> '' AND active = 1")?.total ?? 0) > 0;
  }

  // ---- notifications / audit -------------------------------------------------------------

  notificationsActive(limit = 100) {
    return this.ws.listRecords('notifications', { where: 'dismissed = 0', params: [], order: 'date DESC, created_at DESC', limit });
  }

  auditInsert(entry) {
    this.ws.upsertRecord('audit', entry);
  }

  listAudit({ query = '', page = 1, pageSize = 50, entity = '', userId = '', from = '', to = '' } = {}) {
    const where = []; const params = [];
    if (query) {
      const like = `%${escapeLike(query.toLowerCase())}%`;
      where.push("(LOWER(action) LIKE ? ESCAPE '\\' OR LOWER(entity) LIKE ? ESCAPE '\\' OR LOWER(summary) LIKE ? ESCAPE '\\' OR LOWER(user_name) LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    if (entity) { where.push('entity = ?'); params.push(entity); }
    if (userId) { where.push('user_id = ?'); params.push(userId); }
    if (from) { where.push('created_at >= ?'); params.push(from); }
    if (to) { where.push('created_at <= ?'); params.push(`${to}T23:59:59.999Z`); }
    const whereSql = where.join(' AND ');
    const total = this.ws.countRecords('audit', { where: whereSql, params });
    const rows = this.ws.listRecords('audit', { where: whereSql, params, order: 'seq DESC', limit: pageSize, offset: (Math.max(1, page) - 1) * pageSize });
    return { rows, total, page: Math.max(1, page), pageSize };
  }

  // ---- aggregate scans (indexed range queries, bounded) ----------------------------------

  paymentsInRange(from, to) {
    const where = []; const params = [];
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    return this.ws.listRecords('payments', { where: where.join(' AND '), params, order: 'date ASC', limit: 20000 });
  }

  invoicesInRange(from, to) {
    const where = []; const params = [];
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    return this.ws.listRecords('invoices', { where: where.join(' AND '), params, order: 'date ASC', limit: 20000 });
  }

  invoicesOutstanding(limit = 2000) {
    return this.ws.listRecords('invoices', { where: "status NOT IN ('Paid','Cancelled') AND due_cents > 0", params: [], order: 'date ASC', limit });
  }

  expensesInRange(from, to) {
    const where = []; const params = [];
    if (from) { where.push('date >= ?'); params.push(from); }
    if (to) { where.push('date <= ?'); params.push(to); }
    return this.ws.listRecords('expenses', { where: where.join(' AND '), params, order: 'date ASC', limit: 20000 });
  }

  patientsRegisteredInRange(from, to) {
    return this.ws.listRecords('patients', { where: 'registration_date >= ? AND registration_date <= ?', params: [from, to], order: 'registration_date ASC', limit: 20000 });
  }

  // ---- SQL-level aggregates (no record hydration) -------------------------------------------

  sqlAggregates() {
    const money = (sql, params = []) => Number(this.ws.queryOne(sql, params)?.cents ?? 0);
    return {
      totals: {
        patients: this.ws.countRecords('patients', { where: 'archived = 0' }),
        invoicesOutstandingCents: money("SELECT COALESCE(SUM(due_cents),0) AS cents FROM invoices WHERE status NOT IN ('Paid','Cancelled')"),
        stockValueCents: money('SELECT COALESCE(SUM(current_stock * purchase_price_cents),0) AS cents FROM inventory WHERE archived = 0'),
        lowStockItems: Number(this.ws.queryOne('SELECT COUNT(*) AS total FROM inventory WHERE archived = 0 AND current_stock <= MAX(minimum_stock, reorder_threshold)')?.total ?? 0),
        expiringItems: Number(this.ws.queryOne("SELECT COUNT(*) AS total FROM inventory WHERE archived = 0 AND expiry_date <> '' AND expiry_date <= date('now', '+30 day')")?.total ?? 0),
        openFollowups: Number(this.ws.queryOne("SELECT COUNT(*) AS total FROM follow_up_tasks WHERE status IN ('Open','Contacted','Scheduled')")?.total ?? 0),
        overdueFollowups: Number(this.ws.queryOne("SELECT COUNT(*) AS total FROM follow_up_tasks WHERE status = 'Open' AND due_date <> '' AND due_date < date('now')")?.total ?? 0)
      }
    };
  }

  // ---- generic listing / report stats (see list-sql.mjs) ---------------------------------

  listCollection(collection, opts = {}) { return listCollectionSql(this, collection, opts); }

  reportStats(kind, from = '', to = '') { return reportStatsSql(this, kind, from, to); }

  patientRecordCounts(patientId) { return patientRecordCountsSql(this, patientId); }

  // ---- files / diagnostics --------------------------------------------------------------------

  writeAttachmentFile(id, buffer) { return this.ws.writeAttachmentFile(id, buffer); }
  readAttachmentFile(relativePath) { return this.ws.readAttachmentFile(relativePath); }
  removeAttachmentFile(relativePath) { return this.ws.removeAttachmentFile(relativePath); }
  cleanupOrphanAttachmentFiles() { return this.ws.cleanupOrphanAttachmentFiles(); }
  freeDiskBytes() { return this.ws.freeDiskBytes(); }
  storageInfo() { return this.ws.storageInfo(); }
  integrityCheck() { return this.ws.integrityCheck(); }
  counts() { return this.ws.recordCounts(); }
  transaction(fn) { return this.ws.transaction(() => fn(this)); }
}
