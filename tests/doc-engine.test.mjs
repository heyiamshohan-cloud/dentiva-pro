/** Document engine contract tests — single source for preview/print/PDF. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocument, clinicHeader, patientBlock, medicationTable, totalsSection, statementTable, signatureBlock } from '../src/doc-engine.js';

const settings = {
  clinicName: 'Dentiva Dental Care', dentistName: 'Dr. Aklima Sultana',
  professionalTitle: 'BDS, PGT (Oral Surgery)', dentistRegistration: 'BMDC-12345',
  chamberName: 'Gulshan Chamber', address: 'Road 11, Banani', city: 'Dhaka',
  phone: '01711111111', email: 'care@dentiva.example', clinicWebsite: 'www.dentiva.example',
  logo: 'data:image/png;base64,iVBORw0KGgo=', documentTemplate: { footer: 'Please bring this document to follow-up visits.' }
};

test('clinicHeader carries brand, prescriber, registration and contacts without hardcoding', () => {
  const html = clinicHeader({ settings, title: 'PRESCRIPTION', docRef: 'RX-0042', docDate: '2026-03-01' });
  for (const must of ['Dentiva Dental Care', 'Dr. Aklima Sultana', 'BDS, PGT', 'BMDC-12345', 'Road 11, Banani', 'www.dentiva.example', 'RX-0042']) {
    assert.ok(html.includes(must), `missing: ${must}`);
  }
  assert.ok(html.includes('doc-logo'), 'logo rendered from settings');
});

test('header omits empty optional fields cleanly', () => {
  const html = clinicHeader({ settings: { clinicName: 'Solo Practice' }, title: 'Invoice' });
  assert.ok(!html.includes('undefined'), 'no undefined leakage');
  assert.ok(!html.includes('Reg. no') , 'registration omitted when unset');
  assert.ok(html.includes('Solo Practice'));
});

test('medicationTable renders structured rows (form, pattern, food relation, qty)', () => {
  const html = medicationTable({ medications: [
    { medicine: 'Amoxicillin', form: 'Capsule', strength: '500 mg', genericName: 'Amoxicillin trihydrate', dosage: '1 capsule', frequency: '1-1-1', frequencyPattern: '1-1-1', foodRelation: 'After food', duration: '5 Days', quantity: 15, instructions: 'Complete the course' }
  ]});
  for (const must of ['Capsule Amoxicillin', '500 mg', '1 capsule', '1-1-1', '5 Days', 'Qty 15', 'Complete the course', '℞']) assert.ok(html.includes(must), `missing: ${must}`);
});

test('buildDocument assembles rx end-to-end with page rules + signature', () => {
  const { html, pageSize } = buildDocument({
    kind: 'prescription', settings, title: 'PRESCRIPTION', docRef: 'RX-0042', docDate: '23 Sep 2026',
    patientPairs: [['Name', 'Tanvir Ahmed'], ['Age', '41 yrs'], ['Sex', 'Male']],
    clinicalSections: [{ label: 'C/C', text: 'Toothache' }, { label: 'Advice', text: 'Warm saline rinse' }],
    body: medicationTable({ medications: [{ medicine: 'Flagyl', strength: '400 mg', frequency: '1-1-1', duration: '3 Days' }] }),
    footerStamp: '23 Sep 2026', pageSize: 'A4', lang: 'en'
  });
  assert.equal(pageSize, 'A4');
  for (const must of ['@page{ size:210mm 297mm', 'Tanvir Ahmed', 'C/C', 'Toothache', 'Advice', 'Flagyl', 'Dr. Aklima Sultana', 'BMDC-12345', 'Please bring this document', 'Generated on 23 Sep 2026']) assert.ok(html.includes(must), `missing: ${must}`);
  assert.ok(html.includes('<!doctype html>'), 'full document');
});

test('receipt size rules + no signature area on Receipt80', () => {
  const { html, pageSize } = buildDocument({ kind: 'invoice', settings, title: 'RECEIPT', pageSize: 'Receipt80', body: totalsSection({ pairs: [['Total', 'Tk 600']] , total: ['Paid', 'Tk 600'] }) });
  assert.equal(pageSize, 'Receipt80');
  assert.ok(html.includes('80mm 200mm'), 'thermal page rule');
  assert.ok(!html.includes('<div class="doc-sign-box">'), 'signature element suppressed on receipts (CSS rule remains but no box rendered)');
});

test('statementTable keeps running balance and foot summary', () => {
  const html = statementTable({
    rows: [{ date: '12 Jan', reference: 'INV-0001', type: 'Invoice', note: '2 item(s)', debitCents: 180000, creditCents: 0, balanceCents: 180000 },
           { date: '12 Jan', reference: 'RCP-0001', type: 'Payment', note: 'Cash', debitCents: 0, creditCents: 150000, balanceCents: 30000 }],
    summary: [['Lifetime billed', 'Tk 1,800.00'], ['Lifetime due', 'Tk 300.00']]
  });
  for (const must of ['INV-0001', 'RCP-0001', 'Lifetime billed', 'Lifetime due', 'Debit', 'Credit', 'Balance']) assert.ok(html.includes(must), `missing: ${must}`);
});

test('escaping: patient-supplied markup never reaches the document unescaped', () => {
  const html = clinicHeader({ settings: { clinicName: '<script>alert(1)</script> Clinic' }, title: 'X' });
  assert.ok(!html.includes('<script>alert'), 'script escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
});
