// Pure domain helpers used by the renderer and the automated workflow tests.
// Keeping financial, import and file-safety rules here makes them auditable without a browser.

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function calculateInvoice({ quantity = 1, unitPrice = 0, discount = 0, taxRate = 0 }) {
  const subtotal = Math.max(0, toNumber(quantity)) * Math.max(0, toNumber(unitPrice));
  const appliedDiscount = Math.min(subtotal, Math.max(0, toNumber(discount)));
  const taxable = Math.max(0, subtotal - appliedDiscount);
  const appliedTaxRate = Math.max(0, toNumber(taxRate));
  const tax = taxable * appliedTaxRate / 100;
  return {
    subtotal,
    discount: appliedDiscount,
    taxRate: appliedTaxRate,
    tax,
    total: Math.max(0, taxable + tax)
  };
}

export function canAcceptPayment(amount, due) {
  const payment = toNumber(amount);
  const balance = Math.max(0, toNumber(due));
  return payment > 0 && payment <= balance + 0.005;
}

export function buildBackupManifest(state, version, includedModules) {
  return {
    product: 'Dentiva Pro',
    version,
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    schemaVersion: state.schemaVersion,
    includedModules,
    recordCounts: Object.fromEntries(includedModules.filter((key) => Array.isArray(state[key])).map((key) => [key, state[key].length]))
  };
}

export function detectPatientDuplicates(incoming, existing) {
  const normalisePhone = (value) => String(value || '').replace(/\D/g, '').replace(/^880/, '').replace(/^0/, '');
  const normalise = (value) => String(value || '').trim().toLowerCase();
  return incoming.filter((candidate) => existing.some((local) => {
    const sameCode = candidate.patientCode && local.patientCode && normalise(candidate.patientCode) === normalise(local.patientCode);
    const samePhone = candidate.phone && local.phone && normalisePhone(candidate.phone) && normalisePhone(candidate.phone) === normalisePhone(local.phone);
    const sameNamePhone = samePhone && normalise(candidate.fullName) === normalise(local.fullName);
    const sameEmail = candidate.email && local.email && normalise(candidate.email) === normalise(local.email);
    const sameDob = candidate.dateOfBirth && local.dateOfBirth && candidate.dateOfBirth === local.dateOfBirth && normalise(candidate.fullName) === normalise(local.fullName);
    return sameCode || sameNamePhone || sameEmail || sameDob;
  }));
}

export function validateAttachmentFile({ type = '', size = 0 }) {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];
  return { allowed: allowedTypes.includes(type) && toNumber(size) <= 6 * 1024 * 1024, allowedTypes, maxBytes: 6 * 1024 * 1024 };
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
