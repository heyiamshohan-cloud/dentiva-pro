import { performance } from 'node:perf_hooks';
import { ARRAY_COLLECTIONS, buildBackupManifest, canonicalJson, validateRelationships } from '../src/core.js';

const sizes = [1000, 5000, 10000, 25000];
function makeState(size) {
  const state = Object.fromEntries(ARRAY_COLLECTIONS.map((key) => [key, []]));
  state.schemaVersion = 3;
  state.appVersion = '1.2.0';
  state.settings = { currency: 'BDT' };
  state.patients = Array.from({ length: size }, (_, index) => ({ id: `p_${index}`, patientCode: `PT-${String(index + 1).padStart(6, '0')}`, fullName: `Benchmark Patient ${index + 1}`, phone: `017${String(index).padStart(8, '0')}`, registrationDate: '2026-01-01' }));
  state.visits = state.patients.map((patient, index) => ({ id: `v_${index}`, patientId: patient.id, date: '2026-09-22', reason: 'Benchmark check' }));
  state.appointments = state.patients.map((patient, index) => ({ id: `a_${index}`, patientId: patient.id, date: '2026-09-23', time: '09:00', status: 'Scheduled' }));
  return state;
}

console.log('Dentiva Pro v1.2.0 domain benchmark; synthetic records are never written to the application store.');
for (const size of sizes) {
  const state = makeState(size);
  const validationStart = performance.now();
  const errors = validateRelationships(state, ARRAY_COLLECTIONS);
  const validationMs = performance.now() - validationStart;
  const serializationStart = performance.now();
  const canonical = canonicalJson(state);
  const serializationMs = performance.now() - serializationStart;
  const manifestStart = performance.now();
  const manifest = buildBackupManifest(state, '1.2.0', ARRAY_COLLECTIONS);
  const manifestMs = performance.now() - manifestStart;
  console.log(JSON.stringify({ size, validationMs: Number(validationMs.toFixed(2)), serializationMs: Number(serializationMs.toFixed(2)), manifestMs: Number(manifestMs.toFixed(2)), payloadBytes: Buffer.byteLength(canonical), errors: errors.length, totalRecords: manifest.totalRecords }));
}
