import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Workspace, DB_FILENAME } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { migrateWorkspace, ensureStateMeta } from '../electron/lib/migrate.mjs';
import { createBackup, validateBackup, restoreBackup, listBackups } from '../electron/lib/backup.mjs';

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-pro-storage-'));
}

function openWorkspace(directory) {
  const ws = new Workspace(directory).open();
  const repo = new SqlRepo(ws);
  ensureStateMeta(ws);
  return { ws, repo };
}

function makeV4Db(directory) {
  const dbPath = path.join(directory, DB_FILENAME);
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.exec('CREATE TABLE records (collection TEXT NOT NULL, record_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (collection, record_id))');
  const meta = {
    schemaVersion: 4,
    appVersion: '1.3.0',
    settings: { clinicName: 'Migration Clinic', currency: 'BDT' },
    counters: { patient: 3, appointment: 1, invoice: 2, visit: 1, prescription: 1, receipt: 1, serial: 1, staff: 1 },
    setupComplete: true,
    dashboard: ['schedule', 'queue', 'followups', 'signals'],
    notificationRead: {},
    lastBackupAt: null
  };
  for (const [key, value] of Object.entries(meta)) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
  const records = [
    ['patients', 'p1', { id: 'p1', patientCode: 'PT-0001', fullName: 'Amina Rahman', phone: '01700000000', registrationDate: '2026-01-05', status: 'Active' }],
    ['patients', 'p2', { id: 'p2', patientCode: 'PT-0002', fullName: 'करीम उद्दीन', phone: '01800000000', registrationDate: '2026-02-11', status: 'Active' }],
    ['visits', 'v1', { id: 'v1', visitCode: 'V-0001', patientId: 'p1', date: '2026-03-01', reason: 'Checkup', diagnosis: 'Review' }],
    ['invoices', 'inv1', { id: 'inv1', invoiceNumber: 'INV-0001', patientId: 'p1', date: '2026-03-01', total: 1400, paid: 800, due: 600, status: 'Partially Paid', items: [{ name: 'Filling', quantity: 1, unitPrice: 1400, total: 1400 }] }],
    ['payments', 'pay1', { id: 'pay1', receiptNumber: 'R-0001', invoiceId: 'inv1', patientId: 'p1', amount: 800, refundedAmount: 0, date: '2026-03-01', method: 'Cash', status: 'Recorded' }],
    ['appointments', 'a1', { id: 'a1', appointmentCode: 'APT-0001', patientId: 'p1', date: '2026-03-10', time: '10:00', status: 'Scheduled' }],
    ['attachments', 'att1', { id: 'att1', patientId: 'p1', name: 'x-ray.png', type: 'image/png', size: 11, data: 'data:image/png;base64,aGVsbG8gd29ybGQh' }],
    ['users', 'u1', { id: 'u1', name: 'Admin', role: 'Administrator', active: true, pinHash: 'abc123', pinSalt: 'def456', failedAttempts: 0, lockedUntil: 0 }]
  ];
  for (const [collection, id, payload] of records) {
    db.prepare('INSERT INTO records (collection, record_id, payload) VALUES (?, ?, ?)').run(collection, id, JSON.stringify(payload));
  }
  db.close();
  return dbPath;
}

test('relational store persists collections, externalizes attachments and computes exact balance cents', () => {
  const directory = temporaryDirectory();
  try {
    migrateWorkspace(directory);
    const { ws, repo } = openWorkspace(directory);
    const nowIso = new Date().toISOString();
    repo.insert('patients', { id: 'p1', patientCode: 'PT-0001', fullName: 'Amina Rahman', phone: '01700000000', registrationDate: '2026-01-05', status: 'Active', balanceCents: 0, createdAt: nowIso });
    repo.insert('invoices', { id: 'inv1', invoiceNumber: 'INV-0001', patientId: 'p1', date: '2026-03-01', items: [{ name: 'Filling', quantity: 2, unitPrice: 750, total: 1500 }], subtotal: 1500, discount: 100, taxRate: 0, tax: 0, total: 1400, paid: 0, due: 1400, status: 'Issued', createdAt: nowIso });
    repo.insert('payments', { id: 'pay1', receiptNumber: 'R-0001', invoiceId: 'inv1', patientId: 'p1', amount: 800, refundedAmount: 0, date: '2026-03-01', method: 'Cash', status: 'Recorded', createdAt: nowIso });
    repo.updatePatientBalance('p1');
    const balance = repo.get('patients', 'p1').balanceCents;
    assert.equal(balance, 60000, 'balance must be integer cents (1400 - 800 = 600)');

    const attachmentBytes = new TextEncoder().encode('hello world!');
    const written = repo.writeAttachmentFile('att1', attachmentBytes);
    assert.equal(written.checksum, crypto.createHash('sha256').update(attachmentBytes).digest('hex'));
    repo.insert('attachments', { id: 'att1', patientId: 'p1', name: 'x-ray.png', type: 'image/png', size: attachmentBytes.length, filePath: written.relativePath, checksum: written.checksum, data: '', createdAt: nowIso });
    assert.equal(fs.existsSync(path.join(directory, 'attachments', 'att1.bin')), true);
    const readBack = repo.readAttachmentFile(written.relativePath);
    assert.equal(Buffer.compare(readBack, attachmentBytes), 0);
    ws.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('v4 sql.js database migrates to the relational layout with exact money and preserved history', () => {
  const directory = temporaryDirectory();
  try {
    makeV4Db(directory);
    const result = migrateWorkspace(directory);
    assert.ok(['migrated', 'current'].includes(result.status), `status was ${result.status}`);
    assert.equal(fs.existsSync(path.join(directory, `${DB_FILENAME}.v4-preserved.sqlite`)), true, 'source database must be preserved');

    const { ws, repo } = openWorkspace(directory);
    assert.equal(repo.listPatients({ page: 1, pageSize: 10 }).total, 2);
    const invoice = repo.get('invoices', 'inv1');
    assert.equal(invoice.totalCents, 140000);
    assert.equal(invoice.paidCents, 80000);
    assert.equal(invoice.dueCents, 60000);
    const patient = repo.get('patients', 'p1');
    assert.equal(patient.balanceCents, 60000);
    const unicodeSearch = repo.listPatients({ page: 1, pageSize: 10, query: 'करीम' });
    assert.equal(unicodeSearch.total, 1, 'non-Latin full-text search must survive migration');
    const attachmentRow = repo.ws.queryOne('SELECT file_path FROM attachments WHERE id = ?', ['att1']);
    assert.ok(attachmentRow && attachmentRow.file_path.includes('att1.bin'));
    const user = repo.userGet('u1');
    assert.equal(user.hasPin, true, 'user keeps its PIN-protected flag');
    assert.ok(!user.pinHash && !user.pinSalt, 'secrets must not be exposed by the default read');
    assert.equal(repo.integrityCheck().ok, true);
    const again = migrateWorkspace(directory);
    assert.equal(again.status, 'current', 're-running migration on a current workspace must be a no-op');
    ws.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy JSON store migrates and is marked, not deleted', () => {
  const directory = temporaryDirectory();
  try {
    fs.writeFileSync(path.join(directory, 'dentiva-pro-store.json'), JSON.stringify({
      schemaVersion: 2,
      settings: { clinicName: 'Legacy clinic', currency: 'BDT' },
      patients: [{ id: 'p1', patientCode: 'PT-0001', fullName: 'Legacy Patient', phone: '01711111111', registrationDate: '2025-05-01' }]
    }));
    migrateWorkspace(directory);
    assert.equal(fs.existsSync(path.join(directory, `${DB_FILENAME}.v4-preserved`)) || fs.existsSync(path.join(directory, 'dentiva-pro-store.json.migrated')), true, 'legacy source must be marked, never deleted');
    const { ws, repo } = openWorkspace(directory);
    const settings = repo.getSettings();
    assert.equal(settings.clinicName, 'Legacy clinic');
    assert.equal(repo.listPatients({ page: 1, pageSize: 10 }).total, 1);
    ws.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt primary recovers from the retained backup copy', () => {
  const directory = temporaryDirectory();
  try {
    migrateWorkspace(directory);
    const { ws, repo } = openWorkspace(directory);
    const nowIso = new Date().toISOString();
    repo.insert('patients', { id: 'p1', patientCode: 'PT-0001', fullName: 'First', phone: '01700000001', registrationDate: '2026-01-01', status: 'Active', createdAt: nowIso });
    repo.insert('patients', { id: 'p2', patientCode: 'PT-0002', fullName: 'Second', phone: '01700000002', registrationDate: '2026-01-02', status: 'Active', createdAt: nowIso });
    ws.close();
    fs.copyFileSync(path.join(directory, DB_FILENAME), path.join(directory, `${DB_FILENAME}.bak`));
    fs.writeFileSync(path.join(directory, DB_FILENAME), 'this is not a database');
    const result = migrateWorkspace(directory);
    assert.ok(!result.errors.length || result.errors.some((e) => /recovered/i.test(e)), JSON.stringify(result.errors));
    const { ws: ws2, repo: repo2 } = openWorkspace(directory);
    assert.equal(repo2.listPatients({ page: 1, pageSize: 10 }).total, 2, 'records must survive recovery');
    ws2.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('backup round-trip preserves money invariants and rejects tampered backups', () => {
  const directory = temporaryDirectory();
  try {
    migrateWorkspace(directory);
    const { ws, repo } = openWorkspace(directory);
    const nowIso = new Date().toISOString();
    repo.insert('patients', { id: 'p1', patientCode: 'PT-0001', fullName: 'Round Trip', phone: '01700000000', registrationDate: '2026-01-01', status: 'Active', balanceCents: 0, createdAt: nowIso });
    repo.insert('invoices', { id: 'inv1', invoiceNumber: 'INV-0001', patientId: 'p1', date: '2026-02-01', items: [{ name: 'Crown', quantity: 1, unitPrice: 9000, total: 9000 }], subtotal: 9000, discount: 0, taxRate: 0, tax: 0, total: 9000, paid: 4000, due: 5000, status: 'Partially Paid', createdAt: nowIso });
    repo.insert('payments', { id: 'pay1', receiptNumber: 'R-0001', invoiceId: 'inv1', patientId: 'p1', amount: 4000, refundedAmount: 0, date: '2026-02-01', method: 'bKash', status: 'Recorded', createdAt: nowIso });
    repo.updatePatientBalance('p1');
    const before = repo.get('patients', 'p1').balanceCents;
    assert.equal(before, 500000, '9000 - 4000 = 5000 taka = 500000 cents');

    const created = createBackup(ws, { label: 'test' });
    assert.equal(created.ok, true);
    assert.equal(validateBackup(created.path).ok, true, 'fresh backup must validate');
    assert.ok(listBackups(ws).length >= 1);

    // mutate, then restore
    repo.insert('patients', { id: 'p2', patientCode: 'PT-0002', fullName: 'Extra', phone: '01700000009', registrationDate: '2026-03-01', status: 'Active', createdAt: nowIso });
    const restored = restoreBackup(ws, created.path);
    assert.equal(restored.ok, true, restored.error);
    assert.equal(repo.listPatients({ page: 1, pageSize: 10 }).total, 1, 'restore must return the exact prior state');
    assert.equal(repo.get('patients', 'p1').balanceCents, 500000, 'integer-cent invariants must survive the round-trip');
    assert.equal(repo.integrityCheck().ok, true);

    // tamper the backup database and expect validation failure
    const dbFile = path.join(created.path, DB_FILENAME);
    const bytes = fs.readFileSync(dbFile);
    bytes[bytes.length - 12] ^= 0xff;
    fs.writeFileSync(dbFile, bytes);
    const tampered = validateBackup(created.path);
    assert.equal(tampered.ok, false, 'a tampered backup must fail checksum or integrity validation');
    ws.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('foreign-key integrity check catches orphaned child records', () => {
  const directory = temporaryDirectory();
  try {
    migrateWorkspace(directory);
    const { ws } = openWorkspace(directory);
    const before = ws.integrityCheck();
    assert.equal(before.ok, true);
    // Plant a violation the way corruption or foreign tooling would: temporarily
    // relax enforcement, write the orphan, restore enforcement.
    ws.run('PRAGMA foreign_keys = OFF');
    ws.run("INSERT INTO payments (id, patient_id, invoice_id, receipt_number, date, amount_cents, status, payload) VALUES ('orphan', NULL, 'missing', 'R-0009', '2026-01-01', 100, 'Recorded', '{}')");
    ws.run('PRAGMA foreign_keys = ON');
    const after = ws.integrityCheck();
    assert.equal(after.ok, false, 'a dangling invoice reference must be reported');
    assert.ok(after.foreignKeyViolationCount >= 1);
    ws.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
