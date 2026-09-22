// Dentiva Pro v1.4.0 — browser repository (LocalRepo).
//
// The SAME operations and queries that run against the SQLite store on desktop
// run against this in-memory + localStorage implementation in the browser
// (vite dev mode, visual tests, CI smoke). It mirrors the SqlRepo surface one
// to one — money stays integer-cent on read, listing/pagination/search and
// report stats follow the SQL semantics — so no behaviour exists in only one
// runtime. The persisted shape is the classic Dentiva state object under the
// v2 storage key, which the desktop migration engine also understands.

import { ARRAY_COLLECTIONS, moneyToCents, centsToMoney, paymentStatusFor, toNumber, hasPermission, permissionsForRole, validateRelationships } from './core.js';
import { migrateState, defaultState, APP_VERSION, META_KEYS, DEFAULT_SETTINGS } from './migrate-state.js';

export const LOCAL_STORAGE_KEY = 'dentiva-pro.store.v2';
export const LOCAL_LEGACY_KEY = 'dentiva-pro.store.v1';
export const LOCAL_ATTACHMENTS_KEY = 'dentiva-pro.attachments.v1';

const str = (value) => String(value ?? '').trim();
const phoneNorm = (value) => str(value).replace(/\D/g, '').replace(/^880/, '').replace(/^0/, '');
const isoDate = (date = new Date()) => date.toISOString().slice(0, 10);

/** moneyToCents over a record field that may already be cents or decimal. */
/* Decimal fields are authoritative (the desktop mappers derive every cents
 * column from the decimal payload), so prefer them when present; the camelCase
 * cents fields are a fallback for records stored without the decimal twin. */
const fieldCents = (record, camelField, decimalField) => {
  if (decimalField && record && record[decimalField] !== undefined && record[decimalField] !== null && record[decimalField] !== '') return Math.max(0, moneyToCents(record[decimalField]));
  if (record && record[camelField] !== undefined && record[camelField] !== null && record[camelField] !== '') return Math.max(0, Math.round(Number(record[camelField])));
  return 0;
};

/* Compact synchronous SHA-256 (hex) — browser fallback for checksums where
 * Node's crypto is unavailable. Deterministic, same output as crypto.subtle. */
const sha256Hex = (data) => {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const length = bytes.length;
  const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const bitLen = length * 8;
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[padded.length - 8] = (hi >>> 24) & 0xff;
  padded[padded.length - 7] = (hi >>> 16) & 0xff;
  padded[padded.length - 6] = (hi >>> 8) & 0xff;
  padded[padded.length - 5] = hi & 0xff;
  padded[padded.length - 4] = (lo >>> 24) & 0xff;
  padded[padded.length - 3] = (lo >>> 16) & 0xff;
  padded[padded.length - 2] = (lo >>> 8) & 0xff;
  padded[padded.length - 1] = lo & 0xff;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = (padded[offset + t * 4] << 24) | (padded[offset + t * 4 + 1] << 16) | (padded[offset + t * 4 + 2] << 8) | padded[offset + t * 4 + 3];
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
};

const base64Encode = (bytes) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return (typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64'));
};

const base64Decode = (encoded) => {
  const binary = typeof atob !== 'undefined' ? atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/* List specifications — mirror electron/lib/list-sql.mjs (camelCase fields). */
const LIST_SPECS = {
  appointments: { text: ['reason', 'treatment', 'appointmentCode', 'serial'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  visits: { text: ['visitCode', 'reason', 'chiefComplaint', 'diagnosis', 'treatmentPerformed', 'findings'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  invoices: { text: ['invoiceNumber', 'notes'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'total-desc', 'due-desc', 'recent'] },
  payments: { text: ['receiptNumber', 'reference', 'transactionId', 'notes'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'amount-desc'] },
  paymentAdjustments: { text: ['reason'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  expenses: { text: ['description', 'reference', 'notes'], date: 'date', sorts: ['date', 'date-desc', 'amount-desc', 'recent'] },
  stockMovements: { text: ['reason', 'notes'], date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  suppliers: { text: ['name', 'code', 'contactPerson', 'phone', 'email'], sorts: ['name', 'name-desc', 'recent'] },
  staff: { text: ['name', 'staffCode', 'role', 'specialization', 'phone', 'email'], sorts: ['name', 'name-desc', 'recent'] },
  referrals: { text: ['referralTo', 'specialty', 'reason', 'response'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  attachments: { text: ['name', 'notes'], joinPatient: true, sorts: ['recent', 'name', 'size-desc'] },
  followUpTasks: { text: ['title', 'reason', 'notes'], joinPatient: true, date: 'dueDate', sorts: ['due', 'due-desc', 'recent'] },
  treatmentPlans: { text: ['title', 'goal', 'notes'], joinPatient: true, sorts: ['recent', 'start', 'total-desc'] },
  prescriptions: { text: ['prescriptionCode', 'doctor', 'notes'], joinPatient: true, date: 'date', sorts: ['date', 'date-desc', 'recent'] },
  dentalRecords: { text: ['note', 'procedure', 'tooth'], joinPatient: true, sorts: ['recent', 'tooth'] },
  treatments: { text: ['name', 'code', 'category', 'description'], sorts: ['name', 'price-desc', 'recent'] },
  notifications: { text: ['title', 'message'], sorts: ['recent'] },
  medicationCatalog: { text: ['name', 'strength', 'dosage', 'frequency'], sorts: ['name'] },
  rooms: { text: ['name'], sorts: ['name'] },
  savedFilters: { text: ['name', 'query'], sorts: ['recent', 'name'] },
  savedReports: { text: ['name'], sorts: ['name'] },
  notificationRules: { text: ['kind'], sorts: [] }
};

/* Read-time hydration: mirrors the desktop rowToRecord enrichment so every
 * money record exposes its authoritative camelCase *_cents fields whether the
 * store is SQLite or the browser fallback. Copies — stored records are not
 * mutated by reads. */
const CENTS_FIELDS = {
  invoices: [['subtotalCents', 'subtotal'], ['discountCents', 'discount'], ['taxCents', 'tax'], ['totalCents', 'total'], ['paidCents', 'paid'], ['dueCents', 'due']],
  payments: [['amountCents', 'amount'], ['refundedCents', 'refundedAmount']],
  paymentAdjustments: [['amountCents', 'amount']],
  expenses: [['amountCents', 'amount']],
  inventory: [['purchasePriceCents', 'purchasePrice'], ['salePriceCents', 'salePrice']],
  treatments: [['defaultPriceCents', 'defaultPrice']],
  treatmentPlans: [['estimatedCostCents', 'estimatedCost'], ['discountCents', 'discount'], ['estimatedTotalCents', 'estimatedTotal']]
};
function hydrate(record, collection) {
  if (!record || typeof record !== 'object') return record;
  const fields = CENTS_FIELDS[collection];
  if (!fields) return record;
  // Decimal fields are the authoritative input (same rule as the desktop
  // mappers): recompute cents on every read so a record that was saved from a
  // previously hydrated copy can never carry stale money values.
  const out = { ...record };
  for (const [camel, decimal] of fields) {
    if (out[decimal] !== undefined && out[decimal] !== null && out[decimal] !== '') {
      out[camel] = Math.max(0, moneyToCents(out[decimal]));
    } else if (out[camel] === undefined) {
      out[camel] = 0;
    }
  }
  return out;
}

export class LocalRepo {
  constructor({ storage = null } = {}) {
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.state = this.#loadState();
    this.attachments = this.#loadAttachments();
    this.#externalizeInlineAttachmentData();
    this.dirty = false;
  }

  #rawState() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(LOCAL_STORAGE_KEY) || this.storage.getItem(LOCAL_LEGACY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  #loadState() {
    const raw = this.#rawState();
    const migrated = migrateState(raw && typeof raw === 'object' ? raw : null);
    if (!Array.isArray(migrated.audit)) migrated.audit = [];
    return migrated;
  }

  #loadAttachments() {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(LOCAL_ATTACHMENTS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /** v1.3.0 stored attachment bytes inline; externalize once on load. */
  #externalizeInlineAttachmentData() {
    let changed = false;
    for (const record of this.state.attachments || []) {
      if (!record || !record.data || !/^data:[^;]+;base64,/.test(String(record.data))) continue;
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(String(record.data));
      if (!match) continue;
      this.attachments[record.id] = {
        dataUrl: record.data,
        relativePath: record.filePath || `attachments/${record.id}.bin`,
        checksum: record.checksum || '',
        bytes: Math.floor(((match[2].length * 3) / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0))
      };
      record.filePath = record.filePath || `attachments/${record.id}.bin`;
      record.data = '';
      changed = true;
    }
    if (changed) this.save();
  }

  save() {
    if (!this.storage) return;
    try {
      this.state.updatedAt = new Date().toISOString();
      this.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.state));
      this.storage.setItem(LOCAL_ATTACHMENTS_KEY, JSON.stringify(this.attachments));
      this.dirty = false;
    } catch (error) {
      console.error('Dentiva Pro local store save failed', error);
      throw error;
    }
  }

  reset() {
    this.state = defaultState();
    this.attachments = {};
    this.save();
  }

  // ---- meta / settings -----------------------------------------------------

  get db() { return null; } // parity with SqlRepo surface (unused in browser)
  getMeta(key, fallback = null) {
    const value = this.state[key];
    return value === undefined || value === null ? fallback : value;
  }
  setMeta(key, value) {
    this.state[key] = value;
    this.save();
  }
  getAllMeta() {
    const meta = {};
    for (const key of META_KEYS) if (this.state[key] !== undefined) meta[key] = this.state[key];
    return meta;
  }
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...(this.state.settings || {}) };
  }
  getCounters() {
    return this.state.counters && typeof this.state.counters === 'object' ? this.state.counters : {};
  }
  nextCounter(kind) {
    const counters = this.state.counters || (this.state.counters = {});
    const value = Math.max(1, Math.round(Number(counters[kind]) || 1));
    counters[kind] = value + 1;
    this.save();
    return value;
  }

  // ---- records -------------------------------------------------------------

  #collection(collection) {
    if (!Array.isArray(this.state[collection])) this.state[collection] = [];
    return this.state[collection];
  }

  get(collection, id) {
    if (!id) return null;
    const record = this.#collection(collection).find((entry) => entry && entry.id === id) || null;
    return record ? hydrate(record, collection) : null;
  }
  insert(collection, record, _extra = {}) {
    const list = this.#collection(collection);
    const index = list.findIndex((entry) => entry && entry.id === record.id);
    if (index >= 0) list[index] = record;
    else list.push(record);
    this.save();
    return record;
  }
  update(collection, record, _extra = {}) {
    return this.insert(collection, record);
  }
  remove(collection, id) {
    const list = this.#collection(collection);
    const index = list.findIndex((entry) => entry && entry.id === id);
    if (index >= 0) list.splice(index, 1);
    this.save();
  }
  all(collection, _order = '') {
    return this.#collection(collection).map((record) => hydrate(record, collection));
  }
  byIds(collection, ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    return this.#collection(collection).filter((record) => record && wanted.has(record.id)).map((record) => hydrate(record, collection));
  }
  clearCollection(collection) {
    this.state[collection] = [];
    this.save();
  }
  transaction(fn) {
    // The browser store commits synchronously per record; a transaction is a
    // logical grouping with the same call shape as the SQL workspace.
    return fn(this);
  }

  counts() {
    const counts = {};
    for (const collection of ARRAY_COLLECTIONS) counts[collection] = this.#collection(collection).length;
    return counts;
  }
  countRecords() { return this.counts(); }

  // ---- patient domain ------------------------------------------------------

  patientByCode(code) {
    const wanted = str(code).toLowerCase();
    return this.#collection('patients').find((record) => str(record.patientCode).toLowerCase() === wanted) || null;
  }
  patientByPhoneNorm(phone) {
    const norm = phoneNorm(phone);
    if (!norm) return null;
    return this.#collection('patients').find((record) => phoneNorm(record.phone) === norm) || null;
  }
  findPatientDuplicates({ fullName = '', phone = '', email = '', dateOfBirth = '', patientCode = '', excludeId = '' }) {
    const nameNorm = str(fullName).toLowerCase();
    const norm = phoneNorm(phone);
    const emailNorm = str(email).toLowerCase();
    const candidates = this.#collection('patients').filter((record) => record && record.id !== excludeId);
    return candidates.filter((record) => {
      const sameCode = patientCode && str(record.patientCode).toLowerCase() === str(patientCode).toLowerCase();
      const samePhone = norm && phoneNorm(record.phone) === norm;
      const sameNamePhone = samePhone && str(record.fullName).toLowerCase() === nameNorm;
      const sameEmail = emailNorm && str(record.email).toLowerCase() === emailNorm;
      const sameDob = dateOfBirth && record.dateOfBirth === dateOfBirth && str(record.fullName).toLowerCase() === nameNorm;
      return Boolean(sameCode || sameNamePhone || sameEmail || sameDob);
    }).slice(0, 25);
  }

  updatePatientBalance(patientId) {
    if (!patientId) return 0;
    const invoices = this.#collection('invoices');
    const payments = this.#collection('payments');
    const adjustments = this.#collection('paymentAdjustments');
    const patientOf = (id) => { const invoice = invoices.find((entry) => entry && entry.id === id); return invoice ? invoice.patientId : ''; };
    const charges = invoices
      .filter((invoice) => invoice && invoice.patientId === patientId && invoice.status !== 'Cancelled')
      .reduce((sum, invoice) => sum + fieldCents(invoice, 'totalCents', 'total'), 0);
    const credits = payments
      .filter((payment) => payment && payment.status !== 'Voided' && payment.status !== 'Cancelled' && (payment.patientId === patientId || (payment.invoiceId && patientOf(payment.invoiceId) === patientId)))
      .reduce((sum, payment) => sum + Math.max(0, moneyToCents(payment.amount) - moneyToCents(payment.refundedAmount)), 0);
    const forgiven = adjustments
      .filter((adjustment) => adjustment && adjustment.type === 'Adjustment' && (adjustment.patientId === patientId || (adjustment.invoiceId && patientOf(adjustment.invoiceId) === patientId)))
      .reduce((sum, adjustment) => sum + moneyToCents(adjustment.amount), 0);
    const balance = charges - credits - forgiven;
    const patient = this.#collection('patients').find((entry) => entry && entry.id === patientId);
    if (patient) patient.balanceCents = balance;
    this.save();
    return balance;
  }

  reassignPatientRecords(fromPatientId, toPatientId) {
    const tables = ['appointments', 'visits', 'prescriptions', 'dentalRecords', 'treatmentPlans', 'invoices', 'payments', 'paymentAdjustments', 'referrals', 'attachments', 'followUpTasks'];
    let moved = 0;
    for (const table of tables) {
      for (const record of this.#collection(table)) {
        if (record && record.patientId === fromPatientId) {
          record.patientId = toPatientId;
          moved += 1;
        }
      }
    }
    this.save();
    return moved;
  }

  patientRecordCounts(patientId) {
    const tables = {
      visits: 'visits', appointments: 'appointments', invoices: 'invoices', payments: 'payments',
      prescriptions: 'prescriptions', treatmentPlans: 'treatmentPlans', referrals: 'referrals',
      attachments: 'attachments', followUpTasks: 'followUpTasks', dentalRecords: 'dentalRecords'
    };
    const out = {};
    for (const [key, table] of Object.entries(tables)) {
      out[key] = this.#collection(table).filter((record) => record && record.patientId === patientId).length;
    }
    return out;
  }

  // ---- clinical / billing relationships --------------------------------------

  appointmentsOnDate(date) {
    return this.#collection('appointments')
      .filter((record) => record && record.date === date)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }
  appointmentsInRange(from, to) {
    return this.#collection('appointments')
      .filter((record) => record && (!from || record.date >= from) && (!to || record.date <= to))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }
  appointmentsByPatient(patientId, limit = 200) {
    return this.#collection('appointments')
      .filter((record) => record && record.patientId === patientId)
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, limit);
  }
  visitsByPatient(patientId, limit = 500) {
    return this.#collection('visits')
      .filter((record) => record && record.patientId === patientId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit);
  }
  visitsInRange(from, to) {
    return this.#collection('visits').filter((record) => record && (!from || record.date >= from) && (!to || record.date <= to));
  }
  paymentsByPatient(patientId, limit = 500) {
    return this.#collection('payments').filter((record) => record && record.patientId === patientId).slice(0, limit).map((record) => hydrate(record, 'payments'));
  }
  paymentsByInvoice(invoiceId) {
    return this.#collection('payments').filter((record) => record && record.invoiceId === invoiceId).map((record) => hydrate(record, 'payments'));
  }
  paymentsInRange(from, to) {
    return this.#collection('payments').filter((record) => record && (!from || record.date >= from) && (!to || record.date <= to)).map((record) => hydrate(record, 'payments'));
  }
  invoicesByPatient(patientId, limit = 500) {
    return this.#collection('invoices').filter((record) => record && record.patientId === patientId).slice(0, limit).map((record) => hydrate(record, 'invoices'));
  }
  invoicesInRange(from, to) {
    return this.#collection('invoices').filter((record) => record && (!from || record.date >= from) && (!to || record.date <= to)).map((record) => hydrate(record, 'invoices'));
  }
  invoicesOutstanding(limit = 2000) {
    return this.#collection('invoices')
      .filter((record) => record && !['Paid', 'Cancelled'].includes(record.status) && fieldCents(record, 'dueCents', 'due') > 0)
      .slice(0, limit).map((record) => hydrate(record, 'invoices'));
  }
  expensesInRange(from, to) {
    return this.#collection('expenses').filter((record) => record && (!from || record.date >= from) && (!to || record.date <= to)).map((record) => hydrate(record, 'expenses'));
  }
  patientsRegisteredInRange(from, to) {
    return this.#collection('patients').filter((record) => record && (!from || record.registrationDate >= from) && (!to || record.registrationDate <= to));
  }
  adjustmentsByPatient(patientId, limit = 500) {
    return this.#collection('paymentAdjustments').filter((record) => record && record.patientId === patientId).slice(0, limit).map((record) => hydrate(record, 'paymentAdjustments'));
  }
  adjustmentsByPayment(paymentId) {
    return this.#collection('paymentAdjustments').filter((record) => record && record.paymentId === paymentId).map((record) => hydrate(record, 'paymentAdjustments'));
  }
  adjustmentsByInvoice(invoiceId) {
    return this.#collection('paymentAdjustments').filter((record) => record && record.invoiceId === invoiceId).map((record) => hydrate(record, 'paymentAdjustments'));
  }
  invoiceByNumber(number) {
    const wanted = str(number).toLowerCase();
    return this.#collection('invoices').find((record) => record && str(record.invoiceNumber).toLowerCase() === wanted) || null;
  }
  dentalCurrent(patientId) {
    return this.#collection('dentalRecords')
      .filter((record) => record && record.patientId === patientId && !record.superseded)
      .sort((a, b) => (a.dentition === b.dentition ? a.tooth - b.tooth : a.dentition.localeCompare(b.dentition)));
  }
  dentalHistory(patientId, tooth = null) {
    return this.#collection('dentalRecords')
      .filter((record) => record && record.patientId === patientId && (tooth === null || Number(record.tooth) === Number(tooth)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  supersedeDental(patientId, tooth, dentition) {
    let touched = 0;
    for (const record of this.#collection('dentalRecords')) {
      if (record && record.patientId === patientId && Number(record.tooth) === Number(tooth) && (record.dentition || 'adult') === (dentition || 'adult') && !record.superseded) {
        record.superseded = true;
        record.updatedAt = new Date().toISOString();
        touched += 1;
      }
    }
    if (touched) this.save();
    return touched;
  }
  prescriptionsByPatient(patientId, limit = 300) {
    return this.#collection('prescriptions').filter((record) => record && record.patientId === patientId).slice(0, limit);
  }
  plansByPatient(patientId) {
    return this.#collection('treatmentPlans').filter((record) => record && record.patientId === patientId);
  }
  referralsByPatient(patientId) {
    return this.#collection('referrals').filter((record) => record && record.patientId === patientId);
  }
  attachmentsByPatient(patientId) {
    return this.#collection('attachments').filter((record) => record && record.patientId === patientId);
  }
  followupsByPatient(patientId) {
    return this.#collection('followUpTasks').filter((record) => record && record.patientId === patientId);
  }
  followupsOpen(today, limit = 300) {
    return this.#collection('followUpTasks')
      .filter((record) => record && ['Open', 'Contacted', 'Scheduled'].includes(record.status))
      .filter((record) => !today || record.dueDate <= today)
      .slice(0, limit);
  }
  visitsWithFollowupDue(today, limit = 300) {
    return this.#collection('visits')
      .filter((record) => record && record.followUpDate && (!today || record.followUpDate <= today))
      .slice(0, limit);
  }
  movementsByItem(itemId, limit = 200) {
    return this.#collection('stockMovements')
      .filter((record) => record && record.itemId === itemId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit);
  }

  // ---- users ------------------------------------------------------------------

  #sanitizeUser(user) {
    if (!user) return null;
    const { pinHash, pinSalt, ...safe } = user;
    return { ...safe, hasPin: Boolean(pinHash || user.hasPin) };
  }
  usersList(_options = {}) {
    return this.#collection('users').map((user) => this.#sanitizeUser(user));
  }
  userGet(id, { includeSecrets = false } = {}) {
    const user = this.#collection('users').find((record) => record && record.id === id);
    if (!user) return null;
    return includeSecrets ? { ...user } : this.#sanitizeUser(user);
  }
  setUserSecrets(userId, fields = {}) {
    const user = this.#collection('users').find((record) => record && record.id === userId);
    if (!user) return null;
    Object.assign(user, fields);
    this.save();
    return this.#sanitizeUser(user);
  }
  activeUserCount() {
    return this.#collection('users').filter((user) => user && user.active !== false).length;
  }
  activeAdminCount() {
    return this.#collection('users').filter((user) => user && user.active !== false && user.role === 'Administrator').length;
  }
  anyPinSet() {
    return this.#collection('users').some((user) => user && user.active !== false && user.pinHash);
  }

  // ---- audit / notifications ----------------------------------------------------

  auditInsert(entry) {
    this.#collection('audit').push(entry);
    this.save();
    return entry;
  }
  notificationsActive(limit = 100) {
    return this.#collection('notifications')
      .filter((record) => record && record.dismissed !== true)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, limit);
  }

  // ---- attachments ------------------------------------------------------------

  freeDiskBytes() {
    return null; // unknown in the browser; guards treat null as "no limit"
  }
  writeAttachmentFile(id, bytes) {
    const buffer = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
    const dataUrl = `data:application/octet-stream;base64,${base64Encode(buffer)}`;
    const relativePath = `attachments/${id}.bin`;
    const checksum = sha256Hex(buffer);
    this.attachments[id] = { dataUrl, relativePath, checksum, bytes: buffer.length };
    this.save();
    return { relativePath, checksum, bytes: buffer.length };
  }
  readAttachmentFile(relativePath) {
    const wanted = String(relativePath || '').replace(/\\/g, '/');
    const match = Object.values(this.attachments).find((entry) => entry && entry.relativePath.replace(/\\/g, '/') === wanted);
    if (!match) {
      const byId = Object.values(this.attachments).find((entry) => entry && entry.relativePath.replace(/\\/g, '/').endsWith(`/${wanted.split('/').pop()}`));
      if (!byId) return null;
      return base64Decode(byId.dataUrl.split(',', 2)[1]);
    }
    return base64Decode(match.dataUrl.split(',', 2)[1]);
  }
  removeAttachmentFile(relativePath) {
    const wanted = String(relativePath || '').replace(/\\/g, '/');
    for (const [id, entry] of Object.entries(this.attachments)) {
      if (entry && entry.relativePath.replace(/\\/g, '/') === wanted) {
        delete this.attachments[id];
        this.save();
        return true;
      }
    }
    return false;
  }

  // ---- generic listing (mirrors list-sql.mjs semantics) --------------------------

  #patientById(id) {
    return this.#collection('patients').find((record) => record && record.id === id) || null;
  }

  #matchesQuery(record, spec, query) {
    const wanted = String(query).toLowerCase();
    const fields = spec.text.map((field) => {
      const value = record[field];
      if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? Object.values(item).join(' ') : String(item ?? ''))).join(' ');
      return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    });
    if (spec.joinPatient) {
      const patient = this.#patientById(record.patientId);
      if (patient) fields.push(patient.fullName, patient.patientCode, phoneNorm(patient.phone));
    }
    return fields.some((value) => value.toLowerCase().includes(wanted));
  }

  #applyFilters(records, collection, f = {}) {
    const patientsById = new Map(this.#collection('patients').map((patient) => [patient.id, patient]));
    const patientOf = (record) => patientsById.get(record.patientId) || null;
    return records.filter((record) => {
      if (!record) return false;
      if (f.patientId && record.patientId !== f.patientId) return false;
      if (f.date && record.date !== f.date) return false;
      if (f.from && record.date && record.date < f.from) return false;
      if (f.to && record.date && record.date > f.to) return false;
      if (f.status) {
        if (collection === 'patients') {
          const archived = record.archived === true;
          if (f.status === 'active' && archived) return false;
          if (f.status === 'archived' && !archived) return false;
        } else if (record.status !== f.status) return false;
      }
      if (f.dentistId && record.dentistId !== f.dentistId) return false;
      if (f.chair && record.chair !== f.chair) return false;
      if (f.room && record.room !== f.room) return false;
      if (f.method && record.method !== f.method) return false;
      if (f.category && record.category !== f.category) return false;
      if (f.visitId && record.visitId !== f.visitId) return false;
      if (f.invoiceId && record.invoiceId !== f.invoiceId) return false;
      if (f.paymentId && record.paymentId !== f.paymentId) return false;
      if (f.itemId && record.itemId !== f.itemId) return false;
      if (f.supplierId && record.supplierId !== f.supplierId) return false;
      if (f.type && record.type !== f.type) return false;
      if (f.entity && record.entity !== f.type && record.entity !== f.entity) return false;
      if (f.kind && record.kind !== f.kind) return false;
      if (f.enabled !== undefined && Boolean(record.enabled) !== Boolean(f.enabled)) return false;
      if (f.read !== undefined && Boolean(record.read) !== Boolean(f.read)) return false;
      if (f.dismissed !== undefined && Boolean(record.dismissed) !== Boolean(f.dismissed)) return false;
      if (f.dueBefore && (!record.dueDate || record.dueDate > f.dueBefore)) return false;
      if (f.dueAfter && (!record.dueDate || record.dueDate < f.dueAfter)) return false;
      if (f.tooth && Number(record.tooth) !== Number(f.tooth)) return false;
      if (f.dentition && (record.dentition || 'adult') !== f.dentition) return false;
      if (f.currentOnly && record.superseded) return false;
      if (f.hasPhone && !record.phone) return false;
      if (f.dateFrom && record.date && record.date < f.dateFrom) return false;
      if (f.dateTo && record.date && record.date > f.dateTo) return false;
      if (f.registeredFrom && record.registrationDate && record.registrationDate < f.registeredFrom) return false;
      if (f.registeredTo && record.registrationDate && record.registrationDate > f.registeredTo) return false;
      if (f.balance === 'outstanding' && fieldCents(record, 'balanceCents', null) <= 0) return false;
      if (f.balance === 'clear' && fieldCents(record, 'balanceCents', null) > 0) return false;
      if (collection === 'inventory') {
        if (f.archived === 'exclude' && record.archived) return false;
        if (f.archived === 'only' && !record.archived) return false;
        if (f.lowStock) {
          const threshold = Math.max(toNumber(record.minimumStock) || 0, toNumber(record.reorderThreshold) || 0, Number(f.lowStockThreshold) || 0);
          if (toNumber(record.currentStock) > threshold) return false;
        }
        if (f.expiringBefore && (!record.expiryDate || record.expiryDate > f.expiringBefore)) return false;
      }
      if (collection === 'invoices' && f.outstanding) {
        if (['Paid', 'Cancelled'].includes(record.status) || fieldCents(record, 'dueCents', 'due') <= 0) return false;
      }
      if (collection === 'treatments' && f.archived !== 'include' && record.archived) return false;
      return true;
    });
  }

  #sortRecords(records, collection, sort) {
    const byString = (key) => (a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
    const byCentsDesc = (camel, decimal) => (a, b) => fieldCents(b, camel, decimal) - fieldCents(a, camel, decimal);
    const today = isoDate();
    const comparators = {
      name: byString('name'),
      'name-desc': (a, b) => String(b.name ?? '').localeCompare(String(a.name ?? '')),
      code: byString('patientCode'),
      recent: (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
      oldest: (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
      date: (a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`),
      'date-desc': (a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`),
      'total-desc': byCentsDesc('totalCents', 'total'),
      'due-desc': byCentsDesc('dueCents', 'due'),
      'amount-desc': byCentsDesc('amountCents', 'amount'),
      'size-desc': (a, b) => Number(b.size || 0) - Number(a.size || 0),
      'price-desc': byCentsDesc('defaultPriceCents', 'defaultPrice'),
      'value-desc': (a, b) => toNumber(b.currentStock) * toNumber(b.purchasePrice) - toNumber(a.currentStock) * toNumber(a.purchasePrice),
      'stock-asc': (a, b) => toNumber(a.currentStock) - toNumber(b.currentStock),
      'stock-desc': (a, b) => toNumber(b.currentStock) - toNumber(a.currentStock),
      balance: (a, b) => fieldCents(b, 'balanceCents', null) - fieldCents(a, 'balanceCents', null),
      due: (a, b) => String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')),
      'due-desc': (a, b) => String(b.dueDate ?? '0000').localeCompare(String(a.dueDate ?? '0000')),
      tooth: (a, b) => ((a.dentition || 'adult') === (b.dentition || 'adult') ? a.tooth - b.tooth : (a.dentition || 'adult').localeCompare(b.dentition || 'adult')),
      start: (a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')),
      expiry: (a, b) => {
        const ae = a.expiryDate || ''; const be = b.expiryDate || '';
        if (!ae || !be) return ae === be ? 0 : ae ? -1 : 1;
        return ae.localeCompare(be);
      }
    };
    const comparator = comparators[sort] || (collection === 'patients' ? comparators.name : (comparators.recent || comparators.date || comparators.name));
    return [...records].sort(comparator);
  }

  listPatients({ query = '', status = 'all', balance = 'all', dateFrom = '', dateTo = '', registeredFrom = '', registeredTo = '', hasPhone = false, toothStatus = '', tag = '', page = 1, pageSize = 50, sort = 'name' } = {}) {
    let records = this.#collection('patients');
    if (status === 'active') records = records.filter((record) => record && !record.archived);
    if (status === 'archived') records = records.filter((record) => record && record.archived === true);
    if (query) {
      const wanted = String(query).toLowerCase();
      const norm = phoneNorm(query);
      records = records.filter((record) => {
        if (!record) return false;
        return [record.fullName, record.patientCode, record.phone, norm && phoneNorm(record.phone), record.email, record.address]
          .some((value) => value && String(value).toLowerCase().includes(wanted));
      });
    }
    records = this.#applyFilters(records, 'patients', { balance, dateFrom, dateTo, registeredFrom, registeredTo, hasPhone });
    if (toothStatus) {
      const hasTooth = (patientId) => this.#collection('dentalRecords').some((record) => record && record.patientId === patientId && record.status === toothStatus && !record.superseded);
      records = records.filter((record) => record && hasTooth(record.id));
    }
    if (tag) records = records.filter((record) => record && (record.tags || []).includes(tag));
    const sorted = this.#sortRecords(records, 'patients', sort);
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
    return { rows: sorted.slice((safePage - 1) * safeSize, safePage * safeSize).map((record) => hydrate(record, 'patients')), total: sorted.length, page: safePage, pageSize: safeSize };
  }

  listInventory({ query = '', category = '', supplierId = '', lowStock = false, lowStockThreshold = 0, expiringBefore = '', archived = 'exclude', page = 1, pageSize = 50, sort = 'name' } = {}) {
    let records = this.#collection('inventory');
    if (archived === 'exclude') records = records.filter((record) => record && !record.archived);
    if (archived === 'only') records = records.filter((record) => record && record.archived);
    if (query) {
      const wanted = String(query).toLowerCase();
      records = records.filter((record) => record && [record.name, record.itemCode, record.brand, record.batch, record.lot].some((value) => value && String(value).toLowerCase().includes(wanted)));
    }
    records = records.filter((record) => record && (!category || record.category === category) && (!supplierId || record.supplierId === supplierId));
    if (lowStock) {
      records = records.filter((record) => toNumber(record.currentStock) <= Math.max(toNumber(record.minimumStock) || 0, toNumber(record.reorderThreshold) || 0, Number(lowStockThreshold) || 0));
    }
    if (expiringBefore) records = records.filter((record) => record.expiryDate && record.expiryDate <= expiringBefore);
    const sorted = this.#sortRecords(records, 'inventory', sort);
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
    return { rows: sorted.slice((safePage - 1) * safeSize, safePage * safeSize).map((record) => hydrate(record, 'inventory')), total: sorted.length, page: safePage, pageSize: safeSize };
  }

  listAudit({ query = '', page = 1, pageSize = 50, entity = '', userId = '', from = '', to = '' } = {}) {
    let records = this.#collection('audit');
    if (entity) records = records.filter((record) => record && record.entity === entity);
    if (userId) records = records.filter((record) => record && record.userId === userId);
    if (from) records = records.filter((record) => record && String(record.createdAt || '').slice(0, 10) >= from);
    if (to) records = records.filter((record) => record && String(record.createdAt || '').slice(0, 10) <= to);
    if (query) {
      const wanted = String(query).toLowerCase();
      records = records.filter((record) => record && [record.action, record.entity, record.summary, record.userName].some((value) => value && String(value).toLowerCase().includes(wanted)));
    }
    const sorted = [...records].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
    return { rows: sorted.slice((safePage - 1) * safeSize, safePage * safeSize), total: sorted.length, page: safePage, pageSize: safeSize };
  }

  listCollection(collection, { page = 1, pageSize = 25, query = '', sort = '', filters = {} } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.max(1, Math.min(500, Number(pageSize) || 25));
    const f = filters && typeof filters === 'object' ? filters : {};
    if (collection === 'patients') return this.listPatients({ query, page: safePage, pageSize: safeSize, sort: sort || 'name', ...f });
    if (collection === 'inventory') return this.listInventory({ query, page: safePage, pageSize: safeSize, sort: sort || 'name', ...f });
    if (collection === 'audit') return this.listAudit({ query, page: safePage, pageSize: safeSize, ...f });
    if (collection === 'users') {
      let records = this.usersList();
      if (query) {
        const wanted = String(query).toLowerCase();
        records = records.filter((record) => [record.name, record.role, record.staffId].some((value) => value && String(value).toLowerCase().includes(wanted)));
      }
      const sorted = this.#sortRecords(records, 'staff', sort || 'name');
      return { rows: sorted.slice((safePage - 1) * safeSize, safePage * safeSize), total: sorted.length, page: safePage, pageSize: safeSize };
    }
    const spec = LIST_SPECS[collection] || { text: [], sorts: [] };
    let records = this.#collection(collection);
    if (query) records = records.filter((record) => this.#matchesQuery(record, spec, query));
    records = this.#applyFilters(records, collection, f);
    const sorted = this.#sortRecords(records, collection, sort || (spec.date ? 'date-desc' : 'recent'));
    return { rows: sorted.slice((safePage - 1) * safeSize, safePage * safeSize).map((record) => hydrate(record, collection)), total: sorted.length, page: safePage, pageSize: safeSize };
  }

  // ---- report stats (mirrors reportStatsSql semantics) ----------------------------

  #inRange(record, from, to, dateField = 'date') {
    const value = record[dateField] || record.date;
    return (!from || (value && value >= from)) && (!to || (value && value <= to));
  }

  reportStats(kind, from = '', to = '') {
    const patients = this.#collection('patients');
    const appointments = this.#collection('appointments');
    const visits = this.#collection('visits');
    const invoices = this.#collection('invoices');
    const payments = this.#collection('payments');
    const adjustments = this.#collection('paymentAdjustments');
    const expenses = this.#collection('expenses');
    const inventory = this.#collection('inventory');
    const movements = this.#collection('stockMovements');
    const staff = this.#collection('staff');
    const dentalRecords = this.#collection('dentalRecords');
    const staffName = (id) => (staff.find((member) => member && member.id === id) || {}).name || '';
    const activePayments = (records) => records.filter((record) => record && !['Voided', 'Cancelled'].includes(record.status));
    const money = (records, centsField, decimalField) => records.reduce((sum, record) => sum + fieldCents(record, centsField, decimalField), 0);
    const inRange = (record) => this.#inRange(record, from, to);

    switch (kind) {
      case 'revenue': {
        const active = activePayments(payments.filter(inRange));
        const live = invoices.filter((record) => record && record.status !== 'Cancelled' && inRange(record));
        const spent = expenses.filter(inRange);
        return {
          collectedCents: money(active, 'amountCents', 'amount'),
          billedCents: money(live, 'totalCents', 'total'),
          expensesCents: money(spent, 'amountCents', 'amount'),
          adjustedCents: money(adjustments.filter((record) => record && record.type === 'Adjustment' && inRange(record)), 'amountCents', 'amount'),
          refundedCents: payments.filter(inRange).reduce((sum, record) => sum + moneyToCents(record.refundedAmount), 0),
          paymentCount: active.length,
          invoiceCount: live.length,
          expenseCount: spent.length
        };
      }
      case 'patients': {
        const registered = patients.filter((record) => record && !record.archived && this.#inRange(record, from, to, 'registrationDate'));
        return {
          registered: registered.length,
          totalActive: patients.filter((record) => record && !record.archived).length,
          withPhone: registered.filter((record) => record.phone).length,
          upcoming: patients.filter((record) => record && !record.archived && record.nextVisit && record.nextVisit >= isoDate()).length
        };
      }
      case 'visits': {
        const ranged = visits.filter(inRange);
        return {
          visits: ranged.length,
          uniquePatients: new Set(ranged.map((record) => record.patientId).filter(Boolean)).size,
          withFollowUp: ranged.filter((record) => record.followUpDate).length,
          withTreatment: ranged.filter((record) => record.treatmentPerformed).length
        };
      }
      case 'appointments': {
        const ranged = appointments.filter(inRange);
        const completed = ranged.filter((record) => record.status === 'Completed').length;
        return {
          appointments: ranged.length,
          completed,
          noShows: ranged.filter((record) => record.status === 'No Show').length,
          cancelled: ranged.filter((record) => record.status === 'Cancelled').length,
          completionPct: ranged.length ? Math.round((completed / ranged.length) * 100) : 0
        };
      }
      case 'outstanding': {
        const open = invoices.filter((record) => record && !['Paid', 'Cancelled'].includes(record.status) && fieldCents(record, 'dueCents', 'due') > 0);
        const ranged = open.filter(inRange);
        return {
          dueCents: money(open, 'dueCents', 'due'),
          openInvoices: open.length,
          partiallyPaid: invoices.filter((record) => record && record.status === 'Partially Paid').length,
          unpaid: invoices.filter((record) => record && record.status === 'Issued').length,
          adjusted: invoices.filter((record) => record && record.status === 'Adjusted').length,
          rangedCents: money(ranged, 'dueCents', 'due')
        };
      }
      case 'inventory': {
        const active = inventory.filter((record) => record && !record.archived);
        const now = isoDate();
        return {
          itemsTracked: active.length,
          lowStock: active.filter((record) => toNumber(record.currentStock) <= Math.max(toNumber(record.minimumStock) || 0, toNumber(record.reorderThreshold) || 0)).length,
          expired: active.filter((record) => record.expiryDate && record.expiryDate < now).length,
          unitsOnHand: active.reduce((sum, record) => sum + toNumber(record.currentStock), 0),
          stockValueCents: active.reduce((sum, record) => sum + toNumber(record.currentStock) * moneyToCents(record.purchasePrice), 0)
        };
      }
      case 'expenses': {
        const ranged = expenses.filter(inRange);
        const total = money(ranged, 'amountCents', 'amount');
        return {
          totalCents: total,
          transactions: ranged.length,
          categories: new Set(ranged.map((record) => record.category).filter(Boolean)).size,
          averageCents: ranged.length ? Math.round(total / ranged.length) : 0
        };
      }
      case 'accounting': {
        const active = activePayments(payments.filter(inRange));
        const collected = money(active, 'amountCents', 'amount');
        const spent = expenses.filter(inRange);
        const methods = new Map();
        for (const record of active) {
          const entry = methods.get(record.method || 'Other') || { label: record.method || 'Other', cents: 0, count: 0 };
          entry.cents += moneyToCents(record.amount);
          entry.count += 1;
          methods.set(record.method || 'Other', entry);
        }
        return {
          billedCents: money(invoices.filter((record) => record && record.status !== 'Cancelled' && inRange(record)), 'totalCents', 'total'),
          collectedCents: collected,
          expensesCents: money(spent, 'amountCents', 'amount'),
          adjustedCents: money(adjustments.filter((record) => record && record.type === 'Adjustment' && inRange(record)), 'amountCents', 'amount'),
          refundedCents: payments.filter(inRange).reduce((sum, record) => sum + moneyToCents(record.refundedAmount), 0),
          netOperatingCents: collected - money(spent, 'amountCents', 'amount'),
          receivablesCents: money(invoices.filter((record) => record && !['Paid', 'Cancelled'].includes(record.status)), 'dueCents', 'due'),
          byMethod: [...methods.values()].sort((a, b) => b.cents - a.cents)
        };
      }
      case 'aging': {
        const now = Date.now();
        const days = (record) => Math.floor((now - new Date(record.date || record.createdAt).getTime()) / 86400000);
        const open = invoices.filter((record) => record && !['Paid', 'Cancelled'].includes(record.status) && fieldCents(record, 'dueCents', 'due') > 0);
        const bucket = (label, lo, hi) => {
          const members = open.filter((record) => days(record) >= lo && (hi === null || days(record) <= hi));
          return { label, cents: money(members, 'dueCents', 'due'), count: members.length };
        };
        return { rows: [bucket('Current (0–30 days)', 0, 30), bucket('31–60 days', 31, 60), bucket('61–90 days', 61, 90), bucket('Over 90 days', 91, null)] };
      }
      case 'expenseCategories': {
        const groups = new Map();
        for (const record of expenses.filter(inRange)) {
          const key = record.category || 'Other';
          const entry = groups.get(key) || { label: key, cents: 0, count: 0 };
          entry.cents += moneyToCents(record.amount);
          entry.count += 1;
          groups.set(key, entry);
        }
        return { rows: [...groups.values()].sort((a, b) => b.cents - a.cents).slice(0, 25) };
      }
      case 'analytics': {
        const active = activePayments(payments.filter(inRange));
        const months = new Map();
        for (const record of active) {
          const month = String(record.date || '').slice(0, 7);
          if (!month) continue;
          months.set(month, (months.get(month) || 0) + moneyToCents(record.amount));
        }
        const visitMonths = new Map();
        for (const record of visits.filter(inRange)) {
          const month = String(record.date || '').slice(0, 7);
          if (!month) continue;
          visitMonths.set(month, (visitMonths.get(month) || 0) + 1);
        }
        const methods = new Map();
        for (const record of active) {
          const key = record.method || 'Other';
          methods.set(key, (methods.get(key) || 0) + moneyToCents(record.amount));
        }
        return {
          totals: {
            collectedCents: money(active, 'amountCents', 'amount'),
            billedCents: money(invoices.filter((record) => record && record.status !== 'Cancelled' && inRange(record)), 'totalCents', 'total'),
            expensesCents: money(expenses.filter(inRange), 'amountCents', 'amount'),
            outstandingCents: money(invoices.filter((record) => record && !['Paid', 'Cancelled'].includes(record.status)), 'dueCents', 'due')
          },
          counts: {
            patients: patients.filter((record) => record && !record.archived).length,
            newPatients: patients.filter((record) => record && !record.archived && this.#inRange(record, from, to, 'registrationDate')).length,
            visits: visits.filter(inRange).length,
            appointments: appointments.filter(inRange).length,
            completed: appointments.filter((record) => record && record.status === 'Completed' && inRange(record)).length,
            invoices: invoices.filter(inRange).length,
            payments: active.length
          },
          monthly: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-24).map(([month, cents]) => ({ month, cents })),
          visitMonthly: [...visitMonths.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-24).map(([month, count]) => ({ month, count })),
          byMethod: [...methods.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents).slice(0, 12)
        };
      }
      case 'services': {
        const groups = new Map();
        for (const record of dentalRecords.filter((entry) => entry && entry.procedure && this.#inRange(entry, from, to, 'createdAt'))) {
          groups.set(record.procedure, (groups.get(record.procedure) || 0) + 1);
        }
        return { rows: [...groups.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10) };
      }
      case 'dentists': {
        const groups = new Map();
        for (const record of visits.filter((entry) => entry && entry.dentistId && inRange(entry))) {
          const label = staffName(record.dentistId) || record.dentistId || 'Unassigned';
          groups.set(label, (groups.get(label) || 0) + 1);
        }
        return { rows: [...groups.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10) };
      }
      case 'movements': {
        const groups = new Map();
        const items = new Map(inventory.map((record) => [record.id, record.name]));
        for (const record of movements.filter((entry) => entry && inRange(entry))) {
          const label = items.get(record.itemId) || record.itemId;
          const entry = groups.get(label) || { label, total: 0, count: 0 };
          entry.total += Math.abs(toNumber(record.quantity));
          entry.count += 1;
          groups.set(label, entry);
        }
        return { rows: [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 10).map((entry) => ({ label: entry.label, quantity: entry.total, count: entry.count })) };
      }
      case 'inventoryValue': {
        const active = inventory.filter((record) => record && !record.archived);
        return {
          stockValueCents: active.reduce((sum, record) => sum + toNumber(record.currentStock) * moneyToCents(record.purchasePrice), 0),
          retailValueCents: active.reduce((sum, record) => sum + toNumber(record.currentStock) * moneyToCents(record.salePrice), 0),
          unitsOnHand: active.reduce((sum, record) => sum + toNumber(record.currentStock), 0),
          itemsTracked: active.length
        };
      }
      default:
        return {};
    }
  }

  sqlAggregates() {
    const patients = this.#collection('patients');
    const invoices = this.#collection('invoices');
    const inventory = this.#collection('inventory');
    const followups = this.#collection('followUpTasks');
    const now = isoDate();
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const active = inventory.filter((record) => record && !record.archived);
    return {
      totals: {
        patients: patients.filter((record) => record && !record.archived).length,
        invoicesOutstandingCents: invoices.filter((record) => record && !['Paid', 'Cancelled'].includes(record.status)).reduce((sum, record) => sum + fieldCents(record, 'dueCents', 'due'), 0),
        stockValueCents: active.reduce((sum, record) => sum + toNumber(record.currentStock) * moneyToCents(record.purchasePrice), 0),
        lowStockItems: active.filter((record) => toNumber(record.currentStock) <= Math.max(toNumber(record.minimumStock) || 0, toNumber(record.reorderThreshold) || 0)).length,
        expiringItems: active.filter((record) => record.expiryDate && record.expiryDate <= soon).length,
        openFollowups: followups.filter((record) => record && ['Open', 'Contacted', 'Scheduled'].includes(record.status)).length,
        overdueFollowups: followups.filter((record) => record && record.status === 'Open' && record.dueDate && record.dueDate < now).length
      }
    };
  }

  // ---- workspace surface ---------------------------------------------------------

  storageInfo() {
    const recordCounts = this.counts();
    const bytes = this.storage && this.storage.getItem(LOCAL_STORAGE_KEY) ? this.storage.getItem(LOCAL_STORAGE_KEY).length : 0;
    return {
      path: LOCAL_STORAGE_KEY,
      bytes,
      walBytes: 0,
      pageSize: 0,
      pageCount: 0,
      journalMode: 'local-storage',
      backupPath: '',
      attachmentDirectory: '',
      attachmentBytes: Object.values(this.attachments).reduce((sum, entry) => sum + (entry ? entry.bytes || 0 : 0), 0),
      attachmentFiles: Object.keys(this.attachments).length,
      storage: 'Local storage (browser development mode)',
      source: 'local',
      readOnly: false,
      recordCounts
    };
  }

  integrityCheck() {
    const violations = [];
    const patientIds = new Set(this.#collection('patients').map((record) => record.id));
    const invoiceIds = new Set(this.#collection('invoices').map((record) => record.id));
    for (const record of this.#collection('payments')) {
      if (record && record.invoiceId && !invoiceIds.has(record.invoiceId)) violations.push({ table: 'payments', rowid: record.id, references: record.invoiceId, fkid: 0 });
      if (record && record.patientId && !patientIds.has(record.patientId)) violations.push({ table: 'payments', rowid: record.id, references: record.patientId, fkid: 1 });
    }
    for (const record of this.#collection('visits')) {
      if (record && record.patientId && !patientIds.has(record.patientId)) violations.push({ table: 'visits', rowid: record.id, references: record.patientId, fkid: 0 });
    }
    return {
      ok: violations.length === 0,
      integrity: 'ok',
      foreignKeyViolations: violations.slice(0, 50),
      foreignKeyViolationCount: violations.length
    };
  }

  /** v1.3.0 parity: relationship report over the whole state. */
  relationshipErrors() {
    return validateRelationships(this.state);
  }

  get appVersion() {
    return this.state.appVersion || APP_VERSION;
  }
  get schemaVersion() {
    return Number(this.state.schemaVersion || 0);
  }
}

export { sha256Hex, base64Encode, base64Decode, phoneNorm as localPhoneNorm };
