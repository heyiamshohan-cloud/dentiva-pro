import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSQLiteStore } = require('../electron/storage.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-pro-storage-'));
}

test('SQLite store persists relational collections and externalizes attachment bytes', async () => {
  const directory = temporaryDirectory();
  const store = await createSQLiteStore(directory);
  try {
    const state = {
      schemaVersion: 2,
      appVersion: '1.2.0',
      settings: { currency: 'BDT' },
      patients: [{ id: 'p1', fullName: 'Amina Rahman' }],
      visits: [{ id: 'v1', patientId: 'p1', reason: 'Review' }],
      attachments: [{ id: 'a1', patientId: 'p1', type: 'image/png', size: 1, data: 'data:image/png;base64,AA==' }]
    };
    const result = store.save(state);
    assert.equal(result.ok, true);
    assert.equal(store.info().storage, 'SQLite');
    assert.equal(fs.existsSync(path.join(directory, 'dentiva-pro.sqlite')), true);
    assert.equal(fs.existsSync(path.join(directory, 'attachments', 'a1.bin')), true);
    const restored = store.load();
    assert.equal(restored.patients[0].fullName, 'Amina Rahman');
    assert.equal(restored.visits[0].patientId, 'p1');
    assert.equal(restored.attachments[0].data, 'data:image/png;base64,AA==');
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy JSON state migrates without being silently discarded', async () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, 'dentiva-pro-store.json'), JSON.stringify({ schemaVersion: 2, settings: { clinicName: 'Legacy clinic' }, patients: [{ id: 'p1' }] }));
  const store = await createSQLiteStore(directory);
  try {
    assert.equal(store.load().settings.clinicName, 'Legacy clinic');
    assert.equal(fs.existsSync(path.join(directory, 'dentiva-pro.sqlite')), true);
    assert.equal(fs.existsSync(path.join(directory, 'dentiva-pro-store.json.migrated')), true);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite recovery backup is retained when the current database is corrupt', async () => {
  const directory = temporaryDirectory();
  const store = await createSQLiteStore(directory);
  try {
    store.save({ schemaVersion: 2, settings: { clinicName: 'First' }, patients: [] });
    store.save({ schemaVersion: 2, settings: { clinicName: 'Second' }, patients: [] });
    store.close();
    fs.writeFileSync(path.join(directory, 'dentiva-pro.sqlite'), 'corrupt');
    const recovered = await createSQLiteStore(directory);
    try { assert.equal(recovered.load().settings.clinicName, 'First'); } finally { recovered.close(); }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
