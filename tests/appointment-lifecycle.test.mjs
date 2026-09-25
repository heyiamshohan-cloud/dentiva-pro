import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalRepo } from '../src/repo-local.js';
import { runOp } from '../src/ops.js';
import { permissionsForRole } from '../src/core.js';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';

const ctx = () => ({ userId: 'u', userName: 'A', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true });

test('appointment lifecycle: recording a linked visit closes the appointment on both runtimes; status timestamps stamped', async () => {
  for (const makeRepo of [
    () => new LocalRepo(),
    () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appt-sql-')); migrateWorkspace(dir); return new SqlRepo(new Workspace(dir).open()); }
  ]) {
    const repo = makeRepo();
    const c = ctx();
    const patient = (await runOp(repo, 'patient.create', { fullName: 'Loop Patient', phone: '01811111111' }, c)).record;
    const appt = (await runOp(repo, 'appointment.create', { patientId: patient.id, date: '2026-09-23', time: '10:00', reason: 'Scaling' }, c)).record;
    // walk the queue
    await runOp(repo, 'appointment.setStatus', { id: appt.id, status: 'Checked In' }, c);
    const inTreatment = (await runOp(repo, 'appointment.setStatus', { id: appt.id, status: 'In Treatment' }, c)).record;
    assert.ok(inTreatment.startedAt, 'startedAt stamped when moving In Treatment');
    assert.equal(inTreatment.status, 'In Treatment');
    // record the visit against it
    const visit = (await runOp(repo, 'visit.create', { patientId: patient.id, appointmentId: appt.id, date: '2026-09-23', reason: 'Scaling', treatmentPerformed: 'Scaling + polish' }, c)).record;
    assert.equal(visit.appointmentId, appt.id);
    const after = repo.get('appointments', appt.id);
    assert.equal(after.status, 'Completed', 'visit against the appointment closes it');
    assert.ok(after.completedAt, 'completedAt stamped');
    // a later visit does not resurrect/corrupt the closed appointment
    (await runOp(repo, 'visit.create', { patientId: patient.id, appointmentId: appt.id, date: '2026-09-24', reason: 'Review' }, c));
    assert.equal(repo.get('appointments', appt.id).status, 'Completed');
    // explicit Completed stamps completedAt directly
    const appt2 = (await runOp(repo, 'appointment.create', { patientId: patient.id, date: '2026-09-25', time: '09:00', reason: 'Consult' }, c)).record;
    const done = (await runOp(repo, 'appointment.setStatus', { id: appt2.id, status: 'Completed' }, c)).record;
    assert.ok(done.completedAt);
  }
});
