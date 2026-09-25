/**
 * Long-history patient (v2.0.0 audit).
 *
 * A patient who has been with the clinic for years has hundreds of visits,
 * invoices and payments. Every one of them must be reachable from Patient 360,
 * page by page, with no silent truncation — and the renderer must actually be
 * wired to the paged queries (before v2.0.0 each tab fetched page 1 and
 * stopped: 20 timeline events, 25 visits, 50 referrals, 100 invoices).
 *
 * The tests below drive the same queries the UI drives, with the same page
 * size, and prove that paging walks the entire history exactly once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalRepo } from '../src/repo-local.js';
import { runOp } from '../src/ops.js';
import { runQuery } from '../src/queries.js';
import { permissionsForRole } from '../src/core.js';
import { makeSqlRepo, tempDir } from './helpers/harness.mjs';

const PATIENT_TAB_PAGE_SIZE = 50;
const ctx = () => ({
  userId: 'u_admin', userName: 'Admin', role: 'Administrator',
  permissions: permissionsForRole('Administrator'), firstRun: false,
  now: () => '2026-09-25T09:00:00.000Z', today: () => '2026-09-25'
});

const VISITS = 130;
const INVOICES = 130;
const PAYMENTS = 130;

/** Seed a patient with a long, internally-linked history. */
async function seedLongHistory(repo) {
  const c = ctx();
  const patient = (await runOp(repo, 'patient.create', { fullName: 'Long History Patient', phone: '01712345678' }, c)).record;
  const invoices = [];
  for (let i = 0; i < VISITS; i += 1) {
    const day = `20${22 + Math.floor(i / 60)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
    const visit = await runOp(repo, 'visit.create', { patientId: patient.id, date: day, reason: `Visit ${i + 1}`, diagnosis: 'Review' }, c);
    if (!visit.ok) throw new Error(`visit.create failed: ${visit.error}`);
    if (i < INVOICES) {
      const invoice = await runOp(repo, 'invoice.create', {
        patientId: patient.id, visitId: visit.record.id, date: day,
        items: [{ name: 'Consultation', quantity: 1, unitPrice: 500 }], taxRate: 0
      }, c);
      if (!invoice.ok) throw new Error(`invoice.create failed: ${invoice.error}`);
      invoices.push(invoice.record);
    }
  }
  for (let i = 0; i < PAYMENTS; i += 1) {
    const invoice = invoices[i];
    const payment = await runOp(repo, 'payment.record', {
      invoiceId: invoice.id, patientId: patient.id, amount: 200, method: 'Cash', date: invoice.date
    }, c);
    if (!payment.ok) throw new Error(`payment.record failed: ${payment.error}`);
  }
  return patient.id;
}

/** Walk every page of a query result set and return the concatenated rows. */
async function walkAllPages(repo, name, params, { pageSize = PATIENT_TAB_PAGE_SIZE, predicate = () => true } = {}) {
  const seen = [];
  const ids = new Set();
  let duplicates = 0;
  let page = 1;
  let total = null;
  for (;;) {
    const result = await runQuery(repo, name, { ...params, page, pageSize }, ctx());
    assert.equal(result.ok !== false, true, `${name} page ${page} failed: ${result.error || ''}`);
    if (total === null) total = Number(result.total || 0);
    const rows = (result.rows || []).filter(predicate);
    if (!rows.length) break;
    for (const row of rows) {
      if (ids.has(row.id)) duplicates += 1;
      ids.add(row.id);
      seen.push(row);
    }
    if (page > 200) throw new Error(`${name} paging did not terminate`);
    page += 1;
  }
  return { rows: seen, unique: ids.size, duplicates, total, pages: page - 1 };
}

test('every Patient 360 sub-list walks the full history of a long-standing patient', async (t) => {
  const dir = tempDir('long-history-');
  const { ws, repo } = makeSqlRepo(dir);
  t.after(() => ws.close());

  const patientId = await seedLongHistory(repo);

  const visits = await runQuery(repo, 'list', { collection: 'visits', page: 1, pageSize: PATIENT_TAB_PAGE_SIZE, filters: { patientId }, sort: 'date-desc' }, ctx());
  assert.equal(visits.total, VISITS, 'visit total must be exact, not a page length');

  const walked = await walkAllPages(repo, 'list', { collection: 'visits', filters: { patientId }, sort: 'date-desc' });
  assert.equal(walked.total, VISITS);
  assert.equal(walked.rows.length, VISITS, 'paging must reach every visit');
  assert.equal(walked.duplicates, 0, 'paging must never repeat a visit');
  assert.equal(walked.pages, Math.ceil(VISITS / PATIENT_TAB_PAGE_SIZE));

  const invoices = await walkAllPages(repo, 'list', { collection: 'invoices', filters: { patientId }, sort: 'date-desc' });
  assert.equal(invoices.total, INVOICES);
  assert.equal(invoices.rows.length, INVOICES);
  assert.equal(invoices.duplicates, 0);

  const payments = await walkAllPages(repo, 'list', { collection: 'payments', filters: { patientId }, sort: 'date-desc' });
  assert.equal(payments.total, PAYMENTS);
  assert.equal(payments.rows.length, PAYMENTS);
  assert.equal(payments.duplicates, 0);

  // The unified timeline is the widest surface: it merges nine collections and
  // must still hand back every event exactly once, page after page.
  const timeline = await walkAllPages(repo, 'patientTimeline', { patientId });
  const expectedEvents = VISITS + INVOICES + PAYMENTS;
  assert.equal(timeline.rows.length, expectedEvents, `timeline must expose all ${expectedEvents} events`);
  assert.equal(timeline.duplicates, 0, 'timeline paging must never repeat an event');
  const types = new Set(timeline.rows.map((row) => row.type));
  for (const type of ['visit', 'invoice', 'payment']) assert.ok(types.has(type), `timeline must include ${type} events`);
  // Renderer contract: the tab renders row.summary / row.type / row.record.status.
  for (const row of timeline.rows) {
    assert.equal(typeof row.summary, 'string', 'every timeline row carries a summary');
    assert.ok(row.summary.length > 0, 'timeline summaries are never blank');
    assert.equal(typeof row.date, 'string');
    assert.ok(row.record && typeof row.record === 'object', 'timeline rows carry their source record');
  }

  // Statement and ledger are the money surfaces: both must stay exact at this size.
  const statement = await runQuery(repo, 'patientStatement', { patientId, page: 1, pageSize: 25 }, ctx());
  assert.equal(statement.total, VISITS + PAYMENTS, 'statement paginates the whole ledger');
  const ledger = await runQuery(repo, 'patientLedgerQuery', { patientId, page: 1, pageSize: 25 }, ctx());
  assert.equal(Number(ledger.total), VISITS + PAYMENTS);
  assert.equal(Number(ledger.billedCents), INVOICES * 50000);
  assert.equal(Number(ledger.paidCents), PAYMENTS * 20000);
});

test('the JSON runtime exposes the same per-visit billing roll-up as SQLite', async (t) => {
  const dir = tempDir('long-history-local-');
  const { ws, repo: sql } = makeSqlRepo(dir);
  t.after(() => ws.close());
  const local = new LocalRepo();

  const detail = [];
  for (const [label, repo] of [['sql', sql], ['local', local]]) {
    const c = ctx();
    const patient = (await runOp(repo, 'patient.create', { fullName: `Rollup ${label}`, phone: '01712340000' }, c)).record;
    const visit = (await runOp(repo, 'visit.create', { patientId: patient.id, date: '2026-09-20', reason: 'Pain' }, c)).record;
    const invoice = (await runOp(repo, 'invoice.create', {
      patientId: patient.id, visitId: visit.id, date: '2026-09-20',
      items: [{ name: 'Consultation', quantity: 1, unitPrice: 800 }], taxRate: 0
    }, c)).record;
    await runOp(repo, 'payment.record', { invoiceId: invoice.id, patientId: patient.id, amount: 500, method: 'bKash', date: '2026-09-20' }, c);
    const rollup = await runQuery(repo, 'visitBilling', { visitIds: [visit.id, 'missing-visit'] }, c);
    const entry = (rollup.byVisit || {})[visit.id] || {};
    detail.push({
      billed: entry.billedCents, paid: entry.paidCents, due: entry.dueCents,
      invoices: (entry.invoices || []).map((row) => [row.invoiceNumber, row.totalCents, row.dueCents, row.status]),
      payments: (entry.payments || []).map((row) => [row.receiptNumber, row.amountCents, row.method]),
      missingIgnored: Object.keys(rollup.byVisit || {}).length === 1
    });
  }
  assert.deepEqual(detail[0], detail[1], 'both runtimes must roll up per-visit billing identically');
  assert.equal(detail[0].billed, 80000);
  assert.equal(detail[0].paid, 50000);
  assert.equal(detail[0].due, 30000);
  assert.equal(detail[0].missingIgnored, true, 'unknown visit ids are ignored, never invented');
});

test('the Patient 360 renderer pages every sub-list it renders', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  // Every patient sub-list must pass a page number to its query...
  const paged = [
    "collection: 'visits', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'invoices', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'payments', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'prescriptions', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'treatmentPlans', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'attachments', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'referrals', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "collection: 'followUpTasks', page, pageSize: PATIENT_TAB_PAGE_SIZE",
    "q('patientTimeline', { patientId: id, page, pageSize: PATIENT_TAB_PAGE_SIZE })"
  ];
  for (const needle of paged) assert.ok(source.includes(needle), `patient sub-list is not server-paged: ${needle}`);
  // ...and every one of them must render the pager the user walks with.
  for (const tab of ['visits', 'billing', 'payments', 'prescriptions', 'treatment-plan', 'attachments', 'referrals', 'followups', 'audit']) {
    assert.ok(source.includes(`patientTabPager('${tab}'`), `no pager rendered for the ${tab} tab`);
  }
  assert.ok(source.includes('data-tab="timeline"'), 'the timeline tab must offer its own pager');
  assert.ok(source.includes("case 'patient-tab-page'"), 'the pager action must be handled');
  // The timeline tab must render the fields the timeline payload actually
  // carries (summary/record), not fields it never had.
  assert.ok(source.includes('row.summary || row.title'), 'timeline rows must render their summary');
  assert.ok(!source.includes('${esc(row.title)}'), 'timeline must not render an undefined title');
});
