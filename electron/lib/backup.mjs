// Dentiva Pro v1.4.0 — backup / restore engine.
//
// A backup is a portable folder: a consistent `VACUUM INTO` snapshot of the
// SQLite store (WAL-safe, no lock needed), a copy of every attachment file and
// a `manifest.json` carrying versions, record counts and SHA-256 checksums so
// any backup can be validated before it is trusted. Restore is fail-fast:
// the backup is fully validated, a safety backup of the current workspace is
// taken, only then are the files swapped — so a failed restore always leaves a
// known-good backup on disk. No size or count limits anywhere (§6–§8).

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
export function createBackup(ws, { label = '', createdBy = '' } = {}) {
  try {
    const name = `${timestampName()}${safeLabel(label) ? `-${safeLabel(label)}` : ''}`;
    const target = path.join(ws.backupDirectory, name);
    if (fs.existsSync(target)) return { ok: false, error: 'A backup with this name already exists.' };
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
    fs.writeFileSync(path.join(target, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    ws.setMeta('lastBackupAt', manifest.createdAt);
    return { ok: true, path: target, manifest };
  } catch (error) {
    return { ok: false, error: `Backup failed: ${error.message}` };
  }
}

/** Restore a validated backup into the workspace. The workspace is reopened. */
export function restoreBackup(ws, backupPath, { autoSafetyBackup = true } = {}) {
  const validation = validateBackup(backupPath);
  if (!validation.ok) {
    return { ok: false, error: 'Backup validation failed.', problems: validation.problems };
  }
  const manifest = validation.manifest;

  // Safety net: snapshot the current state before swapping anything out.
  if (autoSafetyBackup) {
    const safety = createBackup(ws, { label: `pre-restore-${Date.now()}` });
    if (!safety.ok) return { ok: false, error: `Could not create the pre-restore safety backup: ${safety.error}` };
  }

  try {
    ws.close();
    const backupDb = path.join(backupPath, String(manifest.dbFile || DB_FILENAME));
    // Remove stale journal files, then swap the database in.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { fs.rmSync(ws.dbPath + suffix, { force: true }); } catch { /* absent */ }
    }
    fs.copyFileSync(backupDb, ws.dbPath);

    // Replace the attachment store with the backup's set (lossless for the user:
    // the previous files are inside the pre-restore safety backup).
    fs.rmSync(ws.attachmentDirectory, { recursive: true, force: true });
    fs.mkdirSync(ws.attachmentDirectory, { recursive: true });
    const backupAttachments = path.join(backupPath, ATTACHMENT_DIRECTORY);
    if (isDirectory(backupAttachments)) {
      for (const file of listAttachmentFiles(backupAttachments)) {
        const rel = file.rel.replace(/\\/g, '/');
        const out = path.join(ws.attachmentDirectory, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(file.full, out);
      }
    }

    ws.open();
    const post = ws.integrityCheck();
    if (!post.ok) {
      return {
        ok: false,
        error: 'Restore completed but post-restore integrity failed.',
        integrity: post,
        hint: `A pre-restore safety backup was created before the swap; use it to roll back.`
      };
    }
    ws.setMeta('lastRestoreAt', new Date().toISOString());
    ws.setMeta('restoredFrom', backupPath);
    return { ok: true, restoredFrom: backupPath, manifest, recordCounts: ws.recordCounts(), integrity: post };
  } catch (error) {
    // Reopen what we can so the workspace is usable again even after a failure.
    try { ws.open(); } catch { /* left closed; next launch migrates fresh */ }
    return {
      ok: false,
      error: `Restore failed: ${error.message}`,
      hint: 'A pre-restore safety backup was created before the swap; use it to roll back.'
    };
  }
}

/** List backups (newest first) with size + validity summary. */
export function listBackups(ws) {
  const entries = [];
  let names = [];
  try { names = fs.readdirSync(ws.backupDirectory, { withFileTypes: true }).map((entry) => entry.name); } catch { names = []; }
  for (const name of names) {
    const full = path.join(ws.backupDirectory, name);
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

/** Delete a backup by name (contained to the workspace backup directory). */
export function deleteBackup(ws, name) {
  const candidate = path.join(ws.backupDirectory, String(name || ''));
  if (!isDirectory(candidate)) return { ok: false, error: 'Backup not found.' };
  const resolved = path.resolve(candidate);
  const root = path.resolve(ws.backupDirectory);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return { ok: false, error: 'Refusing to delete outside the backup directory.' };
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Delete failed: ${error.message}` };
  }
}

/** Keep the newest `keep` backups, remove older ones. Returns removed names. */
export function pruneBackups(ws, keep = 10) {
  const limit = Math.max(1, Number(keep) || 10);
  const all = listBackups(ws);
  const removed = [];
  for (const entry of all.slice(limit)) {
    const result = deleteBackup(ws, entry.name);
    if (result.ok) removed.push(entry.name);
  }
  return { ok: true, removed };
}
