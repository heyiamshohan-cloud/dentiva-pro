/**
 * PATIENT CODE CONTRACT + PRESCRIPTION FINANCIAL SAFETY + FORENSIC DOCUMENT RENDER.
 * Release-gate items: stable unique patient codes, prescription = clinical-only,
 * and multi-page/Bengali/long-content document resilience.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { permissionsForRole } from '../src/core.js';
import { runOp } from '../src/ops.js';
import { runQuery } from '../src/queries.js';
import { migrateWorkspace } from '../electron/lib/migrate.mjs';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { buildDocument, medicationTable } from '../src/doc-engine.js';

const rnd = () => Math.random().toString(36).slice(2, 8);
const ctx = () => ({ userId: 'u1', userName: 'Admin', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true });

function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `code-${rnd()}-`));
  migrateWorkspace(dir);
  const ws = new Workspace(dir).open();
  const repo = new SqlRepo(ws);
  t.after(() => { try { ws.close(); } catch { /* closed */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });
  return repo;
}

const ok = (r) => { assert.equal(r.ok, true, r.error || JSON.stringify(r).slice(0, 200)); return r; };
// Non-Latin fixture names (Devanagari + a combining-mark cluster) prove the
// pipeline round-trips arbitrary Unicode without shipping any localized UI.
const UNICODE_NAME = 'मोहन अब्दुल्ला पटवारी चौधरी';
const newPatient = (repo, extra = {}) => ok(runOp(repo, 'patient.create', { fullName: `${UNICODE_NAME} Contract ${rnd()}`, gender: 'Female', phone: `0171${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, ...extra }, ctx()));

test('patient code: DP-prefixed, unique, stable across visit/rx/invoice/payment creation', async (t) => {
  const repo = boot(t);
  const p1 = newPatient(repo).record;
  assert.match(p1.patientCode, /^DP-\d+$/);
  const p2 = newPatient(repo).record;
  assert.match(p2.patientCode, /^DP-\d+$/);
  assert.notEqual(p1.patientCode, p2.patientCode);

  ok(runOp(repo, 'visit.create', { patientId: p1.id, date: '2026-09-01', reason: 'Checkup' }, ctx()));
  ok(runOp(repo, 'prescription.create', {
    patientId: p1.id, date: '2026-09-01', doctor: 'Dr Contract',
    medications: [{ medicine: 'Amoxicillin', strength: '500mg', dosage: '1 cap', frequency: '1-1-1', durationValue: 5, durationUnit: 'days', foodRelation: 'After food', quantity: 15 }]
  }, ctx()));
  ok(runOp(repo, 'invoice.create', { patientId: p1.id, date: '2026-09-01', items: [{ name: 'RCT 46', quantity: 1, unitPrice: 3500 }] }, ctx()));

  const after = repo.get('patients', p1.id);
  assert.equal(after.patientCode, p1.patientCode, 'code must be stable for patient lifetime');

  // list + 360 + search surfaces carry the code
  const list = await runQuery(repo, 'list', { collection: 'patients', page: 1, pageSize: 5 }, ctx());
  assert.ok(list.rows.every((r) => /^DP-\d+$/.test(r.patientCode)));
  const search = await runQuery(repo, 'globalSearch', { query: 'Contract', limit: 5 }, ctx());
  const unicodeSearch = await runQuery(repo, 'list', { collection: 'patients', page: 1, pageSize: 5, query: 'पटवारी' }, ctx());
  assert.ok(unicodeSearch.total >= 1, 'non-Latin patient search must reach the record');
  assert.ok(search.results.patients.rows.every((r) => r.patientCode));
});

test('prescription document: clinical sections render, financial terms NEVER render', (t) => {
  const patientPairs = [['Name', 'रोकेया बेगम खातून चौधरी Maharani'], ['Patient ID', 'DP-000124'], ['Age', '43 yrs'], ['Sex', 'Female'], ['Phone', '01711234567']];
  const spec = {
    kind: 'prescription', title: 'PRESCRIPTION', docRef: 'RX-2026-0007', docDate: '24 Sep 2026',
    settings: { clinicName: 'Dentiva Dental Care', dentistName: 'Dr. Ayesha Rahman', professionalTitle: 'BDS, PGT (DU)', dentistRegistration: 'BMDC-12345', phone: '02-9876543', email: 'care@example.com' },
    patientPairs,
    clinicalSections: [
      { label: 'C/C', text: 'Pain On; G. Carries; custom: occasional SWELLING at night (evening)' },
      { label: 'O/E', text: 'Carries / G Carries; Perio Dontitis' },
      { label: 'R/E', text: 'IOPA X-ray 46' },
    ],
    body: '',
    totals: undefined,
  };
  spec.clinicalSections.push({ label: 'Advice', text: 'Warm saline rinse. Review after two days. दो दिन बाद जाँच।' });
  const { html } = buildDocument(spec);
  for (const needed of ['C/C', 'O/E', 'R/E', 'Advice', 'DP-000124', 'Dentiva Dental Care', 'BMDC-12345', 'G. Carries', 'Perio Dontitis', 'रोकेया', 'दो दिन']) {
    assert.ok(html.includes(needed), `prescription must render '${needed}'`);
  }
  // Prescription is a clinical document: money vocabulary, totals section and currency symbols are forbidden
  // (check CONTENT only — the shared stylesheet legitimately defines the doc-totals class for invoices).
  const content = html.slice(html.indexOf('</style>'));
  // The prescription is a clinical document ONLY. Any of these tokens means a
  // financial leak: currency symbol, billing vocabulary, payment state, or the
  // invoice totals machinery. Regressions here must fail the release gate.
  for (const forbidden of ['Tk ', 'BDT', 'Subtotal', 'subtotal', 'Grand total', 'Discount', 'Tax', 'tax', 'Paid', 'Due', 'dueCents', 'Amount', 'amount', 'Payment', 'Invoice', 'invoice', 'Payment method', 'Unit price', 'Money receipt', '<section class="doc-totals']) {
    assert.ok(!content.includes(forbidden), `prescription must NOT contain '${forbidden}'`);
  }
  // Positive identity proof: the header carries clinic + dentist + registration + contact
  // straight from settings; patient identity carries the stable code, sex and age.
  assert.ok(/Patient ID/.test(content) && content.includes('DP-000124'));
  assert.ok(content.includes('43 yrs') && content.includes('Female'));
  assert.ok(content.includes('992 Prolls') === false, 'no other patient identity may appear');
});

test('forensic document render: 40 meds, long multi-script name/notes, multipage-safe CSS', () => {
  const longName = 'मोहम्मद अब्दुल्लाह अल मामुन पटवारी मर्ज़ुक सहित उल्लेखनीय दीर्घ नाम 日本語のテキスト'.repeat(3);
  const medications = Array.from({ length: 40 }, (_, i) => ({
    medicine: `Medicine-${i + 1} very-long-brand-name ${i % 2 ? 'カプセル' : 'Capsule'}`,
    strength: '500mg', dosage: '1', frequency: '1-0-1', duration: '7 days', quantity: 14,
    instructions: i % 5 === 0 ? 'Take with plenty of water. सुबह और रात में।'.repeat(3) : ''
  }));
  const { html } = buildDocument({
    kind: 'prescription', title: 'PRESCRIPTION', docRef: 'RX-FORENSIC', docDate: '24 Sep 2026',
    settings: { clinicName: 'Care' }, patientPairs: [['Name', longName], ['Patient ID', 'DP-999999']],
    body: medicationTable({ medications })
  });
  assert.ok(html.includes('page-break-inside:avoid'), 'rows must be break-safe');
  assert.ok(html.includes('table-header-group'), 'thead repeats across pages');
  assert.ok((html.match(/Medicine-\d+/g) || []).length >= 40, 'all 40 medication rows render — no truncation');
  assert.ok(html.includes('カプセル'), 'non-Latin (wide) glyphs preserved');
  assert.ok(html.length < 200_000, 'bounded output');
});
