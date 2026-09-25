// Workspace database manager built on Node's built-in SQLite (node:sqlite).
// Zero native dependencies: identical engine in local Node tests, Electron main on
// Windows and CI. Writes run in (re-entrant) transactions; reads are paginated by
// their callers; no database-size or record-count limit exists in this module.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL, COLLECTION_TABLES } from './schema.mjs';
import { applyMigrations, BASELINE_LAYOUT_VERSION } from './schema-migrations.mjs';
import { mapRecord, rowToRecord, tableFor } from './records.mjs';
import { META_KEYS } from '../../src/migrate-state.js';

export const DB_FILENAME = 'dentiva-pro.sqlite';
export const V4_PRESERVED_SUFFIX = '.v4-preserved.sqlite';
export const LEGACY_FILENAME = 'dentiva-pro-store.json';
export const ATTACHMENT_DIRECTORY = 'attachments';
export const BACKUP_DIRECTORY = 'backups';
export const LOG_DIRECTORY = 'logs';

export function sanitizeIdComponent(value, fallback = 'record') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || fallback;
}

/** Bind-safe parameter coercion for node:sqlite (no undefined/boolean/NaN bindings). */
function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  return String(value);
}

export class Workspace {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.dbPath = path.join(this.directory, DB_FILENAME);
    this.attachmentDirectory = path.join(this.directory, ATTACHMENT_DIRECTORY);
    this.backupDirectory = path.join(this.directory, BACKUP_DIRECTORY);
    this.logDirectory = path.join(this.directory, LOG_DIRECTORY);
    this.db = null;
    this.source = 'none';
    this.readOnly = false;
    this.txDepth = 0;
    this.appliedMigrations = [];
  }

  open({ readOnly = false, migrate = true } = {}) {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(this.attachmentDirectory, { recursive: true });
    fs.mkdirSync(this.backupDirectory, { recursive: true });
    fs.mkdirSync(this.logDirectory, { recursive: true });
    this.readOnly = readOnly;
    this.db = readOnly ? new DatabaseSync(this.dbPath, { readOnly: true }) : new DatabaseSync(this.dbPath);
    this.txDepth = 0;
    if (!readOnly) {
      // Never stamp the v5 schema onto a file that holds a different layout
      // (legacy v4 blob store, foreign SQLite file): that would make the old
      // data invisible to every later migration attempt.
      const tables = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      const foreign = tables.size > 0 && !(tables.has('patients') && tables.has('meta'));
      if (foreign) {
        this.db.close();
        this.db = null;
        const error = new Error('The workspace database has an unrecognised or legacy layout and was not modified.');
        error.code = 'foreign-layout';
        throw error;
      }
      this.db.exec(SCHEMA_SQL);
      this.#setMetaOnce('dbLayoutVersion', String(BASELINE_LAYOUT_VERSION));
      this.appliedMigrations = migrate ? applyMigrations(this) : [];
    } else {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    }
    this.source = 'sqlite';
    return this;
  }

  #setMetaOnce(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(key, value);
  }

  close({ checkpoint = true } = {}) {
    if (!this.db) return;
    try {
      if (checkpoint && !this.readOnly) {
        this.db.exec('PRAGMA optimize');
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }
    } catch { /* best effort */ }
    try { this.db.close(); } catch { /* already closed */ }
    this.db = null;
  }

  // ---- meta -------------------------------------------------------------

  getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value ?? null));
  }

  getAllMeta() {
    const meta = {};
    for (const row of this.db.prepare('SELECT key, value FROM meta').all()) {
      try { meta[row.key] = JSON.parse(row.value); } catch { meta[row.key] = row.value; }
    }
    return meta;
  }

  // ---- detection ----------------------------------------------------------

  /** Inspect an existing database file and classify its layout. */
  static detectLayout(dbPath) {
    if (!fs.existsSync(dbPath)) return 'missing';
    // An open failure can be TRANSIENT (SQLITE_BUSY from a winding-down prior
    // instance, antivirus scan windows, OS file-flush delay after a force-kill).
    // "corrupt" must only be declared after the lock has had time to clear —
    // a false positive here renames a healthy database and renders a fresh
    // empty workspace, which is a silent-data-invisibility disaster.
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const probe = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const tables = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
          if (tables.has('patients') && tables.has('meta')) return 'v5';
          if (tables.has('records') && tables.has('metadata')) return 'v4-blob';
          return tables.size ? 'unknown-tables' : 'empty';
        } finally {
          probe.close();
        }
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        const transient = /busy|locked|being used|access|denied|EACCES|EPERM|share/i.test(message);
        if (!transient) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 + attempt * 250);
      }
    }
    if (lastError) console.error(`detectLayout: probe failed after retries (${String(lastError?.message || lastError)})`);
    return 'corrupt';
  }

  /** Read a v4 sql.js-generated database (standard SQLite file) into a raw state object. */
  static readV4State(dbPath) {
    const probe = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const state = {};
      for (const row of probe.prepare('SELECT key, value FROM metadata').all()) {
        try { state[row.key] = JSON.parse(row.value); } catch { state[row.key] = row.value; }
      }
      for (const row of probe.prepare('SELECT collection, record_id, payload FROM records ORDER BY collection, rowid').all()) {
        if (!Array.isArray(state[row.collection])) state[row.collection] = [];
        try { state[row.collection].push(JSON.parse(row.payload)); } catch { /* unreadable payload is quarantined later */ }
      }
      return state;
    } finally {
      probe.close();
    }
  }

  /** Read a v5 relational database (e.g. a recovered backup) back into a plain state object. */
  static readV5State(dbPath) {
    const probe = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const state = {};
      for (const row of probe.prepare('SELECT key, value FROM meta').all()) {
        try { state[row.key] = JSON.parse(row.value); } catch { state[row.key] = row.value; }
      }
      for (const [collection, table] of Object.entries(COLLECTION_TABLES)) {
        try {
          const rows = probe.prepare(`SELECT * FROM ${table}`).all();
          state[collection] = rows.map((row) => rowToRecord(row)).filter(Boolean);
        } catch {
          state[collection] = [];
        }
      }
      return state;
    } finally {
      probe.close();
    }
  }

  static readLegacyJson(jsonPath) {
    if (!fs.existsSync(jsonPath)) return null;
    try {
      const text = fs.readFileSync(jsonPath, 'utf8');
      if (!text.trim()) return null;
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Run `fn` atomically. Re-entrant: a nested call becomes a SAVEPOINT, so an
   * inner failure rolls back only the inner unit while the outer transaction
   * decides the final outcome.
   */
  transaction(fn) {
    if (this.readOnly) throw new Error('Workspace database is read-only.');
    if (this.txDepth > 0) {
      const name = `sp_${this.txDepth}`;
      this.db.exec(`SAVEPOINT ${name}`);
      this.txDepth += 1;
      try {
        const result = fn(this);
        this.db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        try { this.db.exec(`ROLLBACK TO ${name}`); this.db.exec(`RELEASE ${name}`); } catch { /* best effort */ }
        throw error;
      } finally {
        this.txDepth -= 1;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* best effort */ }
      throw error;
    } finally {
      this.txDepth = 0;
    }
  }

  upsertRecord(collection, record, extra = {}) {
    const row = mapRecord(collection, record, extra);
    const columns = Object.keys(row);
    const table = tableFor(collection);
    // Authentication secrets/state are owned exclusively by setUserSecrets():
    // a generic upsert of a (sanitized) user record must never touch them.
    const protectedColumns = collection === 'users' ? AUTH_COLUMNS : null;
    const updatable = columns.filter((c) => c !== 'id' && c !== 'seq' && !(protectedColumns && protectedColumns.has(c)));
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}`;
    this.db.prepare(sql).run(...columns.map((c) => bind(row[c])));
    return record;
  }

  deleteRecord(collection, id) {
    this.db.prepare(`DELETE FROM ${tableFor(collection)} WHERE id = ?`).run(bind(id));
  }

  getRecord(collection, id) {
    const row = this.db.prepare(`SELECT * FROM ${tableFor(collection)} WHERE id = ?`).get(bind(id));
    return row ? rowToRecord(row) : null;
  }

  /**
   * Paginated list. `where` is a raw SQL fragment with `?` placeholders; params are
   * bound positionally. Records are returned from their payloads (canonical shape).
   */
  listRecords(collection, { where = '', params = [], order = '', limit = 50, offset = 0 } = {}) {
    const table = tableFor(collection);
    const whereSql = where ? `WHERE ${where}` : '';
    const orderSql = order ? `ORDER BY ${order}` : '';
    const rows = this.db.prepare(`SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
      .all(...params.map(bind), Math.max(1, int(limit, 50)), Math.max(0, int(offset, 0)));
    return rows.map(rowToRecord).filter(Boolean);
  }

  countRecords(collection, { where = '', params = [] } = {}) {
    const table = tableFor(collection);
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${where ? `WHERE ${where}` : ''}`).get(...params.map(bind));
    return Number(row?.total ?? 0);
  }

  query(sql, params = []) {
    return this.db.prepare(sql).all(...params.map(bind));
  }

  queryOne(sql, params = []) {
    return this.db.prepare(sql).get(...params.map(bind)) ?? null;
  }

  run(sql, params = []) {
    if (this.readOnly) throw new Error('Workspace database is read-only.');
    return this.db.prepare(sql).run(...params.map(bind));
  }

  exec(sql) {
    if (this.readOnly) throw new Error('Workspace database is read-only.');
    this.db.exec(sql);
  }

  quarantine(collection, recordId, reason, payload) {
    this.db.prepare('INSERT INTO quarantine (collection, record_id, reason, payload, quarantined_at) VALUES (?, ?, ?, ?, ?)')
      .run(bind(collection), bind(recordId), bind(reason), bind(JSON.stringify(payload ?? null)), bind(new Date().toISOString()));
  }

  // ---- health & diagnostics ------------------------------------------------

  /** Fast structural check (O(pages), no index cross-checks) for routine health probes. */
  quickCheck() {
    const quick = this.db.prepare('PRAGMA quick_check').get();
    return { ok: quick?.quick_check === 'ok', integrity: quick?.quick_check ?? 'unknown', mode: 'quick' };
  }

  /** Full integrity + foreign-key audit. Expensive on large stores — explicit diagnostics only. */
  integrityCheck() {
    const integrity = this.db.prepare('PRAGMA integrity_check').get();
    const fkViolations = this.db.prepare('PRAGMA foreign_key_check').all();
    return {
      ok: integrity?.integrity_check === 'ok' && fkViolations.length === 0,
      integrity: integrity?.integrity_check ?? 'unknown',
      foreignKeyViolations: fkViolations.slice(0, 50).map((row) => ({ table: row.table, rowid: Number(row.rowid), references: row.parent, fkid: Number(row.fkid) })),
      foreignKeyViolationCount: fkViolations.length,
      mode: 'full'
    };
  }

  recordCounts() {
    const counts = {};
    for (const [collection, table] of Object.entries(COLLECTION_TABLES)) {
      counts[collection] = Number(this.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total ?? 0);
    }
    return counts;
  }

  storageInfo({ includeCounts = true } = {}) {
    const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()?.page_size ?? 4096);
    const pageCount = Number(this.db.prepare('PRAGMA page_count').get()?.page_count ?? 0);
    const journalMode = String(this.db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '');
    let attachmentBytes = 0;
    let attachmentFiles = 0;
    try {
      for (const entry of fs.readdirSync(this.attachmentDirectory)) {
        const stat = fs.statSync(path.join(this.attachmentDirectory, entry));
        if (stat.isFile()) { attachmentBytes += stat.size; attachmentFiles += 1; }
      }
    } catch { /* no attachment directory yet */ }
    return {
      path: this.dbPath,
      bytes: sizeOf(this.dbPath),
      walBytes: sizeOf(`${this.dbPath}-wal`),
      pageSize,
      pageCount,
      journalMode,
      backupPath: this.backupDirectory,
      attachmentDirectory: this.attachmentDirectory,
      attachmentBytes,
      attachmentFiles,
      storage: `SQLite (layout v${Number(this.getMeta('dbLayoutVersion', BASELINE_LAYOUT_VERSION))})`,
      source: this.source,
      readOnly: this.readOnly,
      recordCounts: includeCounts ? this.recordCounts() : null
    };
  }

  freeDiskBytes() {
    try {
      const stats = fs.statfsSync(this.directory);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }

  /** Reclaim free pages. Safe online operation; WAL keeps readers consistent. */
  vacuum() {
    if (this.readOnly) throw new Error('Workspace database is read-only.');
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
  }

  checkpoint() {
    if (this.readOnly) return null;
    return this.db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
  }

  // ---- attachments on disk ---------------------------------------------------

  attachmentPathFor(attachmentId) {
    return path.join(this.attachmentDirectory, `${sanitizeIdComponent(attachmentId, 'attachment')}.bin`);
  }

  /** Atomically persist attachment bytes; returns relative path + sha256 checksum. */
  writeAttachmentFile(attachmentId, buffer) {
    const target = this.attachmentPathFor(attachmentId);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temp, 'w');
    try {
      fs.writeFileSync(descriptor, buffer);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temp, target);
    return {
      relativePath: path.join(ATTACHMENT_DIRECTORY, path.basename(target)),
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.byteLength
    };
  }

  readAttachmentFile(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath) return null;
    const root = this.attachmentDirectory;
    const candidate = path.resolve(this.directory, relativePath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null; // path containment
    try {
      return fs.readFileSync(candidate);
    } catch {
      return null;
    }
  }

  removeAttachmentFile(relativePath) {
    const bufferRoot = this.attachmentDirectory;
    const candidate = path.resolve(this.directory, relativePath || '');
    if (!candidate.startsWith(`${bufferRoot}${path.sep}`)) return false;
    try { fs.rmSync(candidate, { force: true }); return true; } catch { return false; }
  }

  /** Delete attachment files no longer referenced by the attachments table. */
  cleanupOrphanAttachmentFiles() {
    const referenced = new Set(this.db.prepare('SELECT file_path FROM attachments').all()
      .map((row) => row.file_path)
      .filter(Boolean)
      .map((rel) => path.resolve(this.directory, rel)));
    let removed = 0;
    try {
      for (const entry of fs.readdirSync(this.attachmentDirectory)) {
        const filePath = path.resolve(this.attachmentDirectory, entry);
        if (fs.statSync(filePath).isFile() && filePath.endsWith('.bin') && !referenced.has(filePath)) {
          fs.rmSync(filePath, { force: true });
          removed += 1;
        }
      }
    } catch { /* nothing to clean */ }
    return removed;
  }
}

const AUTH_COLUMNS = new Set(['pin_hash', 'pin_salt', 'kdf', 'failed_attempts', 'locked_until', 'last_login', 'lockout_count']);

function int(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export { COLLECTION_TABLES, META_KEYS };
