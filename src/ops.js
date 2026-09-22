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
  calculateInvoice, paymentStatusFor, validatePayment, validateMoney, appointmentsOverlap,
  moneyToCents, centsToMoney, toNumber, hasPermission, sanitizeFilename, validateAttachmentFile,
  MOVEMENT_TYPES, FOLLOWUP_STATUSES, REFERRAL_STATUSES, INVOICE_STATUSES, APPOINTMENT_STATUSES
} from './core.js';
import { normaliseTags, validatePatientInput, validateTreatmentPlanInput } from './domain.js';

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextCode(repo, kind, settingKey, fallbackPrefix, pad = 4) {
  const settings = repo.getSettings();
  const prefix = String(settings[settingKey] || fallbackPrefix || kind.slice(0, 3).toUpperCase());
  const n = repo.nextCounter(kind);
  return `${prefix}-${String(n).padStart(pad, '0')}`;
}

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

/** Net payment state of an invoice from its live payments (single financial projection). */
function computeInvoiceState(repo, invoice) {
  const payments = invoice?.id ? repo.paymentsByInvoice(invoice.id) : [];
  const status = paymentStatusFor(invoice?.total ?? 0, payments);
  const adjustments = invoice?.id
    ? (repo.adjustmentsByInvoice ? repo.adjustmentsByInvoice(invoice.id) : [])
    : [];
  const adjustedCents = adjustments
    .filter((adjustment) => adjustment.type === 'Adjustment')
    .reduce((sum, adjustment) => sum + Math.max(0, moneyToCents(adjustment.amount)), 0);
  const totalCents = Math.max(0, moneyToCents(invoice?.total ?? 0));
  const dueCents = Math.max(0, totalCents - moneyToCents(status.paid) - adjustedCents);
  return { paid: status.paid, paidCents: moneyToCents(status.paid), dueCents, adjustedCents };
}

function invoiceStatusFrom(state, previousStatus) {
  if (['Draft', 'Cancelled', 'Refunded'].includes(previousStatus)) return previousStatus;
  if (state.dueCents === 0 && state.paidCents > 0) return 'Paid';
  if (state.dueCents === 0 && state.paidCents === 0 && state.adjustedCents > 0) return 'Adjusted';
  if (state.paidCents > 0) return 'Partially Paid';
  if (state.adjustedCents > 0) return 'Adjusted';
  return 'Issued';
}

function refreshInvoicePaymentState(repo, invoice, nowIso) {
  const state = computeInvoiceState(repo, invoice);
  const updated = {
    ...invoice,
    paid: centsToMoney(state.paidCents),
    due: centsToMoney(state.dueCents),
    status: invoiceStatusFrom(state, invoice.status),
    updatedAt: nowIso || invoice.updatedAt
  };
  repo.update('invoices', updated);
  repo.updatePatientBalance(updated.patientId);
  return updated;
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
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => ({
      name: str(item.name),
      quantity: Math.max(0, toNumber(item.quantity) || 1),
      unitPrice: Math.max(0, toNumber(item.unitPrice)),
      treatmentId: str(item.treatmentId),
      tooth: str(item.tooth),
      note: str(item.note)
    }))
    .filter((item) => item.name && item.quantity > 0)
    .map((item) => {
      const line = calculateInvoice({ quantity: item.quantity, unitPrice: item.unitPrice, discount: 0, taxRate: 0 });
      return { ...item, unitPrice: line.subtotal / (item.quantity || 1), total: line.subtotal };
    });
  if (!items.length) {
    if (!str(payload.itemName) || !validateMoney(payload.unitPrice)) {
      return { error: 'Add at least one line item with a valid two-decimal price.' };
    }
    const quantity = Math.max(1, toNumber(payload.quantity) || 1);
    const line = calculateInvoice({ quantity, unitPrice: payload.unitPrice, discount: 0, taxRate: 0 });
    items.push({ name: str(payload.itemName), quantity, unitPrice: line.subtotal / quantity, total: line.subtotal, treatmentId: '', tooth: str(payload.tooth), note: '' });
  }
  if (!validateMoney(payload.discount ?? 0)) return { error: 'Discount must be a valid two-decimal amount.' };
  const subtotal = centsToMoney(items.reduce((sum, item) => sum + moneyToCents(item.total), 0));
  const taxRate = settings.taxEnabled && payload.taxRate === undefined ? toNumber(settings.taxRate) : toNumber(payload.taxRate);
  const totals = calculateInvoice({ quantity: 1, unitPrice: subtotal, discount: payload.discount, taxRate });
  return {
    record: {
      ...(existing || {}),
      id: existing?.id || makeId('invoice'),
      invoiceNumber: existing?.invoiceNumber || nextCode(repo, 'invoice', 'invoicePrefix', 'INV'),
      patientId: payload.patientId,
      visitId: str(payload.visitId),
      planId: str(payload.planId),
      dentistId: str(payload.dentistId),
      date: dateValid(payload.date) ? payload.date : (existing?.date || ctx.today()),
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxRate: totals.taxRate,
      tax: totals.tax,
      total: totals.total,
      notes: str(payload.notes),
      createdAt: existing?.createdAt || ctx.now(),
      updatedAt: ctx.now()
    }
  };
}

// ---------------------------------------------------------------------------
// Operation registry
// ---------------------------------------------------------------------------

export const OPS = {
  // ------------------------------------------------------------------ settings
  'settings.update': {
    permission: 'settings.edit',
    run(repo, payload, ctx) {
      const current = repo.getSettings();
      const allowed = [
        'clinicName', 'chamberName', 'dentistName', 'professionalTitle', 'phone', 'secondaryPhone',
        'email', 'address', 'city', 'district', 'country', 'logo', 'language', 'currency', 'timezone',
        'dateFormat', 'timeFormat', 'patientPrefix', 'invoicePrefix', 'appointmentPrefix', 'serialPrefix',
        'receiptPrefix', 'visitPrefix', 'staffPrefix', 'itemPrefix', 'defaultDuration', 'taxEnabled', 'taxRate',
        'autoLockMinutes', 'sessionTimeoutMinutes', 'notifications', 'paymentMethods', 'expenseCategories',
        'inventoryCategories', 'chairs', 'rooms', 'backupEnabled', 'backupIntervalHours', 'backupRetention',
        'backupDirectory', 'lowStockThreshold', 'attachmentMaxMb', 'accent', 'density', 'printPageSize',
        'paperProfile', 'customPatientFields', 'medicationTemplates', 'documentTemplate'
      ];
      const next = { ...current };
      const changed = [];
      for (const key of allowed) {
        if (payload[key] === undefined) continue;
        if (key === 'logo' && payload.logo && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(String(payload.logo))) continue;
        next[key] = payload[key];
        changed.push(key);
      }
      if (Array.isArray(next.paymentMethods)) next.paymentMethods = [...new Set(next.paymentMethods.map(str).filter(Boolean))].slice(0, 30);
      if (Array.isArray(next.expenseCategories)) next.expenseCategories = [...new Set(next.expenseCategories.map(str).filter(Boolean))].slice(0, 40);
      if (Array.isArray(next.inventoryCategories)) next.inventoryCategories = [...new Set(next.inventoryCategories.map(str).filter(Boolean))].slice(0, 40);
      if (Array.isArray(next.chairs)) next.chairs = [...new Set(next.chairs.map(str).filter(Boolean))].slice(0, 20);
      if (Array.isArray(next.rooms)) next.rooms = [...new Set(next.rooms.map(str).filter(Boolean))].slice(0, 20);
      if (next.taxRate !== undefined) next.taxRate = Math.min(100, Math.max(0, toNumber(next.taxRate)));
      if (next.defaultDuration !== undefined) next.defaultDuration = Math.min(480, Math.max(5, Math.round(toNumber(next.defaultDuration) || 30)));
      if (next.attachmentMaxMb !== undefined) next.attachmentMaxMb = Math.min(4096, Math.max(1, toNumber(next.attachmentMaxMb) || 256));
      if (next.sessionTimeoutMinutes !== undefined) next.sessionTimeoutMinutes = Math.min(480, Math.max(0, Math.round(toNumber(next.sessionTimeoutMinutes))));
      repo.setMeta('settings', next);
      return { ok: true, settings: next, audit: [{ action: 'Settings updated', entity: 'Settings', entityId: '', summary: changed.slice(0, 12).join(', ') || 'Settings reviewed' }] };
    }
  },

  'setup.complete': {
    permission: null, // wrapper additionally requires first-run OR settings.edit
    run(repo, payload) {
      const current = repo.getSettings();
      const identity = {};
      for (const key of ['clinicName', 'dentistName', 'professionalTitle', 'phone', 'email', 'address', 'city', 'chamberName', 'language', 'currency', 'timezone']) {
        if (payload[key] !== undefined) identity[key] = str(payload[key]);
      }
      repo.setMeta('settings', { ...current, ...identity });
      repo.setMeta('setupComplete', true);
      return { ok: true, audit: [{ action: 'Workspace setup completed', entity: 'Settings', entityId: '', summary: str(identity.clinicName) || 'Clinic identity saved' }] };
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
        patientCode: nextCode(repo, 'patient', 'patientPrefix', 'PT'),
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
      const merged = { ...existing, ...payload, id: existing.id, patientCode: existing.patientCode, registrationDate: existing.registrationDate, createdAt: existing.createdAt };
      const validation = validatePatientInput(merged);
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const settings = repo.getSettings();
      const record = {
        ...merged,
        fullName: str(merged.fullName),
        phone: str(merged.phone),
        email: str(merged.email),
        tags: normaliseTags(merged.tags),
        customFields: Object.fromEntries((settings.customPatientFields || []).map((definition) => [definition.key, str(merged.customFields?.[definition.key] ?? existing.customFields?.[definition.key] ?? '')])),
        status: str(merged.status) || 'Active',
        archived: merged.archived === true || merged.status === 'Archived',
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
      return { ok: true, record, audit: [{ action: archived ? 'Patient archived' : 'Patient reactivated', entity: 'Patient', entityId: record.id, summary: record.fullName }] };
    }
  },

  'patient.merge': {
    permission: 'patients.edit',
    run(repo, payload, ctx) {
      const primary = repo.get('patients', payload.primaryId);
      const duplicate = repo.get('patients', payload.duplicateId);
      if (!primary || !duplicate) return { ok: false, error: 'Both the primary and the duplicate patient must exist.' };
      if (primary.id === duplicate.id) return { ok: false, error: 'Choose two different patients.' };
      if (duplicate.archived === false && primary.archived) return { ok: false, error: 'The primary patient cannot be archived.' };
      if (!payload.confirm) {
        return { ok: false, code: 'merge-confirm', error: `Merging moves every record from ${duplicate.fullName} (${duplicate.patientCode}) into ${primary.fullName} (${primary.patientCode}) and archives the duplicate. Confirm to continue.` };
      }
      const moved = repo.reassignPatientRecords(duplicate.id, primary.id);
      const mergedRecord = {
        ...primary,
        tags: normaliseTags([...(primary.tags || []), ...(duplicate.tags || [])]),
        notes: [primary.notes, duplicate.notes && `Merged notes (from ${duplicate.patientCode}): ${duplicate.notes}`].filter(Boolean).join('\n'),
        email: primary.email || duplicate.email,
        dateOfBirth: primary.dateOfBirth || duplicate.dateOfBirth,
        gender: primary.gender || duplicate.gender,
        bloodGroup: primary.bloodGroup || duplicate.bloodGroup,
        address: primary.address || duplicate.address,
        allergies: [primary.allergies, duplicate.allergies].filter(Boolean).join('; '),
        medicalHistory: [primary.medicalHistory, duplicate.medicalHistory].filter(Boolean).join('; '),
        importantAlerts: [primary.importantAlerts, duplicate.importantAlerts].filter(Boolean).join('; '),
        emergencyName: primary.emergencyName || duplicate.emergencyName,
        emergencyPhone: primary.emergencyPhone || duplicate.emergencyPhone,
        archived: false,
        status: 'Active',
        updatedAt: ctx.now()
      };
      repo.update('patients', mergedRecord);
      repo.update('patients', { ...duplicate, archived: true, status: 'Archived', mergedInto: primary.id, updatedAt: ctx.now() });
      repo.updatePatientBalance(primary.id);
      return {
        ok: true,
        record: mergedRecord,
        moved,
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
        appointmentCode: nextCode(repo, 'appointment', 'appointmentPrefix', 'APT'),
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
      const settings = repo.getSettings();
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
        status: APPOINTMENT_STATUSES.includes(payload.status) ? payload.status : existing.status,
        updatedAt: ctx.now()
      };
      if (!repo.get('patients', record.patientId)) return { ok: false, error: 'Choose an existing patient.' };
      const conflict = repo.appointmentsOnDate(record.date)
        .find((appointment) => appointmentsOverlap(record, appointment, settings.defaultDuration));
      if (conflict && !payload.confirmConflict) {
        return { ok: false, code: 'conflict-confirm', conflict, error: `This overlaps another appointment (${conflict.time}). Confirm to reschedule anyway.` };
      }
      repo.update('appointments', record);
      const rescheduled = record.date !== existing.date || record.time !== existing.time;
      return { ok: true, record, audit: [{ action: rescheduled ? 'Appointment rescheduled' : 'Appointment edited', entity: 'Appointment', entityId: record.id, summary: `${record.date} ${record.time} · ${record.status}` }] };
    }
  },

  'appointment.setStatus': {
    permission: ['appointments.queue', 'appointments.edit'],
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'appointments', payload.id, 'appointment');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      const status = str(payload.status);
      if (!APPOINTMENT_STATUSES.includes(status)) return { ok: false, error: 'Unknown appointment status.' };
      const record = { ...existing, status, updatedAt: ctx.now() };
      if (['Checked In', 'Waiting'].includes(status) && !record.checkedInAt) {
        record.checkedInAt = ctx.now();
        if (!record.serial) {
          const settings = repo.getSettings();
          const serialNumber = repo.appointmentsOnDate(record.date).filter((appointment) => appointment.serial).length + 1;
          record.serial = `${settings.serialPrefix || 'Q'}-${String(serialNumber).padStart(3, '0')}`;
        }
      }
      if (status === 'In Treatment') record.startedAt = record.startedAt || ctx.now();
      if (status === 'Completed') { record.completedAt = ctx.now(); record.startedAt = record.startedAt || ctx.now(); }
      if (status === 'Cancelled') record.cancelledAt = ctx.now();
      if (status === 'No Show') record.noShowAt = ctx.now();
      repo.update('appointments', record);
      return { ok: true, record, audit: [{ action: 'Appointment status changed', entity: 'Appointment', entityId: record.id, summary: `${existing.status || 'Scheduled'} → ${status}${record.serial ? ` · serial ${record.serial}` : ''}` }] };
    }
  },

  'appointment.cancel': {
    permission: 'appointments.cancel',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'appointments', payload.id, 'appointment');
      if (found.error) return { ok: false, error: found.error };
      const record = { ...found.record, status: 'Cancelled', cancelReason: str(payload.reason), cancelledAt: ctx.now(), updatedAt: ctx.now() };
      repo.update('appointments', record);
      return { ok: true, record, audit: [{ action: 'Appointment cancelled', entity: 'Appointment', entityId: record.id, summary: record.cancelReason || 'Cancelled' }] };
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
        visitCode: nextCode(repo, 'visit', 'visitPrefix', settings.appointmentPrefix || 'V'),
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
      repo.insert('visits', record);
      const patient = repo.get('patients', record.patientId);
      if (patient && (!patient.lastVisit || record.date > patient.lastVisit)) {
        repo.update('patients', { ...patient, lastVisit: record.date, updatedAt: ctx.now() });
      }
      const audit = [{ action: 'Visit created', entity: 'Visit', entityId: record.id, summary: `${patient?.fullName || record.patientId} · ${record.date} · ${record.reason}` }];
      // Automation allowed by §85: a due follow-up date becomes an actionable task.
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
      const record = { ...found.record, ...payload, id: found.record.id, visitCode: found.record.visitCode, patientId: found.record.patientId, createdAt: found.record.createdAt, updatedAt: ctx.now() };
      if (record.followUpDate && !dateValid(record.followUpDate)) record.followUpDate = '';
      repo.update('visits', record);
      return { ok: true, record, audit: [{ action: 'Visit edited', entity: 'Visit', entityId: record.id, summary: `${record.visitCode} · ${record.date}` }] };
    }
  },

  'dental.save': {
    permission: 'clinical.edit',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose a patient first.' };
      const tooth = Number(payload.tooth);
      if (!Number.isInteger(tooth) || tooth <= 0) return { ok: false, error: 'Choose a valid tooth.' };
      const dentition = payload.dentition === 'primary' ? 'primary' : 'adult';
      const status = str(payload.status);
      const note = str(payload.note);
      if (!status && !note && !str(payload.procedure)) return { ok: false, error: 'Record a status, procedure or note for this tooth.' };
      // Preserve tooth history: the previous current record is superseded, never lost.
      repo.supersedeDental(patient.id, tooth, dentition);
      const record = {
        id: makeId('dental'),
        patientId: patient.id,
        tooth,
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
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      if (!str(payload.doctor)) return { ok: false, error: 'The prescriber name is required.' };
      let medications = (Array.isArray(payload.medications) ? payload.medications : [])
        .map((item) => ({
          medicine: str(item.medicine), strength: str(item.strength), dosage: str(item.dosage),
          frequency: str(item.frequency), duration: str(item.duration),
          route: str(item.route) || 'Oral', instructions: str(item.instructions)
        }))
        .filter((item) => item.medicine);
      if (!medications.length && str(payload.medicine)) {
        medications = [{
          medicine: str(payload.medicine), strength: str(payload.strength), dosage: str(payload.dosage),
          frequency: str(payload.frequency), duration: str(payload.duration),
          route: str(payload.route) || 'Oral', instructions: str(payload.instructions)
        }];
      }
      // v1.3.0 form contract: additional medicines as pipe-delimited lines.
      if (!medications.length && str(payload.medicationsText)) {
        medications = str(payload.medicationsText).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const [medicine = '', strength = '', dosage = '', frequency = '', duration = '', route = 'Oral', instructions = ''] = line.split('|').map((part) => part.trim());
          return { medicine, strength, dosage, frequency, duration, route, instructions };
        }).filter((item) => item.medicine);
      }
      if (!medications.length) return { ok: false, error: 'Add at least one medicine. Prescriptions are clinician-authored.' };
      const settings = repo.getSettings();
      const record = {
        id: makeId('rx'),
        prescriptionCode: nextCode(repo, 'prescription', 'appointmentPrefix', settings.appointmentPrefix || 'RX'),
        patientId: patient.id,
        visitId: str(payload.visitId),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        doctor: str(payload.doctor),
        dentistId: str(payload.dentistId),
        medications,
        notes: str(payload.notes),
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('prescriptions', record);
      return { ok: true, record, audit: [{ action: 'Prescription created', entity: 'Prescription', entityId: record.id, summary: `${patient.fullName} · ${medications.length} medicine(s)` }] };
    }
  },

  'prescription.update': {
    permission: 'prescriptions.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'prescriptions', payload.id, 'prescription');
      if (found.error) return { ok: false, error: found.error };
      const medications = Array.isArray(payload.medications)
        ? payload.medications.map((item) => ({ ...item, medicine: str(item.medicine), route: str(item.route) || 'Oral' })).filter((item) => item.medicine)
        : found.record.medications;
      const record = { ...found.record, ...payload, id: found.record.id, prescriptionCode: found.record.prescriptionCode, patientId: found.record.patientId, medications, createdAt: found.record.createdAt, updatedAt: ctx.now() };
      repo.update('prescriptions', record);
      return { ok: true, record, audit: [{ action: 'Prescription edited', entity: 'Prescription', entityId: record.id, summary: `${record.prescriptionCode} · ${medications.length} medicine(s)` }] };
    }
  },

  // ------------------------------------------------- treatment plans & catalog
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
        visitCode: nextCode(repo, 'visit', 'visitPrefix', settings.appointmentPrefix || 'V'),
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
        status: payload.status === 'Draft' ? 'Draft' : 'Issued'
      };
      repo.insert('invoices', record);
      repo.updatePatientBalance(patient.id);
      return { ok: true, record, audit: [{ action: 'Invoice created', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${patient.fullName} · ${record.status}` }] };
    }
  },

  'invoice.update': {
    permission: 'billing.edit',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'invoices', payload.id, 'invoice');
      if (found.error) return { ok: false, error: found.error };
      const existing = found.record;
      const state = computeInvoiceState(repo, existing);
      if (state.paidCents > 0 || state.adjustedCents > 0) {
        // Money exists: only notes/status transitions are safe; re-pricing is rejected
        // outright — never silently ignored — so financial history stays trustworthy.
        const repricingAttempted = ['items', 'itemName', 'unitPrice', 'quantity', 'discount', 'taxRate', 'subtotal', 'total']
          .some((key) => payload[key] !== undefined);
        if (repricingAttempted) {
          return { ok: false, error: 'Invoice pricing is locked after payments or adjustments exist. Record an adjustment or refund instead.', code: 'invoice-locked' };
        }
        const status = INVOICE_STATUSES.includes(payload.status) ? payload.status : existing.status;
        if (['Paid', 'Partially Paid'].includes(status) && status !== invoiceStatusFrom(state, existing.status) && status !== 'Cancelled') {
          return { ok: false, error: 'Payment status follows recorded payments and cannot be set manually.' };
        }
        const record = { ...existing, notes: payload.notes !== undefined ? str(payload.notes) : existing.notes, status, updatedAt: ctx.now() };
        repo.update('invoices', record);
        repo.updatePatientBalance(record.patientId);
        return { ok: true, record, audit: [{ action: 'Invoice edited', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${record.status}` }] };
      }
      const built = buildInvoice(repo, { ...existing, ...payload }, ctx, existing);
      if (built.error) return { ok: false, error: built.error };
      const record = {
        ...built.record,
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        paid: 0,
        due: built.record.total,
        status: INVOICE_STATUSES.includes(payload.status) ? payload.status : (payload.status === 'Draft' ? 'Draft' : 'Issued'),
        createdAt: existing.createdAt
      };
      repo.update('invoices', record);
      repo.updatePatientBalance(record.patientId);
      return { ok: true, record, audit: [{ action: 'Invoice edited', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber} · ${record.status}` }] };
    }
  },

  'invoice.cancel': {
    permission: 'billing.void',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'invoices', payload.id, 'invoice');
      if (found.error) return { ok: false, error: found.error };
      const invoice = found.record;
      if (invoice.status === 'Cancelled') return { ok: false, error: 'This invoice is already cancelled.' };
      const state = computeInvoiceState(repo, invoice);
      if (state.paidCents > 0) return { ok: false, error: 'Refund the recorded payments before cancelling this invoice.' };
      const record = { ...invoice, status: 'Cancelled', cancelReason: str(payload.reason), paid: 0, due: 0, updatedAt: ctx.now() };
      repo.update('invoices', record);
      repo.updatePatientBalance(record.patientId);
      return { ok: true, record, audit: [{ action: 'Invoice cancelled', entity: 'Invoice', entityId: record.id, summary: `${record.invoiceNumber}${record.cancelReason ? ` · ${record.cancelReason}` : ''}` }] };
    }
  },

  'payment.record': {
    permission: 'payments.create',
    run(repo, payload, ctx) {
      const patient = repo.get('patients', payload.patientId);
      if (!patient) return { ok: false, error: 'Choose an existing patient.' };
      if (!dateValid(payload.date)) return { ok: false, error: 'A valid payment date is required.' };
      const amount = toNumber(payload.amount);
      const invoice = payload.invoiceId ? repo.get('invoices', payload.invoiceId) : null;
      if (payload.invoiceId && !invoice) return { ok: false, error: 'That invoice no longer exists.' };
      let due = amount;
      if (invoice) {
        const state = computeInvoiceState(repo, invoice);
        due = centsToMoney(state.dueCents);
      }
      const validation = validatePayment({ amount, due, invoiceStatus: invoice?.status || 'Unpaid' });
      if (!validation.valid) return { ok: false, error: validation.errors[0], errors: validation.errors };
      const settings = repo.getSettings();
      const method = str(payload.method) || 'Cash';
      if (!(settings.paymentMethods || []).includes(method) && !['Cash', 'Bank', 'Card'].includes(method)) {
        return { ok: false, error: `"${method}" is not a configured payment method.` };
      }
      const record = {
        id: makeId('payment'),
        receiptNumber: nextCode(repo, 'receipt', 'receiptPrefix', settings.invoicePrefix || 'INV'),
        invoiceId: invoice?.id || '',
        patientId: patient.id,
        amount: validation.amount,
        refundedAmount: 0,
        status: 'Recorded',
        date: payload.date,
        method,
        reference: str(payload.reference),
        transactionId: str(payload.transactionId) || str(payload.reference),
        provider: str(payload.provider),
        notes: str(payload.notes),
        createdAt: ctx.now(),
        updatedAt: ctx.now()
      };
      repo.insert('payments', record);
      if (invoice) refreshInvoicePaymentState(repo, repo.get('invoices', invoice.id), ctx.now());
      repo.updatePatientBalance(patient.id);
      return { ok: true, record, audit: [{ action: 'Payment recorded', entity: 'Payment', entityId: record.id, summary: `${record.receiptNumber} · ${record.method} · ${record.amount}` }] };
    }
  },

  'payment.refund': {
    permission: 'payments.refund',
    run(repo, payload, ctx) {
      const found = requireRecord(repo, 'payments', payload.id ?? payload.paymentId, 'payment');
      if (found.error) return { ok: false, error: found.error };
      const payment = found.record;
      if (!validateMoney(payload.amount, { allowZero: false })) return { ok: false, error: 'Refund must be a positive amount with at most two decimals.' };
      const amountCents = moneyToCents(payload.amount);
      const remainingCents = Math.max(0, moneyToCents(payment.amount) - moneyToCents(payment.refundedAmount));
      if (amountCents > remainingCents) return { ok: false, error: 'Refund cannot exceed the remaining payment balance.' };
      if (!str(payload.reason)) return { ok: false, error: 'A refund reason is required.' };
      const adjustment = {
        id: makeId('adjustment'),
        type: 'Refund',
        paymentId: payment.id,
        invoiceId: payment.invoiceId || '',
        patientId: payment.patientId || (payment.invoiceId ? repo.get('invoices', payment.invoiceId)?.patientId : '') || '',
        amount: centsToMoney(amountCents),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: str(payload.reason),
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
        if (invoice) {
          const refreshed = refreshInvoicePaymentState(repo, invoice, ctx.now());
          if (refundedCents >= moneyToCents(payment.amount) && computeInvoiceState(repo, refreshed).paidCents === 0) {
            repo.update('invoices', { ...refreshed, status: 'Refunded', updatedAt: ctx.now() });
          }
        }
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
      if (!validateMoney(payload.amount, { allowZero: false })) return { ok: false, error: 'Adjustment must be a positive amount with at most two decimals.' };
      if (!str(payload.reason)) return { ok: false, error: 'An adjustment reason is required.' };
      const state = computeInvoiceState(repo, invoice);
      const amountCents = Math.min(moneyToCents(payload.amount), state.dueCents);
      if (amountCents <= 0) return { ok: false, error: 'This invoice has no outstanding balance to adjust.' };
      const adjustment = {
        id: makeId('adjustment'),
        type: 'Adjustment',
        paymentId: '',
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        amount: centsToMoney(amountCents),
        date: dateValid(payload.date) ? payload.date : ctx.today(),
        reason: str(payload.reason),
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
        itemCode: str(payload.itemCode) || nextCode(repo, 'item', 'itemPrefix', 'IT'),
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
        staffCode: nextCode(repo, 'staff', 'staffPrefix', 'STF'),
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
      const found = requireRecord(repo, 'users', payload.id, 'user account');
      if (found.error) return { ok: false, error: found.error };
      const user = found.record;
      if (user.id === ctx.userId) return { ok: false, error: 'You cannot deactivate the signed-in account.' };
      const nextActive = user.active === false;
      if (!nextActive && user.role === 'Administrator') {
        const otherAdmins = repo.usersList().filter((candidate) => candidate.id !== user.id && candidate.active !== false && candidate.role === 'Administrator').length;
        if (otherAdmins < 1) return { ok: false, error: 'Keep at least one active Administrator account.' };
      }
      const record = { ...user, active: nextActive, updatedAt: ctx.now() };
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
      for (const note of repo.notificationsActive(500)) {
        repo.update('notifications', { ...note, read: true });
        read[note.id] = true;
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
  }
};

export function sanitizeUser(record) {
  if (!record) return null;
  const { pinHash, pinSalt, ...safe } = record;
  return { ...safe, hasPin: Boolean(pinHash || record.hasPin) };
}

function userUpsert(repo, payload, ctx, editing) {
  const name = str(payload.name);
  if (!name) return { ok: false, error: 'Enter the account holder name.' };
  const role = str(payload.role) || 'Receptionist';
  let existing = null;
  if (editing) {
    const found = requireRecord(repo, 'users', payload.id, 'user account');
    if (found.error) return { ok: false, error: found.error };
    existing = found.record;
  }
  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  const record = {
    ...(existing || { id: makeId('user'), createdAt: ctx.now(), failedAttempts: 0, lockedUntil: 0, lastLogin: null }),
    name,
    role,
    staffId: str(payload.staffId),
    active: payload.active === undefined ? (existing ? existing.active !== false : true) : payload.active !== false && payload.active !== 'false',
    permissions,
    updatedAt: ctx.now()
  };
  if (record.active === false && record.id === ctx.userId) return { ok: false, error: 'You cannot deactivate the signed-in account.' };
  const allUsers = repo.usersList();
  const projectedAdmins = allUsers.filter((candidate) => {
    if (candidate.id === record.id) return record.active !== false && record.role === 'Administrator';
    return candidate.active !== false && candidate.role === 'Administrator';
  }).length;
  if (projectedAdmins < 1) return { ok: false, error: 'Keep at least one active Administrator account.' };
  const pinRequest = payload.pin !== undefined && payload.pin !== '' ? str(payload.pin) : null;
  if (pinRequest !== null) {
    if (!/^\d{4,12}$/.test(pinRequest)) return { ok: false, error: 'PINs must be 4–12 digits.' };
    if (pinRequest !== str(payload.confirmPin)) return { ok: false, error: 'PIN confirmation does not match.' };
  } else if (!editing) {
    return { ok: false, error: 'New accounts require a 4–12 digit PIN.' };
  }
  repo.insert('users', record);
  return {
    ok: true,
    record: sanitizeUser(record),
    pinToSet: pinRequest !== null ? { userId: record.id, pin: pinRequest } : null,
    audit: [{ action: editing ? 'User account updated' : 'User account created', entity: 'User', entityId: record.id, summary: `${record.name} · ${record.role}${pinRequest !== null ? ' · PIN set' : ''}` }]
  };
}

/** Permission required for an op given its payload (string, list = any-of, fn, or null). */
export function opPermission(name, payload = {}) {
  const op = OPS[name];
  if (!op) return undefined;
  if (typeof op.permission === 'function') return op.permission(payload);
  if (Array.isArray(op.permission)) return op.permission;
  return op.permission;
}

export function authorizeOp(name, payload, ctx) {
  const permission = opPermission(name, payload);
  if (permission === undefined) return { ok: false, error: `Unknown operation: ${name}` };
  if (!ctx) return { ok: false, error: 'Sign in to continue.', code: 'auth-required' };
  if (permission === null) return { ok: true };
  const candidate = { active: true, role: ctx.role, permissions: ctx.permissions };
  const candidates = Array.isArray(permission) ? permission : [permission];
  if (candidates.some((entry) => hasPermission(candidate, entry))) return { ok: true };
  return { ok: false, error: 'Your account is not allowed to perform this action.', code: 'permission-denied', permission: candidates[0] };
}

export function runOp(repo, name, payload = {}, ctx = {}) {
  const op = OPS[name];
  if (!op) return { ok: false, error: `Unknown operation: ${name}` };
  const authorization = authorizeOp(name, payload, ctx);
  if (!authorization.ok) return authorization;
  return op.run(repo, payload, { now: () => new Date().toISOString(), today: () => new Date().toISOString().slice(0, 10), ...ctx });
}

export { normaliseTags };
