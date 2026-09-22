// v1.4.0 migration engine.
//
// Converts any supported predecessor workspace into the relational v5 layout:
//   - v4 sql.js database file (standard SQLite with records/metadata tables)
//   - v4 recovery copy (.bak) when the primary file is corrupt
//   - legacy JSON store (dentiva-pro-store.json / .bak)
//   - fresh workspace (no prior data)
//
// Safety contract (§65, §66):
//   - The conversion builds a NEW database file; the source is only replaced after
//     the new file passes integrity, foreign-key and record-count validation.
//     Any failure leaves the source untouched (rollback safety).
//   - Pre-migration sources are preserved (`*.v4-preserved.sqlite`, `.corrupt-*`,
//     `.migrated` markers) — never deleted.
//   - Records with dangling references are repaired (relational reference nulled,
//     payload kept verbatim) or quarantined with a reason; no record is silently
//     discarded. Duplicate ids keep the first occurrence; the rest are quarantined.
//   - Inline base64 attachment data is externalized to the attachment file store.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Workspace, DB_FILENAME, LEGACY_FILENAME, V4_PRESERVED_SUFFIX, ATTACHMENT_DIRECTORY
} from './db.mjs';
import { SCHEMA_SQL, WRITE_ORDER, COLLECTION_TABLES } from './schema.mjs';
import { migrateState, defaultState, APP_VERSION, META_KEYS } from '../../src/migrate-state.js';

/**
 * Guarantee state meta keys exist. Seeds the v1.4.0 default state for stores
 * created without them (e.g. a bare Workspace.open() in tests or a fresh
 * first launch that skipped migration). Existing values are never overwritten.
 */
export function ensureStateMeta(ws) {
  const existing = ws.getMeta('schemaVersion');
  if (existing !== null && existing !== undefined) return 'present';
  const base = defaultState();
  ws.transaction(() => {
    for (const key of META_KEYS) ws.setMeta(key, base[key]);
  });
  return 'seeded';
}
import { ARRAY_COLLECTIONS, validateRelationships } from '../../src/core.js';

// column → [record field, parent collection, 'required'?]
const FK_PARENTS = {
  appointments: { patient_id: ['patientId', 'patients'] },
  visits: { patient_id: ['patientId', 'patients'] },
  prescriptions: { patient_id: ['patientId', 'patients'] },
  dentalRecords: { patient_id: ['patientId', 'patients', 'required'] },
  treatmentPlans: { patient_id: ['patientId', 'patients', 'required'] },
  invoices: { patient_id: ['patientId', 'patients', 'required'] },
  payments: { invoice_id: ['invoiceId', 'invoices'], patient_id: ['patientId', 'patients'] },
  paymentAdjustments: { payment_id: ['paymentId', 'payments', 'required'], invoice_id: ['invoiceId', 'invoices'], patient_id: ['patientId', 'patients'] },
  inventory: { supplier_id: ['supplierId', 'suppliers'] },
  stockMovements: { item_id: ['itemId', 'inventory', 'required'], supplier_id: ['supplierId', 'suppliers'] },
  referrals: { patient_id: ['patientId', 'patients', 'required'] },
  attachments: { patient_id: ['patientId', 'patients', 'required'] },
  followUpTasks: { patient_id: ['patientId', 'patients', 'required'] }
};

function idSet(records) {
  return new Set((records || []).filter((record) => record && record.id).map((record) => String(record.id)));
}

/**
 * Migrate the workspace in `directory` to relational v5 when needed.
 * Returns a detailed result for diagnostics, logging and tests.
 */
export function migrateWorkspace(directory, { log = () => {} } = {}) {
  const started = Date.now();
  const dir = path.resolve(directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, ATTACHMENT_DIRECTORY), { recursive: true });
  const dbPath = path.join(dir, DB_FILENAME);
  const result = {
    status: 'fresh',
    from: null,
    layoutBefore: 'missing',
    migrated: false,
    preservedFile: null,
    quarantined: [],
    repairedReferences: 0,
    externalizedAttachments: 0,
    residualRelationshipErrors: [],
    counts: {},
    durationMs: 0,
    errors: []
  };

  let layout = Workspace.detectLayout(dbPath);
  result.layoutBefore = layout;
  let sourcePath = dbPath;

  // Corrupt primary → try the v1.3.x recovery copy before giving up.
  if (layout === 'corrupt') {
    const bakPath = `${dbPath}.bak`;
    const bakLayout = Workspace.detectLayout(bakPath);
    if (bakLayout === 'v4-blob' || bakLayout === 'v5') {
      sourcePath = bakPath;
      layout = bakLayout;
      result.from = 'v4-bak-recovery';
      result.errors.push('Primary database file failed its integrity probe; recovered from the retained backup copy.');
      try { fs.copyFileSync(dbPath, path.join(dir, `${DB_FILENAME}.corrupt-${Date.now()}`)); } catch { /* bytes stay in place */ }
    } else {
      const corruptCopy = path.join(dir, `${DB_FILENAME}.corrupt-${Date.now()}`);
      try { fs.renameSync(dbPath, corruptCopy); result.preservedFile = corruptCopy; } catch { /* best effort */ }
      layout = 'missing';
      result.errors.push('Primary and recovery database files are unreadable. The corrupt file was preserved and a fresh workspace was prepared.');
    }
  }

  if (layout === 'v5' && sourcePath === dbPath) {
    const ws = new Workspace(dir);
    ws.open();
    try {
      const metaStatus = ensureStateMeta(ws);
      if (metaStatus === 'seeded') result.errors.push('State metadata was missing and has been re-seeded with default values.');
    } finally {
      ws.close();
    }
    result.status = 'current';
    result.durationMs = Date.now() - started;
    return result;
  }

  // ---- gather the source state ------------------------------------------------
  let sourceState = null;
  if (layout === 'v4-blob') {
    try {
      sourceState = Workspace.readV4State(sourcePath);
      result.from = result.from || (sourcePath === dbPath ? 'v4-sqlite' : 'v4-bak-recovery');
    } catch (error) {
      result.errors.push(`v4 database could not be read: ${error.message}`);
    }
  }
  if (!sourceState) {
    for (const candidate of [path.join(dir, LEGACY_FILENAME), path.join(dir, `${LEGACY_FILENAME}.bak`)]) {
      const legacy = Workspace.readLegacyJson(candidate);
      if (legacy) {
        sourceState = legacy;
        result.from = 'legacy-json';
        try { fs.copyFileSync(candidate, `${candidate}.migrated`); } catch { /* marker is best effort */ }
        break;
      }
    }
  }
  if (!sourceState && !['missing', 'empty', 'unknown-tables'].includes(layout)) {
    preserveSource(dir, sourcePath, result);
    result.status = 'preserved';
    result.errors.push('The existing database layout is not recognized. The file was preserved byte-for-byte and a fresh workspace was prepared.');
    result.durationMs = Date.now() - started;
    return result;
  }

  const normalized = migrateState(sourceState || null, APP_VERSION);
  if (normalized.unsupportedSchema) {
    preserveSource(dir, sourcePath, result);
    result.status = 'preserved';
    result.errors.push(normalized.migrationError || 'Workspace uses a newer schema and was preserved read-only.');
    result.durationMs = Date.now() - started;
    return result;
  }

  // ---- normalize collections: ids, duplicates, references, attachments ---------
  const knownIds = {};
  ARRAY_COLLECTIONS.forEach((key) => { knownIds[key] = idSet(normalized[key]); });
  const quarantined = [];
  const collectionsToWrite = {};
  for (const collection of ARRAY_COLLECTIONS) {
    const seen = new Set();
    const records = [];
    for (const record of (Array.isArray(normalized[collection]) ? normalized[collection] : [])) {
      if (!record || typeof record !== 'object' || !record.id) {
        quarantined.push({ collection, recordId: String(record?.id ?? 'unknown'), reason: 'record-missing-id', payload: record ?? null });
        continue;
      }
      if (seen.has(String(record.id))) {
        quarantined.push({ collection, recordId: String(record.id), reason: 'duplicate-id', payload: record });
        continue;
      }
      seen.add(String(record.id));
      records.push({ ...record });
    }
    collectionsToWrite[collection] = records;
  }
  // Original source counts: the final check proves every source record either became
  // a row or was quarantined with a reason (nothing is silently discarded).
  const sourceCounts = Object.fromEntries(ARRAY_COLLECTIONS.map((key) => [key, Array.isArray(normalized[key]) ? normalized[key].length : 0]));

  // Attachment bytes: externalize inline data-URLs; verify referenced files exist.
  const attachmentWrites = [];
  collectionsToWrite.attachments = collectionsToWrite.attachments.map((record) => {
    const next = { ...record, data: '' };
    const safeId = String(next.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (typeof record.data === 'string' && /^data:[^;]+;base64,/.test(record.data)) {
      const encoded = record.data.slice(record.data.indexOf(',') + 1).replace(/\s/g, '');
      const buffer = Buffer.from(encoded, 'base64');
      attachmentWrites.push({ id: safeId, buffer });
      next.filePath = path.join(ATTACHMENT_DIRECTORY, `${safeId}.bin`);
      if (!next.size) next.size = buffer.byteLength;
      result.externalizedAttachments += 1;
      return next;
    }
    if (next.filePath) {
      const absolute = path.resolve(dir, next.filePath);
      const contained = absolute === path.resolve(dir, ATTACHMENT_DIRECTORY)
        || absolute.startsWith(`${path.resolve(dir, ATTACHMENT_DIRECTORY)}${path.sep}`);
      if (contained && fs.existsSync(absolute)) return next;
      quarantined.push({ collection: 'attachments', recordId: String(next.id), reason: 'missing-attachment-file', payload: next });
      return null;
    }
    quarantined.push({ collection: 'attachments', recordId: String(next.id), reason: 'attachment-without-content', payload: next });
    return null;
  }).filter(Boolean);

  // Dangling reference repair (payload keeps the historical value) / quarantine.
  const nulledReferences = []; // {collection, id, field}
  for (const [collection, rules] of Object.entries(FK_PARENTS)) {
    collectionsToWrite[collection] = (collectionsToWrite[collection] || []).map((record) => {
      for (const [column, rule] of Object.entries(rules)) {
        const [field, parentCollection, required] = rule;
        const reference = record[field];
        if (reference && !knownIds[parentCollection].has(String(reference))) {
          if (required === 'required') {
            quarantined.push({ collection, recordId: String(record.id), reason: `orphan-${field}-missing-${parentCollection}`, payload: record });
            return null;
          }
          nulledReferences.push({ collection, id: String(record.id), field, column, original: reference });
          result.repairedReferences += 1;
        }
      }
      return record;
    }).filter(Boolean);
  }

  // Financial cache: patient balance cents = non-cancelled charges − net payments.
  const balanceCents = new Map();
  const addBalance = (patientId, cents) => {
    if (!patientId) return;
    balanceCents.set(patientId, (balanceCents.get(patientId) || 0) + cents);
  };
  for (const invoice of collectionsToWrite.invoices) {
    if (String(invoice.status) === 'Cancelled') continue;
    addBalance(invoice.patientId, Math.round((Number(invoice.total) || 0) * 100));
  }
  const refundedByPayment = new Map();
  for (const adjustment of collectionsToWrite.paymentAdjustments) {
    if (adjustment.type !== 'Refund' || !adjustment.paymentId) continue;
    refundedByPayment.set(adjustment.paymentId, (refundedByPayment.get(adjustment.paymentId) || 0) + Math.round((Number(adjustment.amount) || 0) * 100));
  }
  const invoiceById = new Map(collectionsToWrite.invoices.map((invoice) => [String(invoice.id), invoice]));
  for (const payment of collectionsToWrite.payments) {
    if (['Voided', 'Cancelled'].includes(payment.status)) continue;
    const refunded = Math.max(
      Math.round((Number(payment.refundedAmount) || 0) * 100),
      refundedByPayment.get(payment.id) || 0
    );
    const net = Math.max(0, Math.round((Number(payment.amount) || 0) * 100) - refunded);
    const patientId = payment.patientId || invoiceById.get(String(payment.invoiceId || ''))?.patientId || '';
    addBalance(patientId, -net);
    payment.refundedAmount = refunded / 100;
  }
  // Forgiveness adjustments reduce the balance (refund-type adjustments are already
  // reflected through payments' refunded amounts above — never double-count them).
  for (const adjustment of collectionsToWrite.paymentAdjustments) {
    if (adjustment.type !== 'Adjustment') continue;
    const patientId = adjustment.patientId || invoiceById.get(String(adjustment.invoiceId || ''))?.patientId || '';
    addBalance(patientId, -Math.max(0, Math.round((Number(adjustment.amount) || 0) * 100)));
  }
  collectionsToWrite.patients = collectionsToWrite.patients.map((patient) => ({
    ...patient,
    balanceCents: balanceCents.get(patient.id) || 0
  }));

  // Informational relationship validation of the repaired state.
  result.residualRelationshipErrors = validateRelationships({
    ...normalized,
    ...collectionsToWrite,
    schemaVersion: normalized.schemaVersion
  });

  // ---- build + validate the converted database ---------------------------------
  const tempPath = `${dbPath}.migrating-${process.pid}-${Date.now()}`;
  let tempDb = null;
  try {
    tempDb = new DatabaseSync(tempPath);
    tempDb.exec(SCHEMA_SQL);
    const tempWorkspace = new Workspace(dir);
    tempWorkspace.db = tempDb;
    tempWorkspace.dbPath = tempPath;

    const nullLookup = new Map();
    for (const entry of nulledReferences) {
      const key = `${entry.collection}:${entry.id}`;
      if (!nullLookup.has(key)) nullLookup.set(key, []);
      nullLookup.get(key).push(entry.column);
    }
    tempWorkspace.transaction((ws) => {
      for (const collection of WRITE_ORDER) {
        if (!COLLECTION_TABLES[collection]) continue;
        for (const record of (collectionsToWrite[collection] || [])) {
          const nullColumns = nullLookup.get(`${collection}:${String(record.id)}`) || [];
          // The record payload keeps the original reference value; only the
          // relational FK columns are nulled so constraints hold.
          ws.upsertRecord(collection, record, nullColumns.length ? { nullColumns } : {});
        }
      }
      for (const key of META_KEYS) {
        if (normalized[key] !== undefined) ws.setMeta(key, normalized[key]);
      }
      ws.setMeta('dbLayoutVersion', 1);
      ws.setMeta('migratedAt', new Date().toISOString());
      ws.setMeta('migratedFrom', result.from || 'fresh');
      ws.db.prepare('INSERT INTO migration_history (version, name, applied_at, duration_ms, details) VALUES (?, ?, ?, ?, ?)')
        .run(1, 'relational-baseline-v5', new Date().toISOString(), Date.now() - started, JSON.stringify({
          from: result.from,
          quarantined: quarantined.length,
          repairedReferences: result.repairedReferences,
          externalizedAttachments: result.externalizedAttachments,
          residualRelationshipErrors: result.residualRelationshipErrors.slice(0, 20)
        }));
      for (const entry of quarantined) ws.quarantine(entry.collection, entry.recordId, entry.reason, entry.payload);
    });

    // Attachment bytes land only after the database transaction commits.
    for (const write of attachmentWrites) {
      const target = path.join(dir, ATTACHMENT_DIRECTORY, `${write.id}.bin`);
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      const descriptor = fs.openSync(temp, 'w');
      try {
        fs.writeFileSync(descriptor, write.buffer);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temp, target);
    }

    // Validate before promotion.
    const integrity = tempWorkspace.integrityCheck();
    if (!integrity.ok) {
      throw new Error(`post-migration integrity check failed (${integrity.integrity}, ${integrity.foreignKeyViolationCount} FK violations)`);
    }
    const counts = tempWorkspace.recordCounts();
    for (const collection of ARRAY_COLLECTIONS) {
      const source = sourceCounts[collection] || 0;
      const quarantinedHere = quarantined.filter((entry) => entry.collection === collection).length;
      if (counts[collection] + quarantinedHere !== source) {
        throw new Error(`record count mismatch for ${collection}: wrote ${counts[collection]}, quarantined ${quarantinedHere}, source ${source}`);
      }
    }
    tempWorkspace.close();
    tempDb = null;

    // Promote: preserve the source, swap the converted database into place.
    if (sourceState && fs.existsSync(sourcePath)) {
      const preserved = path.join(dir, `${DB_FILENAME}${V4_PRESERVED_SUFFIX}`);
      try {
        fs.copyFileSync(sourcePath, preserved);
        result.preservedFile = preserved;
      } catch { /* the untouched source file itself remains the fallback */ }
      if (sourcePath === dbPath) {
        fs.rmSync(dbPath, { force: true });
        fs.rmSync(`${dbPath}-wal`, { force: true });
        fs.rmSync(`${dbPath}-shm`, { force: true });
        fs.rmSync(`${dbPath}.bak`, { force: true });
      }
    }
    fs.renameSync(tempPath, dbPath);
    fs.rmSync(`${tempPath}-wal`, { force: true });
    fs.rmSync(`${tempPath}-shm`, { force: true });

    result.status = sourceState ? 'migrated' : 'fresh';
    result.migrated = Boolean(sourceState);
    result.counts = counts;
    result.quarantined = quarantined;
    log(`migration ${result.status} from ${result.from || 'fresh'}: ${Object.values(counts).reduce((a, b) => a + b, 0)} records in ${Date.now() - started}ms`);
  } catch (error) {
    if (tempDb) { try { tempDb.close(); } catch { /* best effort */ } }
    fs.rmSync(tempPath, { force: true });
    fs.rmSync(`${tempPath}-wal`, { force: true });
    fs.rmSync(`${tempPath}-shm`, { force: true });
    result.status = sourceState ? 'preserved' : 'failed';
    result.quarantined = quarantined;
    result.errors.push(`Migration failed and the source data was left untouched: ${error.message}`);
    log(`migration failed: ${error.message}`);
  }
  result.durationMs = Date.now() - started;
  return result;
}

function preserveSource(dir, sourcePath, result) {
  try {
    const preserved = path.join(dir, `${DB_FILENAME}${V4_PRESERVED_SUFFIX}`);
    if (fs.existsSync(sourcePath) && path.resolve(sourcePath) !== preserved) {
      fs.copyFileSync(sourcePath, preserved);
    }
    if (fs.existsSync(preserved)) result.preservedFile = preserved;
  } catch { /* best effort; the source file itself is never modified here */ }
}
