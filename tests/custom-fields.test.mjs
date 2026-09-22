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

test('custom patient fields: definition clamp, create+update round-trip on both runtimes', async () => {
  for (const makeRepo of [
    () => new LocalRepo(),
    () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sql-')); migrateWorkspace(dir); return new SqlRepo(new Workspace(dir).open()); }
  ]) {
    const repo = makeRepo();
    const c = ctx();
    const defs = await runOp(repo, 'settings.update', { customPatientFields: [{ label: 'Guardian name', type: 'text' }, { label: 'Referral source', type: 'textarea' }, { label: '!!!!', type: 'text' }] }, c);
    assert.equal(defs.ok, true);
    assert.equal(defs.settings.customPatientFields.length, 3, 'definitions normalized');
    assert.ok(defs.settings.customPatientFields.every((d) => /^[a-z0-9_]+$/.test(d.key)));
    const patient = (await runOp(repo, 'patient.create', { fullName: 'Custom Field Patient', phone: '01777777777', custom_guardian_name: 'Abdul Karim', custom_referral_source: 'Word of mouth', custom_hacked: 'not a defined key' }, c)).record;
    assert.equal(patient.customFields.guardian_name, 'Abdul Karim', 'defined custom key is stored');
    assert.equal(patient.customFields.hacked, undefined, 'undefined keys are dropped');
    const updated = (await runOp(repo, 'patient.update', { id: patient.id, custom_referral_source: 'Colleague' }, c)).record;
    assert.equal(updated.customFields.referral_source, 'Colleague');
    assert.equal(updated.customFields.guardian_name, 'Abdul Karim', 'untouched custom fields preserved');
  }
});
