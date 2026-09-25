// Record → relational-row mapping. Columns are derived from the authoritative record
// payload at write time; the payload column preserves the full record losslessly.
// Shared by the storage writer, the v4→v5 migration, restore and diagnostics so that
// derived-column semantics can never diverge between paths.

import { moneyToCents, toNumber } from '../../src/core.js';

const str = (value) => (value === null || value === undefined ? '' : String(value));
const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
const bool = (value) => (value ? 1 : 0);
const json = (value, fallback = null) => JSON.stringify(value ?? fallback);

export function phoneNorm(value) {
  return str(value).replace(/\D/g, '').replace(/^880/, '').replace(/^0/, '');
}

const mappers = {
  patients: (r) => ({
    id: str(r.id),
    patient_code: str(r.patientCode),
    full_name: str(r.fullName),
    phone: str(r.phone),
    phone_norm: phoneNorm(r.phone),
    email: str(r.email),
    gender: str(r.gender),
    date_of_birth: str(r.dateOfBirth),
    registration_date: str(r.registrationDate),
    status: str(r.status) || 'Active',
    archived: bool(r.archived || r.status === 'Archived'),
    last_visit: str(r.lastVisit),
    next_visit: str(r.nextVisit),
    balance_cents: int(r.balanceCents, 0),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  appointments: (r) => ({
    id: str(r.id),
    patient_id: str(r.patientId) || null,
    appointment_code: str(r.appointmentCode),
    date: str(r.date),
    time: str(r.time),
    duration: int(r.duration, 30) || 30,
    dentist_id: str(r.dentistId),
    chair: str(r.chair),
    room: str(r.room),
    reason: str(r.reason),
    treatment: str(r.treatment),
    status: str(r.status) || 'Scheduled',
    serial: str(r.serial),
    checked_in_at: str(r.checkedInAt),
    started_at: str(r.startedAt),
    completed_at: str(r.completedAt),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  visits: (r) => ({
    id: str(r.id),
    visit_code: str(r.visitCode),
    patient_id: str(r.patientId) || null,
    appointment_id: str(r.appointmentId),
    date: str(r.date),
    reason: str(r.reason),
    chief_complaint: str(r.chiefComplaint ?? r.reason),
    symptoms: str(r.symptoms),
    findings: str(r.findings),
    diagnosis: str(r.diagnosis),
    treatment_performed: str(r.treatmentPerformed),
    procedures: str(r.procedures),
    teeth: str(r.teeth),
    anesthesia: str(r.anesthesia),
    medications: str(r.medications),
    follow_up_date: str(r.followUpDate),
    dentist_id: str(r.dentistId),
    status: str(r.status),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  prescriptions: (r) => ({
    id: str(r.id),
    prescription_code: str(r.prescriptionCode),
    patient_id: str(r.patientId) || null,
    visit_id: str(r.visitId),
    date: str(r.date),
    doctor: str(r.doctor),
    dentist_id: str(r.dentistId),
    notes: str(r.notes),
    medications: json(Array.isArray(r.medications) ? r.medications : [], []),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  dentalRecords: (r, extra = {}) => ({
    id: str(r.id),
    patient_id: str(r.patientId),
    tooth: int(r.tooth, 0),
    dentition: str(r.dentition) || 'adult',
    status: str(r.status),
    note: str(r.note),
    procedure_name: str(r.procedure ?? r.procedureName),
    treatment_id: str(r.treatmentId),
    visit_id: str(r.visitId),
    superseded: bool(extra.superseded ?? r.superseded),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  treatments: (r) => ({
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    category: str(r.category),
    description: str(r.description),
    default_price_cents: Math.max(0, moneyToCents(r.defaultPrice)),
    duration: int(r.duration, 30) || 30,
    tooth_required: bool(r.toothRequired),
    active: r.active === false ? 0 : 1,
    notes: str(r.notes),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  treatmentPlans: (r) => ({
    id: str(r.id),
    patient_id: str(r.patientId),
    title: str(r.title),
    goal: str(r.goal),
    procedures: str(r.procedures),
    teeth: str(r.teeth),
    status: str(r.status) || 'Draft',
    estimated_duration: int(r.estimatedDuration, 0),
    estimated_cost_cents: Math.max(0, moneyToCents(r.estimatedCost)),
    discount_cents: Math.max(0, moneyToCents(r.discount)),
    estimated_total_cents: Math.max(0, moneyToCents(r.estimatedTotal ?? Math.max(0, toNumber(r.estimatedCost) - toNumber(r.discount)))),
    start_date: str(r.startDate),
    review_date: str(r.reviewDate),
    dentist_id: str(r.dentistId),
    notes: str(r.notes),
    stages: json(Array.isArray(r.stages) ? r.stages : [], []),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  invoices: (r) => ({
    id: str(r.id),
    invoice_number: str(r.invoiceNumber),
    patient_id: str(r.patientId),
    date: str(r.date),
    status: str(r.status) || 'Issued',
    subtotal_cents: Math.max(0, moneyToCents(r.subtotal)),
    discount_cents: Math.max(0, moneyToCents(r.discount)),
    tax_rate: Number(r.taxRate) || 0,
    tax_cents: Math.max(0, moneyToCents(r.tax)),
    total_cents: Math.max(0, moneyToCents(r.total)),
    paid_cents: Math.max(0, moneyToCents(r.paid)),
    due_cents: Math.max(0, moneyToCents(r.due)),
    items: json(Array.isArray(r.items) ? r.items : [], []),
    notes: str(r.notes),
    dentist_id: str(r.dentistId),
    visit_id: str(r.visitId),
    plan_id: str(r.planId),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  payments: (r) => ({
    id: str(r.id),
    receipt_number: str(r.receiptNumber),
    invoice_id: str(r.invoiceId) || null,
    patient_id: str(r.patientId) || null,
    date: str(r.date),
    amount_cents: Math.max(0, moneyToCents(r.amount)),
    refunded_cents: Math.max(0, Math.min(moneyToCents(r.refundedAmount), Math.max(0, moneyToCents(r.amount)))),
    method: str(r.method) || 'Cash',
    reference: str(r.reference),
    transaction_id: str(r.transactionId ?? r.reference),
    provider: str(r.provider),
    notes: str(r.notes),
    status: str(r.status) || 'Recorded',
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  paymentAdjustments: (r) => ({
    id: str(r.id),
    payment_id: str(r.paymentId) || null,
    invoice_id: str(r.invoiceId) || null,
    patient_id: str(r.patientId) || null,
    type: r.type === 'Adjustment' ? 'Adjustment' : 'Refund',
    amount_cents: Math.max(0, moneyToCents(r.amount)),
    date: str(r.date),
    reason: str(r.reason),
    created_at: str(r.createdAt),
    payload: json(r)
  }),
  expenses: (r) => ({
    id: str(r.id),
    description: str(r.description),
    amount_cents: Math.max(0, moneyToCents(r.amount)),
    date: str(r.date),
    category: str(r.category) || 'Other',
    method: str(r.method) || 'Cash',
    reference: str(r.reference),
    notes: str(r.notes),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  inventory: (r) => ({
    id: str(r.id),
    item_code: str(r.itemCode),
    name: str(r.name),
    category: str(r.category),
    brand: str(r.brand),
    unit: str(r.unit),
    supplier_id: str(r.supplierId) || null,
    purchase_price_cents: Math.max(0, moneyToCents(r.purchasePrice)),
    sale_price_cents: Math.max(0, moneyToCents(r.salePrice)),
    current_stock: Math.max(0, Number(r.currentStock) || 0),
    minimum_stock: Math.max(0, Number(r.minimumStock) || 0),
    reorder_threshold: Math.max(0, Number(r.reorderThreshold ?? r.minimumStock) || 0),
    expiry_date: str(r.expiryDate),
    batch: str(r.batch),
    lot: str(r.lot),
    location: str(r.location),
    notes: str(r.notes),
    active: r.active === false ? 0 : 1,
    archived: bool(r.archived),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  stockMovements: (r) => ({
    id: str(r.id),
    item_id: str(r.itemId),
    supplier_id: str(r.supplierId) || null,
    type: ['Purchase', 'Usage', 'Return', 'Damage', 'Expiry', 'Correction', 'Adjustment'].includes(r.type) ? r.type : ({ 'Stock-out': 'Usage', 'Expired': 'Expiry', 'Damaged': 'Damage', Issue: 'Usage', Sale: 'Usage' }[r.type] || 'Adjustment'),
    quantity: Number(r.quantity) || 0,
    before_stock: r.before === undefined || r.before === null ? null : Number(r.before),
    after_stock: r.after === undefined || r.after === null ? null : Number(r.after),
    unit_price_cents: Math.max(0, moneyToCents(r.unitPrice)),
    date: str(r.date),
    reason: str(r.reason),
    notes: str(r.notes),
    user_id: str(r.userId),
    created_at: str(r.createdAt),
    payload: json(r)
  }),
  suppliers: (r) => ({
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    contact_person: str(r.contactPerson),
    phone: str(r.phone),
    email: str(r.email),
    address: str(r.address),
    notes: str(r.notes),
    active: r.active === false ? 0 : 1,
    archived: bool(r.archived),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  staff: (r) => ({
    id: str(r.id),
    staff_code: str(r.staffCode),
    name: str(r.name),
    role: str(r.role),
    phone: str(r.phone),
    email: str(r.email),
    address: str(r.address),
    specialization: str(r.specialization),
    join_date: str(r.joinDate),
    active: r.active === false ? 0 : 1,
    archived: bool(r.archived),
    notes: str(r.notes),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  referrals: (r) => ({
    id: str(r.id),
    patient_id: str(r.patientId),
    visit_id: str(r.visitId),
    date: str(r.date),
    referral_to: str(r.referralTo),
    specialty: str(r.specialty),
    reason: str(r.reason),
    notes: str(r.notes),
    response: str(r.response),
    response_date: str(r.responseDate),
    status: str(r.status) || 'Sent',
    attachment_ids: json(Array.isArray(r.attachmentIds) ? r.attachmentIds : [], []),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  attachments: (r) => ({
    id: str(r.id),
    patient_id: str(r.patientId),
    visit_id: str(r.visitId),
    name: str(r.name),
    type: str(r.type),
    size_bytes: Math.max(0, int(r.size, 0)),
    category: str(r.category),
    notes: str(r.notes),
    file_path: str(r.filePath),
    checksum: str(r.checksum),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    // Payload never carries base64 bytes; the file store owns the content.
    payload: json({ ...r, data: '' })
  }),
  followUpTasks: (r) => ({
    id: str(r.id),
    patient_id: str(r.patientId),
    visit_id: str(r.visitId),
    appointment_id: str(r.appointmentId),
    title: str(r.title),
    reason: str(r.reason),
    due_date: str(r.dueDate),
    status: str(r.status) || 'Open',
    notes: str(r.notes),
    completed_at: str(r.completedAt),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  audit: (r) => ({
    id: str(r.id),
    created_at: str(r.createdAt) || new Date().toISOString(),
    ts_ms: r.createdAt ? Date.parse(r.createdAt) || 0 : Date.now(),
    user_id: str(r.userId),
    user_name: str(r.userName),
    action: str(r.action),
    entity: str(r.entity),
    entity_id: str(r.entityId ?? r.recordId),
    summary: str(r.summary),
    details: str(r.details),
    payload: json(r)
  }),
  notifications: (r) => ({
    id: str(r.id),
    kind: str(r.kind ?? r.type),
    title: str(r.title),
    message: str(r.message),
    page: str(r.page),
    record_id: str(r.recordId),
    severity: str(r.severity) || 'info',
    date: str(r.date),
    read: bool(r.read),
    dismissed: bool(r.dismissed),
    created_at: str(r.createdAt),
    payload: json(r)
  }),
  users: (r) => ({
    id: str(r.id),
    name: str(r.name),
    role: str(r.role) || 'Receptionist',
    staff_id: str(r.staffId),
    active: r.active === false ? 0 : 1,
    permissions: json(Array.isArray(r.permissions) ? r.permissions : [], []),
    pin_hash: str(r.pinHash),
    pin_salt: str(r.pinSalt),
    kdf: str(r.kdf),
    failed_attempts: Math.max(0, int(r.failedAttempts, 0)),
    locked_until: Math.max(0, int(r.lockedUntil, 0)),
    last_login: str(r.lastLogin),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    // Secrets never ride in the payload: the sanitized record is what any reader sees.
    payload: json((({ pinHash, pinSalt, kdf, hasPin, ...safe }) => safe)(r))
  }),
  medicationCatalog: (r) => ({
    id: str(r.id),
    name: str(r.name),
    strength: str(r.strength),
    dosage: str(r.dosage),
    frequency: str(r.frequency),
    duration: str(r.duration),
    route: str(r.route),
    instructions: str(r.instructions),
    favorite: bool(r.favorite),
    payload: json(r)
  }),
  notificationRules: (r) => ({
    id: str(r.id),
    kind: str(r.kind),
    enabled: r.enabled === false ? 0 : 1,
    payload: json(r)
  }),
  rooms: (r) => ({
    id: str(r.id),
    name: str(r.name),
    active: r.active === false ? 0 : 1,
    payload: json(r)
  }),
  savedFilters: (r) => ({
    id: str(r.id),
    entity: str(r.entity) || 'patients',
    name: str(r.name),
    query: str(r.query),
    filters: json(r.filters ?? {}, {}),
    created_at: str(r.createdAt),
    updated_at: str(r.updatedAt),
    payload: json(r)
  }),
  savedReports: (r) => ({
    id: str(r.id),
    name: str(r.name),
    type: str(r.type),
    range_key: str(r.range ?? r.rangeKey),
    options: json(r.options ?? {}, {}),
    payload: json(r)
  })
};

export function mapRecord(collection, record, extra = {}) {
  const mapper = mappers[collection];
  if (!mapper) throw new Error(`Unknown collection: ${collection}`);
  if (!record || typeof record !== 'object' || !record.id) throw new Error(`Invalid record for ${collection}`);
  const row = mapper(record, extra);
  // Migration repair: null relational FK columns while the payload keeps the
  // original historical value (lossless, auditable via migration_history).
  if (Array.isArray(extra.nullColumns)) {
    for (const column of extra.nullColumns) {
      if (column in row) row[column] = null;
    }
  }
  return row;
}

export function collectionColumns(collection, record, extra = {}) {
  return Object.keys(mapRecord(collection, record, extra));
}

export function upsertSql(collection, record, extra = {}) {
  const row = mapRecord(collection, record, extra);
  const columns = Object.keys(row);
  return {
    sql: `INSERT INTO ${tableFor(collection)} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
          ON CONFLICT(id) DO UPDATE SET ${columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
    params: columns.map((c) => row[c])
  };
}

import { COLLECTION_TABLES } from './schema.mjs';
export function tableFor(collection) {
  const table = COLLECTION_TABLES[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  return table;
}

const camelCase = (column) => column.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());

/**
 * Parse a row's payload back into the canonical record shape. When the full row
 * is selected, authoritative typed columns (integer `*_cents` money, the
 * `superseded` flag) are merged over the payload values so consumers always see
 * the stored source of truth, not a possibly stale decimal mirror.
 */
export function rowToRecord(row) {
  try {
    const record = JSON.parse(row.payload);
    if (!record || typeof record !== 'object') return null;
    for (const [column, value] of Object.entries(row)) {
      if (column === 'payload' || value === null || value === undefined) continue;
      if (column.endsWith('_cents') && typeof value === 'number') record[camelCase(column)] = value;
      else if (column === 'superseded') record.superseded = Boolean(value);
    }
    return record;
  } catch {
    return null;
  }
}
