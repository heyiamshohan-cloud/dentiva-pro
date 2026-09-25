// Dentiva Pro v2.0.0 — backup / restore engine.
//
// A backup is a portable folder: a consistent `VACUUM INTO` snapshot of the
// SQLite store (WAL-safe, no lock needed), a copy of every attachment file and
// a `manifest.json` carrying versions, kind, record counts and SHA-256
// checksums so any backup can be validated before it is trusted.
//
// Restore is transactional at the file level:
//   1. validate the backup (checksums, integrity, layout, FKs),
//   2. take a safety backup of the current workspace,
//   3. STAGE the backup database + attachments next to the live files and
//      verify the staged copy,
//   4. swap by rename (live → rollback copy, staged → live), reopen, verify,
//   5. on ANY failure rename the rollback copies back — the workspace is left
//      exactly as it was.
// Automatic retention only ever prunes automatic backups; manual, safety,
// pre-upgrade and export backups are never deleted by the scheduler.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_FILENAME, ATTACHMENT_DIRECTORY } from './db.mjs';
import { DB_LAYOUT_VERSION } from './schema.mjs';

const MANIFEST_FILE = 'manifest.json';
const BACKUP_FORMAT = 'dentiva-backup';
const BACKUP_FORMAT_VERSION = 1;

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listAttachmentFiles(directory) {
  const out = [];
  const walk = (dir, prefix = '') => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push({ rel, full });
    }
  };
  walk(directory);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** Combined digest over the sorted attachment set (checksum, bytes, file count). */
function digestAttachments(directory) {
  const files = listAttachmentFiles(directory);
  const hasher = crypto.createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const stat = fs.statSync(file.full);
    bytes += stat.size;
    hasher.update(file.rel.replace(/\\/g, '/') + ':' + stat.size + ':');
    hasher.update(fs.readFileSync(file.full));
  }
  return { files: files.length, bytes, sha256: files.length ? hasher.digest('hex') : null };
}

function timestampName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `dentiva-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function safeLabel(label = '') {
  return String(label || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40);
}

function isDirectory(value) {
  try { return fs.statSync(value).isDirectory(); } catch { return false; }
}

/** Read + shape-check a manifest without trusting it. */
function readManifest(backupPath) {
  const manifestPath = path.join(backupPath, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return { ok: false, error: 'Missing manifest.json' };
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { ok: false, error: 'Unreadable manifest.json' }; }
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'Invalid manifest.json' };
  if (manifest.format !== BACKUP_FORMAT) return { ok: false, error: 'Not a Dentiva backup (unknown format)' };
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `Unsupported backup format version ${manifest.formatVersion}` };
  }
  return { ok: true, manifest };
}

/** Full validation of a backup folder. Returns detailed problems for the UI. */
export function validateBackup(backupPath) {
  const problems = [];
  const manifestRead = readManifest(backupPath);
  if (!manifestRead.ok) return { ok: false, manifest: null, problems: [manifestRead.error] };
  const manifest = manifestRead.manifest;
  const dbPath = path.join(backupPath, String(manifest.dbFile || DB_FILENAME));
  if (!fs.existsSync(dbPath)) {
    problems.push('Database file is missing from the backup.');
  } else {
    const actualHash = sha256File(dbPath);
    if (manifest.dbSha256 && actualHash !== manifest.dbSha256) problems.push('Database checksum mismatch.');
    // Open read-only and prove it is a sound v5 store before anything else.
    let probe = null;
    try {
      probe = new DatabaseSync(dbPath, { readOnly: true });
      const integrity = probe.prepare('PRAGMA integrity_check').get()?.integrity_check;
      if (integrity !== 'ok') problems.push(`SQLite integrity check failed (${integrity}).`);
      const layout = probe.prepare("SELECT value FROM meta WHERE key = 'dbLayoutVersion'").get();
      const layoutVersion = layout ? Number(layout.value) : null;
      if (!Number.isInteger(layoutVersion)) problems.push('Backup database has no layout version (not a v5 store).');
      else if (layoutVersion > DB_LAYOUT_VERSION) problems.push(`Backup layout v${layoutVersion} is newer than this build (v${DB_LAYOUT_VERSION}).`);
      const fk = probe.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) problems.push(`${fk.length} foreign-key violation(s) inside the backup database.`);
      const tables = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      if (!tables.has('patients')) problems.push('Backup database is missing the patients table.');
    } catch (error) {
      problems.push(`Backup database cannot be opened: ${error.message}`);
    } finally {
      try { probe?.close(); } catch { /* already closed */ }
    }
  }
  const attachments = manifest.attachments || {};
  if (Number(attachments.files) > 0) {
    const actual = digestAttachments(path.join(backupPath, ATTACHMENT_DIRECTORY));
    if (attachments.sha256 && actual.sha256 !== attachments.sha256) problems.push('Attachment files checksum mismatch.');
    else if (actual.files !== attachments.files) problems.push(`Attachment file count mismatch (expected ${attachments.files}, found ${actual.files}).`);
  }
  return {
    ok: problems.length === 0,
    problems,
    manifest,
    dbSha256: manifest.dbSha256 || null,
    recordCounts: manifest.recordCounts || {},
    totalBytes: Number(manifest.totalBytes) || 0
  };
}

/**
 * Create a portable backup in the workspace's backups directory.
 * Returns { ok: true, path, manifest } or { ok: false, error }.
 */
export const BACKUP_KINDS = ['manual', 'automatic', 'safety', 'pre-upgrade', 'export'];

export function createBackup(ws, { label = '', createdBy = '', directory = '', kind = 'manual' } = {}) {
  let target = '';
  try {
    const backupKind = BACKUP_KINDS.includes(kind) ? kind : 'manual';
    const base = `${timestampName()}${safeLabel(label) ? `-${safeLabel(label)}` : ''}`;
    const root = path.isAbsolute(String(directory || '')) && String(directory || '').trim() ? path.resolve(String(directory).trim()) : ws.backupDirectory;
    fs.mkdirSync(root, { recursive: true });
    let name = base;
    for (let suffix = 2; fs.existsSync(path.join(root, name)); suffix += 1) name = `${base}-${suffix}`;
    target = path.join(root, name);
    fs.mkdirSync(target, { recursive: true });

    // 1) Consistent snapshot — VACUUM INTO is WAL-safe and needs no exclusive lock.
    const dbTarget = path.join(target, DB_FILENAME);
    ws.exec(`VACUUM INTO ${sqlLiteral(dbTarget)}`);

    // 2) Attachment files (full copy; orphans are cleaned separately, never here).
    const attTarget = path.join(target, ATTACHMENT_DIRECTORY);
    fs.mkdirSync(attTarget, { recursive: true });
    for (const file of listAttachmentFiles(ws.attachmentDirectory)) {
      const rel = file.rel.replace(/\\/g, '/');
      const out = path.join(attTarget, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(file.full, out);
    }

    // 3) Manifest with versions, counts and checksums.
    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      kind: backupKind,
      label: String(label || '').trim(),
      createdBy,
      appVersion: ws.getMeta('appVersion') || null,
      schemaVersion: ws.getMeta('schemaVersion') ?? null,
      dbLayoutVersion: Number(ws.getMeta('dbLayoutVersion')) || DB_LAYOUT_VERSION,
      dbFile: DB_FILENAME,
      dbSha256: sha256File(dbTarget),
      dbBytes: fs.statSync(dbTarget).size,
      attachments: digestAttachments(attTarget),
      recordCounts: ws.recordCounts(),
      totalBytes: 0
    };
    manifest.totalBytes = manifest.dbBytes + manifest.attachments.bytes;
    // Write the manifest last and atomically: a folder without a manifest is
    // an incomplete backup and is never listed as valid.
    const manifestTemp = path.join(target, `${MANIFEST_FILE}.tmp`);
    fs.writeFileSync(manifestTemp, JSON.stringify(manifest, null, 2));
    fs.renameSync(manifestTemp, path.join(target, MANIFEST_FILE));
    if (backupKind !== 'safety' && backupKind !== 'pre-upgrade') ws.setMeta('lastBackupAt', manifest.createdAt);
    return { ok: true, path: target, name, manifest };
  } catch (error) {
    if (target) { try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* leave partial folder; it has no manifest */ } }
    return { ok: false, error: `Backup failed: ${error.message}` };
  }
}

function removePath(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
}

function removeJournal(dbPath) {
  for (const suffix of ['-wal', '-shm', '-journal']) removePath(dbPath + suffix);
}

/** Restore a validated backup into the workspace (staged swap with automatic rollback). */
export function restoreBackup(ws, backupPath, { autoSafetyBackup = true, faultInjection = null } = {}) {
  const validation = validateBackup(backupPath);
  if (!validation.ok) {
    return { ok: false, error: 'Backup validation failed. Nothing was changed.', problems: validation.problems };
  }
  const manifest = validation.manifest;
  const fault = (step) => { if (faultInjection === step) throw new Error(`injected fault at ${step}`); };

  let safety = null;
  if (autoSafetyBackup) {
    safety = createBackup(ws, { label: 'pre-restore', kind: 'safety' });
    if (!safety.ok) return { ok: false, error: `Could not create the pre-restore safety backup, so nothing was changed: ${safety.error}` };
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const stagedDb = `${ws.dbPath}.restore-${stamp}`;
  const stagedAttachments = `${ws.attachmentDirectory}.restore-${stamp}`;
  const rollbackDb = `${ws.dbPath}.rollback-${stamp}`;
  const rollbackAttachments = `${ws.attachmentDirectory}.rollback-${stamp}`;

  // 1) Stage and verify — the live workspace is untouched in this phase.
  try {
    const backupDb = path.join(backupPath, String(manifest.dbFile || DB_FILENAME));
    fs.copyFileSync(backupDb, stagedDb);
    fault('stage-db');
    if (manifest.dbSha256 && sha256File(stagedDb) !== manifest.dbSha256) throw new Error('the staged database copy does not match the backup checksum');
    const probe = new DatabaseSync(stagedDb, { readOnly: true });
    try {
      const quick = probe.prepare('PRAGMA quick_check').get()?.quick_check;
      if (quick !== 'ok') throw new Error(`the staged database failed its integrity check (${quick})`);
    } finally {
      probe.close();
    }
    fs.mkdirSync(stagedAttachments, { recursive: true });
    const backupAttachments = path.join(backupPath, ATTACHMENT_DIRECTORY);
    if (isDirectory(backupAttachments)) {
      for (const file of listAttachmentFiles(backupAttachments)) {
        const rel = file.rel.replace(/\\/g, '/');
        const out = path.join(stagedAttachments, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(file.full, out);
      }
    }
    fault('stage-attachments');
  } catch (error) {
    removePath(stagedDb);
    removeJournal(stagedDb);
    removePath(stagedAttachments);
    return { ok: false, error: `Restore could not be prepared (${error.message}). Your workspace was not changed.`, safetyBackup: safety?.path || null };
  }

  // 2) Swap by rename, reopen, verify; roll back on any failure.
  let swappedDb = false;
  let swappedAttachments = false;
  try {
    ws.close();
    removeJournal(ws.dbPath);
    fs.renameSync(ws.dbPath, rollbackDb);
    swappedDb = true;
    if (fs.existsSync(ws.attachmentDirectory)) fs.renameSync(ws.attachmentDirectory, rollbackAttachments);
    swappedAttachments = true;
    fs.renameSync(stagedDb, ws.dbPath);
    fs.renameSync(stagedAttachments, ws.attachmentDirectory);
    fault('swap');
    ws.open();
    fault('reopen');
    const post = ws.quickCheck();
    const fk = ws.query('PRAGMA foreign_key_check');
    if (!post.ok || fk.length) throw new Error(`post-restore verification failed (${post.integrity}, ${fk.length} foreign-key violation(s))`);
    ws.setMeta('lastRestoreAt', new Date().toISOString());
    ws.setMeta('restoredFrom', backupPath);
    removePath(rollbackDb);
    removePath(rollbackAttachments);
    return { ok: true, restoredFrom: backupPath, manifest, recordCounts: ws.recordCounts(), integrity: post, safetyBackup: safety?.path || null, migrations: ws.appliedMigrations || [] };
  } catch (error) {
    try { ws.close({ checkpoint: false }); } catch { /* not open */ }
    let rolledBack = true;
    try {
      if (swappedDb) {
        removePath(ws.dbPath);
        removeJournal(ws.dbPath);
        fs.renameSync(rollbackDb, ws.dbPath);
      }
      if (swappedAttachments) {
        removePath(ws.attachmentDirectory);
        if (fs.existsSync(rollbackAttachments)) fs.renameSync(rollbackAttachments, ws.attachmentDirectory);
        else fs.mkdirSync(ws.attachmentDirectory, { recursive: true });
      }
    } catch {
      rolledBack = false;
    }
    removePath(stagedDb);
    removeJournal(stagedDb);
    removePath(stagedAttachments);
    try { ws.open(); } catch { rolledBack = false; }
    return {
      ok: false,
      rolledBack,
      error: rolledBack
        ? `Restore failed (${error.message}) and was rolled back automatically. Your workspace is unchanged.`
        : `Restore failed (${error.message}) and the automatic rollback did not complete. Restore the safety backup ${safety?.path || ''} from Backup & Restore.`,
      safetyBackup: safety?.path || null
    };
  }
}

/** Backup roots: the workspace backup folder plus an optional clinic-configured folder. */
export function backupRoots(ws, extraDirectory = '') {
  const roots = [path.resolve(ws.backupDirectory)];
  const extra = String(extraDirectory || '').trim();
  if (extra && path.isAbsolute(extra) && !roots.includes(path.resolve(extra))) roots.push(path.resolve(extra));
  return roots;
}

/** List backups (newest first) with size + validity summary. */
export function listBackups(ws, { extraDirectory = '' } = {}) {
  const entries = [];
  const candidates = [];
  for (const root of backupRoots(ws, extraDirectory)) {
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch { names = []; }
    for (const name of names) candidates.push({ root, name });
  }
  for (const { root, name } of candidates) {
    const full = path.join(root, name);
    if (!isDirectory(full)) continue;
    const read = readManifest(full);
    const manifest = read.ok ? read.manifest : null;
    let bytes = 0;
    try {
      for (const file of listAttachmentFiles(full)) bytes += fs.statSync(file.full).size;
      const dbFile = path.join(full, String(manifest?.dbFile || DB_FILENAME));
      if (fs.existsSync(dbFile)) bytes += fs.statSync(dbFile).size;
    } catch { /* size unknown */ }
    entries.push({
      name,
      path: full,
      root,
      kind: manifest ? (manifest.kind || inferKind(manifest.label, name)) : 'incomplete',
      createdAt: manifest?.createdAt || null,
      label: manifest?.label || '',
      appVersion: manifest?.appVersion || null,
      dbLayoutVersion: manifest?.dbLayoutVersion ?? null,
      recordCounts: manifest?.recordCounts || null,
      bytes,
      valid: read.ok
    });
  }
  entries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.name.localeCompare(a.name));
  return entries;
}

function inferKind(label = '', name = '') {
  const text = `${label} ${name}`.toLowerCase();
  if (/automatic/.test(text)) return 'automatic';
  if (/pre-restore/.test(text)) return 'safety';
  if (/pre-upgrade/.test(text)) return 'pre-upgrade';
  if (/preserved-export/.test(text)) return 'export';
  return 'manual';
}

/** Delete a backup folder by name (contained to a backup root; must be a Dentiva backup). */
export function deleteBackup(ws, name, { extraDirectory = '' } = {}) {
  const safeName = String(name || '');
  if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') return { ok: false, error: 'Backup not found.' };
  const root = backupRoots(ws, extraDirectory).find((candidateRoot) => isDirectory(path.join(candidateRoot, safeName)));
  if (!root) return { ok: false, error: 'Backup not found.' };
  const resolved = path.resolve(path.join(root, safeName));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) return { ok: false, error: 'Refusing to delete outside the backup directory.' };
  if (!fs.existsSync(path.join(resolved, MANIFEST_FILE)) && !fs.existsSync(path.join(resolved, DB_FILENAME))) return { ok: false, error: 'That folder is not a Dentiva backup.' };
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Delete failed: ${error.message}` };
  }
}

/**
 * Retention: keep the newest `keep` AUTOMATIC backups. Manual, safety,
 * pre-upgrade and export backups are never pruned automatically.
 */
export function pruneBackups(ws, keep = 10, { extraDirectory = '' } = {}) {
  const limit = Math.max(1, Number(keep) || 10);
  const automatic = listBackups(ws, { extraDirectory }).filter((entry) => entry.valid && entry.kind === 'automatic');
  const removed = [];
  for (const entry of automatic.slice(limit)) {
    const result = deleteBackup(ws, entry.name, { extraDirectory });
    if (result.ok) removed.push(entry.name);
  }
  return { ok: true, removed };
}

/* ------------------------------------------------------------------ */
/* v1.3.0-compatible JSON backups: full or module-grouped restore with */
/* explicit strategies (Keep Existing / Replace / Create New Copy).    */
/* ------------------------------------------------------------------ */

import { migrateState } from '../../src/migrate-state.js';
import { ARRAY_COLLECTIONS, buildRestorePlan, applyRestorePlan, validateRelationships } from '../../src/core.js';

/**
 * Parse an exported JSON backup (v1.3.0 `exportBackup` shape or the v1.4.0
 * LocalApi export) into a normalized state object. Throws on invalid input.
 */
export function parseBackupJson(text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { throw new Error('The backup file is not valid JSON.'); }
  const root = parsed && typeof parsed === 'object' ? parsed : null;
  if (!root) throw new Error('The backup file is empty.');
  const rawState = root.state && typeof root.state === 'object' ? root.state : root;
  if (!rawState || typeof rawState !== 'object') throw new Error('The backup file does not contain a Dentiva state payload.');
  if (Array.isArray(rawState.patients) && rawState.patients.length === 0 && !rawState.schemaVersion && !rawState.settings) {
    // allow genuinely empty backups
  }
  const state = migrateState(rawState);
  if (!Array.isArray(state.audit)) state.audit = [];
  return { state, attachments: root.attachments && typeof root.attachments === 'object' ? root.attachments : null, manifest: root.manifest || null };
}

/**
 * Restore a parsed JSON backup into the live store.
 * - No `modules`: whole-workspace replace (settings + all collections), then
 *   re-externalize attachment bytes.
 * - With `modules`: module-grouped restore using the shared plan/apply
 *   functions with the caller's strategy and optional patient scoping.
 */
const JSON_RESTORE_TABLES = {
  patients: 'patients', appointments: 'appointments', visits: 'visits', prescriptions: 'prescriptions', dentalRecords: 'dental_records',
  treatmentPlans: 'treatment_plans', invoices: 'invoices', payments: 'payments', paymentAdjustments: 'payment_adjustments', expenses: 'expenses',
  inventory: 'inventory', stockMovements: 'stock_movements', suppliers: 'suppliers', staff: 'staff', referrals: 'referrals',
  attachments: 'attachments', followUpTasks: 'follow_up_tasks', audit: 'audit', notifications: 'notifications', users: 'users',
  medicationCatalog: 'medication_catalog', notificationRules: 'notification_rules', rooms: 'rooms', savedFilters: 'saved_filters',
  savedReports: 'saved_reports', treatments: 'treatments'
};
// Parents before children for inserts; the reverse for deletes.
const JSON_WRITE_ORDER = ['staff', 'suppliers', 'rooms', 'notificationRules', 'medicationCatalog', 'savedFilters', 'savedReports', 'treatments',
  'patients', 'appointments', 'visits', 'prescriptions', 'dentalRecords', 'treatmentPlans', 'invoices', 'payments', 'paymentAdjustments',
  'expenses', 'inventory', 'stockMovements', 'referrals', 'attachments', 'followUpTasks', 'notifications', 'audit'];

/**
 * Restore a parsed JSON backup (v1.3.x export format) into the live store.
 * - No `modules`: whole-workspace replace of practice data.
 * - With `modules`: module-grouped restore with the caller's strategy.
 * Local accounts and their PINs are NEVER replaced from a JSON file: accounts
 * missing locally are added without a PIN (an Administrator assigns one).
 * Everything runs in one transaction — a failure leaves the store unchanged.
 */
export function restoreJsonBackup(ws, parsed, { modules = null, strategy = 'Replace', patientIds = null } = {}) {
  const { state: incoming, attachments } = parsed;
  if (!incoming) throw new Error('Backup state is missing.');
  const relationshipErrors = validateRelationships(incoming);
  if (relationshipErrors.length) throw new Error(`The backup has inconsistent records: ${relationshipErrors.slice(0, 3).join(' ')}`);

  const current = {};
  for (const collection of ARRAY_COLLECTIONS) {
    const table = JSON_RESTORE_TABLES[collection];
    current[collection] = table ? ws.query(`SELECT * FROM ${table}`).map((row) => rowToRecord(row)).filter(Boolean) : [];
  }
  const meta = ws.getAllMeta();
  for (const key of ['settings', 'counters', 'dashboard', 'navigation', 'notificationRead', 'setupComplete']) {
    if (meta[key] !== undefined) current[key] = meta[key];
  }

  let resultState;
  let mode;
  if (Array.isArray(modules) && modules.length) {
    const plan = buildRestorePlan(current, incoming, { modules, strategy, patientIds: Array.isArray(patientIds) ? patientIds : null });
    resultState = applyRestorePlan(current, plan).state;
    mode = 'modules';
  } else {
    resultState = { ...current };
    for (const collection of ARRAY_COLLECTIONS) if (Array.isArray(incoming[collection])) resultState[collection] = incoming[collection];
    for (const key of ['settings', 'counters']) if (incoming[key] && typeof incoming[key] === 'object') resultState[key] = incoming[key];
    mode = 'full';
  }

  const existingUserIds = new Set(ws.query('SELECT id FROM users').map((row) => row.id));
  let accountsAdded = 0;
  ws.transaction(() => {
    if (mode === 'full') {
      for (const collection of [...JSON_WRITE_ORDER].reverse()) ws.run(`DELETE FROM ${JSON_RESTORE_TABLES[collection]}`);
    }
    for (const collection of JSON_WRITE_ORDER) {
      if (!(collection in resultState)) continue;
      const rows = Array.isArray(resultState[collection]) ? resultState[collection] : [];
      for (const record of rows) {
        if (!record || !record.id) continue;
        ws.upsertRecord(collection, record);
      }
    }
    // Accounts: add missing ones (no secrets); never overwrite existing accounts.
    for (const user of (Array.isArray(incoming.users) ? incoming.users : [])) {
      if (!user || !user.id || existingUserIds.has(user.id)) continue;
      const { pinHash, pinSalt, kdf, hasPin, ...safe } = user;
      ws.upsertRecord('users', { ...safe, active: safe.active !== false });
      accountsAdded += 1;
    }
    if (resultState.settings && typeof resultState.settings === 'object') {
      const settings = { ...resultState.settings };
      for (const legacy of ['language', 'applicationLock', 'pinHash', 'pinSalt']) delete settings[legacy];
      ws.setMeta('settings', settings);
    }
    if (resultState.counters && typeof resultState.counters === 'object') ws.setMeta('counters', resultState.counters);
    ws.setMeta('setupComplete', true);
    ws.setMeta('lastRestoreAt', new Date().toISOString());
    if (attachments) {
      for (const [id, entry] of Object.entries(attachments)) {
        const dataUrl = entry && typeof entry === 'string' ? entry : entry?.dataUrl;
        const match = typeof dataUrl === 'string' ? /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl) : null;
        if (!match) continue;
        const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
        const written = ws.writeAttachmentFile(id, bytes);
        if (ws.queryOne('SELECT id FROM attachments WHERE id = ?', [id])) {
          ws.run('UPDATE attachments SET file_path = ?, checksum = ?, size_bytes = ? WHERE id = ?', [written.relativePath, written.checksum, written.bytes, id]);
        }
      }
    }
  });
  return { mode, counts: ws.recordCounts(), accountsAdded };
}

import { rowToRecord } from './records.mjs';
