// Dentiva Pro — versioned relational schema migrations.
//
// The layout-1 schema in schema.mjs is the immutable baseline. Every later
// change is an ordered, idempotent migration recorded in `migration_history`
// and reflected in meta.dbLayoutVersion. Migrations run inside ONE immediate
// transaction per version: a failure rolls the database back to the exact
// previous layout (the caller also holds a pre-upgrade backup).
//
// Rules: never rewrite historical identifiers or money; keep the original value
// in the payload whenever a stored value is canonicalised; be idempotent.

import { ADULT_POSITION_TO_FDI, PRIMARY_POSITION_TO_FDI, isValidFdi } from '../../src/dental.js';

export const BASELINE_LAYOUT_VERSION = 1;

function columnExists(ws, table, column) {
  return ws.db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(ws, table, column, definition) {
  if (!columnExists(ws, table, column)) ws.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const LEGACY_FDI_SOURCES = new Set(['v4-sqlite', 'v4-bak-recovery', 'legacy-json']);

/**
 * v1.3.x stored real FDI tooth numbers; v1.4.0–v1.6.1 stored chart POSITION
 * indices (adult 1–32, primary 1–20) and only displayed FDI. Convert every row
 * to canonical FDI. Values 11–18/21–28/31–32 are ambiguous for adult teeth:
 * rows written before the v1.3→v1.4 migration are FDI, later rows are positions.
 */
export function canonicalizeDentalTeeth(ws) {
  const meta = ws.getAllMeta();
  const cutoff = LEGACY_FDI_SOURCES.has(String(meta.migratedFrom || '')) ? String(meta.migratedAt || '') : '';
  const rows = ws.db.prepare('SELECT id, patient_id, tooth, dentition, superseded, created_at, payload FROM dental_records ORDER BY created_at ASC, id ASC').all();
  if (!rows.length) return { converted: 0, superseded: 0, unmapped: 0 };
  ws.db.exec('DROP INDEX IF EXISTS dental_current_uidx');
  let converted = 0;
  let unmapped = 0;
  const update = ws.db.prepare('UPDATE dental_records SET tooth = ?, payload = ? WHERE id = ?');
  const flag = ws.db.prepare('UPDATE dental_records SET payload = ? WHERE id = ?');
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload); } catch { payload = {}; }
    if (payload && payload.toothSystem === 'FDI') continue; // already canonical (idempotent)
    const dentition = row.dentition === 'primary' ? 'primary' : 'adult';
    const tooth = Number(row.tooth);
    let fdi = null;
    if (dentition === 'primary') {
      if (isValidFdi(tooth, 'primary')) fdi = tooth;
      else if (tooth >= 1 && tooth <= 20) fdi = PRIMARY_POSITION_TO_FDI[tooth - 1];
    } else {
      const validFdi = isValidFdi(tooth, 'adult');
      if (tooth >= 1 && tooth <= 32 && !validFdi) fdi = ADULT_POSITION_TO_FDI[tooth - 1];
      else if (validFdi && tooth > 32) fdi = tooth;
      else if (validFdi) {
        const legacy = cutoff && (!row.created_at || String(row.created_at) <= cutoff);
        fdi = legacy ? tooth : ADULT_POSITION_TO_FDI[tooth - 1];
      }
    }
    if (!fdi) {
      unmapped += 1;
      flag.run(JSON.stringify({ ...payload, toothSystem: 'unmapped', legacyTooth: row.tooth }), row.id);
      continue;
    }
    const next = { ...payload, tooth: fdi, toothSystem: 'FDI' };
    if (fdi !== tooth) { next.legacyTooth = tooth; converted += 1; }
    update.run(fdi, JSON.stringify(next), row.id);
  }
  // Canonicalisation may make two rows "current" for the same tooth: keep the
  // newest current record and supersede older ones (history is preserved).
  const duplicates = ws.db.prepare(`SELECT patient_id, tooth, dentition FROM dental_records WHERE superseded = 0
    GROUP BY patient_id, tooth, dentition HAVING COUNT(*) > 1`).all();
  let superseded = 0;
  for (const dup of duplicates) {
    const current = ws.db.prepare('SELECT id, payload FROM dental_records WHERE patient_id = ? AND tooth = ? AND dentition = ? AND superseded = 0 ORDER BY created_at DESC, id DESC')
      .all(dup.patient_id, dup.tooth, dup.dentition);
    for (const older of current.slice(1)) {
      let payload;
      try { payload = JSON.parse(older.payload); } catch { payload = {}; }
      ws.db.prepare('UPDATE dental_records SET superseded = 1, payload = ? WHERE id = ?').run(JSON.stringify({ ...payload, superseded: true, supersededReason: 'fdi-canonicalisation' }), older.id);
      superseded += 1;
    }
  }
  ws.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS dental_current_uidx ON dental_records(patient_id, tooth, dentition) WHERE superseded = 0');
  return { converted, superseded, unmapped };
}

function cleanSettings(ws) {
  const settings = ws.getMeta('settings', null);
  if (!settings || typeof settings !== 'object') return { cleaned: [] };
  const removed = [];
  for (const key of ['language', 'applicationLock', 'pinHash', 'pinSalt']) {
    if (key in settings) { delete settings[key]; removed.push(key); }
  }
  ws.setMeta('settings', settings);
  return { cleaned: removed };
}

export const MIGRATIONS = [
  {
    version: 2,
    name: 'v2.0.0-foundation',
    up(ws) {
      addColumn(ws, 'users', 'lockout_count', 'INTEGER NOT NULL DEFAULT 0');
      ws.db.exec('CREATE INDEX IF NOT EXISTS audit_entity_id_idx ON audit(entity_id)');
      ws.db.exec('CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at)');
      ws.db.exec('CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at)');
      const dental = canonicalizeDentalTeeth(ws);
      const settings = cleanSettings(ws);
      return { dental, settings };
    }
  }
];

export const LATEST_LAYOUT_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), BASELINE_LAYOUT_VERSION);

export function currentLayoutVersion(ws) {
  const value = Number(ws.getMeta('dbLayoutVersion', BASELINE_LAYOUT_VERSION));
  return Number.isInteger(value) ? value : BASELINE_LAYOUT_VERSION;
}

export function pendingMigrations(ws) {
  const current = currentLayoutVersion(ws);
  return MIGRATIONS.filter((migration) => migration.version > current).sort((a, b) => a.version - b.version);
}

/** Apply every pending migration, each in its own transaction. */
export function applyMigrations(ws, { log = () => {} } = {}) {
  const applied = [];
  for (const migration of pendingMigrations(ws)) {
    const started = Date.now();
    const details = ws.transaction(() => {
      const outcome = migration.up(ws) || {};
      ws.db.prepare('INSERT OR REPLACE INTO migration_history (version, name, applied_at, duration_ms, details) VALUES (?, ?, ?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString(), Date.now() - started, JSON.stringify(outcome));
      ws.setMeta('dbLayoutVersion', migration.version);
      return outcome;
    });
    applied.push({ version: migration.version, name: migration.name, details });
    log(`schema migration ${migration.version} (${migration.name}) applied in ${Date.now() - started}ms`);
  }
  return applied;
}
