// v2.0.0 security regression suite — every test drives the REAL IPC handlers
// over a real on-disk workspace. Each test is named after the defect it pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHarness, makePatient, ADMIN_PIN } from './helpers/harness.mjs';
import { createBackup } from '../electron/lib/backup.mjs';

test('SEC-01: editing a user without a new PIN keeps the PIN, KDF and sign-in intact', async (t) => {
  const h = createHarness(t);
  const admin = await h.bootstrapAdmin();
  const renamed = await h.op('user.update', { id: admin.id, name: 'Dr. Renamed Admin', role: 'Administrator' });
  assert.equal(renamed.ok, true, renamed.error);
  const row = h.ws.queryOne('SELECT pin_hash, pin_salt, kdf FROM users WHERE id = ?', [admin.id]);
  assert.equal(row.pin_hash.length, 64, 'PIN hash preserved');
  assert.ok(row.pin_salt.length > 0, 'salt preserved');
  assert.equal(row.kdf, 'PBKDF2-SHA-256-v2', 'kdf preserved');
  await h.invoke('auth:logout');
  assert.equal(h.sessions.firstRun(), false, 'workspace must NOT fall back to first-run');
  const login = await h.invoke('auth:login', { userId: admin.id, pin: ADMIN_PIN });
  assert.equal(login.ok, true, login.error);
  assert.equal(login.session.userName, 'Dr. Renamed Admin');
});

test('SEC-01: toggling another account and editing roles never touches secrets', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const rec = await h.createUser('Receptionist', { name: 'Front Desk', pin: '5555' });
  assert.equal((await h.op('user.toggleActive', { id: rec.id })).ok, true);
  assert.equal((await h.op('user.toggleActive', { id: rec.id })).ok, true);
  assert.equal((await h.op('user.update', { id: rec.id, name: 'Front Desk', role: 'Accountant' })).ok, true);
  await h.loginAs(rec.id, '5555');
  assert.equal(h.sessions.context().role, 'Accountant');
});

test('SEC-02: no operation runs while signed out (setup.complete cannot rewrite clinic identity)', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin({ clinicName: 'Real Clinic' });
  await h.invoke('auth:logout');
  for (const name of ['setup.complete', 'dashboard.setLayout', 'navigation.pushRecent', 'savedFilter.save', 'notification.markAllRead', 'notifications.scan', 'patient.create']) {
    const result = await h.op(name, { clinicName: 'TAMPERED', layout: ['schedule'], page: 'x', name: 'x', fullName: 'X' });
    assert.equal(result.ok, false, `${name} must be rejected while signed out`);
    assert.equal(result.code, 'auth-required', `${name} → ${result.code}`);
  }
  assert.equal(h.repo.getSettings().clinicName, 'Real Clinic');
});

test('SEC-02: setup.complete after first run requires settings.edit', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin({ clinicName: 'Real Clinic' });
  const rec = await h.createUser('Receptionist', { pin: '5555' });
  await h.loginAs(rec.id, '5555');
  const attempt = await h.op('setup.complete', { clinicName: 'Receptionist Rename' });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, 'permission-denied');
  assert.equal(h.repo.getSettings().clinicName, 'Real Clinic');
});

test('SEC-03: server-side inactivity expiry is enforced; background polling does not extend it', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  h.repo.setMeta('settings', { ...h.repo.getSettings(), sessionTimeoutMinutes: 5 });
  h.advance(4 * 60_000);
  await h.query('notifications'); // background poll
  await h.invoke('auth:session'); // background poll
  h.advance(2 * 60_000); // 6 minutes since the last real activity
  const result = await h.op('patient.create', { fullName: 'After Expiry', phone: '01700000011' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'auth-required');
  assert.equal(h.sessions.lastEnded.reason, 'expired');
});

test('SEC-03: a timeout of 0 disables expiry instead of expiring after one minute', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  h.repo.setMeta('settings', { ...h.repo.getSettings(), sessionTimeoutMinutes: 0 });
  h.advance(3 * 60 * 60_000);
  const patient = await makePatient(h);
  assert.ok(patient.id);
});

test('SEC-04: role changes and deactivation apply to a live session immediately', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const acct = await h.createUser('Accountant', { name: 'Books', pin: '7777' });
  const other = await h.createUser('Administrator', { name: 'Second Admin', pin: '8888' });
  await h.loginAs(acct.id, '7777');
  assert.equal((await h.op('expense.create', { description: 'Gloves', amount: '120.00', date: '2026-09-01' })).ok, true);
  // Another administrator demotes the account (simulated directly in the store).
  h.repo.insert('users', { ...h.repo.userGet(acct.id), role: 'Cleaner', permissions: [] });
  const denied = await h.op('expense.create', { description: 'Masks', amount: '80.00', date: '2026-09-01' });
  assert.equal(denied.code, 'permission-denied', 'demotion applies without re-login');
  h.repo.insert('users', { ...h.repo.userGet(acct.id), active: false });
  const gone = await h.query('dashboard');
  assert.equal(gone.code, 'auth-required', 'deactivated account is signed out');
  assert.equal(h.sessions.lastEnded.reason, 'account-disabled');
  assert.ok(other.id);
});

test('SEC-05: workspace export requires backup.create', async (t) => {
  const exported = [];
  const h = createHarness(t, { dialogs: { showOpenDialog: async () => { exported.push(1); return { canceled: false, filePaths: [path.join(h.dir, 'export-target')] }; } } });
  await h.bootstrapAdmin();
  const assistant = await h.createUser('Dental Assistant', { pin: '4444' });
  await h.loginAs(assistant.id, '4444');
  const denied = await h.invoke('workspace:export');
  assert.equal(denied.code, 'permission-denied');
  assert.equal(exported.length, 0, 'no dialog shown to an unauthorised role');
});

test('SEC-07: restore/validate accept only managed backups or dialog-picked folders', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const outside = path.join(h.dir, '..', `rogue-${Date.now()}`);
  fs.mkdirSync(outside, { recursive: true });
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  for (const channel of ['backup:restore', 'backup:validate']) {
    const result = await h.invoke(channel, { path: outside });
    assert.equal(result.code, 'path-not-allowed', `${channel} → ${JSON.stringify(result)}`);
  }
  const managed = await h.invoke('backup:create', { label: 'managed' });
  assert.equal(managed.ok, true, managed.error);
  const valid = await h.invoke('backup:validate', { path: managed.path });
  assert.equal(valid.ok, true, JSON.stringify(valid.problems));
});

test('SEC-09: repeated lockouts escalate and persist across sessions', async (t) => {
  const h = createHarness(t);
  const admin = await h.bootstrapAdmin();
  await h.invoke('auth:logout');
  const fail5 = async () => {
    let last;
    for (let i = 0; i < 5; i += 1) last = await h.invoke('auth:login', { userId: admin.id, pin: '0000' });
    return last;
  };
  const first = await fail5();
  assert.equal(first.lockedOut, true);
  assert.match(first.error, /30 seconds/);
  h.advance(31_000);
  const second = await fail5();
  assert.match(second.error, /60 seconds|1 minutes/);
  h.advance(61_000);
  const third = await fail5();
  assert.match(third.error, /5 minutes/);
  const blocked = await h.invoke('auth:login', { userId: admin.id, pin: ADMIN_PIN });
  assert.equal(blocked.ok, false, 'correct PIN is refused while locked');
  h.advance(5 * 60_000 + 1000);
  const ok = await h.invoke('auth:login', { userId: admin.id, pin: ADMIN_PIN });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(h.repo.userGet(admin.id, { includeSecrets: true }).lockoutCount, 0, 'successful sign-in resets the escalation');
});

test('SEC-11: unknown roles and unknown permissions are rejected', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const bad = await h.op('user.create', { name: 'Ghost', role: 'Superuser', pin: '1234', confirmPin: '1234' });
  assert.equal(bad.ok, false);
  const custom = await h.op('user.create', { name: 'Custom', role: 'Custom Role', pin: '1234', confirmPin: '1234', permissions: ['patients.view', 'root.everything'] });
  assert.equal(custom.ok, true, custom.error);
  assert.deepEqual(h.repo.userGet(custom.record.id).permissions, ['patients.view']);
});

test('SEC-12: queries require authentication and global search respects collection permissions', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const patient = await makePatient(h, { fullName: 'Searchable Person' });
  const invoice = await h.op('invoice.create', { patientId: patient.id, items: [{ name: 'Scaling', quantity: 1, unitPrice: '1500.00' }] });
  assert.equal(invoice.ok, true, invoice.error);
  const assistant = await h.createUser('Dental Assistant', { pin: '4444' });
  await h.invoke('auth:logout');
  for (const name of ['directory', 'globalSearch', 'dashboard', 'workspace', 'patientSearch', 'list']) {
    const result = await h.query(name, { query: 'Searchable', collection: 'patients' });
    assert.equal(result.code, 'auth-required', `${name} must require sign-in`);
  }
  await h.loginAs(assistant.id, '4444');
  const search = await h.query('globalSearch', { query: invoice.record.invoiceNumber });
  assert.equal(search.ok, true);
  assert.equal(search.results.invoices, undefined, 'no billing results for a role without billing.view');
  const listed = await h.query('list', { collection: 'invoices' });
  assert.equal(listed.code, 'permission-denied');
});

test('SEC-13: changing your own PIN requires the current PIN', async (t) => {
  const h = createHarness(t);
  const admin = await h.bootstrapAdmin();
  const wrong = await h.op('user.changeOwnPin', { currentPin: '9999', newPin: '1111', confirmPin: '1111' });
  assert.equal(wrong.code, 'pin-mismatch');
  const right = await h.op('user.changeOwnPin', { currentPin: ADMIN_PIN, newPin: '1111', confirmPin: '1111' });
  assert.equal(right.ok, true, right.error);
  await h.invoke('auth:logout');
  assert.equal((await h.invoke('auth:login', { userId: admin.id, pin: '1111' })).ok, true);
});

test('BK-05: full JSON restore never wipes local accounts or PINs', async (t) => {
  const h = createHarness(t);
  const admin = await h.bootstrapAdmin();
  await makePatient(h, { fullName: 'Before Restore' });
  const legacy = {
    schemaVersion: 4,
    settings: { clinicName: 'Legacy Clinic', currency: 'BDT', language: 'Bengali' },
    patients: [{ id: 'legacy_p1', patientCode: 'PT-0001', fullName: 'Legacy Patient', phone: '01711111111', registrationDate: '2024-01-01', createdAt: '2024-01-01T00:00:00Z' }],
    users: [{ id: 'legacy_u1', name: 'Legacy Nurse', role: 'Dental Assistant', pinHash: 'deadbeef', pinSalt: 'abcd' }],
    appointments: [], visits: [], invoices: [], payments: [], expenses: [], inventory: [], stockMovements: [], suppliers: [], staff: [],
    prescriptions: [], referrals: [], attachments: [], dentalRecords: [], treatments: [], followUpTasks: [], audit: [], notifications: []
  };
  const result = await h.invoke('backup:restore-json', { text: JSON.stringify(legacy), options: {} });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.safetyBackup && fs.existsSync(result.safetyBackup), 'a safety backup was taken first');
  assert.equal(h.sessions.firstRun(), false, 'accounts with PINs survive');
  const login = await h.invoke('auth:login', { userId: admin.id, pin: ADMIN_PIN });
  assert.equal(login.ok, true, login.error);
  const imported = h.repo.userGet('legacy_u1', { includeSecrets: true });
  assert.equal(imported.pinHash, '', 'secrets are never imported from a JSON file');
  assert.equal(h.repo.getSettings().language, undefined, 'retired language setting stripped');
  const patients = h.ws.query('SELECT full_name FROM patients ORDER BY full_name').map((row) => row.full_name);
  assert.deepEqual(patients, ['Legacy Patient'], 'full restore replaced practice data');
});

test('ops that fail mid-way leave no partial writes (transactional)', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const patient = await makePatient(h);
  const before = h.repo.getCounters();
  // Conflict-confirm path allocates a code before failing; the counter must roll back.
  const first = await h.op('appointment.create', { patientId: patient.id, date: '2026-10-01', time: '10:00', reason: 'Checkup', chair: 'Chair 1' });
  assert.equal(first.ok, true, first.error);
  const afterFirst = h.repo.getCounters();
  const clash = await h.op('appointment.create', { patientId: patient.id, date: '2026-10-01', time: '10:00', reason: 'Clash', chair: 'Chair 1' });
  assert.equal(clash.code, 'conflict-confirm');
  assert.deepEqual(h.repo.getCounters(), afterFirst, 'rejected op rolled back its counter increment');
  assert.notDeepEqual(afterFirst, before);
});

test('manual and safety backups survive automatic retention', async (t) => {
  const h = createHarness(t);
  await h.bootstrapAdmin();
  const manual = createBackup(h.ws, { label: 'year-end', kind: 'manual' });
  const safety = createBackup(h.ws, { label: 'pre-restore', kind: 'safety' });
  for (let i = 0; i < 4; i += 1) createBackup(h.ws, { label: 'automatic', kind: 'automatic' });
  const pruned = await h.invoke('backup:prune', { keep: 1 });
  assert.equal(pruned.ok, true);
  assert.equal(pruned.removed.length, 3);
  assert.ok(fs.existsSync(manual.path), 'manual backup kept');
  assert.ok(fs.existsSync(safety.path), 'safety backup kept');
});
