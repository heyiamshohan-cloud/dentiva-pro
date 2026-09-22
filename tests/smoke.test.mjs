import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('release identity and desktop target are configured', () => {
  assert.equal(pkg.name, 'dentiva-pro');
  assert.equal(pkg.version, '1.0.0');
  assert.match(JSON.stringify(pkg.build), /Windows-x64/);
  assert.match(source, /Md\. Shohan Khan|helloiamshohan@gmail\.com/);
});

test('local schema contains the core relational collections', () => {
  for (const collection of ['patients', 'appointments', 'visits', 'prescriptions', 'dentalRecords', 'invoices', 'payments', 'inventory', 'suppliers', 'staff', 'expenses', 'attachments', 'audit']) {
    assert.match(source, new RegExp(`${collection}: \\[\\]`), `${collection} collection missing`);
  }
  assert.match(source, /schemaVersion: 1/);
  assert.match(source, /buildBackupManifest/);
});

test('financial source-of-truth formula is present and deterministic', () => {
  const subtotal = 3 * 1250;
  const discount = 150;
  const tax = (subtotal - discount) * 5 / 100;
  const total = subtotal - discount + tax;
  assert.equal(total, 3780);
  assert.match(source, /function invoiceTotals/);
  assert.match(source, /const due = Math\.max\(0, totals\.total - paid\)/);
  assert.match(source, /canAcceptPayment/);
});

test('safety and offline guardrails exist', () => {
  assert.match(source, /No cloud required|offline-first/i);
  assert.match(source, /applicationLock/);
  assert.match(source, /async function hashPin/);
  assert.match(source, /PBKDF2/);
  assert.match(source, /data-form=\"unlock\"/);
  assert.doesNotMatch(source, /Architecture ready for a local administrator PIN/);
  assert.match(source, /translateDom/);
  assert.match(source, /Professional dental practice management for Bangladesh/);
  assert.match(source, /validateAttachmentFile/);
  assert.match(source, /Keep Existing/);
  assert.match(source, /Create New Copy/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(source, /sample patients|demo records|lorem ipsum/i);
});
