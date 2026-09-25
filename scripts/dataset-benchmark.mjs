// Dentiva Pro v2.0.0 — scale benchmark on the REAL relational store.
//
// Seeds synthetic patients + related records into a throwaway workspace
// (never the application store), then measures the operations the renderer
// actually performs: boot/migration, paginated listing, text search (name,
// patient code and phone), patient aggregate, statement, report stats,
// directory resolution and backup creation. Nothing is capped — the only
// limits are the machine's.
//
// Usage: node scripts/dataset-benchmark.mjs [size1,size2,...]

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../electron/lib/db.mjs';
import { SqlRepo } from '../electron/lib/repo-sql.mjs';
import { migrateWorkspace, ensureStateMeta } from '../electron/lib/migrate.mjs';
import { createBackup } from '../electron/lib/backup.mjs';
import { runQuery } from '../src/queries.js';
import { APP_VERSION } from '../src/migrate-state.js';
import { permissionsForRole } from '../src/core.js';

const sizes = process.argv[2] ? process.argv[2].split(',').map(Number) : [1000, 10000, 25000, 100000];

const ctx = { userId: 'bench', userName: 'Benchmark', role: 'Administrator', permissions: permissionsForRole('Administrator') };

function seededPatientCount(repo) {
  return repo.listPatients({ page: 1, pageSize: 1 }).total;
}

function seed(directory, size) {
  migrateWorkspace(directory);
  const ws = new Workspace(directory).open();
  const repo = new SqlRepo(ws);
  ensureStateMeta(ws);
  const nowIso = new Date().toISOString();

  // Catalogs first (small, realistic).
  ws.transaction(() => {
    for (let i = 0; i < 40; i += 1) {
      repo.insert('inventory', { id: `stock_${i}`, itemCode: `IT-${i + 1}`, name: `Stock Item ${i + 1}`, category: 'Consumable', unit: 'pcs', purchasePrice: 50 + i, salePrice: 80 + i, currentStock: 100 + i, minimumStock: 10, reorderThreshold: 10, createdAt: nowIso });
    }
    for (let i = 0; i < 12; i += 1) repo.insert('suppliers', { id: `sup_${i}`, name: `Supplier ${i + 1}`, phone: `017100000${i}`, createdAt: nowIso });
    for (let i = 0; i < 8; i += 1) repo.insert('staff', { id: `staff_${i}`, staffCode: `STF-${i + 1}`, name: `Dentist ${i + 1}`, role: 'Dentist', createdAt: nowIso });
    for (let i = 0; i < 20; i += 1) repo.insert('treatments', { id: `trt_${i}`, code: `TRT-${i + 1}`, name: `Treatment ${i + 1}`, category: 'General', defaultPrice: 1000 + i * 100, duration: 30, createdAt: nowIso });
  });

  // The heavy part: one patient with a realistic record fan-out.
  const patientsPerBatch = 5000;
  for (let start = 0; start < size; start += patientsPerBatch) {
    const end = Math.min(size, start + patientsPerBatch);
    ws.transaction(() => {
      for (let i = start; i < end; i += 1) {
        const pId = `p_${i}`;
        const code = `PT-${String(i + 1).padStart(6, '0')}`;
        const name = i % 500 === 0 ? 'बेंचमार्क मरीज़' : `Benchmark Patient ${i + 1}`;
        repo.insert('patients', { id: pId, patientCode: code, fullName: name, phone: `017${String(i).padStart(8, '0')}`, registrationDate: '2026-01-15', status: 'Active', balanceCents: 0, createdAt: nowIso });
        repo.insert('visits', { id: `v_${i}`, visitCode: `V-${String(i + 1).padStart(6, '0')}`, patientId: pId, date: '2026-08-20', reason: 'Benchmark check', diagnosis: 'Review', createdAt: nowIso });
        repo.insert('appointments', { id: `a_${i}`, appointmentCode: `APT-${String(i + 1).padStart(6, '0')}`, patientId: pId, date: '2026-09-15', time: '09:00', duration: 30, status: 'Completed', createdAt: nowIso });
        repo.insert('prescriptions', { id: `rx_${i}`, prescriptionCode: `RX-${String(i + 1).padStart(6, '0')}`, patientId: pId, date: '2026-08-20', doctor: 'Dr. Bench', medications: [{ medicine: 'Amoxicillin', strength: '500mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '5 days', route: 'Oral' }], createdAt: nowIso });
        repo.insert('dentalRecords', { id: `d_${i}`, patientId: pId, tooth: (i % 32) + 1, dentition: 'adult', status: 'Restored', note: 'Filling', superseded: false, createdAt: nowIso });
        repo.insert('referrals', { id: `ref_${i}`, patientId: pId, date: '2026-08-25', referralTo: 'Ortho Clinic', reason: 'Review', status: 'Closed', createdAt: nowIso });
        repo.insert('followUpTasks', { id: `fu_${i}`, patientId: pId, title: 'Follow-up: review', dueDate: '2026-09-25', status: 'Open', createdAt: nowIso });
        const total = 1500 + (i % 100) * 10;
        const paid = total - 500;
        repo.insert('invoices', { id: `inv_${i}`, invoiceNumber: `INV-${String(i + 1).padStart(6, '0')}`, patientId: pId, date: '2026-08-20', items: [{ name: 'Treatment 1', quantity: 1, unitPrice: total, total }], subtotal: total, discount: 0, taxRate: 0, tax: 0, total, paid, due: 500, status: paid >= total ? 'Paid' : 'Partially Paid', createdAt: nowIso });
        repo.insert('payments', { id: `pay_${i}`, receiptNumber: `RCP-${String(i + 1).padStart(6, '0')}`, invoiceId: `inv_${i}`, patientId: pId, amount: paid, refundedAmount: 0, date: '2026-08-20', method: i % 2 ? 'bKash' : 'Cash', status: 'Recorded', createdAt: nowIso });
        if (i % 4 === 0) repo.insert('stockMovements', { id: `mov_${i}`, itemId: `stock_${i % 40}`, type: 'Usage', quantity: -2, before: 100, after: 98, date: '2026-08-20', reason: 'Clinic use', createdAt: nowIso });
        if (i % 10 === 0) repo.insert('treatmentPlans', { id: `plan_${i}`, patientId: pId, title: `Plan ${i + 1}`, status: 'Completed', stages: [{ id: `st_${i}`, title: 'Stage 1', status: 'Completed' }], createdAt: nowIso });
        if (i % 10 === 0) repo.insert('expenses', { id: `exp_${i}`, description: `Utility ${i + 1}`, amount: 250, date: '2026-08-01', category: 'Utilities', method: 'Cash', createdAt: nowIso });
      }
    });
  }
  return { ws, repo };
}

/**
 * Measure a step and report the MEDIAN of `repeat` runs. A single timing on a
 * shared machine is dominated by whichever other process happened to run at
 * that instant (observed swings of 3–10x on identical code), so the recorded
 * figure is the median and the raw spread is kept for the audit trail.
 */
async function time(label, fn, { repeat = 3 } = {}) {
  const samples = [];
  let value;
  for (let i = 0; i < repeat; i += 1) {
    const start = performance.now();
    value = await Promise.resolve(fn());
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const ms = sorted[Math.floor(sorted.length / 2)];
  const spread = repeat > 1 ? `  (median of ${repeat}: ${samples.map((n) => n.toFixed(1)).join(', ')})` : '';
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(1).padStart(9)} ms${spread}`);
  return { value, ms, samples };
}

for (const size of sizes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `dentiva-bench-${size}-`));
  try {
    console.log(`\n── size ${size} patients (≈${Math.round(size * 2.2)} total records) ──`);
    const seedStart = performance.now();
    const { ws, repo } = seed(directory, size);
    const seedMs = performance.now() - seedStart;
    console.log(`  seed (transactional inserts)                    ${seedMs.toFixed(1).padStart(9)} ms`);

    // Re-open as a cold start (migration path must be a no-op).
    ws.close();
    const { ms: openMs } = await time('cold open + migration no-op', () => {
      const w = new Workspace(directory).open();
      w.close();
    });
    const ws2 = new Workspace(directory).open();
    const repo2 = new SqlRepo(ws2);

    const counts = repo2.counts();
    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`  total records in store                          ${String(totalRecords).padStart(9)}`);

    await time('patient list page 1 (25 rows)', () => runQuery(repo2, 'list', { collection: 'patients', page: 1, pageSize: 25, sort: 'name' }, ctx));
    const lastPage = Math.ceil(size / 25);
    await time(`patient list last page (${lastPage})`, () => runQuery(repo2, 'list', { collection: 'patients', page: lastPage, pageSize: 25, sort: 'name' }, ctx));
    await time('patient list with aggregates + sort=balance', () => runQuery(repo2, 'list', { collection: 'patients', page: 1, pageSize: 25, sort: 'balance', filters: { includeAggregates: true } }, ctx));
    await time('aggregated patient search + sort=visits-desc', () => runQuery(repo2, 'list', { collection: 'patients', query: 'Benchmark', page: 1, pageSize: 25, sort: 'visits-desc', filters: { includeAggregates: true } }, ctx));
    await time('patient search "Benchmark Patient 4" (Latin)', () => runQuery(repo2, 'list', { collection: 'patients', query: 'Benchmark Patient 4' }, ctx));
    await time('patient search "बेंचमार्क" (non-Latin Unicode)', () => runQuery(repo2, 'list', { collection: 'patients', query: 'बेंचमार्क' }, ctx));
    await time('appointment list page 1', () => runQuery(repo2, 'list', { collection: 'appointments', page: 1, pageSize: 30, sort: 'date-desc' }, ctx));
    await time('invoices outstanding filter', () => runQuery(repo2, 'list', { collection: 'invoices', page: 1, pageSize: 25, filters: { outstanding: true } }, ctx));
    await time('directory (name resolution, 2000 cap)', () => runQuery(repo2, 'directory', {}, ctx));
    await time('patient aggregate (timeline + counts)', () => runQuery(repo2, 'patientAggregate', { patientId: 'p_0' }, ctx));
    await time('patient statement', () => runQuery(repo2, 'patientStatement', { patientId: 'p_0' }, ctx));
    await time('invoice detail', () => runQuery(repo2, 'invoiceDetail', { invoiceId: 'inv_0' }, ctx));
    await time('report revenue (all)', () => runQuery(repo2, 'report', { type: 'revenue', rangeKey: 'all' }, ctx));
    await time('accounting summary (aging + methods)', () => runQuery(repo2, 'accountingSummary', { rangeKey: 'all' }, ctx));
    await time('analytics (monthly trends)', () => runQuery(repo2, 'analytics', { rangeKey: 'year' }, ctx));
    await time('global search "Benchmark" (command palette)', () => runQuery(repo2, 'globalSearch', { query: 'Benchmark', limit: 5 }, ctx));
    await time('audit list page 1', () => runQuery(repo2, 'auditList', { page: 1, pageSize: 50 }, ctx));
    await time('integrity check (all tables)', () => ws2.integrityCheck(), { repeat: 2 });
    const backup = (await time('backup (VACUUM INTO + attachments + manifest)', () => createBackup(ws2, { label: 'bench' }), { repeat: 1 })).value;
    const storage = ws2.storageInfo();
    console.log(`  database size                                   ${storage.bytes.toLocaleString().padStart(9)} B`);
    console.log(`  integrity ok                                    ${String(ws2.integrityCheck().ok).padStart(9)}`);
    console.log(`  backup created                                  ${backup.ok ? 'yes' : `no — ${backup.error}`}`);
    ws2.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
console.log(`\nDentiva Pro v${APP_VERSION} scale benchmark complete — synthetic data, throwaway workspaces.`);
