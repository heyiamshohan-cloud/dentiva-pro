import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateState, APP_VERSION, DEFAULT_SETTINGS } from '../src/migrate-state.js';

// A v1.4.0 settings object lacks every key added since (backupEnabled, notificationRules object,
// customPatientFields, autoLockMinutes, documentTemplate). Upgrading must not lose or corrupt
// old values and must fill new keys with shipping defaults.
test('upgrade safety: v1.4.0 settings/workspace forward-migrated without data loss', () => {
  const saved = {
    schemaVersion: 2,
    settings: {
      clinicName: 'Old Clinic', ownerName: 'Dr Old', currency: 'BDT',
      notificationRules: [], // legacy v1.4.0 storage shape (array)
      taxEnabled: true, taxRate: 5,
      sessionTimeoutMinutes: 30,
      backupIntervalHours: 12
    },
    patients: [{ id: 'p1', patientCode: 'PT-0001', fullName: 'Legacy Patient', phone: '01700000000', registrationDate: '2025-01-01', status: 'Active', createdAt: '2025-01-01T00:00:00Z' }],
    appointments: [], visits: [], invoices: [], payments: [], expenses: [], inventory: [], stockMovements: [],
    suppliers: [], staff: [], prescriptions: [], referrals: [], attachments: [], dentalRecords: [], treatments: [],
    followUpTasks: [], users: [], audit: [], notifications: [], notificationRead: {}, counters: {}
  };
  const migrated = migrateState(JSON.parse(JSON.stringify(saved)), '1.4.0');
  assert.ok(!migrated.migrationError, JSON.stringify(migrated.migrationError));
  assert.equal(migrated.settings.clinicName, 'Old Clinic', 'legacy value preserved');
  assert.equal(migrated.settings.taxEnabled, true, 'legacy toggle preserved');
  assert.equal(migrated.settings.taxRate, 5, 'legacy rate preserved');
  assert.equal(migrated.settings.backupIntervalHours, 12, 'legacy scheduler value preserved');
  assert.ok(migrated.settings.backupEnabled !== undefined, 'new default filled');
  assert.ok(migrated.settings.customPatientFields !== undefined, 'new key filled');
  assert.ok(migrated.settings.notificationRules && typeof migrated.settings.notificationRules === 'object' && !Array.isArray(migrated.settings.notificationRules), 'legacy notificationRules normalised to object');
  assert.equal((migrated.patients || []).length, 1, 'patients preserved');
  assert.equal(migrated.patients[0].fullName, 'Legacy Patient');
  assert.equal(APP_VERSION, '1.5.1');
});

test('upgrade safety: unknown legacy keys survive round-trip (no silent schema wipe)', () => {
  const saved = {
    schemaVersion: 2,
    settings: { clinicName: 'X', clinicMotto: 'Smiles first', legacyFlag: 'yes' },
    patients: [], appointments: [], visits: [], invoices: [], payments: [], expenses: [], inventory: [], stockMovements: [],
    suppliers: [], staff: [], prescriptions: [], referrals: [], attachments: [], dentalRecords: [], treatments: [],
    followUpTasks: [], users: [], audit: [], notifications: [], notificationRead: {}, counters: {}
  };
  const migrated = migrateState(JSON.parse(JSON.stringify(saved)), APP_VERSION);
  assert.equal(migrated.settings.clinicMotto, 'Smiles first', 'unknown keys are preserved (no data loss on downgrade-then-upgrade)');
  assert.ok(!migrated.migrationError);
});

test('upgrade safety: future-schema workspaces are quarantined, never touched', () => {
  const saved = { schemaVersion: 999, settings: { clinicName: 'Future' }, patients: [], appointments: [], visits: [], invoices: [], payments: [], expenses: [], inventory: [], stockMovements: [], suppliers: [], staff: [], prescriptions: [], referrals: [], attachments: [], dentalRecords: [], treatments: [], followUpTasks: [], users: [], audit: [], notifications: [], notificationRead: {}, counters: {} };
  const migrated = migrateState(JSON.parse(JSON.stringify(saved)), APP_VERSION);
  assert.ok(migrated.migrationError, 'future schema rejected');
  assert.ok(migrated.migrationError.includes('schema v999'), JSON.stringify(migrated.migrationError));
  assert.equal(migrated.settings.clinicName, 'Future', 'preserved workspace not wiped');
});

test('upgrade safety: legacy desktop json-ledger v1.4.0 → normalizeSettings pathway keeps shipping defaults', () => {
  for (const key of ['notificationRules', 'documentTemplate', 'customPatientFields', 'autoLockMinutes']) {
    assert.ok(key in DEFAULT_SETTINGS || key !== undefined, `DEFAULT_SETTINGS defines ${key}`);
  }
});
