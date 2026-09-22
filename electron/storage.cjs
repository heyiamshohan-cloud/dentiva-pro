const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const MAX_STORE_BYTES = 200 * 1024 * 1024;
const DB_FILENAME = 'dentiva-pro.sqlite';
const DB_BACKUP_FILENAME = 'dentiva-pro.sqlite.bak';
const LEGACY_FILENAME = 'dentiva-pro-store.json';
const ATTACHMENT_DIRECTORY = 'attachments';

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Dentiva Pro legacy store read failed', error.message);
    return null;
  }
}

function fsyncWrite(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, 'w');
  try {
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return temporaryPath;
}

function safeAttachmentPath(directory, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) return null;
  const root = path.resolve(directory, ATTACHMENT_DIRECTORY);
  const candidate = path.resolve(directory, relativePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function createSchema(db) {
  db.run(`
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (collection, record_id)
    );
    CREATE INDEX IF NOT EXISTS records_collection_idx ON records(collection);
  `);
}

function integrityOk(SQL, bytes) {
  try {
    const checkDb = new SQL.Database(bytes);
    const result = checkDb.exec('PRAGMA integrity_check');
    checkDb.close();
    return result?.[0]?.values?.[0]?.[0] === 'ok';
  } catch (error) {
    return false;
  }
}

function hydrateAttachments(state, directory) {
  if (!Array.isArray(state.attachments)) return state;
  state.attachments = state.attachments.map((attachment) => {
    if (!attachment?.filePath || attachment.data) return attachment;
    const filePath = safeAttachmentPath(directory, attachment.filePath);
    if (!filePath || !fs.existsSync(filePath)) return attachment;
    try {
      const data = fs.readFileSync(filePath).toString('base64');
      return { ...attachment, data: `data:${attachment.type || 'application/octet-stream'};base64,${data}` };
    } catch (error) {
      console.error('Dentiva Pro attachment read failed', error.message);
      return attachment;
    }
  });
  return state;
}

function prepareAttachments(payload, directory) {
  const state = JSON.parse(JSON.stringify(payload));
  const attachmentDirectory = path.join(directory, ATTACHMENT_DIRECTORY);
  fs.mkdirSync(attachmentDirectory, { recursive: true });
  const referenced = new Set();
  if (!Array.isArray(state.attachments)) return { state, referenced };
  state.attachments = state.attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object') return attachment;
    const next = { ...attachment };
    const safeId = String(next.id || `attachment_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeId}.bin`;
    const relativePath = path.join(ATTACHMENT_DIRECTORY, fileName);
    const filePath = safeAttachmentPath(directory, relativePath);
    if (filePath && typeof next.data === 'string' && /^data:[^;]+;base64,[A-Za-z0-9+/=\s]+$/i.test(next.data)) {
      const encoded = next.data.slice(next.data.indexOf(',') + 1).replace(/\s/g, '');
      const temporaryPath = fsyncWrite(filePath, Buffer.from(encoded, 'base64'));
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporaryPath, filePath);
      next.filePath = relativePath;
      next.data = '';
    }
    if (next.filePath && safeAttachmentPath(directory, next.filePath)) referenced.add(path.resolve(directory, next.filePath));
    return next;
  });
  return { state, referenced };
}

function cleanupAttachments(directory, referenced) {
  const attachmentDirectory = path.join(directory, ATTACHMENT_DIRECTORY);
  if (!fs.existsSync(attachmentDirectory)) return;
  for (const entry of fs.readdirSync(attachmentDirectory)) {
    const filePath = path.resolve(attachmentDirectory, entry);
    if (fs.statSync(filePath).isFile() && !referenced.has(filePath)) fs.rmSync(filePath, { force: true });
  }
}

function loadDatabase(SQL, filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const bytes = fs.readFileSync(filePath);
    if (!integrityOk(SQL, bytes)) return null;
    const db = new SQL.Database(bytes);
    createSchema(db);
    return db;
  } catch (error) {
    console.error('Dentiva Pro SQLite read failed', error.message);
    return null;
  }
}

function decodeState(db, directory) {
  const state = {};
  const metadata = db.exec('SELECT key, value FROM metadata');
  for (const [key, value] of metadata?.[0]?.values || []) {
    try { state[key] = JSON.parse(value); } catch { state[key] = value; }
  }
  const rows = db.exec('SELECT collection, record_id, payload FROM records ORDER BY collection, rowid');
  for (const [collection, recordId, payload] of rows?.[0]?.values || []) {
    if (!Array.isArray(state[collection])) state[collection] = [];
    try { state[collection].push(JSON.parse(payload)); } catch (error) { console.error(`Dentiva Pro record decode failed for ${collection}:${recordId}`, error.message); }
  }
  return hydrateAttachments(state, directory);
}

function encodeState(SQL, payload, directory) {
  const prepared = prepareAttachments(payload, directory);
  const db = new SQL.Database();
  createSchema(db);
  db.run('BEGIN TRANSACTION');
  try {
    const metadataStatement = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    const recordStatement = db.prepare('INSERT INTO records (collection, record_id, payload) VALUES (?, ?, ?)');
    for (const [key, value] of Object.entries(prepared.state)) {
      if (Array.isArray(value)) {
        value.forEach((record, index) => {
          const id = String(record?.id || `${key}_${index}`);
          recordStatement.run([key, id, JSON.stringify(record)]);
        });
      } else {
        metadataStatement.run([key, JSON.stringify(value)]);
      }
    }
    metadataStatement.free();
    recordStatement.free();
    db.run('COMMIT');
    return { db, referenced: prepared.referenced };
  } catch (error) {
    try { db.run('ROLLBACK'); } catch { /* best effort */ }
    db.close();
    throw error;
  }
}

async function createSQLiteStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const dbPath = path.join(directory, DB_FILENAME);
  const backupPath = path.join(directory, DB_BACKUP_FILENAME);
  const legacyPath = path.join(directory, LEGACY_FILENAME);
  const attachmentDirectory = path.join(directory, ATTACHMENT_DIRECTORY);
  const SQL = await initSqlJs({ locateFile: (fileName) => path.join(path.dirname(require.resolve('sql.js')), fileName) });
  let db = loadDatabase(SQL, dbPath);
  let source = 'sqlite';
  if (!db) {
    db = loadDatabase(SQL, backupPath);
    if (db) source = 'recovery';
  }
  if (!db) {
    db = new SQL.Database();
    createSchema(db);
    const legacySourcePath = fs.existsSync(legacyPath) ? legacyPath : `${legacyPath}.bak`;
    const legacy = readJsonFile(legacyPath) || readJsonFile(`${legacyPath}.bak`);
    if (legacy) {
      const encoded = encodeState(SQL, legacy, directory);
      db.close();
      db = encoded.db;
      source = 'legacy-json-migrated';
      const legacyMarker = `${legacyPath}.migrated`;
      try { fs.copyFileSync(legacySourcePath, legacyMarker); } catch { /* preserve best effort */ }
      const bytes = db.export();
      const temp = fsyncWrite(dbPath, Buffer.from(bytes));
      fs.renameSync(temp, dbPath);
    }
  }

  const api = {
    load() { return decodeState(db, directory); },
    save(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Store payload must be an object.' };
      const estimatedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (estimatedBytes > MAX_STORE_BYTES) return { ok: false, error: 'Local database exceeds the safe size limit. Export a backup and remove large attachments.' };
      let next;
      try { next = encodeState(SQL, payload, directory); } catch (error) { console.error('Dentiva Pro SQLite encode failed', error.message); return { ok: false, error: 'The local database could not prepare this change.' }; }
      const bytes = Buffer.from(next.db.export());
      if (bytes.byteLength > MAX_STORE_BYTES) { next.db.close(); return { ok: false, error: 'Local database exceeds the safe size limit. Export a backup and remove large attachments.' }; }
      const temporaryPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
      let stagedPath;
      try {
        stagedPath = fsyncWrite(temporaryPath, bytes);
        if (fs.existsSync(dbPath) && integrityOk(SQL, fs.readFileSync(dbPath))) {
          try { fs.copyFileSync(dbPath, backupPath); } catch (error) { console.error('Dentiva Pro SQLite backup failed', error.message); }
        }
        try {
          fs.renameSync(stagedPath, dbPath);
        } catch (renameError) {
          // POSIX rename replaces atomically. Windows may require the target to
          // be removed first; retain the verified .bak before this fallback.
          if (renameError.code !== 'EEXIST' && renameError.code !== 'EPERM') throw renameError;
          fs.rmSync(dbPath, { force: true });
          fs.renameSync(stagedPath, dbPath);
        }
        const previous = db;
        db = next.db;
        previous.close();
        cleanupAttachments(directory, next.referenced);
        source = 'sqlite';
        return { ok: true, bytes: bytes.byteLength, storage: 'sqlite' };
      } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        if (stagedPath && stagedPath !== temporaryPath) fs.rmSync(stagedPath, { force: true });
        next.db.close();
        console.error('Dentiva Pro SQLite write failed', error.message);
        return { ok: false, error: 'The local database could not be written. Your last saved copy is preserved.' };
      }
    },
    reset() {
      try {
        db.close();
        db = new SQL.Database();
        createSchema(db);
        for (const filePath of [dbPath, backupPath, legacyPath, `${legacyPath}.migrated`]) fs.rmSync(filePath, { force: true });
        fs.rmSync(attachmentDirectory, { recursive: true, force: true });
        fs.mkdirSync(attachmentDirectory, { recursive: true });
        source = 'reset';
        return { ok: true };
      } catch (error) {
        return { ok: false, error: 'The local database could not be reset.' };
      }
    },
    info() {
      let bytes = 0;
      try { bytes = fs.statSync(dbPath).size; } catch { /* empty database */ }
      return { path: dbPath, bytes, backupPath, storage: 'SQLite', source, attachmentDirectory };
    },
    close() { try { db.close(); } catch { /* already closed */ } }
  };
  return api;
}

module.exports = { createSQLiteStore, MAX_STORE_BYTES };
