// Pure domain helpers used by the renderer, Electron persistence and automated tests.
// Keeping financial, import, relationship and file-safety rules here makes them auditable
// without a browser and prevents UI code from becoming the source of truth.

export const CURRENT_SCHEMA_VERSION = 5;

/* ── the clinic's calendar day ─────────────────────────────────────────────
 * Every date default in the product (new invoice, new payment, "today's"
 * queue, aging buckets, reporting periods) means the CLINIC's day, never
 * UTC's. A clinic in Dhaka at 01:00 local is still on the previous UTC date,
 * so a UTC-based "today" would silently date tonight's invoices yesterday and
 * empty the dashboard. `timezone` is a clinic setting (default Asia/Dhaka)
 * and the same helper is used by the JSON runtime, the SQLite runtime and the
 * renderer, so all three agree on what day it is. */
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

export function timeZoneOf(repo, fallback = DEFAULT_TIMEZONE) {
  try {
    const settings = repo && typeof repo.getSettings === 'function' ? repo.getSettings() : null;
    const zone = settings && typeof settings.timezone === 'string' ? settings.timezone.trim() : '';
    if (zone) return zone;
  } catch { /* fall through to the product default */ }
  return fallback;
}

export function clinicDate(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const stamp = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(stamp.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp);
  } catch {
    const pad = (value) => String(value).padStart(2, '0');
    return `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  }
}

export function clinicToday(repo, date = new Date()) {
  return clinicDate(date, timeZoneOf(repo));
}

/** Calendar-day distance between two YYYY-MM-DD strings (b − a). */
export function daysBetween(a, b) {
  const dayNumber = (value) => {
    const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return NaN;
    return Date.UTC(year, month - 1, day) / 86400000;
  };
  const left = dayNumber(a);
  const right = dayNumber(b);
  return Number.isNaN(left) || Number.isNaN(right) ? NaN : right - left;
}
// Attachment ceilings are configurable, resource-aware guards (settings.attachmentMaxMb) —
// never a fixed product limit. This default is deliberately generous for clinical imaging.
export const DEFAULT_ATTACHMENT_MAX_BYTES = 256 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = DEFAULT_ATTACHMENT_MAX_BYTES;
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'application/pdf',
  'application/dicom',
  'text/plain'
];
// Executable/dangerous extensions are rejected regardless of the declared MIME type.
export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'ps1', 'psm1', 'jar', 'app', 'dll', 'sys', 'drv', 'ocx', 'cpl', 'hta', 'lnk', 'reg',
  'msc', 'gadget', 'inf', 'sh', 'bash', 'apk', 'iso', 'img', 'vhd', 'vhdx'
];

export const APPOINTMENT_STATUSES = ['Scheduled', 'Confirmed', 'Checked In', 'Waiting', 'In Treatment', 'Completed', 'Cancelled', 'No Show'];
export const INVOICE_STATUSES = ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Cancelled', 'Refunded', 'Adjusted'];
export const MOVEMENT_TYPES = ['Purchase', 'Usage', 'Return', 'Damage', 'Expiry', 'Correction', 'Adjustment'];
export const FOLLOWUP_STATUSES = ['Open', 'Contacted', 'Scheduled', 'Completed', 'Cancelled'];
export const REFERRAL_STATUSES = ['Sent', 'Acknowledged', 'Report received', 'Closed', 'Cancelled'];

export const ARRAY_COLLECTIONS = [
  'patients', 'appointments', 'visits', 'prescriptions', 'dentalRecords',
  'treatments', 'invoices', 'payments', 'inventory', 'stockMovements',
  'suppliers', 'staff', 'expenses', 'referrals', 'attachments', 'paymentAdjustments', 'audit',
  'notifications', 'followUpTasks', 'treatmentPlans', 'users', 'medicationCatalog', 'notificationRules', 'rooms', 'savedFilters', 'savedReports'
];

export const PERMISSIONS = [
  'patients.view', 'patients.create', 'patients.edit', 'patients.archive', 'patients.delete',
  'clinical.view', 'clinical.create', 'clinical.edit',
  'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.queue',
  'prescriptions.view', 'prescriptions.create', 'prescriptions.edit', 'prescriptions.print',
  'billing.view', 'billing.create', 'billing.edit', 'billing.refund', 'billing.void',
  'payments.view', 'payments.create', 'payments.adjust', 'payments.refund',
  'inventory.view', 'inventory.purchase', 'inventory.adjust', 'inventory.consume', 'inventory.correct',
  'accounting.view', 'accounting.create', 'accounting.edit',
  'reports.view', 'reports.export',
  'backup.create', 'backup.restore',
  'settings.view', 'settings.edit', 'audit.view',
  'staff.view', 'staff.create', 'staff.edit', 'staff.disable',
  'users.manage',
  'patients.import', 'patients.export', 'clinical.plan', 'clinical.attachments',
  'appointments.cancel', 'appointments.move', 'queue.manage',
  'inventory.view-cost', 'inventory.expiry',
  'reports.analytics', 'reports.schedule', 'reports.clinical',
  'data.export', 'data.import', 'backup.validate', 'backup.history',
  'notifications.manage', 'diagnostics.view', 'diagnostics.repair',
  'customization.edit', 'documents.templates', 'audit.export', 'attachments.delete'
];

const roleTemplates = {
  Administrator: PERMISSIONS,
  Dentist: [
    'patients.view', 'patients.create', 'patients.edit', 'clinical.view', 'clinical.create', 'clinical.edit',
    'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.queue',
    'prescriptions.view', 'prescriptions.create', 'prescriptions.edit', 'prescriptions.print',
    'billing.view', 'billing.create', 'billing.edit', 'payments.view', 'reports.view', 'reports.export', 'reports.analytics', 'reports.clinical',
    'inventory.view', 'backup.create', 'backup.validate', 'data.export', 'clinical.plan', 'clinical.attachments', 'appointments.cancel', 'queue.manage', 'audit.view', 'settings.view'
  ],
  Manager: [
    'patients.view', 'patients.create', 'patients.edit', 'patients.archive', 'clinical.view', 'clinical.create', 'clinical.edit',
    'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.queue',
    'prescriptions.view', 'prescriptions.create', 'prescriptions.edit', 'prescriptions.print',
    'billing.view', 'billing.create', 'billing.edit', 'billing.refund', 'billing.void', 'payments.view', 'payments.create', 'payments.adjust', 'payments.refund',
    'inventory.view', 'inventory.purchase', 'inventory.adjust', 'inventory.consume', 'inventory.correct',
    'accounting.view', 'accounting.create', 'accounting.edit', 'reports.view', 'reports.export', 'backup.create', 'backup.restore',
    'settings.view', 'audit.view', 'staff.view', 'staff.create', 'staff.edit', 'staff.disable', 'patients.import', 'patients.export', 'reports.analytics', 'reports.clinical', 'data.export', 'data.import', 'backup.validate', 'backup.history', 'notifications.manage', 'diagnostics.view', 'customization.edit', 'documents.templates'
  ],
  Accountant: [
    'patients.view', 'billing.view', 'billing.create', 'billing.edit', 'billing.refund', 'billing.void',
    'payments.view', 'payments.create', 'payments.adjust', 'payments.refund',
    'accounting.view', 'accounting.create', 'accounting.edit',
    'inventory.view', 'reports.view', 'reports.export', 'reports.analytics',
    'data.export', 'backup.create', 'backup.validate', 'settings.view', 'audit.view'
  ],
  Receptionist: ['patients.view', 'patients.create', 'patients.edit', 'patients.archive', 'patients.import', 'patients.export', 'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.move', 'appointments.queue', 'queue.manage', 'billing.view', 'billing.create', 'payments.view', 'payments.create', 'inventory.view', 'reports.view', 'data.export', 'backup.create', 'backup.validate', 'settings.view'],
  'Dental Assistant': ['patients.view', 'clinical.view', 'clinical.create', 'clinical.attachments', 'appointments.view', 'appointments.queue', 'queue.manage', 'prescriptions.view', 'prescriptions.print', 'inventory.view', 'inventory.consume', 'inventory.expiry', 'reports.view', 'settings.view'],
  Cleaner: ['settings.view'],
  Other: [],
  'Custom Role': []
};

export function permissionsForRole(role, customPermissions = []) {
  const template = roleTemplates[role] || [];
  return [...new Set(role === 'Custom Role' ? customPermissions.filter((permission) => PERMISSIONS.includes(permission)) : template)];
}

export function hasPermission(user, permission) {
  return Boolean(user?.active !== false && permissionsForRole(user.role, user.permissions).includes(permission));
}

export function roleDefinitions() {
  return Object.fromEntries(Object.entries(roleTemplates).map(([role, permissions]) => [role, [...permissions]]));
}

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function moneyToCents(value) {
  return Math.round(toNumber(value) * 100);
}

export function centsToMoney(value) {
  return Math.round(toNumber(value)) / 100;
}

export function calculateInvoice({ quantity = 1, unitPrice = 0, discount = 0, taxRate = 0 }) {
  const subtotalCents = Math.max(0, Math.round(toNumber(quantity) * moneyToCents(unitPrice)));
  const discountCents = Math.min(subtotalCents, Math.max(0, moneyToCents(discount)));
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const appliedTaxRate = Math.max(0, toNumber(taxRate));
  const taxCents = Math.max(0, Math.round(taxableCents * appliedTaxRate / 100));
  return {
    subtotal: centsToMoney(subtotalCents),
    discount: centsToMoney(discountCents),
    taxRate: appliedTaxRate,
    tax: centsToMoney(taxCents),
    total: centsToMoney(taxableCents + taxCents)
  };
}

export function paymentStatusFor(invoiceTotal, payments = []) {
  const totalCents = Math.max(0, moneyToCents(invoiceTotal));
  const paidCents = Math.min(totalCents, payments
    .filter((payment) => !['Voided', 'Refunded', 'Cancelled'].includes(payment.status))
    .reduce((sum, payment) => sum + Math.max(0, moneyToCents(payment.amount) - moneyToCents(payment.refundedAmount || 0)), 0));
  const dueCents = Math.max(0, totalCents - paidCents);
  return {
    paid: centsToMoney(paidCents),
    due: centsToMoney(dueCents),
    status: dueCents === 0 ? 'Paid' : paidCents > 0 ? 'Partially Paid' : 'Unpaid'
  };
}

export function appointmentsOverlap(candidate, existing, defaultDuration = 30) {
  if (!candidate || !existing || candidate.id === existing.id || candidate.date !== existing.date || ['Cancelled', 'No Show'].includes(existing.status)) return false;
  const candidateChair = candidate.chair || 'Chair 1';
  const existingChair = existing.chair || 'Chair 1';
  const normaliseResource = (value) => String(value || '').trim().toLowerCase();
  const sameRoom = normaliseResource(candidate.room) && normaliseResource(existing.room) && normaliseResource(candidate.room) === normaliseResource(existing.room);
  const sharedChair = candidateChair === existingChair && (!candidate.room || !existing.room || sameRoom);
  const sharedDentist = candidate.dentistId && existing.dentistId && candidate.dentistId === existing.dentistId;
  const sharedRoom = Boolean(sameRoom);
  if (!sharedChair && !sharedDentist && !sharedRoom) return false;
  const clockMinutes = (value) => { const [hours, minutes] = String(value || '00:00').split(':').map(Number); return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0); };
  const start = clockMinutes(candidate.time); const end = start + Math.max(1, toNumber(candidate.duration) || defaultDuration);
  const otherStart = clockMinutes(existing.time); const otherEnd = otherStart + Math.max(1, toNumber(existing.duration) || defaultDuration);
  return start < otherEnd && otherStart < end;
}

export function canAcceptPayment(amount, due) {
  const paymentCents = moneyToCents(amount);
  const balanceCents = Math.max(0, moneyToCents(due));
  return paymentCents > 0 && paymentCents <= balanceCents;
}

export function validateMoney(value, { allowZero = true } = {}) {
  const text = String(value ?? '').trim();
  const number = Number(value);
  return Number.isFinite(number) && number >= (allowZero ? 0 : Number.EPSILON) && /^\d+(?:\.\d{1,2})?$/.test(text);
}

export function validatePayment({ amount, due, invoiceStatus = 'Unpaid' } = {}) {
  const paymentCents = moneyToCents(amount);
  const dueCents = Math.max(0, moneyToCents(due));
  const errors = [];
  if (!Number.isFinite(Number(amount)) || paymentCents <= 0) errors.push('Payment amount must be greater than zero.');
  if (invoiceStatus === 'Cancelled') errors.push('Cancelled invoices cannot accept payments.');
  if (paymentCents > dueCents) errors.push('Payment cannot exceed the outstanding balance.');
  if (String(amount ?? '').includes('.') && String(amount).split('.')[1].length > 2) errors.push('Money amounts may contain at most two decimal places.');
  return { valid: errors.length === 0, errors, amount: centsToMoney(paymentCents) };
}

export function buildBackupManifest(state, version, includedModules = ARRAY_COLLECTIONS) {
  const metadataModules = new Set(['settings', 'counters', 'dashboard', 'notificationRead']);
  const modules = includedModules.filter((key) => metadataModules.has(key) || Array.isArray(state[key]));
  return {
    product: 'Dentiva Pro',
    version,
    backupVersion: 2,
    createdAt: new Date().toISOString(),
    schemaVersion: state.schemaVersion,
    includedModules: modules,
    recordCounts: Object.fromEntries(modules.filter((key) => Array.isArray(state[key])).map((key) => [key, state[key].length]))
  };
}

function normalisePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^880/, '').replace(/^0/, '');
}
function normalise(value) { return String(value || '').trim().toLowerCase(); }

export function detectPatientDuplicates(incoming, existing) {
  return (Array.isArray(incoming) ? incoming : []).filter((candidate) => (Array.isArray(existing) ? existing : []).some((local) => {
    const sameCode = candidate.patientCode && local.patientCode && normalise(candidate.patientCode) === normalise(local.patientCode);
    const samePhone = candidate.phone && local.phone && normalisePhone(candidate.phone) && normalisePhone(candidate.phone) === normalisePhone(local.phone);
    const sameNamePhone = samePhone && normalise(candidate.fullName) === normalise(local.fullName);
    const sameEmail = candidate.email && local.email && normalise(candidate.email) === normalise(local.email);
    const sameDob = candidate.dateOfBirth && local.dateOfBirth && candidate.dateOfBirth === local.dateOfBirth && normalise(candidate.fullName) === normalise(local.fullName);
    return sameCode || sameNamePhone || sameEmail || sameDob;
  }));
}

export function attachmentMaxBytes(settings) {
  const configuredMb = Number(settings?.attachmentMaxMb);
  if (!Number.isFinite(configuredMb) || configuredMb <= 0) return DEFAULT_ATTACHMENT_MAX_BYTES;
  return Math.round(Math.min(configuredMb, 4096) * 1024 * 1024);
}

export function hasBlockedExtension(name) {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  const parts = base.split('.').slice(1);
  return parts.some((part) => BLOCKED_ATTACHMENT_EXTENSIONS.includes(part));
}

export function validateAttachmentFile({ type = '', size = 0, name = '', data } = {}, settings = null) {
  const filename = String(name || '').replace(/\\/g, '/').split('/').pop();
  const safeName = filename.replace(/[\u0000<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  const maxBytes = attachmentMaxBytes(settings);
  const dataText = data === undefined || data === null || data === '' ? '' : String(data);
  const dataSafe = !dataText || (ALLOWED_ATTACHMENT_TYPES.includes(type) && new RegExp(`^data:${String(type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};base64,[A-Za-z0-9+/=\\s]+$`).test(dataText));
  const extensionBlocked = hasBlockedExtension(filename);
  return {
    allowed: ALLOWED_ATTACHMENT_TYPES.includes(type) && !extensionBlocked && toNumber(size) >= 0 && toNumber(size) <= maxBytes && Boolean(safeName || !name) && dataSafe,
    allowedTypes: ALLOWED_ATTACHMENT_TYPES,
    maxBytes,
    extensionBlocked,
    safeName: safeName || 'attachment'
  };
}

export function restoreCollection(localRecords, incomingRecords, strategy = 'Keep Existing') {
  const local = Array.isArray(localRecords) ? localRecords : [];
  const incoming = Array.isArray(incomingRecords) ? incomingRecords : [];
  const result = local.map((record) => ({ ...record }));
  let added = 0; let skipped = 0; let replaced = 0; let copied = 0;
  incoming.forEach((record) => {
    const index = result.findIndex((localRecord) => localRecord.id && record.id && localRecord.id === record.id);
    if (index < 0) { result.push({ ...record }); added += 1; return; }
    if (strategy === 'Replace') { result[index] = { ...record }; replaced += 1; return; }
    if (strategy === 'Create New Copy') { result.push({ ...record, id: `${record.id || 'record'}_copy_${copied + 1}` }); copied += 1; return; }
    skipped += 1;
  });
  return { records: result, added, skipped, replaced, copied };
}

function recordIds(records, collection) {
  const seen = new Set();
  const errors = [];
  (Array.isArray(records) ? records : []).forEach((record, index) => {
    if (!record || typeof record !== 'object') { errors.push(`${collection}[${index}] is not an object.`); return; }
    if (!record.id || typeof record.id !== 'string') errors.push(`${collection}[${index}] is missing a stable id.`);
    else if (seen.has(record.id)) errors.push(`${collection} contains duplicate id ${record.id}.`);
    else seen.add(record.id);
  });
  return errors;
}

export function validateRelationships(store) {
  const errors = [];
  const patients = new Set((store.patients || []).map((record) => record.id));
  const invoices = new Set((store.invoices || []).map((record) => record.id));
  const inventory = new Set((store.inventory || []).map((record) => record.id));
  const suppliers = new Set((store.suppliers || []).map((record) => record.id));
  ARRAY_COLLECTIONS.forEach((key) => errors.push(...recordIds(store[key], key)));
  const patientLinks = ['appointments', 'visits', 'prescriptions', 'dentalRecords', 'invoices', 'payments', 'paymentAdjustments', 'referrals', 'attachments', 'followUpTasks', 'treatmentPlans'];
  patientLinks.forEach((collection) => (store[collection] || []).forEach((record) => {
    if (record.patientId && !patients.has(record.patientId)) errors.push(`${collection}:${record.id} references missing patient ${record.patientId}.`);
  }));
  const payments = new Set((store.payments || []).map((record) => record.id));
  (store.payments || []).forEach((record) => { if (record.invoiceId && !invoices.has(record.invoiceId)) errors.push(`payments:${record.id} references missing invoice ${record.invoiceId}.`); });
  (store.paymentAdjustments || []).forEach((record) => { if (record.paymentId && !payments.has(record.paymentId)) errors.push(`paymentAdjustments:${record.id} references missing payment ${record.paymentId}.`); if (record.invoiceId && !invoices.has(record.invoiceId)) errors.push(`paymentAdjustments:${record.id} references missing invoice ${record.invoiceId}.`); });
  (store.inventory || []).forEach((record) => { if (record.supplierId && !suppliers.has(record.supplierId)) errors.push(`inventory:${record.id} references missing supplier ${record.supplierId}.`); });
  (store.stockMovements || []).forEach((record) => { if (record.itemId && !inventory.has(record.itemId)) errors.push(`stockMovements:${record.id} references missing inventory item ${record.itemId}.`); if (record.supplierId && !suppliers.has(record.supplierId)) errors.push(`stockMovements:${record.id} references missing supplier ${record.supplierId}.`); });
  const codes = new Set();
  (store.patients || []).forEach((record) => { if (record.patientCode && codes.has(record.patientCode)) errors.push(`Duplicate patient code ${record.patientCode}.`); if (record.patientCode) codes.add(record.patientCode); });
  const invoiceNumbers = new Set();
  (store.invoices || []).forEach((record) => { if (record.invoiceNumber && invoiceNumbers.has(record.invoiceNumber)) errors.push(`Duplicate invoice number ${record.invoiceNumber}.`); if (record.invoiceNumber) invoiceNumbers.add(record.invoiceNumber); });
  return [...new Set(errors)];
}

export function validateBackupPayload(payload, expectedCollections = ARRAY_COLLECTIONS) {
  const envelope = payload && typeof payload === 'object' ? payload : {};
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope;
  const manifest = envelope.manifest && typeof envelope.manifest === 'object' ? envelope.manifest : null;
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object') errors.push('Backup data is not an object.');
  if (manifest && manifest.product !== 'Dentiva Pro') errors.push('This file is not a Dentiva Pro backup.');
  const schemaVersion = Number(manifest?.schemaVersion ?? data?.schemaVersion);
  if (!Number.isInteger(schemaVersion)) errors.push('Backup schema version is missing.');
  else if (schemaVersion > CURRENT_SCHEMA_VERSION) errors.push(`Backup schema v${schemaVersion} is newer than this application supports.`);
  else if (schemaVersion < 1) errors.push('Backup schema version is invalid.');
  expectedCollections.forEach((key) => {
    if (data[key] !== undefined && !Array.isArray(data[key])) errors.push(`${key} must be an array.`);
    if (Array.isArray(data[key])) errors.push(...recordIds(data[key], key));
  });
  (data.attachments || []).forEach((attachment) => {
    const fileCheck = validateAttachmentFile(attachment);
    if (!fileCheck.allowed) errors.push(`attachments:${attachment.id || 'unknown'} has an unsafe type, name or size.`);
  });
  const relationshipErrors = validateRelationships({ ...data, schemaVersion: schemaVersion || 1 });
  errors.push(...relationshipErrors);
  if (!manifest) warnings.push('Legacy backup envelope detected; no manifest was provided.');
  if (!Array.isArray(data.attachments)) warnings.push('No attachment collection was found.');
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], data, manifest, schemaVersion };
}

const moduleCollections = {
  patients: ['patients'],
  clinical: ['appointments', 'visits', 'prescriptions', 'dentalRecords', 'followUpTasks', 'treatmentPlans'],
  finance: ['invoices', 'payments', 'paymentAdjustments', 'expenses'],
  operations: ['inventory', 'stockMovements', 'suppliers', 'staff', 'referrals', 'attachments'],
  settings: ['settings', 'counters', 'dashboard', 'notificationRead', 'audit', 'users', 'medicationCatalog', 'notificationRules', 'rooms', 'savedFilters', 'savedReports']
};

export function buildRestorePlan(local, incoming, { modules = Object.keys(moduleCollections), strategy = 'Keep Existing', patientIds = [] } = {}) {
  const selected = new Set(patientIds);
  const usePatientFilter = selected.size > 0;
  const plan = { strategy, modules, collections: {}, conflicts: [], skipped: [], errors: [] };
  const allowedPatient = (record) => !usePatientFilter || selected.has(record.patientId || record.id);
  modules.flatMap((module) => moduleCollections[module] || []).forEach((key) => {
    if (['settings', 'counters', 'dashboard', 'notificationRead'].includes(key)) {
      if (incoming[key] !== undefined) plan.collections[key] = [{ ...incoming[key] }];
      return;
    }
    const incomingRecords = (incoming[key] || []).filter(allowedPatient).map((record) => ({ ...record }));
    const localRecords = local[key] || [];
    plan.collections[key] = incomingRecords;
    incomingRecords.forEach((record) => {
      if (record.id && localRecords.some((localRecord) => localRecord.id === record.id)) plan.conflicts.push({ collection: key, id: record.id, label: record.fullName || record.invoiceNumber || record.name || record.id });
    });
  });
  const patientFilterActive = usePatientFilter || plan.collections.patients !== undefined;
  const patientIdsInPlan = new Set(plan.collections.patients ? plan.collections.patients.map((record) => record.id) : [...selected]);
  ['appointments', 'visits', 'prescriptions', 'dentalRecords', 'invoices', 'payments', 'paymentAdjustments', 'referrals', 'attachments', 'followUpTasks', 'treatmentPlans'].forEach((key) => {
    if (!plan.collections[key]) return;
    if (patientFilterActive) plan.collections[key] = plan.collections[key].filter((record) => !record.patientId || patientIdsInPlan.has(record.patientId));
  });
  return plan;
}

export function applyRestorePlan(local, plan) {
  const result = JSON.parse(JSON.stringify(local));
  let added = 0; let skipped = 0; let replaced = 0; let copied = 0;
  const idMaps = {};
  if (plan.strategy === 'Create New Copy') {
    Object.entries(plan.collections || {}).forEach(([key, incoming]) => {
      if (!Array.isArray(incoming)) return;
      idMaps[key] = {};
      let copyIndex = 0;
      incoming.forEach((record) => {
        if (!record?.id || !(result[key] || []).some((localRecord) => localRecord.id === record.id)) return;
        let copyId = '';
        do { copyIndex += 1; copyId = `${record.id}_copy_${copyIndex}`; } while ((result[key] || []).some((localRecord) => localRecord.id === copyId) || incoming.some((other) => other !== record && other.id === copyId));
        idMaps[key][record.id] = copyId;
        copied += 1;
      });
    });
  }
  const relationMaps = { patientId: 'patients', invoiceId: 'invoices', paymentId: 'payments', itemId: 'inventory', supplierId: 'suppliers', appointmentId: 'appointments', visitId: 'visits' };
  const rewrite = (record) => {
    const next = { ...record };
    Object.entries(relationMaps).forEach(([field, collection]) => { if (next[field] && idMaps[collection]?.[next[field]]) next[field] = idMaps[collection][next[field]]; });
    return next;
  };
  Object.entries(plan.collections || {}).forEach(([key, incoming]) => {
    if (['settings', 'counters', 'dashboard', 'notificationRead'].includes(key)) {
      if (plan.strategy !== 'Keep Existing' && incoming[0]) result[key] = { ...incoming[0] };
      return;
    }
    const records = (incoming || []).map((record) => { const next = rewrite(record); if (key === 'attachments') next.name = sanitizeFilename(next.name); if (idMaps[key]?.[next.id]) next.id = idMaps[key][next.id]; return next; });
    const outcome = restoreCollection(result[key] || [], records, plan.strategy === 'Create New Copy' ? 'Keep Existing' : plan.strategy);
    result[key] = outcome.records;
    added += outcome.added; skipped += outcome.skipped; replaced += outcome.replaced;
  });
  const relationshipErrors = validateRelationships(result);
  if (relationshipErrors.length) throw new Error(`Restore relationship validation failed: ${relationshipErrors.slice(0, 4).join(' ')}`);
  return { state: result, added, skipped, replaced, copied };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sanitizeFilename(name, fallback = 'attachment') {
  const base = String(name || fallback).replace(/\\/g, '/').split('/').pop().replace(/[\u0000<>:"|?*]/g, '_').trim();
  return (base || fallback).slice(0, 180);
}
