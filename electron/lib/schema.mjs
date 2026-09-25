// Dentiva Pro v1.4.0 relational schema (layout v1, state schema v5).
//
// Design rules:
// - Every collection gets a real table: typed, indexed relational columns for querying,
//   plus a `payload` TEXT column holding the complete record JSON (lossless round-trip,
//   backup compatibility and forward field tolerance).
// - Money columns are INTEGER cents derived from the payload at write time; CHECK
//   constraints make impossible financial/inventory states unrepresentable.
// - Foreign keys are enforced (PRAGMA foreign_keys=ON). Patients are soft-archived,
//   so FKs use RESTRICT and merge/reassign flows run inside transactions.
// - The audit table is append-only at the API level (no update/delete channel exists).
// - No table or column imposes any record-count or database-size limit (§6).

// Latest relational layout. The tables below are the layout-1 baseline; every
// later change is a migration in schema-migrations.mjs (kept in lockstep by tests).
export const DB_LAYOUT_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -65536;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_history (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  duration_ms INTEGER,
  details TEXT
);

CREATE TABLE IF NOT EXISTS quarantine (
  qid INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER,
  record_count INTEGER,
  payload_hash TEXT,
  verified INTEGER DEFAULT 0,
  app_version TEXT,
  schema_version INTEGER,
  details TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY NOT NULL,
  patient_code TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_norm TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  gender TEXT DEFAULT '',
  date_of_birth TEXT DEFAULT '',
  registration_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  archived INTEGER NOT NULL DEFAULT 0,
  last_visit TEXT DEFAULT '',
  next_visit TEXT DEFAULT '',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients(full_name);
CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients(phone);
CREATE INDEX IF NOT EXISTS patients_phone_norm_idx ON patients(phone_norm);
CREATE INDEX IF NOT EXISTS patients_email_idx ON patients(email);
CREATE UNIQUE INDEX IF NOT EXISTS patients_code_uidx ON patients(patient_code) WHERE patient_code <> '';
CREATE INDEX IF NOT EXISTS patients_reg_idx ON patients(registration_date);
CREATE INDEX IF NOT EXISTS patients_archived_idx ON patients(archived);
CREATE INDEX IF NOT EXISTS patients_balance_idx ON patients(balance_cents);
CREATE INDEX IF NOT EXISTS patients_last_visit_idx ON patients(last_visit);
CREATE INDEX IF NOT EXISTS patients_next_visit_idx ON patients(next_visit);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_code TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 30,
  dentist_id TEXT NOT NULL DEFAULT '',
  chair TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  reason TEXT DEFAULT '',
  treatment TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Scheduled',
  serial TEXT DEFAULT '',
  checked_in_at TEXT DEFAULT '',
  started_at TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appt_date_idx ON appointments(date);
CREATE INDEX IF NOT EXISTS appt_patient_idx ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS appt_dentist_idx ON appointments(dentist_id);
CREATE INDEX IF NOT EXISTS appt_chair_idx ON appointments(chair);
CREATE INDEX IF NOT EXISTS appt_room_idx ON appointments(room);
CREATE INDEX IF NOT EXISTS appt_status_idx ON appointments(status);
CREATE INDEX IF NOT EXISTS appt_date_status_idx ON appointments(date, status);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY NOT NULL,
  visit_code TEXT NOT NULL DEFAULT '',
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  reason TEXT DEFAULT '',
  chief_complaint TEXT DEFAULT '',
  symptoms TEXT DEFAULT '',
  findings TEXT DEFAULT '',
  diagnosis TEXT DEFAULT '',
  treatment_performed TEXT DEFAULT '',
  procedures TEXT DEFAULT '',
  teeth TEXT DEFAULT '',
  anesthesia TEXT DEFAULT '',
  medications TEXT DEFAULT '',
  follow_up_date TEXT DEFAULT '',
  dentist_id TEXT DEFAULT '',
  status TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_patient_idx ON visits(patient_id);
CREATE INDEX IF NOT EXISTS visits_date_idx ON visits(date);
CREATE INDEX IF NOT EXISTS visits_followup_idx ON visits(follow_up_date);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY NOT NULL,
  prescription_code TEXT NOT NULL DEFAULT '',
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  doctor TEXT DEFAULT '',
  dentist_id TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  medications TEXT DEFAULT '[]',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rx_patient_idx ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS rx_date_idx ON prescriptions(date);

CREATE TABLE IF NOT EXISTS dental_records (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  tooth INTEGER NOT NULL,
  dentition TEXT NOT NULL DEFAULT 'adult',
  status TEXT DEFAULT '',
  note TEXT DEFAULT '',
  procedure_name TEXT DEFAULT '',
  treatment_id TEXT DEFAULT '',
  visit_id TEXT DEFAULT '',
  superseded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dental_current_uidx ON dental_records(patient_id, tooth, dentition) WHERE superseded = 0;
CREATE INDEX IF NOT EXISTS dental_patient_idx ON dental_records(patient_id);
CREATE INDEX IF NOT EXISTS dental_status_idx ON dental_records(status);

CREATE TABLE IF NOT EXISTS treatments (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT '',
  description TEXT DEFAULT '',
  default_price_cents INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 30,
  tooth_required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS treatments_name_idx ON treatments(name);
CREATE INDEX IF NOT EXISTS treatments_category_idx ON treatments(category);

CREATE TABLE IF NOT EXISTS treatment_plans (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '',
  goal TEXT DEFAULT '',
  procedures TEXT DEFAULT '',
  teeth TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft',
  estimated_duration INTEGER DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  estimated_total_cents INTEGER NOT NULL DEFAULT 0,
  start_date TEXT DEFAULT '',
  review_date TEXT DEFAULT '',
  dentist_id TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  stages TEXT DEFAULT '[]',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_patient_idx ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS plans_status_idx ON treatment_plans(status);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_number TEXT NOT NULL DEFAULT '',
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Issued'
    CHECK (status IN ('Draft','Issued','Partially Paid','Paid','Cancelled','Refunded','Adjusted')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  due_cents INTEGER NOT NULL DEFAULT 0 CHECK (due_cents >= 0),
  items TEXT NOT NULL DEFAULT '[]',
  notes TEXT DEFAULT '',
  dentist_id TEXT DEFAULT '',
  visit_id TEXT DEFAULT '',
  plan_id TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uidx ON invoices(invoice_number) WHERE invoice_number <> '';
CREATE INDEX IF NOT EXISTS invoices_patient_idx ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(date);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_number TEXT NOT NULL DEFAULT '',
  invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  date TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  method TEXT NOT NULL DEFAULT 'Cash',
  reference TEXT DEFAULT '',
  transaction_id TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Recorded',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_uidx ON payments(receipt_number) WHERE receipt_number <> '';
CREATE INDEX IF NOT EXISTS payments_patient_idx ON payments(patient_id);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments(date);
CREATE INDEX IF NOT EXISTS payments_method_idx ON payments(method);

CREATE TABLE IF NOT EXISTS payment_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('Refund','Adjustment')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  date TEXT NOT NULL DEFAULT '',
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS adj_payment_idx ON payment_adjustments(payment_id);
CREATE INDEX IF NOT EXISTS adj_patient_idx ON payment_adjustments(patient_id);
CREATE INDEX IF NOT EXISTS adj_invoice_idx ON payment_adjustments(invoice_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  date TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT 'Other',
  method TEXT DEFAULT 'Cash',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses(category);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_cents >= 0),
  sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  current_stock REAL NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  minimum_stock REAL NOT NULL DEFAULT 0,
  reorder_threshold REAL NOT NULL DEFAULT 0,
  expiry_date TEXT DEFAULT '',
  batch TEXT DEFAULT '',
  lot TEXT DEFAULT '',
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_name_idx ON inventory(name);
CREATE INDEX IF NOT EXISTS inventory_category_idx ON inventory(category);
CREATE INDEX IF NOT EXISTS inventory_supplier_idx ON inventory(supplier_id);
CREATE INDEX IF NOT EXISTS inventory_expiry_idx ON inventory(expiry_date);
CREATE INDEX IF NOT EXISTS inventory_stock_idx ON inventory(current_stock);
CREATE INDEX IF NOT EXISTS inventory_archived_idx ON inventory(archived);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers(name);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('Purchase','Usage','Return','Damage','Expiry','Correction','Adjustment')),
  quantity REAL NOT NULL,
  before_stock REAL,
  after_stock REAL,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  user_id TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mov_item_idx ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS mov_date_idx ON stock_movements(date);
CREATE INDEX IF NOT EXISTS mov_type_idx ON stock_movements(type);
CREATE INDEX IF NOT EXISTS mov_supplier_idx ON stock_movements(supplier_id);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY NOT NULL,
  staff_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  role TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  specialization TEXT DEFAULT '',
  join_date TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_name_idx ON staff(name);
CREATE INDEX IF NOT EXISTS staff_role_idx ON staff(role);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  referral_to TEXT DEFAULT '',
  specialty TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  response TEXT DEFAULT '',
  response_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Sent',
  attachment_ids TEXT DEFAULT '[]',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS referrals_patient_idx ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS referrals_date_idx ON referrals(date);
CREATE INDEX IF NOT EXISTS referrals_status_idx ON referrals(status);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id TEXT DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  type TEXT DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  category TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  checksum TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_patient_idx ON attachments(patient_id);
CREATE INDEX IF NOT EXISTS attachments_created_idx ON attachments(created_at);

CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id TEXT DEFAULT '',
  appointment_id TEXT DEFAULT '',
  title TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  notes TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS followup_due_idx ON follow_up_tasks(due_date);
CREATE INDEX IF NOT EXISTS followup_status_idx ON follow_up_tasks(status);
CREATE INDEX IF NOT EXISTS followup_patient_idx ON follow_up_tasks(patient_id);

CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  ts_ms INTEGER NOT NULL DEFAULT 0,
  user_id TEXT DEFAULT '',
  user_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  details TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit(created_at);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit(ts_ms);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit(entity);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit(user_id);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit(action);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT DEFAULT '',
  title TEXT DEFAULT '',
  message TEXT DEFAULT '',
  page TEXT DEFAULT '',
  record_id TEXT DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  date TEXT DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notif_read_idx ON notifications(read);
CREATE INDEX IF NOT EXISTS notif_date_idx ON notifications(date);
CREATE INDEX IF NOT EXISTS notif_kind_idx ON notifications(kind);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'Receptionist',
  staff_id TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL DEFAULT '[]',
  pin_hash TEXT DEFAULT '',
  pin_salt TEXT DEFAULT '',
  kdf TEXT DEFAULT '',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_login TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
CREATE INDEX IF NOT EXISTS users_active_idx ON users(active);

CREATE TABLE IF NOT EXISTS medication_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  strength TEXT DEFAULT '',
  dosage TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  route TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS med_name_idx ON medication_catalog(name);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT DEFAULT 'patients',
  name TEXT NOT NULL DEFAULT '',
  query TEXT DEFAULT '',
  filters TEXT DEFAULT '{}',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_filters_name_idx ON saved_filters(name);

CREATE TABLE IF NOT EXISTS saved_reports (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT DEFAULT '',
  range_key TEXT DEFAULT '',
  options TEXT DEFAULT '{}',
  payload TEXT NOT NULL
);
`;

// collection name (renderer/backup vocabulary) → table name
export const COLLECTION_TABLES = {
  patients: 'patients',
  appointments: 'appointments',
  visits: 'visits',
  prescriptions: 'prescriptions',
  dentalRecords: 'dental_records',
  treatments: 'treatments',
  treatmentPlans: 'treatment_plans',
  invoices: 'invoices',
  payments: 'payments',
  paymentAdjustments: 'payment_adjustments',
  expenses: 'expenses',
  inventory: 'inventory',
  stockMovements: 'stock_movements',
  suppliers: 'suppliers',
  staff: 'staff',
  referrals: 'referrals',
  attachments: 'attachments',
  followUpTasks: 'follow_up_tasks',
  audit: 'audit',
  notifications: 'notifications',
  users: 'users',
  medicationCatalog: 'medication_catalog',
  notificationRules: 'notification_rules',
  rooms: 'rooms',
  savedFilters: 'saved_filters',
  savedReports: 'saved_reports'
};

// Foreign-key insertion order (parents before children) and reverse for teardown.
export const WRITE_ORDER = [
  'users', 'staff', 'suppliers', 'rooms', 'notificationRules', 'medicationCatalog',
  'savedFilters', 'savedReports', 'treatments', 'patients', 'appointments', 'visits',
  'prescriptions', 'dentalRecords', 'treatmentPlans', 'invoices', 'payments',
  'paymentAdjustments', 'expenses', 'inventory', 'stockMovements', 'referrals',
  'attachments', 'followUpTasks', 'notifications', 'audit'
];
