// Dentiva Pro v1.4.0 — shared operation registry.
//
// ONE business-logic source of truth: the Electron main process (SqlRepo) and the
// browser development adapter (LocalRepo) both execute these operations, so
// validation, financial math, inventory guards and audit descriptors can never
// diverge between runtimes (§32, §36, §69).
//
// Contract:
//   runOp(repo, name, payload, ctx) → { ok: true, audit: [...], ...result }
//                                   | { ok: false, error, code? }
//   ctx: { userId, userName, role, permissions, firstRun, now(), today() }
//
// Ops never throw for expected failures; they return { ok: false, error }.
// Ops never import Node-only modules: secret hashing (PIN) is delegated to the
// runtime wrapper via the returned `pinToSet` field, and base64 decoding works in
// both Node (Buffer) and browsers (atob).

import {
  calculateInvoice, validatePayment, validateMoney, appointmentsOverlap,
  moneyToCents, centsToMoney, toNumber, hasPermission, sanitizeFilename, validateAttachmentFile,
  MOVEMENT_TYPES, FOLLOWUP_STATUSES, REFERRAL_STATUSES, APPOINTMENT_STATUSES,
  PERMISSIONS, roleDefinitions, localDateInTimeZone, appointmentTransitionAllowed, CODE_KINDS, sanitizeCodePrefix
} from './core.js';
import { isValidFdi, dentitionOf } from './dental.js';
import { deriveNotifications, reconcileNotifications, normalizeNotificationRules } from './notifications.js';
import { normalizeCustomFields } from './migrate-state.js';
import { normaliseTags, validatePatientInput, validateTreatmentPlanInput } from './domain.js';

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Allocate the next human-readable code for a document kind. Each kind has its
 * own prefix and counter; the code is verified unique against the owning table
 * so counter drift (restores, imports, prefix changes) can never produce a
 * duplicate or a constraint failure.
 */
function nextCode(repo, kind, pad = 4) {
  const spec = CODE_KINDS[kind];
  if (!spec) throw new Error(`Unknown code kind: ${kind}`);
  const settings = repo.getSettings();
  const prefix = sanitizeCodePrefix(settings[spec.setting]) || spec.fallback;
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const n = repo.nextCounter(kind);
    const code = `${prefix}-${String(n).padStart(pad, '0')}`;
    if (!repo.codeExists || !repo.codeExists(kind, code)) return code;
  }
  throw new Error(`Could not allocate a unique ${kind} code.`);
}

const ROLE_NAMES = Object.keys(roleDefinitions());
const PERMISSION_SET = new Set(PERMISSIONS);

const PATIENT_EDITABLE_FIELDS = [
  'fullName', 'preferredName', 'phone', 'email', 'gender', 'dateOfBirth', 'bloodGroup', 'address', 'city', 'district',
  'occupation', 'maritalStatus', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'preferredContact',
  'communicationNotes', 'allergies', 'medicalHistory', 'medications', 'dentalHistory', 'importantAlerts', 'notes', 'tags'
];
const VISIT_EDITABLE_FIELDS = [
  'date', 'reason', 'chiefComplaint', 'symptoms', 'findings', 'diagnosis', 'treatmentPerformed', 'procedures', 'teeth',
  'anesthesia', 'medications', 'notes', 'followUpDate', 'dentistId', 'status'
];

const requireRecord = (repo, collection, id, label = 'record') => {
  if (!id) return { error: `A ${label} identifier is required.` };
  const record = repo.get(collection, id);
  if (!record) return { error: `That ${label} no longer exists.` };
  return { record };
};

const str = (value) => String(value ?? '').trim();
// v1.3.0's stock form submitted 'Stock-out' / 'Expired' / 'Damaged' (and older
// exports used 'Issue' / 'Sale'); canonicalise them onto the v1.4.0 vocabulary.
const normalizeMovementType = (raw) => (MOVEMENT_TYPES.includes(raw) ? raw : ({ 'Stock-out': 'Usage', 'Expired': 'Expiry', 'Damaged': 'Damage', Issue: 'Usage', Sale: 'Usage' }[raw] || 'Adjustment'));
const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

/** Decode a data-URL to bytes in Node (Buffer) or the browser (atob). */
export function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const encoded = match[2].replace(/\s/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(encoded, 'base64');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Net payment state of an invoice from its live payments and adjustments —
 * the single financial projection every screen and document derives from.
 *   paid      = Σ(payment amount − refunded)   over non-voided payments
 *   adjusted  = Σ forgiveness adjustments
 *   due       = max(0, total − paid − adjusted)
 */
function computeInvoiceState(repo, invoice) {
  const payments = invoice?.id ? repo.paymentsByInvoice(invoice.id) : [];
  const live = payments.filter((payment) => !['Voided', 'Cancelled'].includes(payment.status));
  const grossCents = live.reduce((sum, payment) => sum + Math.max(0, moneyToCents(payment.amount)), 0);
  const refundedCents = live.reduce((sum, payment) => sum + Math.max(0, Math.min(moneyToCents(payment.refundedAmount || 0), moneyToCents(payment.amount))), 0);
  const adjustments = invoice?.id && repo.adjustmentsByInvoice ? repo.adjustmentsByInvoice(invoice.id) : [];
  const adjustedCents = adjustments
    .filter((adjustment) => adjustment.type === 'Adjustment')
    .reduce((sum, adjustment) => sum + Math.max(0, moneyToCents(adjustment.amount)), 0);
  const totalCents = Math.max(0, moneyToCents(invoice?.total ?? 0));
  const paidCents = Math.max(0, grossCents - refundedCents);
  const dueCents = Math.max(0, totalCents - paidCents - adjustedCents);
  return { totalCents, grossCents, refundedCents, paidCents, adjustedCents, dueCents, paid: centsToMoney(paidCents) };
}

/** Status is DERIVED from money; only Draft (not yet issued) and Cancelled are sticky. */
function invoiceStatusFrom(state, previousStatus) {
  if (previousStatus === 'Cancelled') return 'Cancelled';
  if (previousStatus === 'Draft' && state.grossCents === 0 && state.adjustedCents === 0) return 'Draft';
  if (state.totalCents > 0 && state.dueCents === 0 && state.paidCents > 0) return 'Paid';
  if (state.totalCents === 0 && state.adjustedCents === 0 && state.paidCents === 0 && state.refundedCents === 0) return 'Paid';
  if (state.dueCents === 0 && state.paidCents === 0 && state.adjustedCents > 0) return 'Adjusted';
  if (state.paidCents > 0) return 'Partially Paid';
  if (state.refundedCents > 0) return 'Refunded';
  if (state.adjustedCents > 0) return 'Adjusted';
  return 'Issued';
}

function refreshInvoicePaymentState(repo, invoice, nowIso) {
  const state = computeInvoiceState(repo, invoice);
  const updated = {
    ...invoice,
    paid: centsToMoney(state.paidCents),
    due: invoice.status === 'Cancelled' ? 0 : centsToMoney(state.dueCents),
    status: invoiceStatusFrom(state, invoice.status),
    updatedAt: nowIso || invoice.updatedAt
  };
  repo.update('invoices', updated);
  repo.updatePatientBalance(updated.patientId);
  return updated;
}

const QTY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/** Parse + validate invoice lines into exact integer-cent rows. Errors, never silent coercion. */
function buildInvoiceItems(payload) {
  const raw = Array.isArray(payload.items) ? payload.items : [];
  const items = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] || {};
    const name = str(item.name);
    const priceText = str(item.unitPrice);
    if (!name && !priceText) continue; // untouched blank row
    const label = `Line ${index + 1}`;
    if (!name) return { error: `${label}: enter a description.` };
    const qtyText = str(item.quantity === undefined || item.quantity === '' ? 1 : item.quantity);
    if (!QTY_PATTERN.test(qtyText) || Number(qtyText) <= 0) return { error: `${label}: quantity must be a positive number with at most two decimals.` };
    if (!validateMoney(priceText)) return { error: `${label}: enter a valid unit price (digits with at most two decimals).` };
    const quantity = Number(qtyText);
    const unitPriceCents = moneyToCents(priceText);
    const lineTotalCents = Math.round(quantity * unitPriceCents);
    items.push({
      name, quantity,
      unitPrice: centsToMoney(unitPriceCents), unitPriceCents,
      total: centsToMoney(lineTotalCents), lineTotalCents,
      treatmentId: str(item.treatmentId), tooth: str(item.tooth), note: str(item.note)
    });
  }
  if (!items.length && str(payload.itemName)) {
    return buildInvoiceItems({ items: [{ name: payload.itemName, quantity: payload.quantity ?? 1, unitPrice: payload.unitPrice, tooth: payload.tooth }] });
  }
  if (!items.length) return { error: 'Add at least one line item with a description and price.' };
  if (items.length > 300) return { error: 'An invoice can hold at most 300 line items — split the charges across several invoices.' };
  return { items };
}

// ---------------------------------------------------------------------------
// Builders: pure record construction shared by create/update ops so an update
// can never insert an orphan row.
// ---------------------------------------------------------------------------

function buildTreatmentPlan(repo, payload, ctx, existing = null) {
  const stages = (Array.isArray(payload.stages) ? payload.stages : [])
    .map((stage, index) => ({
      id: stage.id || makeId('stage'),
      title: str(stage.title) || `Stage ${index + 1}`,
      plannedDate: dateValid(stage.plannedDate) ? stage.plannedDate : '',
      estimatedCost: Math.max(0, toNumber(stage.estimatedCost)),
      status: ['Planned', 'In progress', 'Completed', 'Deferred'].includes(stage.status) ? stage.status : 'Planned',
      notes: str(stage.notes)
    }));
  const estimatedCost = Math.max(0, toNumber(payload.estimatedCost));
  const discount = Math.min(estimatedCost, Math.max(0, toNumber(payload.discount)));
  return {
    ...(existing || {}),
    id: existing?.id || makeId('plan'),
    patientId: payload.patientId,
    title: str(payload.title),
    goal: str(payload.goal),
    procedures: str(payload.procedures),
    teeth: str(payload.teeth),
    status: ['Draft', 'In Progress', 'Completed', 'Cancelled'].includes(payload.status) ? payload.status : (existing?.status || 'Draft'),
    estimatedDuration: Math.max(0, Math.round(toNumber(payload.estimatedDuration))),
    estimatedCost,
    discount,
    estimatedTotal: centsToMoney(Math.max(0, moneyToCents(estimatedCost) - moneyToCents(discount))),
    startDate: dateValid(payload.startDate) ? payload.startDate : '',
    reviewDate: dateValid(payload.reviewDate) ? payload.reviewDate : '',
    dentistId: str(payload.dentistId),
    notes: str(payload.notes),
    stages,
    createdAt: existing?.createdAt || ctx.now(),
    updatedAt: ctx.now()
  };
}

function buildTreatment(payload, ctx, existing = null) {
  return {
    ...(existing || {}),
    id: existing?.id || makeId('treatment'),
    code: str(payload.code),
    name: str(payload.name),
    category: str(payload.category),
    description: str(payload.description),
    defaultPrice: Math.max(0, toNumber(payload.defaultPrice)),
    duration: Math.max(0, Math.round(toNumber(payload.duration) || 30)),
    toothRequired: payload.toothRequired === true || payload.toothRequired === 'true',
    active: payload.active !== false && payload.active !== 'false',
    notes: str(payload.notes),
    createdAt: existing?.createdAt || ctx.now(),
    updatedAt: ctx.now()
  };
}

function buildExpense(repo, payload, ctx, existing = null) {
  const record = {
    ...(existing || {}),
    id: existing?.id || makeId('expense'),
    description: str(payload.description),
    amount: toNumber(payload.amount),
    date: payload.date,
    category: str(payload.category) || 'Other',
    method: str(payload.method) || 'Cash',
    reference: str(payload.reference),
    notes: str(payload.notes),
    createdAt: existing?.createdAt || ctx.now(),
    updatedAt: ctx.now()
  };
  return record;
}

function buildInvoice(repo, payload, ctx, existing = null) {
  const settings = repo.getSettings();
  const built = buildInvoiceItems(payload);
  if (built.error) return { error: built.error };
  const { items } = built;
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const discountText = payload.discount === undefined || payload.discount === null || str(payload.discount) === '' ? '0' : str(payload.discount);
  if (!validateMoney(discountText)) return { error: 'Discount must be a valid amount with at most two decimals.' };
  const discountCents = moneyToCents(discountText);
  if (discountCents > subtotalCents) return { error: 'The discount cannot be larger than the subtotal.' };
  const taxInput = payload.taxRate === undefined || payload.taxRate === null || str(payload.taxRate) === ''
    ? (settings.taxEnabled ? settings.taxRate : 0)
    : payload.taxRate;
  const taxRate = Number(taxInput);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return { error: 'The tax rate must be between 0 and 100%.' };
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * taxRate) / 100);
  const totalCents = taxableCents + taxCents;
  if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { error: 'Enter a valid invoice date.' };
  return {
    record: {
      ...(existing || {}),
      id: existing?.id || makeId('invoice'),
      invoiceNumber: existing?.invoiceNumber || nextCode(repo, 'invoice'),
      patientId: payload.patientId,
      visitId: str(payload.visitId),
      planId: str(payload.planId),
      dentistId: str(payload.dentistId),
      date: dateValid(payload.date) ? payload.date : (existing?.date || ctx.today()),
      items,
      subtotal: centsToMoney(subtotalCents),
      discount: centsToMoney(discountCents),
      taxRate,
      tax: centsToMoney(taxCents),
      total: centsToMoney(totalCents),
      notes: str(payload.notes),
      createdBy: existing?.createdBy || ctx.userName || '',
      createdAt: existing?.createdAt || ctx.now(),
      updatedAt: ctx.now()
    }
  };
}

// ---------------------------------------------------------------------------
// Operation registry
// ---------------------------------------------------------------------------

function syncAppointmentProgress(repo, appointmentId, ctx, audit) {
  if (!appointmentId) return;
  const appointment = repo.get('appointments', appointmentId);
  if (!appointment) return;
  if (['Scheduled', 'Checked In', 'Waiting', 'In Treatment'].includes(appointment.status)) {
    repo.update('appointments', { ...appointment, status: 'Completed', completedAt: ctx.now(), updatedAt: ctx.now() });
    audit.push({ action: 'Appointment completed', entity: 'Appointment', entityId: appointment.id, summary: `${appointment.appointmentCode || appointment.reason || 'Appointment'} · closed by clinical visit` });
  }
}


/* ──────────────────────────────────────────────────────────────
 * Prescription composition helpers (v1.6.0 flagship)
 * Structured medication rows + clinical documentation sections.
 * All free text stays clinician-authored — the app validates shape,
 * never content, and never generates diagnoses or recommendations.
 * ────────────────────────────────────────────────────────────── */
const MED_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Cream', 'Gel', 'Mouthwash', 'Drops', 'Injection', 'Other'];
const MED_DURATION_UNITS = ['Days', 'Weeks', 'Months'];
const FOOD_RELATIONS = ['Before food', 'After food', 'With food', 'At bedtime', 'Any time'];

export const MAX_PRESCRIPTION_ROWS = 60;

function normalizeMedicationRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  return rows.map((item) => {
    const durationValue = Math.max(0, Math.round(toNumber(item.durationValue ?? '')) || 0);
    const durationUnit = MED_DURATION_UNITS.includes(str(item.durationUnit)) ? str(item.durationUnit) : '';
    const duration = str(item.duration) || (durationValue && durationUnit ? `${durationValue} ${durationUnit}` : '');
    const form = MED_FORMS.includes(str(item.form)) ? str(item.form) : str(item.form) ? str(item.form) : '';
    const foodRelation = FOOD_RELATIONS.includes(str(item.foodRelation)) ? str(item.foodRelation) : '';
    const pattern = str(item.frequencyPattern);
    const frequency = str(item.frequency) || (pattern && foodRelation ? `${pattern} — ${foodRelation}` : pattern || (foodRelation ? foodRelation : ''));
    return {
      // legacy keys kept populated for every existing consumer (print, lists, patient tab)
      medicine: str(item.medicine), strength: str(item.strength), dosage: str(item.dosage),
      frequency, duration, route: str(item.route) || 'Oral', instructions: str(item.instructions),
      // v1.6.0 structured keys (additive)
      genericName: str(item.genericName), form, frequencyPattern: pattern,
      durationValue: durationValue || '', durationUnit, foodRelation,
      quantity: Math.max(0, Math.round(toNumber(item.quantity ?? '')) || 0) || ''
    };
  }).filter((item) => item.medicine);
}

function normalizeClinicalSections(payload, existing = {}) {
  const take = (key, legacyKey) => (payload[key] !== undefined ? str(payload[key]) : str(payload[legacyKey] ?? existing[key] ?? ''));
  return {
    chiefComplaint: take('chiefComplaint'),
    onExamination: take('onExamination'),
    requiredExamination: take('requiredExamination'),
    diagnosis: take('diagnosis'),
    advice: take('advice'),
    followUp: take('followUp'),
    followUpDate: dateValid(payload.followUpDate) ? payload.followUpDate : str(existing.followUpDate || ''),
    referral: take('referral'),
  };
}


/* Clinic-authored prescription templates (v1.6.0): stored in settings.medicationTemplates.
 * They NEVER auto-prescribe — they pre-fill rows for the clinician to review. */
function normalizeMedicationTemplates(list) {
  const raw = Array.isArray(list) ? list : [];
  return raw.slice(0, 60).map((t) => ({
    id: String(t.id || makeId('rxt')),
    name: str(t.name).slice(0, 80),
    medications: normalizeMedicationRows(t.medications || []),
    advice: str(t.advice || ''),
    followUp: str(t.followUp || '')
  })).filter((t) => t.name && t.medications.length);
}

function prescriptionUpsert(repo, payload, ctx, existing) {
  const patient = repo.get('patients', payload.patientId || existing?.patientId || '');
  if (!patient) return { ok: false, error: 'Choose an existing patient.' };
  if (!str(payload.doctor ?? existing?.doctor)) return { ok: false, error: 'The prescriber name is required.' };
  if (Array.isArray(payload.medications) && payload.medications.filter((row) => str(row?.medicine)).length > MAX_PRESCRIPTION_ROWS) {
    return { ok: false, error: `A prescription can list at most ${MAX_PRESCRIPTION_ROWS} medicines.` };
  }
  if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { ok: false, error: 'Enter a valid prescription date.' };
  let medications = normalizeMedicationRows(payload.medications);
  if (!medications.length && str(payload.medicine)) {
    medications = normalizeMedicationRows([{ medicine: payload.medicine, strength: payload.strength, dosage: payload.dosage, frequency: payload.frequency, duration: payload.duration, route: payload.route, instructions: payload.instructions }]);
  }
  // Legacy v1.3 pipe-delimited textarea still accepted on update paths from older clients.
  if (!medications.length && !existing?.medications?.length && str(payload.medicationsText)) {
    medications = normalizeMedicationRows(str(payload.medicationsText).split(/\r?\n/).map((line) => {
      const [medicine = '', strength = '', dosage = '', frequency = '', duration = '', route = 'Oral', instructions = ''] = line.split('|').map((part) => part.trim());
      return { medicine, strength, dosage, frequency, duration, route, instructions };
    }));
  }
  if (!medications.length && !existing?.medications?.length) return { ok: false, error: 'Add at least one medicine. Prescriptions are clinician-authored.' };
  const settings = repo.getSettings();
  const clinical = normalizeClinicalSections(payload, existing || {});
  const record = {
    ...(existing || {}),
    id: existing?.id || makeId('rx'),
    prescriptionCode: existing?.prescriptionCode || nextCode(repo, 'prescription'),
    patientId: patient.id,
    visitId: payload.visitId !== undefined ? str(payload.visitId) : str(existing?.visitId || ''),
    date: dateValid(payload.date) ? payload.date : (existing?.date || ctx.today()),
    doctor: str(payload.doctor ?? existing?.doctor),
    dentistId: payload.dentistId !== undefined ? str(payload.dentistId) : str(existing?.dentistId || ctx.userId || ''),
    medications: medications.length ? medications : existing.medications,
    ...clinical,
    notes: payload.notes !== undefined ? str(payload.notes) : str(existing?.notes || ''),
    createdAt: existing?.createdAt || ctx.now(),
    updatedAt: ctx.now()
  };
  if (existing) {
    repo.update('prescriptions', record);
    return { ok: true, record, audit: [{ action: 'Prescription updated', entity: 'Prescription', entityId: record.id, summary: `${record.prescriptionCode} · ${patient.fullName}` }] };
  }
  repo.insert('prescriptions', record);
  return { ok: true, record, audit: [{ action: 'Prescription created', entity: 'Prescription', entityId: record.id, summary: `${record.prescriptionCode} · ${patient.fullName} · ${record.medications.length} medicine(s)` }] };
}

export const OPS = {
  // ------------------------------------------------------------------ settings
  'settings.update': {
    permission: 'settings.edit',
    run(repo, payload, ctx) {
      const current = repo.getSettings();
      const allowed = [
        'clinicName', 'chamberName', 'dentistName', 'professionalTitle', 'qualifications', 'phone', 'secondaryPhone',
        'email', 'address', 'city', 'district', 'country', 'logo', 'currency', 'timezone',
        'dentistRegistration', 'clinicWebsite',
        'dateFormat', 'timeFormat', 'patientPrefix', 'invoicePrefix', 'appointmentPrefix', 'serialPrefix',
        'receiptPrefix', 'visitPrefix', 'prescriptionPrefix', 'staffPrefix', 'itemPrefix', 'defaultDuration', 'taxEnabled', 'taxRate', 'notificationRules',
        'autoLockMinutes', 'sessionTimeoutMinutes', 'notifications', 'paymentMethods', 'expenseCategories',
        'inventoryCategories', 'chairs', 'rooms', 'backupEnabled', 'backupIntervalHours', 'backupRetention',
        'backupDirectory', 'lowStockThreshold', 'attachmentMaxMb', 'accent', 'density', 'printPageSize', 'documentFooter',
        'paperProfile', 'customPatientFields', 'medicationTemplates', 'documentTemplate'
      ];
      const next = { ...current };
      const changed = [];
      for (const key of allowed) {
        if (payload[key] === undefined) continue;
        if (key === 'logo' && payload.logo && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(String(payload.logo))) {
          return { ok: false, error: 'The logo must be a PNG, JPEG or WebP image.' };
        }
        next[key] = payload[key];
        changed.push(key);
      }
      for (const legacy of ['language', 'applicationLock', 'pinHash', 'pinSalt']) delete next[legacy];
      // Document code prefixes: valid, and distinct per document kind so an
      // invoice number can never look like a receipt, visit or appointment code.
      const prefixKeys = ['patientPrefix', 'appointmentPrefix', 'visitPrefix', 'prescriptionPrefix', 'invoicePrefix', 'receiptPrefix', 'staffPrefix', 'itemPrefix', 'serialPrefix'];
      for (const key of prefixKeys) {
        if (payload[key] === undefined) continue;
        const clean = sanitizeCodePrefix(payload[key]);
        if (!clean) return { ok: false, error: 'Code prefixes must be 1–8 letters, digits or hyphens (for example INV or RCP).' };
        next[key] = clean;
      }
      const seen = new Map();
      for (const key of prefixKeys) {
        const value = sanitizeCodePrefix(next[key]) || '';
        if (!value) continue;
        if (seen.has(value)) return { ok: false, error: `Each document type needs its own prefix — "${value}" is used twice.` };
        seen.set(value, key);
      }
      if (payload.timezone !== undefined && str(payload.timezone)) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: str(payload.timezone) }); next.timezone = str(payload.timezone); } catch { return { ok: false, error: 'Choose a valid time zone.' }; }
      }
      if (payload.currency !== undefined && !SUPPORTED_CURRENCIES.includes(str(payload.currency))) return { ok: false, error: 'Choose a supported currency.' };
      if (next.dateFormat !== undefined) next.dateFormat = /dmy|DD\/MM\/YYYY/i.test(String(next.dateFormat)) ? 'dmy' : 'short';
      if (next.documentFooter !== undefined) next.documentTemplate = { ...(next.documentTemplate && typeof next.documentTemplate === 'object' ? next.documentTemplate : {}), footer: str(next.documentFooter) };
      if (next.notificationRules !== undefined) next.notificationRules = normalizeNotificationRules(next.notificationRules);
      if (next.customPatientFields !== undefined) next.customPatientFields = normalizeCustomFields(next.customPatientFields);
      if (next.medicationTemplates !== undefined) next.medicationTemplates = normalizeMedicationTemplates(next.medicationTemplates);
      const cleanList = (list, max, label) => {
        const values = [...new Set((Array.isArray(list) ? list : []).map(str).filter(Boolean))];
        if (values.length > max) throw new RangeError(`At most ${max} ${label} can be configured.`);
        return values;
      };
      try {
        if (payload.paymentMethods !== undefined) next.paymentMethods = cleanList(next.paymentMethods, 30, 'payment methods');
        if (payload.expenseCategories !== undefined) next.expenseCategories = cleanList(next.expenseCategories, 60, 'expense categories');
        if (payload.inventoryCategories !== undefined) next.inventoryCategories = cleanList(next.inventoryCategories, 60, 'inventory categories');
        if (payload.chairs !== undefined) next.chairs = cleanList(next.chairs, 40, 'chairs');
        if (payload.rooms !== undefined) next.rooms = cleanList(next.rooms, 40, 'rooms');
      } catch (error) {
        return { ok: false, error: error.message };
      }
      if (payload.paymentMethods !== undefined && !next.paymentMethods.length) return { ok: false, error: 'Keep at least one payment method.' };
      if (next.taxRate !== undefined) {
        const rate = Number(next.taxRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: 'The tax rate must be between 0 and 100%.' };
        next.taxRate = Math.round(rate * 100) / 100;
      }
      next.taxEnabled = next.taxEnabled === true || next.taxEnabled === 'true' || next.taxEnabled === 'on';
      if (next.defaultDuration !== undefined) next.defaultDuration = Math.min(480, Math.max(5, Math.round(toNumber(next.defaultDuration) || 30)));
      if (next.attachmentMaxMb !== undefined) next.attachmentMaxMb = Math.min(4096, Math.max(1, toNumber(next.attachmentMaxMb) || 256));
      if (next.sessionTimeoutMinutes !== undefined) next.sessionTimeoutMinutes = Math.min(480, Math.max(0, Math.round(toNumber(next.sessionTimeoutMinutes))));
      if (next.autoLockMinutes !== undefined) next.autoLockMinutes = Math.min(480, Math.max(0, Math.round(toNumber(next.autoLockMinutes))));
      if (next.backupIntervalHours !== undefined) next.backupIntervalHours = Math.min(720, Math.max(1, Math.round(toNumber(next.backupIntervalHours) || 24)));
      if (next.backupRetention !== undefined) next.backupRetention = Math.min(365, Math.max(1, Math.round(toNumber(next.backupRetention) || 10)));
      if (next.backupDirectory !== undefined) {
        next.backupDirectory = str(next.backupDirectory).slice(0, 400);
        if (next.backupDirectory && !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(next.backupDirectory)) return { ok: false, error: 'The backup folder must be an absolute path.' };
      }
      if (next.lowStockThreshold !== undefined) next.lowStockThreshold = Math.max(0, toNumber(next.lowStockThreshold));
      if (next.documentTemplate && typeof next.documentTemplate === 'object') next.documentTemplate = { footer: str(next.documentTemplate.footer).slice(0, 500), showLogo: next.documentTemplate.showLogo !== false, showClinicContact: next.documentTemplate.showClinicContact !== false };
      if (next.printPageSize !== undefined && !['A4', 'A5', 'Letter', 'Legal', 'Receipt80'].includes(next.printPageSize)) next.printPageSize = 'A4';
      repo.setMeta('settings', next);
      return { ok: true, settings: next, audit: [{ action: 'Settings updated', entity: 'Settings', entityId: '', summary: changed.slice(0, 12).join(', ') || 'Settings reviewed' }] };
    }
  },

  'setup.complete': {
    // First-run setup authority, or settings.edit for a signed-in administrator.
    permission: (payload, ctx) => (ctx && ctx.firstRun === true ? null : 'settings.edit'),
    run(repo, payload) {
      const current = repo.getSettings();
      const identity = {};
      for (const key of ['clinicName', 'dentistName', 'professionalTitle', 'qualifications', 'phone', 'email', 'address', 'city', 'district', 'chamberName', 'currency', 'timezone', 'dentistRegistration', 'clinicWebsite']) {
        if (payload[key] !== undefined) identity[key] = str(payload[key]);
      }
      const clinicName = identity.clinicName !== undefined ? identity.clinicName : str(current.clinicName);
      if (!clinicName) return { ok: false, error: 'Enter the clinic name. It appears on every printed document.' };
      if (identity.currency !== undefined && identity.currency && !SUPPORTED_CURRENCIES.includes(identity.currency)) return { ok: false, error: 'Choose a supported currency.' };
      if (identity.timezone) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: identity.timezone }); } catch { return { ok: false, error: 'Choose a valid time zone.' }; }
      }
      const next = { ...current, ...identity };
      for (const legacy of ['language', 'applicationLock', 'pinHash', 'pinSalt']) delete next[legacy];
      repo.setMeta('settings', next);
      repo.setMeta('setupComplete', true);
      return { ok: true, settings: next, audit: [{ action: 'Workspace setup completed', entity: 'Settings', entityId: '', summary: clinicName }] };
    }
  },

  // ------------------------------------------------------------------ patients
  'patient.create': {
    permission: 'patients.create',
    run(repo, payload, ctx) {
      const validation = validatePatientInput(payload);
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const settings = repo.getSettings();
      const duplicates = repo.findPatientDuplicates({
        fullName: str(payload.fullName), phone: str(payload.phone), email: str(payload.email),
        dateOfBirth: str(payload.dateOfBirth), patientCode: ''
      });
      if (duplicates.length && !payload.confirmDuplicate) {
        return { ok: false, code: 'duplicate-confirm', duplicates, error: `Possible duplicate: ${duplicates[0].fullName} (${duplicates[0].patientCode || 'no code'}). Confirm to save anyway.` };
      }
      const customFields = Object.fromEntries((settings.customPatientFields || []).map((definition) => [definition.key, str(payload.customFields?.[definition.key] ?? payload[`custom_${definition.key}`] ?? '')]));
      const record = {
        id: makeId('patient'),
        patientCode: nextCode(repo, 'patient'),
        fullName: str(payload.fullName),
        preferredName: str(payload.preferredName),
        phone: str(payload.phone),
        email: str(payload.email),
        gender: str(payload.gender),
        dateOfBirth: str(payload.dateOfBirth),
        bloodGroup: str(payload.bloodGroup),
        address: str(payload.address),
        city: str(payload.city),
        district: str(payload.district),
        occupation: str(payload.occupation),
        maritalStatus: str(payload.maritalStatus),
        emergencyName: str(payload.emergencyName),
        emergencyPhone: str(payload.emergencyPhone),
        emergencyRelation: str(payload.emergencyRelation),
        preferredContact: str(payload.preferredContact) || 'Phone',
        communicationNotes: str(payload.communicationNotes),
        allergies: str(payload.allergies),
        medicalHistory: str(payload.medicalHistory),
        importantAlerts: str(payload.importantAlerts),
        notes: str(payload.notes),
        tags: normaliseTags(payload.tags),
        customFields,
        registrationDate: dateValid(payload.registrationDate) ? payload.registrationDate : ctx.today(),
        status: 'Active',
        archived: false,
        balanceCents: 0,
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('patients', record);
      return { ok: true, record, audit: [{ action: 'Patient created', entity: 'Patient', entityId: record.id, summary: `${record.patientCode} · ${record.fullName}` }] };
    }
  },

  'patient.update': {
    permission: 'patients.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'patients', payload.id, 'patient');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      // Only clinical/demographic fields are editable here. Identity (code,
      // registration), archive state (patient.archive) and balances are owned
      // by dedicated operations.
      const editable = {};
      for (const key of PATIENT_EDITABLE_FIELDS) {
        if (payload[key] !== undefined) editable[key] = key === 'tags' ? payload[key] : str(payload[key]);
      }
      const merged = { ...existing, ...editable };
      const validation = validatePatientInput(merged);
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const settings = repo.getSettings();
      const record = {
        ...merged,
        id: existing.id,
        patientCode: existing.patientCode,
        registrationDate: existing.registrationDate,
        createdAt: existing.createdAt,
        fullName: str(merged.fullName),
        phone: str(merged.phone),
        email: str(merged.email),
        tags: normaliseTags(merged.tags),
        customFields: Object.fromEntries((settings.customPatientFields || []).map((definition) => [definition.key, str(payload.customFields?.[definition.key] ?? payload[`custom_${definition.key}`] ?? existing.customFields?.[definition.key] ?? '')])),
        status: existing.status || (existing.archived ? 'Archived' : 'Active'),
        archived: Boolean(existing.archived),
        balanceCents: existing.balanceCents ?? 0,
        updatedAt: ctx.now()
      };
      repo.update('patients', record);
      return { ok: true, record, audit: [{ action: 'Patient edited', entity: 'Patient', entityId: record.id, summary: `${record.patientCode} · ${record.fullName}` }] };
    }
  },

  'patient.archive': {
    permission: 'patients.archive',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'patients', payload.id, 'patient');
      if (found.error) return { ok: false, error: found.error };
      const archived = payload.archived !== false;
      const record = { ...found.record, archived, status: archived ? 'Archived' : 'Active', updatedAt: ctx.now() };
      repo.update('patients', record);
      return { ok: true, record, audit: [{ action: archived ? 'Patient archived' : 'Patient reactivated', entity: 'Patient', entityId: record.id, summary: `${record.patientCode} · ${record.fullName}` }] };
    }
  },

  'patient.merge': {
    permission: 'patients.edit',
    run(repo, payload, ctx) {
      const primary = repo.get('patients', payload.primaryId);
      const duplicate = repo.get('patients', payload.duplicateId);
      if (!primary || !duplicate) return { ok: false, error: 'Both the primary and the duplicate patient must exist.' };
      if (primary.id === duplicate.id) return { ok: false, error: 'Choose two different patients.' };
      if (duplicate.mergedInto) return { ok: false, error: `${duplicate.fullName} was already merged into another record.` };
      if (!payload.confirm) {
        return { ok: false, code: 'merge-confirm', error: `Merging moves every record from ${duplicate.fullName} (${duplicate.patientCode}) into ${primary.fullName} (${primary.patientCode}) and archives the duplicate. Confirm to continue.` };
      }
      // Dental chart: the primary's current tooth records win; the duplicate's
      // conflicting current records become history (never deleted).
      const supersededTeeth = repo.supersedeConflictingDental ? repo.supersedeConflictingDental(duplicate.id, primary.id) : 0;
      const moved = repo.reassignPatientRecords(duplicate.id, primary.id);
      const latest = (a, b) => (String(a || '') > String(b || '') ? a : b) || '';
      const mergedRecord = {
        ...primary,
        tags: normaliseTags([...(primary.tags || []), ...(duplicate.tags || [])]),
        notes: [primary.notes, duplicate.notes && `Merged notes (from ${duplicate.patientCode}): ${duplicate.notes}`].filter(Boolean).join('\n'),
        phone: primary.phone || duplicate.phone,
        email: primary.email || duplicate.email,
        dateOfBirth: primary.dateOfBirth || duplicate.dateOfBirth,
        gender: primary.gender || duplicate.gender,
        bloodGroup: primary.bloodGroup || duplicate.bloodGroup,
        address: primary.address || duplicate.address,
        allergies: [...new Set([primary.allergies, duplicate.allergies].filter(Boolean))].join('; '),
        medicalHistory: [...new Set([primary.medicalHistory, duplicate.medicalHistory].filter(Boolean))].join('; '),
        medications: [...new Set([primary.medications, duplicate.medications].filter(Boolean))].join('; '),
        importantAlerts: [...new Set([primary.importantAlerts, duplicate.importantAlerts].filter(Boolean))].join('; '),
        emergencyName: primary.emergencyName || duplicate.emergencyName,
        emergencyPhone: primary.emergencyPhone || duplicate.emergencyPhone,
        lastVisit: latest(primary.lastVisit, duplicate.lastVisit),
        archived: false,
        status: 'Active',
        updatedAt: ctx.now()
      };
      repo.update('patients', mergedRecord);
      repo.update('patients', { ...duplicate, archived: true, status: 'Archived', mergedInto: primary.id, mergedAt: ctx.now(), updatedAt: ctx.now() });
      repo.updatePatientBalance(primary.id);
      repo.updatePatientBalance(duplicate.id);
      return {
        ok: true,
        record: mergedRecord,
        moved,
        supersededTeeth,
        audit: [{ action: 'Patients merged', entity: 'Patient', entityId: primary.id, summary: `${duplicate.patientCode} merged into ${primary.patientCode} · ${moved} record(s) reassigned` }]
      };
    }
  },

  // ------------------------------------------------------------- appointments
  'appointment.create': {
    permission: 'appointments.create',
    run(repo, payload, ctx) {
      if (!payload.patientId || !repo.get('patients', payload.patientId)) return { ok: false, error: 'Choose an existing patient.' };
      if (!dateValid(payload.date)) return { ok: false, error: 'A valid appointment date is required.' };
      if (!/^\d{2}:\d{2}$/.test(str(payload.time))) return { ok: false, error: 'A valid start time (HH:MM) is required.' };
      if (!str(payload.reason)) return { ok: false, error: 'A reason for the appointment is required.' };
      const settings = repo.getSettings();
      const candidate = {
        id: makeId('appointment'),
        appointmentCode: nextCode(repo, 'appointment'),
        patientId: payload.patientId,
        date: payload.date,
        time: str(payload.time),
        duration: Math.min(480, Math.max(5, Math.round(toNumber(payload.duration) || settings.defaultDuration || 30))),
        dentistId: str(payload.dentistId),
        chair: str(payload.chair) || (settings.chairs?.[0] ?? 'Chair 1'),
        room: str(payload.room) || (settings.rooms?.[0] ?? 'Room 1'),
        reason: str(payload.reason),
        treatment: str(payload.treatment),
        notes: str(payload.notes),
        status: APPOINTMENT_STATUSES.includes(payload.status) ? payload.status : 'Scheduled',
        serial: '',
        checkedInAt: '', startedAt: '', completedAt: '',
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      const conflict = repo.appointmentsOnDate(candidate.date)
        .find((appointment) => appointmentsOverlap(candidate, appointment, settings.defaultDuration));
      if (conflict && !payload.confirmConflict) {
        return { ok: false, code: 'conflict-confirm', conflict, error: `This overlaps another appointment (${conflict.time}, ${conflict.chair || 'chair'}${conflict.room ? `, ${conflict.room}` : ''}). Confirm to book anyway.` };
      }
      repo.insert('appointments', candidate);
      return { ok: true, record: candidate, audit: [{ action: 'Appointment created', entity: 'Appointment', entityId: candidate.id, summary: `${candidate.date} ${candidate.time} · ${candidate.appointmentCode}` }] };
    }
  },

  'appointment.update': {
    permission: 'appointments.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'appointments', payload.id, 'appointment');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { ok: false, error: 'Enter a valid appointment date.' };
      if (payload.time !== undefined && payload.time !== '' && !/^\d{2}:\d{2}$/.test(str(payload.time))) return { ok: false, error: 'Enter a valid start time (HH:MM).' };
      const settings = repo.getSettings();
      const status = APPOINTMENT_STATUSES.includes(payload.status) ? payload.status : existing.status;
      if (status !== existing.status) {
        if (!appointmentTransitionAllowed(existing.status, status)) return { ok: false, error: `An appointment cannot move from ${existing.status} to ${status}.`, code: 'invalid-transition' };
        if (status === 'Cancelled' && !hasPermission({ role: ctx.role, permissions: ctx.permissions }, 'appointments.cancel')) {
          return { ok: false, error: 'Your account is not allowed to cancel appointments.', code: 'permission-denied', permission: 'appointments.cancel' };
        }
      }
      const record = {
        ...existing,
        patientId: payload.patientId || existing.patientId,
        date: dateValid(payload.date) ? payload.date : existing.date,
        time: /^\d{2}:\d{2}$/.test(str(payload.time)) ? str(payload.time) : existing.time,
        duration: Math.min(480, Math.max(5, Math.round(toNumber(payload.duration ?? existing.duration) || settings.defaultDuration || 30))),
        dentistId: payload.dentistId !== undefined ? str(payload.dentistId) : existing.dentistId,
        chair: payload.chair !== undefined ? str(payload.chair) : existing.chair,
        room: payload.room !== undefined ? str(payload.room) : existing.room,
        reason: payload.reason !== undefined ? str(payload.reason) : existing.reason,
        treatment: payload.treatment !== undefined ? str(payload.treatment) : existing.treatment,
        notes: payload.notes !== undefined ? str(payload.notes) : existing.notes,
        status,
        updatedAt: ctx.now()
      };
      if (!str(record.reason)) return { ok: false, error: 'A reason for the appointment is required.' };
      if (status === 'Cancelled' && existing.status !== 'Cancelled') record.cancelledAt = ctx.now();
      if (!repo.get('patients', record.patientId)) return { ok: false, error: 'Choose an existing patient.' };
      const conflict = !['Cancelled', 'No Show', 'Completed'].includes(record.status) && repo.appointmentsOnDate(record.date)
        .find((appointment) => appointmentsOverlap(record, appointment, settings.defaultDuration));
      if (conflict && !payload.confirmConflict) {
        return { ok: false, code: 'conflict-confirm', conflict, error: `This overlaps another appointment (${conflict.time}, ${conflict.chair || 'chair'}${conflict.room ? `, ${conflict.room}` : ''}). Confirm to reschedule anyway.` };
      }
      repo.update('appointments', record);
      const rescheduled = record.date !== existing.date || record.time !== existing.time;
      return { ok: true, record, audit: [{ action: rescheduled ? 'Appointment rescheduled' : 'Appointment edited', entity: 'Appointment', entityId: record.id, summary: `${record.appointmentCode || ''} · ${record.date} ${record.time} · ${record.status}` }] };
    }
  },

  'appointment.setStatus': {
    permission: (payload) => (payload.status === 'Cancelled' ? 'appointments.cancel' : ['appointments.queue', 'appointments.edit']),
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'appointments', payload.id, 'appointment');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      const status = str(payload.status);
      if (!APPOINTMENT_STATUSES.includes(status)) return { ok: false, error: 'Unknown appointment status.' };
      if (!appointmentTransitionAllowed(existing.status, status)) return { ok: false, error: `An appointment cannot move from ${existing.status || 'Scheduled'} to ${status}.`, code: 'invalid-transition' };
      const record = { ...existing, status, updatedAt: ctx.now() };
      if (['Checked In', 'Waiting', 'In Treatment'].includes(status) && !record.checkedInAt) record.checkedInAt = ctx.now();
      if (['Checked In', 'Waiting', 'In Treatment'].includes(status) && !record.serial) {
        record.serial = repo.nextQueueSerial ? repo.nextQueueSerial(record.date, repo.getSettings().serialPrefix || 'Q') : `${repo.getSettings().serialPrefix || 'Q'}-001`;
      }
      if (status === 'In Treatment') record.startedAt = record.startedAt || ctx.now();
      if (status === 'Completed') { record.completedAt = ctx.now(); record.startedAt = record.startedAt || ctx.now(); }
      if (status === 'Cancelled') { record.cancelledAt = ctx.now(); record.cancelReason = str(payload.reason) || record.cancelReason || ''; }
      if (status === 'No Show') record.noShowAt = ctx.now();
      if (status === 'Scheduled' && ['Cancelled', 'No Show'].includes(existing.status)) { record.cancelledAt = ''; record.noShowAt = ''; record.reinstatedAt = ctx.now(); }
      repo.update('appointments', record);
      return { ok: true, record, audit: [{ action: 'Appointment status changed', entity: 'Appointment', entityId: record.id, summary: `${record.appointmentCode || ''} · ${existing.status || 'Scheduled'} → ${status}${record.serial ? ` · serial ${record.serial}` : ''}` }] };
    }
  },

  'appointment.cancel': {
    permission: 'appointments.cancel',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'appointments', payload.id, 'appointment');
      if (found.error) return { ok: false, error: found.error };
      if (found.record.status === 'Cancelled') return { ok: false, error: 'This appointment is already cancelled.' };
      if (!appointmentTransitionAllowed(found.record.status, 'Cancelled')) return { ok: false, error: `A ${found.record.status.toLowerCase()} appointment cannot be cancelled.`, code: 'invalid-transition' };
      const record = { ...found.record, status: 'Cancelled', cancelReason: str(payload.reason), cancelledAt: ctx.now(), updatedAt: ctx.now() };
      repo.update('appointments', record);
      return { ok: true, record, audit: [{ action: 'Appointment cancelled', entity: 'Appointment', entityId: record.id, summary: `${record.appointmentCode || ''} · ${record.cancelReason || 'Cancelled'}` }] };
    }
  },

  // ------------------------------------------------------------------ clinical
  'visit.create': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      if (!payload.patientId || !repo.get('patients', payload.patientId)) return { ok: false, error: 'Choose an existing patient.' };
      if (!str(payload.reason) && !str(payload.chiefComplaint)) return { ok: false, error: 'A reason or chief complaint is required.' };
      const settings = repo.getSettings();
      const date = dateValid(payload.date) ? payload.date : ctx.today();
      const record = {
        id: makeId('visit'),
        visitCode: nextCode(repo, 'visit'),
        patientId: payload.patientId,
        appointmentId: str(payload.appointmentId),
        date,
        reason: str(payload.reason) || str(payload.chiefComplaint),
        chiefComplaint: str(payload.chiefComplaint) || str(payload.reason),
        symptoms: str(payload.symptoms),
        findings: str(payload.findings),
        diagnosis: str(payload.diagnosis),
        treatmentPerformed: str(payload.treatmentPerformed),
        procedures: str(payload.procedures),
        teeth: str(payload.teeth),
        anesthesia: str(payload.anesthesia),
        medications: str(payload.medications),
        notes: str(payload.notes),
        followUpDate: dateValid(payload.followUpDate) ? payload.followUpDate : '',
        dentistId: str(payload.dentistId),
        status: str(payload.status) || 'Completed',
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      if (record.appointmentId) {
        const appointment = repo.get('appointments', record.appointmentId);
        if (!appointment || appointment.patientId !== record.patientId) return { ok: false, error: 'The linked appointment does not belong to this patient.' };
      }
      repo.insert('visits', record);
      const patient = repo.get('patients', record.patientId);
      if (patient && (!patient.lastVisit || record.date > patient.lastVisit)) {
        repo.update('patients', { ...patient, lastVisit: record.date, updatedAt: ctx.now() });
      }
      const audit = [{ action: 'Visit created', entity: 'Visit', entityId: record.id, summary: `${patient?.fullName || record.patientId} · ${record.date} · ${record.reason}` }];
      // Automation allowed by §85: a due follow-up date becomes an actionable task.
      syncAppointmentProgress(repo, record.appointmentId, ctx, audit);
      if (record.followUpDate) {
        const followUp = {
          id: makeId('followup'), patientId: record.patientId, visitId: record.id, appointmentId: '',
          title: `Follow-up: ${record.reason || 'clinical visit'}`, reason: record.reason,
          dueDate: record.followUpDate, status: 'Open', notes: str(payload.followUpNotes),
          completedAt: '', createdAt: ctx.now(), updatedAt: ctx.now()
        };
        repo.insert('followUpTasks', followUp);
        audit.push({ action: 'Follow-up scheduled', entity: 'Follow-up', entityId: followUp.id, summary: `${followUp.title} · due ${followUp.dueDate}` });
      }
      return { ok: true, record, audit };
    }
  },

  'visit.update': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'visits', payload.id, 'visit');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { ok: false, error: 'Enter a valid visit date.' };
      if (payload.followUpDate !== undefined && payload.followUpDate !== '' && !dateValid(payload.followUpDate)) return { ok: false, error: 'Enter a valid follow-up date.' };
      const next = { ...existing };
      for (const key of VISIT_EDITABLE_FIELDS) if (payload[key] !== undefined) next[key] = str(payload[key]);
      if (!str(next.reason) && !str(next.chiefComplaint)) return { ok: false, error: 'A reason or chief complaint is required.' };
      const record = { ...next, id: existing.id, visitCode: existing.visitCode, patientId: existing.patientId, createdAt: existing.createdAt, updatedAt: ctx.now() };
      repo.update('visits', record);
      if (record.date !== existing.date && repo.refreshPatientVisitDates) repo.refreshPatientVisitDates(record.patientId);
      return { ok: true, record, audit: [{ action: 'Visit edited', entity: 'Visit', entityId: record.id, summary: `${record.visitCode} · ${record.date}` }] };
    }
  },

  'dental.save': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose a patient first.' };
      const tooth = Number(payload.tooth);
      const dentition = dentitionOf(tooth);
      if (!dentition || !isValidFdi(tooth, dentition)) return { ok: false, error: 'Choose a valid FDI tooth (11–48 permanent, 51–85 primary).' };
      if (payload.dentition && payload.dentition !== dentition) return { ok: false, error: `Tooth ${tooth} belongs to the ${dentition} dentition.` };
      const status = str(payload.status);
      const note = str(payload.note);
      if (!status && !note && !str(payload.procedure)) return { ok: false, error: 'Record a status, procedure or note for this tooth.' };
      // Preserve tooth history: the previous current record is superseded, never lost.
      repo.supersedeDental(patient.id, tooth, dentition);
      const record = {
        id: makeId('dental'),
        patientId: patient.id,
        tooth,
        toothSystem: 'FDI',
        dentition,
        status,
        note,
        procedure: str(payload.procedure),
        treatmentId: str(payload.treatmentId),
        visitId: str(payload.visitId),
        superseded: false,
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('dentalRecords', record);
      return { ok: true, record, audit: [{ action: 'Dental chart updated', entity: 'Dental record', entityId: record.id, summary: `${patient.fullName} · tooth ${tooth} (${dentition}) · ${status || 'note'}` }] };
    }
  },

  'dental.remove': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'dentalRecords', payload.id, 'dental record');
      if (found.error) return { ok: false, error: found.error };
      repo.supersedeDental(found.record.patientId, found.record.tooth, found.record.dentition || 'adult');
      return { ok: true, audit: [{ action: 'Dental chart record cleared', entity: 'Dental record', entityId: found.record.id, summary: `Tooth ${found.record.tooth} · history preserved` }] };
    }
  },

  'prescription.create': {
    permission: 'prescriptions.create',
    run(repo, payload, ctx) {
      return prescriptionUpsert(repo, payload, ctx, null);
    }
  },

  'prescription.update': {
    permission: 'prescriptions.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'prescriptions', payload.id, 'prescription');
      if (found.error) return { ok: false, error: found.error };
      return prescriptionUpsert(repo, payload, ctx, found.record);
    }
  },

  'medicationTemplate.save': {
    permission: 'prescriptions.edit',
    run(repo, payload, ctx) {
      const settings = repo.getSettings();
      const templates = normalizeMedicationTemplates([...(settings.medicationTemplates || []), { name: payload.name, medications: payload.medications, advice: payload.advice, followUp: payload.followUp }]);
      repo.setMeta('settings', { ...settings, medicationTemplates: templates });
      return { ok: true, record: templates[templates.length - 1], audit: [{ action: 'Prescription template saved', entity: 'Settings', entityId: 'medicationTemplates', summary: `${templates[templates.length - 1].name} · ${templates[templates.length - 1].medications.length} medicine(s)` }] };
    }
  },

  'medicationTemplate.delete': {
    permission: 'settings.edit',
    run(repo, payload, ctx) {
      const settings = repo.getSettings();
      const templates = (settings.medicationTemplates || []).filter((t) => t.id !== str(payload.id));
      repo.setMeta('settings', { ...settings, medicationTemplates: templates });
      return { ok: true, audit: [{ action: 'Prescription template deleted', entity: 'Settings', entityId: 'medicationTemplates', summary: str(payload.name || payload.id) }] };
    }
  },

  'treatmentPlan.create': {
    permission: 'clinical.plan',
    run(repo, payload, ctx) {
      const validation = validateTreatmentPlanInput(payload);
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      if (!repo.get('patients', payload.patientId)) return { ok: false, error: 'Choose an existing patient.' };
      const record = buildTreatmentPlan(repo, payload, ctx);
      repo.insert('treatmentPlans', record);
      return { ok: true, record, audit: [{ action: 'Treatment plan created', entity: 'Treatment plan', entityId: record.id, summary: `${record.title} · ${record.stages.length} stage(s)` }] };
    }
  },

  'treatmentPlan.update': {
    permission: 'clinical.plan',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'treatmentPlans', payload.id, 'treatment plan');
      if (found.error) return { ok: false, error: found.error };
      const merged = { ...found.record, ...payload, id: found.record.id };
      const validation = validateTreatmentPlanInput(merged);
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const record = buildTreatmentPlan(repo, merged, ctx, found.record);
      repo.update('treatmentPlans', record);
      return { ok: true, record, audit: [{ action: 'Treatment plan edited', entity: 'Treatment plan', entityId: record.id, summary: `${record.title} · ${record.status}` }] };
    }
  },

  'treatmentPlan.convert': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'treatmentPlans', payload.id, 'treatment plan');
      if (found.error) return { ok: false, error: found.error };
      const plan = found.record;
      // Explicit conversion creates a clinical visit ONLY — never silent financial records (§28).
      const settings = repo.getSettings();
      const visit = {
        id: makeId('visit'),
        visitCode: nextCode(repo, 'visit'),
        patientId: plan.patientId,
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: `Treatment plan: ${plan.title}`,
        chiefComplaint: `Treatment plan: ${plan.title}`,
        diagnosis: plan.goal || '',
        treatmentPerformed: (plan.stages || []).filter((stage) => stage.status !== 'Deferred').map((stage) => stage.title).join(', '),
        notes: str(payload.notes) || 'Created from a clinician-authored treatment plan.',
        dentistId: plan.dentistId,
        status: 'Completed',
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('visits', visit);
      const updatedPlan = { ...plan, status: plan.status === 'Draft' ? 'In Progress' : (plan.status || 'In Progress'), convertedVisitId: visit.id, updatedAt: ctx.now() };
      repo.update('treatmentPlans', updatedPlan);
      const patient = repo.get('patients', plan.patientId);
      if (patient) repo.update('patients', { ...patient, lastVisit: visit.date, updatedAt: ctx.now() });
      return {
        ok: true, record: visit, plan: updatedPlan,
        audit: [
          { action: 'Treatment plan converted to visit', entity: 'Treatment plan', entityId: plan.id, summary: `${plan.title} · ${visit.visitCode}` },
          { action: 'Visit created', entity: 'Visit', entityId: visit.id, summary: `${plan.title} · ${visit.date}` }
        ]
      };
    }
  },

  'treatment.create': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      if (!str(payload.name)) return { ok: false, error: 'Treatment name is required.' };
      const record = buildTreatment(payload, ctx);
      repo.insert('treatments', record);
      return { ok: true, record, audit: [{ action: 'Treatment catalog item created', entity: 'Treatment', entityId: record.id, summary: `${record.code ? `${record.code} · ` : ''}${record.name}` }] };
    }
  },

  'treatment.update': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'treatments', payload.id, 'treatment');
      if (found.error) return { ok: false, error: found.error };
      const merged = { ...found.record, ...payload };
      if (!str(merged.name)) return { ok: false, error: 'Treatment name is required.' };
      const record = buildTreatment(merged, ctx, found.record);
      repo.update('treatments', record);
      return { ok: true, record, audit: [{ action: 'Treatment catalog edited', entity: 'Treatment', entityId: record.id, summary: record.name }] };
    }
  },

  // ------------------------------------------------------------------- billing
  'invoice.create': {
    permission: 'billing.create',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      const built = buildInvoice(repo, payload, ctx);
      if (built.error) return { ok: false, error: built.error };
      const record = {
        ...built.record,
        paid: 0,
        due: built.record.total,
        status: payload.status === 'Draft' ? 'Draft' : (moneyToCents(built.record.total) === 0 ? 'Paid' : 'Issued')
      };
      repo.insert('invoices', record);
      repo.updatePatientBalance(patient.id);
      return { ok: true, record, audit: [{ action: 'Invoice created', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${patient.patientCode || ''} ${patient.fullName} · ${record.total} · ${record.status}` }] };
    }
  },

  'invoice.update': {
    permission: 'billing.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'invoices', payload.id, 'invoice');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      if (existing.status === 'Cancelled') return { ok: false, error: 'Cancelled invoices are read-only.', code: 'invoice-cancelled' };
      // Status is derived from money. The only manual transition is issuing a draft;
      // cancellation goes through invoice.cancel (billing.void + refund-first guard).
      const requested = payload.status === undefined || payload.status === '' ? existing.status : String(payload.status);
      const issuing = existing.status === 'Draft' && requested === 'Issued';
      if (requested !== existing.status && !issuing) {
        if (requested === 'Cancelled') return { ok: false, error: 'Use "Cancel invoice" to cancel an invoice.', code: 'use-cancel' };
        if (requested === 'Draft') return { ok: false, error: 'An issued invoice cannot return to draft.', code: 'status-locked' };
        return { ok: false, error: 'Invoice status follows recorded payments and adjustments and cannot be set manually.', code: 'status-locked' };
      }
      const state = computeInvoiceState(repo, existing);
      const moneyExists = state.grossCents > 0 || state.adjustedCents > 0;
      if (moneyExists) {
        const repricingAttempted = ['items', 'itemName', 'unitPrice', 'quantity', 'discount', 'taxRate', 'subtotal', 'total', 'patientId']
          .some((key) => payload[key] !== undefined && JSON.stringify(payload[key]) !== JSON.stringify(existing[key]));
        if (repricingAttempted) {
          return { ok: false, error: 'Invoice pricing and patient are locked after payments or adjustments exist. Record an adjustment or refund instead.', code: 'invoice-locked' };
        }
        const record = { ...existing, notes: payload.notes !== undefined ? str(payload.notes) : existing.notes, updatedAt: ctx.now() };
        repo.update('invoices', record);
        const refreshed = refreshInvoicePaymentState(repo, record, ctx.now());
        return { ok: true, record: refreshed, audit: [{ action: 'Invoice edited', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · notes updated` }] };
      }
      const targetPatientId = payload.patientId !== undefined && payload.patientId !== '' ? payload.patientId : existing.patientId;
      const patient = repo.get('patients', targetPatientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      const built = buildInvoice(repo, {
        items: payload.items !== undefined ? payload.items : existing.items,
        itemName: payload.itemName, unitPrice: payload.unitPrice, quantity: payload.quantity,
        discount: payload.discount !== undefined ? payload.discount : existing.discount,
        taxRate: payload.taxRate !== undefined ? payload.taxRate : existing.taxRate,
        date: payload.date !== undefined ? payload.date : existing.date,
        notes: payload.notes !== undefined ? payload.notes : existing.notes,
        visitId: payload.visitId !== undefined ? payload.visitId : existing.visitId,
        planId: payload.planId !== undefined ? payload.planId : existing.planId,
        dentistId: payload.dentistId !== undefined ? payload.dentistId : existing.dentistId,
        patientId: patient.id
      }, ctx, existing);
      if (built.error) return { ok: false, error: built.error };
      const nextStatus = issuing ? 'Issued' : existing.status;
      const record = {
        ...built.record,
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        paid: 0,
        due: built.record.total,
        status: nextStatus === 'Draft' ? 'Draft' : (moneyToCents(built.record.total) === 0 ? 'Paid' : 'Issued'),
        createdAt: existing.createdAt
      };
      repo.update('invoices', record);
      repo.updatePatientBalance(record.patientId);
      if (existing.patientId && existing.patientId !== record.patientId) repo.updatePatientBalance(existing.patientId);
      return { ok: true, record, audit: [{ action: issuing ? 'Invoice issued' : 'Invoice edited', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${record.total} · ${record.status}` }] };
    }
  },

  'invoice.cancel': {
    permission: 'billing.void',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'invoices', payload.id, 'invoice');
      if (found.error) return { ok: false, error: found.error };
      const invoice = found.record;
      if (invoice.status === 'Cancelled') return { ok: false, error: 'This invoice is already cancelled.' };
      if (!str(payload.reason)) return { ok: false, error: 'A cancellation reason is required.' };
      const state = computeInvoiceState(repo, invoice);
      if (state.paidCents > 0) return { ok: false, error: 'Refund the recorded payments before cancelling this invoice.' };
      if (state.adjustedCents > 0) return { ok: false, error: 'This invoice has balance adjustments and cannot be cancelled.' };
      const record = { ...invoice, status: 'Cancelled', cancelReason: str(payload.reason), cancelledAt: ctx.now(), cancelledBy: ctx.userName || '', paid: 0, due: 0, updatedAt: ctx.now() };
      repo.update('invoices', record);
      repo.updatePatientBalance(record.patientId);
      return { ok: true, record, audit: [{ action: 'Invoice cancelled', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${record.cancelReason}` }] };
    }
  },

  'payment.record': {
    permission: 'payments.create',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      if (!dateValid(payload.date)) return { ok: false, error: 'A valid payment date is required.' };
      const invoice = payload.invoiceId ? repo.get('invoices', payload.invoiceId) : null;
      if (payload.invoiceId && !invoice) return { ok: false, error: 'That invoice no longer exists.' };
      if (invoice && invoice.patientId !== patient.id) return { ok: false, error: 'That invoice belongs to a different patient.' };
      if (invoice?.status === 'Draft') return { ok: false, error: 'Issue this draft invoice before recording a payment against it.' };
      const amountText = str(payload.amount);
      if (!validateMoney(amountText, { allowZero: false })) return { ok: false, error: 'Enter a payment amount greater than zero with at most two decimals.' };
      let state = null;
      if (invoice) state = computeInvoiceState(repo, invoice);
      const validation = validatePayment({ amount: amountText, due: invoice ? centsToMoney(state.dueCents) : amountText, invoiceStatus: invoice?.status || 'Unpaid' });
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const settings = repo.getSettings();
      const method = str(payload.method) || 'Cash';
      if (!(settings.paymentMethods || []).includes(method) && !['Cash', 'Bank', 'Card'].includes(method)) {
        return { ok: false, error: `"${method}" is not a configured payment method.` };
      }
      const amountCents = moneyToCents(amountText);
      const record = {
        id: makeId('payment'),
        receiptNumber: nextCode(repo, 'receipt'),
        invoiceId: invoice?.id || '',
        patientId: patient.id,
        amount: centsToMoney(amountCents),
        refundedAmount: 0,
        status: 'Recorded',
        date: payload.date,
        method,
        reference: str(payload.reference),
        transactionId: str(payload.transactionId) || str(payload.reference),
        provider: str(payload.provider),
        notes: str(payload.notes),
        receivedBy: ctx.userName || '',
        receivedById: ctx.userId || '',
        invoiceDueBeforeCents: invoice ? state.dueCents : null,
        invoiceDueAfterCents: invoice ? Math.max(0, state.dueCents - amountCents) : null,
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('payments', record);
      if (invoice) refreshInvoicePaymentState(repo, repo.get('invoices', invoice.id), ctx.now());
      repo.updatePatientBalance(patient.id);
      return { ok: true, record, audit: [{ action: 'Payment recorded', entity: 'Payment', entityId: record.id, summary: `${record.receiptNumber} · ${patient.patientCode || ''} · ${record.method} · ${record.amount}${invoice ? ` · ${invoice.invoiceNumber}` : ''}` }] };
    }
  },

  'payment.refund': {
    permission: 'payments.refund',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'payments', payload.id ?? payload.paymentId, 'payment');
      if (found.error) return { ok: false, error: found.error };
      const payment = found.record;
      if (['Voided', 'Cancelled'].includes(payment.status)) return { ok: false, error: 'This payment is void and cannot be refunded.' };
      if (!validateMoney(payload.amount, { allowZero: false })) return { ok: false, error: 'Refund must be a positive amount with at most two decimals.' };
      const amountCents = moneyToCents(payload.amount);
      const remainingCents = Math.max(0, moneyToCents(payment.amount) - moneyToCents(payment.refundedAmount));
      if (amountCents > remainingCents) return { ok: false, error: `Refund cannot exceed the refundable balance of this payment (${centsToMoney(remainingCents).toFixed(2)}).` };
      if (!str(payload.reason)) return { ok: false, error: 'A refund reason is required.' };
      if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { ok: false, error: 'Enter a valid refund date.' };
      const adjustment = {
        id: makeId('adjustment'),
        type: 'Refund',
        paymentId: payment.id,
        invoiceId: payment.invoiceId || '',
        patientId: payment.patientId || (payment.invoiceId ? repo.get('invoices', payment.invoiceId)?.patientId : '') || '',
        amount: centsToMoney(amountCents),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: str(payload.reason),
        method: str(payload.method) || payment.method || '',
        recordedBy: ctx.userName || '',
        createdAt: ctx.now()
      };
      repo.insert('paymentAdjustments', adjustment);
      const refundedCents = moneyToCents(payment.refundedAmount) + amountCents;
      const updatedPayment = {
        ...payment,
        refundedAmount: centsToMoney(refundedCents),
        status: refundedCents >= moneyToCents(payment.amount) ? 'Refunded' : 'Partially Refunded',
        updatedAt: ctx.now()
      };
      repo.update('payments', updatedPayment);
      if (updatedPayment.invoiceId) {
        const invoice = repo.get('invoices', updatedPayment.invoiceId);
        if (invoice) refreshInvoicePaymentState(repo, invoice, ctx.now());
      }
      if (adjustment.patientId) repo.updatePatientBalance(adjustment.patientId);
      return { ok: true, record: adjustment, payment: updatedPayment, audit: [{ action: 'Payment refunded', entity: 'Payment adjustment', entityId: adjustment.id, summary: `${updatedPayment.receiptNumber} · ${adjustment.amount} · ${adjustment.reason}` }] };
    }
  },

  'payment.adjust': {
    permission: 'payments.adjust',
    run(repo, payload, ctx) {
      const invoice = repo.get('invoices', payload.invoiceId);
      if (!invoice) return { ok: false, error: 'Choose the invoice this adjustment applies to.' };
      if (invoice.status === 'Cancelled') return { ok: false, error: 'Cancelled invoices cannot be adjusted.' };
      if (invoice.status === 'Draft') return { ok: false, error: 'Issue this draft invoice before adjusting it.' };
      if (!validateMoney(payload.amount, { allowZero: false })) return { ok: false, error: 'Adjustment must be a positive amount with at most two decimals.' };
      if (!str(payload.reason)) return { ok: false, error: 'An adjustment reason is required.' };
      if (payload.date !== undefined && payload.date !== '' && !dateValid(payload.date)) return { ok: false, error: 'Enter a valid adjustment date.' };
      const state = computeInvoiceState(repo, invoice);
      const amountCents = moneyToCents(payload.amount);
      if (state.dueCents <= 0) return { ok: false, error: 'This invoice has no outstanding balance to adjust.' };
      if (amountCents > state.dueCents) return { ok: false, error: `The adjustment cannot exceed the outstanding balance (${centsToMoney(state.dueCents).toFixed(2)}).` };
      const adjustment = {
        id: makeId('adjustment'),
        type: 'Adjustment',
        paymentId: '',
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        amount: centsToMoney(amountCents),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: str(payload.reason),
        recordedBy: ctx.userName || '',
        createdAt: ctx.now()
      };
      repo.insert('paymentAdjustments', adjustment);
      refreshInvoicePaymentState(repo, repo.get('invoices', invoice.id), ctx.now());
      return { ok: true, record: adjustment, audit: [{ action: 'Invoice adjusted', entity: 'Payment adjustment', entityId: adjustment.id, summary: `${invoice.invoiceNumber} · ${adjustment.amount} · ${adjustment.reason}` }] };
    }
  },

  'expense.create': {
    permission: 'accounting.create',
    run(repo, payload, ctx) {
      if (!str(payload.description)) return { ok: false, error: 'A description is required.' };
      if (!validateMoney(payload.amount, { allowZero: false })) return { ok: false, error: 'Amount must be positive with at most two decimals.' };
      if (!dateValid(payload.date)) return { ok: false, error: 'A valid date is required.' };
      const record = buildExpense(repo, payload, ctx);
      repo.insert('expenses', record);
      return { ok: true, record, audit: [{ action: 'Expense recorded', entity: 'Expense', entityId: record.id, summary: `${record.description} · ${record.category} · ${record.amount}` }] };
    }
  },

  'expense.update': {
    permission: 'accounting.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'expenses', payload.id, 'expense');
      if (found.error) return { ok: false, error: found.error };
      const merged = { ...found.record, ...payload };
      if (!str(merged.description)) return { ok: false, error: 'A description is required.' };
      if (!validateMoney(merged.amount, { allowZero: false })) return { ok: false, error: 'Amount must be positive with at most two decimals.' };
      if (!dateValid(merged.date)) return { ok: false, error: 'A valid date is required.' };
      const record = buildExpense(repo, merged, ctx, found.record);
      repo.update('expenses', record);
      return { ok: true, record, audit: [{ action: 'Expense edited', entity: 'Expense', entityId: record.id, summary: `${record.description} · ${record.amount}` }] };
    }
  },

  // ----------------------------------------------------------------- inventory
  'inventory.createItem': {
    permission: 'inventory.purchase',
    run(repo, payload, ctx) {
      if (!str(payload.name)) return { ok: false, error: 'Item name is required.' };
      if (payload.supplierId && !repo.get('suppliers', payload.supplierId)) return { ok: false, error: 'Choose an existing supplier.' };
      const openingStock = Math.max(0, toNumber(payload.currentStock ?? payload.openingStock ?? 0));
      const record = {
        id: makeId('stock'),
        itemCode: str(payload.itemCode) || nextCode(repo, 'item'),
        name: str(payload.name),
        category: str(payload.category) || 'Other',
        brand: str(payload.brand),
        unit: str(payload.unit) || 'pcs',
        supplierId: str(payload.supplierId),
        purchasePrice: Math.max(0, toNumber(payload.purchasePrice)),
        salePrice: Math.max(0, toNumber(payload.salePrice)),
        currentStock: openingStock,
        minimumStock: Math.max(0, toNumber(payload.minimumStock)),
        reorderThreshold: Math.max(0, toNumber(payload.reorderThreshold ?? payload.minimumStock)),
        expiryDate: dateValid(payload.expiryDate) ? payload.expiryDate : '',
        batch: str(payload.batch),
        lot: str(payload.lot),
        location: str(payload.location),
        notes: str(payload.notes),
        active: payload.active !== false && payload.active !== 'false',
        archived: false,
        purchaseDate: dateValid(payload.purchaseDate) ? payload.purchaseDate : ctx.today(),
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('inventory', record);
      const audit = [{ action: 'Inventory item created', entity: 'Inventory', entityId: record.id, summary: `${record.name} · ${record.currentStock} ${record.unit}` }];
      if (openingStock > 0) {
        const movement = {
          id: makeId('movement'), itemId: record.id, supplierId: record.supplierId,
          type: 'Purchase', quantity: openingStock, before: 0, after: openingStock,
          unitPrice: record.purchasePrice, date: record.purchaseDate, reason: 'Initial stock entry',
          notes: '', userId: ctx.userId, createdAt: ctx.now()
        };
        repo.insert('stockMovements', movement);
        audit.push({ action: 'Stock movement recorded', entity: 'Inventory movement', entityId: movement.id, summary: `${record.name} · Purchase · +${openingStock}` });
      }
      return { ok: true, record, audit };
    }
  },

  'inventory.updateItem': {
    permission: 'inventory.adjust',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'inventory', payload.id, 'inventory item');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      // Stock levels change ONLY through movements — direct edits fix metadata only.
      const record = {
        ...existing,
        ...payload,
        id: existing.id,
        itemCode: existing.itemCode || str(payload.itemCode),
        currentStock: existing.currentStock,
        name: str(payload.name ?? existing.name),
        minimumStock: Math.max(0, toNumber(payload.minimumStock ?? existing.minimumStock)),
        reorderThreshold: Math.max(0, toNumber(payload.reorderThreshold ?? existing.reorderThreshold ?? existing.minimumStock)),
        expiryDate: payload.expiryDate === undefined ? (existing.expiryDate || '') : (dateValid(payload.expiryDate) ? payload.expiryDate : ''),
        archived: payload.archived === undefined ? Boolean(existing.archived) : payload.archived === true,
        active: payload.active === undefined ? existing.active !== false : payload.active !== false && payload.active !== 'false',
        createdAt: existing.createdAt,
        updatedAt: ctx.now()
      };
      if (!record.name) return { ok: false, error: 'Item name is required.' };
      repo.update('inventory', record);
      return { ok: true, record, audit: [{ action: 'Inventory item edited', entity: 'Inventory', entityId: record.id, summary: `${record.name} · ${record.currentStock} ${record.unit}` }] };
    }
  },

  'inventory.movement': {
    permission: (payload) => ({
      Purchase: 'inventory.purchase', Usage: 'inventory.consume', Return: 'inventory.purchase',
      Damage: 'inventory.correct', Expiry: 'inventory.correct', Correction: 'inventory.correct', Adjustment: 'inventory.adjust'
    }[normalizeMovementType(payload.movementType ?? payload.type)] || 'inventory.adjust'),
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'inventory', payload.itemId, 'inventory item');
      if (found.error) return { ok: false, error: found.error };
      const item = found.record;
      const rawType = payload.movementType ?? payload.type;
      const type = normalizeMovementType(rawType);
      const quantity = toNumber(payload.quantity);
      if (!Number.isFinite(quantity)) return { ok: false, error: 'Quantity must be a number.' };
      const direction = (() => {
        if (['Purchase', 'Return'].includes(type)) return 1;
        if (['Usage', 'Damage', 'Expiry'].includes(type)) return -1;
        // Corrections follow the explicit direction, defaulting to decrease — the
        // same rule v1.3.0 applied, so a plain correction always reconciles stock down.
        return str(payload.direction) === 'increase' ? 1 : -1;
      })();
      const magnitude = Math.abs(quantity);
      if (magnitude <= 0) return { ok: false, error: 'Quantity must be greater than zero.' };
      if (!str(payload.reason)) return { ok: false, error: 'A reason is required for stock movements.' };
      const before = toNumber(item.currentStock);
      const after = before + direction * magnitude;
      if (after < 0) return { ok: false, error: `This movement would make stock negative (available: ${before}).` };
      const movement = {
        id: makeId('movement'),
        itemId: item.id,
        supplierId: type === 'Purchase' ? (str(payload.supplierId) || item.supplierId) : str(payload.supplierId),
        type,
        quantity: direction * magnitude,
        before,
        after,
        unitPrice: Math.max(0, toNumber(payload.unitPrice ?? item.purchasePrice)),
        batch: str(payload.batch) || item.batch,
        lot: str(payload.lot) || item.lot,
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: str(payload.reason),
        notes: str(payload.notes),
        userId: ctx.userId,
        createdAt: ctx.now()
      };
      const updatedItem = {
        ...item,
        currentStock: after,
        batch: movement.batch || item.batch,
        lot: movement.lot || item.lot,
        supplierId: type === 'Purchase' && movement.supplierId ? movement.supplierId : item.supplierId,
        purchasePrice: type === 'Purchase' && toNumber(payload.unitPrice) > 0 ? toNumber(payload.unitPrice) : item.purchasePrice,
        updatedAt: ctx.now()
      };
      repo.update('inventory', updatedItem);
      repo.insert('stockMovements', movement);
      return { ok: true, record: movement, item: updatedItem, audit: [{ action: 'Stock movement recorded', entity: 'Inventory movement', entityId: movement.id, summary: `${updatedItem.name} · ${type} · ${direction > 0 ? '+' : '−'}${magnitude} → ${after}` }] };
    }
  },

  'supplier.create': {
    permission: 'inventory.purchase',
    run(repo, payload, ctx) {
      if (!str(payload.name)) return { ok: false, error: 'Supplier name is required.' };
      const record = {
        id: makeId('supplier'),
        code: str(payload.code),
        name: str(payload.name),
        contactPerson: str(payload.contactPerson),
        phone: str(payload.phone),
        email: str(payload.email),
        address: str(payload.address),
        notes: str(payload.notes),
        active: payload.active !== false && payload.active !== 'false',
        archived: false,
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('suppliers', record);
      return { ok: true, record, audit: [{ action: 'Supplier created', entity: 'Supplier', entityId: record.id, summary: record.name }] };
    }
  },

  'supplier.update': {
    permission: 'inventory.adjust',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'suppliers', payload.id, 'supplier');
      if (found.error) return { ok: false, error: found.error };
      if (!str(payload.name ?? found.record.name)) return { ok: false, error: 'Supplier name is required.' };
      const record = { ...found.record, ...payload, id: found.record.id, createdAt: found.record.createdAt, updatedAt: ctx.now() };
      repo.update('suppliers', record);
      return { ok: true, record, audit: [{ action: 'Supplier edited', entity: 'Supplier', entityId: record.id, summary: record.name }] };
    }
  },

  // --------------------------------------------------------------------- staff
  'staff.create': {
    permission: 'staff.create',
    run(repo, payload, ctx) {
      if (!str(payload.name)) return { ok: false, error: 'Staff name is required.' };
      const record = {
        id: makeId('staff'),
        staffCode: nextCode(repo, 'staff'),
        name: str(payload.name),
        role: str(payload.role) || 'Other',
        phone: str(payload.phone),
        email: str(payload.email),
        address: str(payload.address),
        specialization: str(payload.specialization),
        joinDate: dateValid(payload.joinDate) ? payload.joinDate : ctx.today(),
        active: payload.active !== false && payload.active !== 'false',
        archived: false,
        notes: str(payload.notes),
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('staff', record);
      return { ok: true, record, audit: [{ action: 'Staff created', entity: 'Staff', entityId: record.id, summary: `${record.name} · ${record.role}` }] };
    }
  },

  'staff.update': {
    permission: 'staff.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'staff', payload.id, 'staff member');
      if (found.error) return { ok: false, error: found.error };
      const record = {
        ...found.record, ...payload,
        id: found.record.id, staffCode: found.record.staffCode,
        createdAt: found.record.createdAt, updatedAt: ctx.now(),
        active: payload.active === undefined ? found.record.active !== false : payload.active !== false && payload.active !== 'false'
      };
      if (!str(record.name)) return { ok: false, error: 'Staff name is required.' };
      repo.update('staff', record);
      return { ok: true, record, audit: [{ action: 'Staff edited', entity: 'Staff', entityId: record.id, summary: `${record.name} · ${record.role}` }] };
    }
  },

  // ------------------------------------------------------ referrals & follow-ups
  'referral.create': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      if (!str(payload.referralTo)) return { ok: false, error: 'The referral destination is required.' };
      if (!str(payload.reason)) return { ok: false, error: 'A referral reason is required.' };
      const record = {
        id: makeId('referral'),
        patientId: patient.id,
        visitId: str(payload.visitId),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        referralTo: str(payload.referralTo),
        specialty: str(payload.specialty),
        reason: str(payload.reason),
        notes: str(payload.notes),
        response: '',
        responseDate: '',
        status: 'Sent',
        attachmentIds: [],
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('referrals', record);
      return { ok: true, record, audit: [{ action: 'Referral created', entity: 'Referral', entityId: record.id, summary: `${patient.fullName} → ${record.referralTo}` }] };
    }
  },

  'referral.update': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'referrals', payload.id, 'referral');
      if (found.error) return { ok: false, error: found.error };
      const record = { ...found.record, ...payload, id: found.record.id, patientId: found.record.patientId, status: REFERRAL_STATUSES.includes(payload.status) ? payload.status : found.record.status, createdAt: found.record.createdAt, updatedAt: ctx.now() };
      repo.update('referrals', record);
      return { ok: true, record, audit: [{ action: 'Referral edited', entity: 'Referral', entityId: record.id, summary: `${record.referralTo} · ${record.status}` }] };
    }
  },

  'referral.respond': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'referrals', payload.id, 'referral');
      if (found.error) return { ok: false, error: found.error };
      if (!str(payload.response)) return { ok: false, error: 'The response or report text is required.' };
      const record = {
        ...found.record,
        response: str(payload.response),
        responseDate: dateValid(payload.responseDate) ? payload.responseDate : ctx.today(),
        status: str(payload.status) === 'Closed' ? 'Closed' : 'Report received',
        attachmentIds: Array.isArray(payload.attachmentIds) ? payload.attachmentIds.map(str).filter(Boolean) : found.record.attachmentIds || [],
        updatedAt: ctx.now()
      };
      repo.update('referrals', record);
      return { ok: true, record, audit: [{ action: 'Referral response recorded', entity: 'Referral', entityId: record.id, summary: `${record.referralTo} · ${record.status}` }] };
    }
  },

  'followup.create': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      if (!dateValid(payload.dueDate)) return { ok: false, error: 'A valid due date is required.' };
      const record = {
        id: makeId('followup'),
        patientId: patient.id,
        visitId: str(payload.visitId),
        appointmentId: str(payload.appointmentId),
        title: str(payload.title) || `Follow-up: ${patient.fullName}`,
        reason: str(payload.reason),
        dueDate: payload.dueDate,
        status: 'Open',
        notes: str(payload.notes),
        completedAt: '',
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('followUpTasks', record);
      return { ok: true, record, audit: [{ action: 'Follow-up scheduled', entity: 'Follow-up', entityId: record.id, summary: `${record.title} · due ${record.dueDate}` }] };
    }
  },

  'followup.update': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'followUpTasks', payload.id, 'follow-up');
      if (found.error) return { ok: false, error: found.error };
      const record = {
        ...found.record, ...payload,
        id: found.record.id,
        patientId: found.record.patientId,
        dueDate: dateValid(payload.dueDate) ? payload.dueDate : found.record.dueDate,
        status: FOLLOWUP_STATUSES.includes(payload.status) ? payload.status : found.record.status,
        createdAt: found.record.createdAt,
        updatedAt: ctx.now()
      };
      if (record.status === 'Completed' && !record.completedAt) record.completedAt = ctx.now();
      repo.update('followUpTasks', record);
      return { ok: true, record, audit: [{ action: 'Follow-up updated', entity: 'Follow-up', entityId: record.id, summary: `${record.title} · ${record.status}` }] };
    }
  },

  'followup.complete': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'followUpTasks', payload.id, 'follow-up');
      if (found.error) return { ok: false, error: found.error };
      const record = { ...found.record, status: 'Completed', completedAt: ctx.now(), notes: payload.notes !== undefined ? str(payload.notes) : found.record.notes, updatedAt: ctx.now() };
      repo.update('followUpTasks', record);
      return { ok: true, record, audit: [{ action: 'Follow-up completed', entity: 'Follow-up', entityId: record.id, summary: record.title }] };
    }
  },

  // --------------------------------------------------------------- attachments
  'attachment.add': {
    permission: 'clinical.attachments',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'This attachment is missing its patient record.' };
      const settings = repo.getSettings();
      const validation = validateAttachmentFile({ type: payload.type, size: payload.size, name: payload.name, data: payload.data }, settings);
      if (!validation.allowed) {
        if (validation.extensionBlocked) return { ok: false, error: 'Executable and script files are blocked for clinical safety.' };
        return { ok: false, error: 'This attachment type, name or size is not allowed.' };
      }
      const bytes = dataUrlToBytes(payload.data);
      if (!bytes) return { ok: false, error: 'Attachment content is missing or malformed.' };
      const freeBytes = repo.freeDiskBytes();
      if (freeBytes !== null && bytes.byteLength * 2 > freeBytes) {
        return { ok: false, error: 'Not enough free disk space to store this attachment safely.' };
      }
      const id = makeId('attachment');
      const written = repo.writeAttachmentFile(id, bytes);
      const record = {
        id,
        patientId: patient.id,
        visitId: str(payload.visitId),
        name: sanitizeFilename(validation.safeName || payload.name),
        type: payload.type,
        size: bytes.byteLength,
        category: str(payload.category) || (payload.type === 'application/pdf' ? 'PDF report' : String(payload.type).startsWith('image/') ? 'Image / X-ray' : 'Clinical document'),
        notes: str(payload.notes),
        filePath: written.relativePath,
        checksum: written.checksum,
        data: '',
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('attachments', record);
      return { ok: true, record, audit: [{ action: 'Attachment added', entity: 'Attachment', entityId: record.id, summary: `${record.name} · ${record.category}` }] };
    }
  },

  'attachment.updateMeta': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'attachments', payload.id, 'attachment');
      if (found.error) return { ok: false, error: found.error };
      const record = {
        ...found.record,
        name: sanitizeFilename(payload.name !== undefined ? payload.name : found.record.name),
        category: payload.category !== undefined ? str(payload.category) : found.record.category,
        notes: payload.notes !== undefined ? str(payload.notes) : found.record.notes,
        data: '',
        updatedAt: ctx.now()
      };
      repo.update('attachments', record);
      return { ok: true, record, audit: [{ action: 'Attachment details edited', entity: 'Attachment', entityId: record.id, summary: record.name }] };
    }
  },

  'attachment.delete': {
    permission: 'attachments.delete',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'attachments', payload.id, 'attachment');
      if (found.error) return { ok: false, error: found.error };
      if (!payload.confirm) return { ok: false, code: 'confirm', error: `Remove ${found.record.name} from this patient record? This cannot be undone unless it exists in a backup.` };
      repo.remove('attachments', found.record.id);
      if (found.record.filePath) repo.removeAttachmentFile(found.record.filePath);
      return { ok: true, audit: [{ action: 'Attachment deleted', entity: 'Attachment', entityId: found.record.id, summary: found.record.name }] };
    }
  },

  // --------------------------------------------------------------------- users
  'user.create': {
    permission: 'users.manage',
    run(repo, payload, ctx) {
      return userUpsert(repo, payload, ctx, false);
    }
  },

  'user.update': {
    permission: 'users.manage',
    run(repo, payload, ctx) {
      return userUpsert(repo, payload, ctx, true);
    }
  },

  'user.toggleActive': {
    permission: 'users.manage',
    run(repo, payload, ctx) {
      const user = repo.userGet ? repo.userGet(payload.id) : repo.get('users', payload.id);
      if (!user) return { ok: false, error: 'That user account no longer exists.' };
      if (user.id === ctx.userId) return { ok: false, error: 'You cannot deactivate the signed-in account.' };
      const nextActive = user.active === false;
      if (!nextActive && user.role === 'Administrator') {
        const otherAdmins = repo.usersList().filter((candidate) => candidate.id !== user.id && candidate.active !== false && candidate.role === 'Administrator' && candidate.hasPin).length;
        if (otherAdmins < 1) return { ok: false, error: 'Keep at least one active Administrator account with a PIN.' };
      }
      const { pinHash, pinSalt, kdf, hasPin, ...safeUser } = user;
      const record = { ...safeUser, active: nextActive, updatedAt: ctx.now() };
      repo.update('users', record);
      return { ok: true, record: sanitizeUser(record), audit: [{ action: nextActive ? 'User account activated' : 'User account deactivated', entity: 'User', entityId: user.id, summary: `${user.name} · ${user.role}` }] };
    }
  },

  'user.changeOwnPin': {
    permission: null, // any authenticated session
    run(repo, payload, ctx) {
      if (!ctx.userId) return { ok: false, error: 'Sign in to change your PIN.' };
      if (!/^\d{4,12}$/.test(str(payload.newPin))) return { ok: false, error: 'PINs must be 4–12 digits.' };
      if (str(payload.newPin) !== str(payload.confirmPin)) return { ok: false, error: 'PIN confirmation does not match.' };
      // The runtime wrapper performs the actual KDF (Node or WebCrypto) and stores
      // the secret; ops never handle hashing primitives directly.
      return { ok: true, pinToSet: { userId: ctx.userId, pin: str(payload.newPin) }, audit: [{ action: 'PIN changed', entity: 'User', entityId: ctx.userId, summary: 'Account PIN updated' }] };
    }
  },

  // ------------------------------------------------------------- workspace UI
  'dashboard.setLayout': {
    permission: null,
    run(repo, payload) {
      const allowed = ['schedule', 'queue', 'followups', 'signals', 'activity', 'inventory', 'financial'];
      const layout = [...new Set((Array.isArray(payload.layout) ? payload.layout : []).filter((key) => allowed.includes(key)))];
      if (!layout.length) return { ok: false, error: 'Keep at least one dashboard card enabled.' };
      repo.setMeta('dashboard', layout);
      return { ok: true, dashboard: layout, audit: [{ action: 'Dashboard layout changed', entity: 'Dashboard', entityId: '', summary: layout.join(', ') }] };
    }
  },

  'dashboard.toggleWidget': {
    permission: null,
    run(repo, payload) {
      const current = repo.getMeta('dashboard', ['schedule', 'queue', 'followups', 'signals']) || [];
      const key = str(payload.widget);
      if (!key) return { ok: false, error: 'Unknown dashboard card.' };
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      if (!next.length) return { ok: false, error: 'Keep at least one dashboard card enabled.' };
      repo.setMeta('dashboard', next);
      return { ok: true, dashboard: next, audit: [{ action: 'Dashboard layout changed', entity: 'Dashboard', entityId: '', summary: `${key} ${next.includes(key) ? 'enabled' : 'hidden'}` }] };
    }
  },

  'navigation.setFavorites': {
    permission: null,
    run(repo, payload) {
      const navigation = repo.getMeta('navigation', { favorites: [], recent: [] }) || { favorites: [], recent: [] };
      navigation.favorites = (Array.isArray(payload.favorites) ? payload.favorites : []).map(str).filter(Boolean).slice(0, 12);
      repo.setMeta('navigation', navigation);
      return { ok: true, navigation, audit: [] };
    }
  },

  'navigation.pushRecent': {
    permission: null,
    run(repo, payload) {
      const navigation = repo.getMeta('navigation', { favorites: [], recent: [] }) || { favorites: [], recent: [] };
      const page = str(payload.page);
      if (!page) return { ok: true, navigation, audit: [] };
      navigation.recent = [page, ...(navigation.recent || []).filter((item) => item !== page)].slice(0, 8);
      repo.setMeta('navigation', navigation);
      return { ok: true, navigation, audit: [] };
    }
  },

  'savedFilter.save': {
    permission: null,
    run(repo, payload, ctx) {
      if (!str(payload.name)) return { ok: false, error: 'Enter a name for this saved view.' };
      const record = {
        id: makeId('filter'),
        entity: str(payload.entity) || 'patients',
        name: str(payload.name),
        query: str(payload.query),
        filters: payload.filters && typeof payload.filters === 'object' ? payload.filters : {},
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      const existing = repo.all('savedFilters').find((item) => item.name.toLowerCase() === record.name.toLowerCase());
      if (existing) repo.remove('savedFilters', existing.id);
      repo.insert('savedFilters', record);
      return { ok: true, record, audit: [{ action: 'Saved view created', entity: 'Saved search', entityId: record.id, summary: record.name }] };
    }
  },

  'savedFilter.delete': {
    permission: null,
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'savedFilters', payload.id, 'saved view');
      if (found.error) return { ok: false, error: found.error };
      repo.remove('savedFilters', found.record.id);
      return { ok: true, audit: [{ action: 'Saved view deleted', entity: 'Saved search', entityId: found.record.id, summary: found.record.name }] };
    }
  },

  'notifications.scan': {
    permission: null, // any signed-in staff member may converge the shared signal feed
    run(repo, payload, ctx) {
      const settings = repo.getSettings();
      if (settings.notifications === false) {
        // Notifications disabled — drop every auto-derived row, keep manual ones.
        for (let page = 1;; page += 1) {
          const batch = repo.listCollection('notifications', { page, pageSize: 200 });
          for (const row of batch.rows || []) if (String(row.id).startsWith('auto_')) repo.remove('notifications', row.id);
          if (!batch.rows || batch.rows.length < 200) break;
        }
        return { ok: true, disabled: true, items: [], unread: 0, audit: [] };
      }
      const { rows: drafts, errors } = deriveNotifications(repo, settings, { now: new Date(ctx.now()) });
      const existing = [];
      for (let page = 1;; page += 1) {
        const batch = repo.listCollection('notifications', { page, pageSize: 200, sort: 'recent' });
        existing.push(...(batch.rows || []));
        if (!batch.rows || batch.rows.length < 200) break;
      }
      const plan = reconcileNotifications(drafts, existing, { now: new Date(ctx.now()) });
      for (const row of plan.remove) repo.remove('notifications', row);
      for (const row of plan.update) repo.update('notifications', row);
      for (const row of plan.insert) repo.insert('notifications', row);
      const items = repo.notificationsActive(200);
      return { ok: true, items, unread: items.filter((item) => !item.read && !item.dismissed).length, scanned: drafts.length, changes: plan.insert.length + plan.update.length + plan.remove.length, errors, audit: [] };
    }
  },

  'notification.markRead': {
    permission: null,
    run(repo, payload) {
      const found = requireRecord(repo, 'notifications', payload.id, 'notification');
      if (found.error) return { ok: false, error: found.error };
      repo.update('notifications', { ...found.record, read: true });
      return { ok: true, audit: [] };
    }
  },

  'notification.markAllRead': {
    permission: null,
    run(repo) {
      const read = repo.getMeta('notificationRead', {}) || {};
      for (let page = 1;; page += 1) {
        const batch = repo.listCollection('notifications', { page, pageSize: 200 });
        for (const note of batch.rows || []) {
          if (!note.read) repo.update('notifications', { ...note, read: true });
          read[note.id] = true;
        }
        if (!batch.rows || batch.rows.length < 200) break;
      }
      repo.setMeta('notificationRead', read);
      return { ok: true, notificationRead: read, audit: [{ action: 'Notifications marked read', entity: 'Notifications', entityId: '', summary: 'Notification centre cleared' }] };
    }
  },

  'notification.dismiss': {
    permission: 'notifications.manage',
    run(repo, payload) {
      const found = requireRecord(repo, 'notifications', payload.id, 'notification');
      if (found.error) return { ok: false, error: found.error };
      repo.update('notifications', { ...found.record, dismissed: true });
      return { ok: true, audit: [{ action: 'Notification dismissed', entity: 'Notification', entityId: found.record.id, summary: found.record.title }] };
    }
  },

  'medicationCatalog.save': {
    permission: 'clinical.create',
    run(repo, payload, ctx) {
      const name = str(payload.name);
      if (!name) return { ok: false, error: 'Enter the medicine name.' };
      const existing = repo.all('medicationCatalog').find((item) => item.name.toLowerCase() === name.toLowerCase());
      const record = {
        id: existing?.id || makeId('medication'),
        name,
        strength: str(payload.strength),
        dosage: str(payload.dosage),
        frequency: str(payload.frequency),
        duration: str(payload.duration),
        route: str(payload.route) || 'Oral',
        active: existing?.active !== false,
        favorite: existing?.favorite === true,
        createdAt: existing?.createdAt || ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('medicationCatalog', record);
      return { ok: true, record, audit: [{ action: existing ? 'Medication updated' : 'Medication saved', entity: 'Medication catalog', entityId: record.id, summary: record.name }] }
    }
  },

  'dental.removeCurrent': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose a patient first.' };
      const tooth = Number(payload.tooth);
      const dentition = dentitionOf(tooth);
      if (!dentition) return { ok: false, error: 'Choose a valid FDI tooth.' };
      const removed = repo.supersedeDental(patient.id, tooth, dentition);
      if (!removed) return { ok: false, error: 'There is no current record for this tooth.' };
      return { ok: true, audit: [{ action: 'Dental chart record cleared', entity: 'Dental record', entityId: patient.id, summary: `Tooth ${tooth} (${dentition}) · history preserved` }] }
    }
  },

  /* Nuclear option — reachable from Settings → Danger zone and the
   * unsupported-schema lock screen. Children are wiped before parents so
   * relational constraints hold; local accounts and settings survive, and the
   * audit row recording this reset is written by the caller AFTER the wipe so
   * it remains. confirmToken guards against automation. */
  'workspace.reset': {
    permission: 'settings.edit',
    run(repo, payload, ctx) {
      if (payload.confirmToken !== 'RESET') return { ok: false, error: 'Type RESET to confirm that this entire workspace will be erased.', code: 'reset-token' };
      const baseCounters = { patient: 1, appointment: 1, invoice: 1, visit: 1, prescription: 1, receipt: 1, serial: 1, staff: 1 };
      const wipe = () => {
        for (const collection of RESET_ORDER) {
          if (collection === 'users') continue; // local accounts survive a data reset
          if (typeof repo.clearCollection === 'function') repo.clearCollection(collection);
        }
      };
      if (typeof repo.transaction === 'function') repo.transaction(wipe);
      else wipe();
      repo.setMeta('counters', baseCounters);
      repo.setMeta('setupComplete', true);
      return { ok: true, audit: [{ action: 'Workspace reset', entity: 'Workspace', entityId: '', summary: 'All practice records erased; settings and accounts preserved' }] }
    }
  }
};

/* Children before parents — the reverse of the relational write order, so a
 * full wipe can never violate a foreign key in either runtime. */
const RESET_ORDER = [
  'audit', 'notifications', 'followUpTasks', 'attachments', 'referrals',
  'stockMovements', 'inventory', 'expenses', 'paymentAdjustments', 'payments',
  'invoices', 'treatmentPlans', 'dentalRecords', 'prescriptions', 'visits',
  'appointments', 'treatments', 'savedReports', 'savedFilters', 'medicationCatalog',
  'notificationRules', 'rooms', 'suppliers', 'staff', 'patients'
];

export function sanitizeUser(record) {
  if (!record) return null;
  const { pinHash, pinSalt, kdf, ...safe } = record;
  return { ...safe, hasPin: Boolean(pinHash || record.hasPin) };
}

export const SUPPORTED_CURRENCIES = ['BDT', 'USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'SAR', 'MYR', 'NPR', 'LKR', 'PKR'];

function userUpsert(repo, payload, ctx, editing) {
  const name = str(payload.name);
  if (!name) return { ok: false, error: 'Enter the account holder name.' };
  let existing = null;
  if (editing) {
    existing = repo.userGet ? repo.userGet(payload.id) : repo.get('users', payload.id);
    if (!existing) return { ok: false, error: 'That user account no longer exists.' };
  }
  const role = str(payload.role) || existing?.role || 'Receptionist';
  if (!ROLE_NAMES.includes(role)) return { ok: false, error: `"${role}" is not a recognised role.` };
  const permissions = Array.isArray(payload.permissions)
    ? [...new Set(payload.permissions.map(str).filter((permission) => PERMISSION_SET.has(permission)))]
    : (existing?.permissions || []);
  if (role === 'Custom Role' && !permissions.length) return { ok: false, error: 'Choose at least one permission for a custom role.' };
  // Sanitized base only: authentication secrets are never part of a user record
  // passed through a generic write (the repository also refuses to touch them).
  const base = existing
    ? { id: existing.id, createdAt: existing.createdAt, lastLogin: existing.lastLogin || null }
    : { id: makeId('user'), createdAt: ctx.now(), lastLogin: null };
  const record = {
    ...base,
    name,
    role,
    staffId: str(payload.staffId ?? existing?.staffId),
    active: payload.active === undefined ? (existing ? existing.active !== false : true) : payload.active !== false && payload.active !== 'false',
    permissions: role === 'Custom Role' ? permissions : [],
    updatedAt: ctx.now()
  };
  if (record.active === false && record.id === ctx.userId) return { ok: false, error: 'You cannot deactivate the signed-in account.' };
  // The workspace must always keep at least one active Administrator who can sign in.
  const allUsers = repo.usersList();
  const otherAdmins = allUsers
    .filter((candidate) => candidate.id !== record.id)
    .filter((candidate) => candidate.active !== false && candidate.role === 'Administrator' && candidate.hasPin).length;
  const pinRequest = payload.pin !== undefined && payload.pin !== '' ? str(payload.pin) : null;
  const willHavePin = pinRequest !== null || Boolean(existing?.hasPin);
  const projectedAdmins = otherAdmins + (record.active !== false && record.role === 'Administrator' && willHavePin ? 1 : 0);
  if (projectedAdmins < 1) return { ok: false, error: 'Keep at least one active Administrator account with a PIN.' };
  if (pinRequest !== null) {
    if (!/^\d{4,12}$/.test(pinRequest)) return { ok: false, error: 'PINs must be 4–12 digits.' };
    if (pinRequest !== str(payload.confirmPin)) return { ok: false, error: 'PIN confirmation does not match.' };
  } else if (!editing) {
    return { ok: false, error: 'New accounts require a 4–12 digit PIN.' };
  }
  repo.insert('users', record);
  return {
    ok: true,
    record: sanitizeUser({ ...record, hasPin: willHavePin }),
    pinToSet: pinRequest !== null ? { userId: record.id, pin: pinRequest } : null,
    audit: [{ action: editing ? 'User account updated' : 'User account created', entity: 'User', entityId: record.id, summary: `${record.name} · ${record.role}${pinRequest !== null ? ' · PIN set' : ''}` }]
  };
}

/** Permission required for an op given its payload/context (string, list = any-of, or null). */
export function opPermission(name, payload = {}, ctx = null) {
  const op = OPS[name];
  if (!op) return undefined;
  if (typeof op.permission === 'function') return op.permission(payload || {}, ctx);
  if (Array.isArray(op.permission)) return op.permission;
  return op.permission;
}

/** An authorization context is authenticated only with a signed-in user or first-run setup authority. */
export function isAuthenticatedContext(ctx) {
  return Boolean(ctx && typeof ctx === 'object' && (ctx.userId || ctx.firstRun === true) && Array.isArray(ctx.permissions));
}

export function authorizeOp(name, payload, ctx) {
  const permission = opPermission(name, payload, ctx);
  if (permission === undefined) return { ok: false, error: `Unknown operation: ${name}`, code: 'unknown-op' };
  if (!isAuthenticatedContext(ctx)) return { ok: false, error: 'Sign in to continue.', code: 'auth-required' };
  if (permission === null) return { ok: true };
  const candidate = { active: true, role: ctx.role, permissions: ctx.permissions };
  const candidates = Array.isArray(permission) ? permission : [permission];
  if (candidates.some((entry) => hasPermission(candidate, entry))) return { ok: true };
  return { ok: false, error: 'Your account is not allowed to perform this action.', code: 'permission-denied', permission: candidates[0] };
}

export function runOp(repo, name, payload = {}, ctx = null) {
  const op = OPS[name];
  if (!op) return { ok: false, error: `Unknown operation: ${name}`, code: 'unknown-op' };
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const authorization = authorizeOp(name, safePayload, ctx);
  if (!authorization.ok) return authorization;
  const timeZone = repo.getSettings().timezone;
  return op.run(repo, safePayload, {
    now: () => new Date().toISOString(),
    today: () => localDateInTimeZone(timeZone),
    ...ctx
  });
}

/** Ops that are background/system housekeeping: they never count as user activity. */
export const BACKGROUND_OPS = new Set(['notifications.scan']);

export { normaliseTags };
