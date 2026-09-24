// Dentiva Pro v1.4.0 — workspace diagnostics.
//
// Read-only health report consumed by Settings → Diagnostics, the bootstrap
// payload and crash-safety logging. Detects structural problems (integrity,
// FK violations, version skew) and reports storage facts; it never mutates
// the store.

import fs from 'node:fs';
import path from 'node:path';
import { DB_LAYOUT_VERSION } from './schema.mjs';

const LOW_DISK_BYTES = 100 * 1024 * 1024; // 100 MB warning threshold

function issue(severity, code, message) {
  return { severity, code, message };
}

export function diagnoseWorkspace(ws) {
  const checkedAt = new Date().toISOString();
  const issues = [];
  const meta = ws.getAllMeta();

  const integrity = ws.integrityCheck();
  if (integrity.integrity !== 'ok') {
    issues.push(issue('error', 'integrity', `SQLite integrity check reported: ${integrity.integrity}. Create a backup and run a restore from a healthy backup.`));
  }
  if (integrity.foreignKeyViolationCount > 0) {
    issues.push(issue('error', 'foreign-keys', `${integrity.foreignKeyViolationCount} dangling foreign-key reference(s). Review quarantine/referenced records in Settings → Diagnostics.`));
  }

  const storage = ws.storageInfo();
  if (storage.journalMode && storage.journalMode.toLowerCase() !== 'wal') {
    issues.push(issue('warning', 'journal-mode', `Journal mode is ${storage.journalMode}; WAL is expected for crash safety.`));
  }

  const layout = Number(meta.dbLayoutVersion);
  if (!Number.isInteger(layout)) {
    issues.push(issue('warning', 'layout-version', 'Database layout version is missing from meta.'));
  } else if (layout > DB_LAYOUT_VERSION) {
    issues.push(issue('error', 'layout-newer', `Database layout v${layout} is newer than this build (v${DB_LAYOUT_VERSION}); upgrade the app before editing data.`));
  }

  const schemaVersion = meta.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === null) {
    issues.push(issue('warning', 'schema-version', 'State schema version is missing from meta.'));
  }

  if (!meta.appVersion) {
    issues.push(issue('info', 'app-version', 'No app version recorded in meta (fresh or pre-v1.4.0 store).'));
  }

  const counts = ws.recordCounts();
  if (!Object.values(counts).some((count) => count > 0)) {
    issues.push(issue('info', 'empty-workspace', 'No records yet — the workspace is empty.'));
  }

  const freeDiskBytes = ws.freeDiskBytes();
  if (freeDiskBytes !== null && freeDiskBytes < LOW_DISK_BYTES) {
    issues.push(issue('warning', 'low-disk', `Only ${Math.max(1, Math.round(freeDiskBytes / (1024 * 1024)))} MB of free disk remains; backups and large attachments may fail.`));
  }

  const attachmentDirectory = path.join(ws.directory, 'attachments');
  let orphanCount = null;
  try {
    const referenced = new Set(ws.query('SELECT file_path FROM attachments').map((row) => row.file_path).filter(Boolean));
    let total = 0;
    for (const entry of fs.readdirSync(attachmentDirectory)) {
      if (!fs.statSync(path.join(attachmentDirectory, entry)).isFile()) continue;
      total += 1;
      if (!referenced.has(path.join('attachments', entry).replace(/\\/g, '/'))) orphanCount = (orphanCount || 0) + 1;
    }
  } catch { /* attachment directory may not exist yet */ }

  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    checkedAt,
    versions: {
      appVersion: meta.appVersion || null,
      schemaVersion: schemaVersion ?? null,
      dbLayoutVersion: Number.isInteger(layout) ? layout : null
    },
    integrity,
    storage,
    recordCounts: counts,
    freeDiskBytes,
    orphanAttachmentFiles: orphanCount,
    issues
  };
}
