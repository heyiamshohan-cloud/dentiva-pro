import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { hashPin, verifyPin } from '../electron/lib/auth.mjs';
import { runOp } from '../src/ops.js';
import { permissionsForRole } from '../src/core.js';
import { createApi } from '../src/api.js';

// The first-run setup flow is the single most important flow in the app:
// with an EMPTY user table, the renderer submits
//   setup.complete -> settings.update -> user.create (Administrator + PIN)
// and then signs in with that PIN. The "keep at least one active
// Administrator" guard must project the admin population AFTER the upsert —
// including the brand-new record on create — or first-run can never finish.
// (Regression: the guard counted only stored users, so the very first
// user.create was rejected and the setup modal could not advance.)

function firstRunCtx() {
  return { userId: '', userName: 'Setup', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true };
}
function adminCtx(userId) {
  return { userId, userName: 'Administrator', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: false };
}
function applyPinLikeDesktop(result, repo) {
  // Mirrors electron/lib/ipc.mjs applyPinToSet exactly.
  if (!result || !result.ok || !result.pinToSet) return;
  const { userId, pin } = result.pinToSet;
  const derived = hashPin(pin);
  repo.setUserSecrets(userId, { pinHash: derived.hash, pinSalt: derived.salt, kdf: derived.kdf, failedAttempts: 0, lockedUntil: 0 });
  delete result.pinToSet;
}

const SETUP_SEQUENCE = [
  ['setup.complete', { clinicName: 'Regression Clinic', dentistName: 'Dr. Regression', phone: '01700000000', address: '1 Test Road', language: 'English', currency: 'BDT' }],
  ['settings.update', { language: 'English', currency: 'BDT' }],
  ['user.create', { name: 'Dr. Regression', role: 'Administrator', active: true, pin: '2468', confirmPin: '2468' }]
];

function runFirstRunOnSqlRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-first-run-'));
  const ws = new Workspace(dir).open();
  const repo = new SqlRepo(ws);
  let adminId = '';
  for (const [name, payload] of SETUP_SEQUENCE) {
    const result = runOp(repo, name, payload, firstRunCtx());
    assert.equal(result.ok, true, `desktop first-run ${name} failed: ${result.error || result.code}`);
    applyPinLikeDesktop(result, repo);
    if (name === 'user.create') adminId = result.record.id;
  }
  const admin = repo.userGet(adminId, { includeSecrets: true });
  assert.equal(admin.role, 'Administrator');
  assert.equal(repo.anyPinSet(), true, 'first account must carry a PIN hash');
  assert.equal(verifyPin('2468', admin).ok, true, 'stored PIN hash must verify');
  return { repo, adminId };
}

test('desktop first-run setup creates the first Administrator and accepts a second account (SqlRepo)', () => {
  const { repo, adminId } = runFirstRunOnSqlRepo();
  const staff = runOp(repo, 'user.create', { name: 'Front Desk', role: 'Receptionist', active: true, pin: '1357', confirmPin: '1357' }, adminCtx(adminId));
  assert.equal(staff.ok, true, `second account rejected: ${staff.error}`);
  applyPinLikeDesktop(staff, repo);
  const secondAdmin = runOp(repo, 'user.create', { name: 'Second Doctor', role: 'Administrator', active: true, pin: '9012', confirmPin: '9012' }, adminCtx(adminId));
  assert.equal(secondAdmin.ok, true, `second administrator rejected: ${secondAdmin.error}`);
  assert.equal(repo.usersList().length, 3);
});

test('last-Administrator protections keep the workspace signable (SqlRepo)', () => {
  const { repo, adminId } = runFirstRunOnSqlRepo();
  const admin = repo.userGet(adminId, { includeSecrets: true });
  // Demoting the only administrator (even by that administrator) leaves zero admins.
  const demote = runOp(repo, 'user.update', { id: adminId, name: admin.name, role: 'Receptionist', active: true, pin: '2468', confirmPin: '2468' }, adminCtx(adminId));
  assert.equal(demote.ok, false, 'demoting the only administrator must be rejected');
  assert.match(String(demote.error), /Keep at least one active Administrator/);
  // Self-deactivation is refused by the signed-in-account guard.
  const selfDeactivate = runOp(repo, 'user.toggleActive', { id: adminId }, adminCtx(adminId));
  assert.equal(selfDeactivate.ok, false, 'deactivating the signed-in account must be rejected');
  assert.match(String(selfDeactivate.error), /You cannot deactivate the signed-in account/);
  // With a second administrator, deactivating one of them is fine — coverage stays >= 1.
  const second = runOp(repo, 'user.create', { name: 'Second Doctor', role: 'Administrator', active: true, pin: '9012', confirmPin: '9012' }, adminCtx(adminId));
  assert.equal(second.ok, true, `second administrator rejected: ${second.error}`);
  applyPinLikeDesktop(second, repo);
  const toggle = runOp(repo, 'user.toggleActive', { id: second.record.id }, adminCtx(adminId));
  assert.equal(toggle.ok, true, `deactivating one of two administrators must be allowed: ${toggle.error}`);
});

test('creating a non-administrator into a zero-admin store is rejected; the first Administrator is not (SqlRepo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-first-run-'));
  const repo = new SqlRepo(new Workspace(dir).open());
  const noAdmin = runOp(repo, 'user.create', { name: 'Lone Receptionist', role: 'Receptionist', active: true, pin: '1357', confirmPin: '1357' }, firstRunCtx());
  assert.equal(noAdmin.ok, false, 'creating a non-administrator into a zero-admin store must be rejected');
  assert.match(String(noAdmin.error), /Keep at least one active Administrator/);
  const firstAdmin = runOp(repo, 'user.create', { name: 'First Doctor', role: 'Administrator', active: true, pin: '2468', confirmPin: '2468' }, firstRunCtx());
  assert.equal(firstAdmin.ok, true, `creating the first administrator must succeed: ${firstAdmin.error}`);
  assert.equal(repo.usersList().length, 1);
});

test('editing the only administrator without reducing coverage stays allowed (LocalRepo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-first-run-'));
  const repo = new SqlRepo(new Workspace(dir).open());
  const { adminId } = (() => {
    let id = '';
    for (const [name, payload] of SETUP_SEQUENCE) {
      const result = runOp(repo, name, payload, firstRunCtx());
      assert.equal(result.ok, true, name);
      applyPinLikeDesktop(result, repo);
      if (name === 'user.create') id = result.record.id;
    }
    return { adminId: id };
  })();
  const renamed = runOp(repo, 'user.update', { id: adminId, name: 'Dr. Regression Two', role: 'Administrator', active: true, pin: '2468', confirmPin: '2468' }, adminCtx(adminId));
  assert.equal(renamed.ok, true, `editing the only administrator must stay allowed: ${renamed.error}`);
  assert.equal(repo.usersList().find((user) => user.id === adminId).name, 'Dr. Regression Two');
});

test('browser first-run completes end-to-end on LocalApi (setup -> admin PIN -> sign-in)', async () => {
  const api = createApi({ desktopBridge: null });
  const boot = await api.bootstrap();
  assert.equal(boot.firstRun, true, 'fresh browser workspace is first-run');
  assert.equal(boot.setupComplete, false);
  for (const [name, payload] of SETUP_SEQUENCE) {
    const result = await api.runOp(name, payload);
    assert.equal(result.ok, true, `browser first-run ${name} failed: ${result.error || result.code}`);
  }
  const after = await api.bootstrap();
  assert.equal(after.firstRun, false, 'workspace is no longer first-run once the administrator PIN exists');
  const admin = api.repo.usersList().find((user) => user.role === 'Administrator');
  assert.ok(admin, 'first-run created exactly one Administrator account');
  const realLogin = await api.login(admin.id, '2468');
  assert.equal(realLogin.ok, true, `sign-in with the first-run PIN failed: ${realLogin.error}`);
  assert.equal(realLogin.session.role, 'Administrator');
  const staff = await api.runOp('user.create', { name: 'Front Desk', role: 'Receptionist', active: true, pin: '1357', confirmPin: '1357' });
  assert.equal(staff.ok, true, `second account rejected after sign-in: ${staff.error}`);
  const demote = await api.runOp('user.update', { id: admin.id, name: admin.name, role: 'Receptionist', active: true, pin: '2468', confirmPin: '2468' });
  assert.equal(demote.ok, false, 'demoting the only administrator must be rejected on the browser runtime too');
});
