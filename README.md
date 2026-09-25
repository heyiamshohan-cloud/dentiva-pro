# Dentiva Pro

**Premium offline-first dental practice management for Windows · v2.0.0**

Dentiva Pro is a local, relational dental-practice workspace for clinics in Bangladesh. It runs entirely on the clinic's own machine: a **relational SQLite engine** (Node's built-in `node:sqlite`, zero native dependencies), a **shared service layer** with server-side validation, RBAC and audit, and an **async, paginated renderer** on a light-only design system. This machine is the only copy of the data — there is no cloud, no telemetry and no network code.

v2.0.0 is the final audit and hardening cycle. It fixes every defect found by a full-surface forensic pass over both runtimes (see the findings table in [`docs/V2_FINAL_RELEASE_AUDIT.md`](docs/V2_FINAL_RELEASE_AUDIT.md)), including several that no previous audit had caught:

- **the patient picker now exists at all** — the searchable picker called a query that was never implemented, so no patient-selecting form could work (`V2-08`);
- **the desktop `directory` query no longer fails**, which is what had been emptying every picker and rendering "Unassigned patient" (`V2-01`);
- **goodwill adjustments are treated as credits** everywhere, so a patient's balance is never inflated by twice the adjustment (`V2-09`);
- **"today" is the clinic's calendar day**, not UTC's — invoices, payments, the queue, aging buckets and report windows no longer slip a day in the early-morning hours (`V2-10`);
- **refunds reduce the net operating KPI** exactly once, while gross collections stay gross (`V2-07`);
- **the product UI is English-only** — the bilingual layer and its Bengali dictionary are gone (`V2-05`);
- **list ordering is identical in both runtimes** (the same list can no longer come back in a different order in desktop vs browser mode) (`V2-11`), and every query payload carries its patient's name and code, so a lifetime practice never shows "Unassigned patient" (`V2-12`).

The repository starts with an empty store by design. There are no sample patients, demo transactions, fake dashboard numbers or placeholder records — every record visible in the UI is created by the clinic.

## Verification status for v2.0.0

| Gate | Result |
|---|---|
| `npm test` (unit + integration, both runtimes) | 142 tests — 140 pass, 0 fail, 2 skipped |
| `node scripts/v2-audit/differential-probe.mjs` (SQL vs JSON engine) | 0 findings |
| `node scripts/v2-audit/surface-sweep.mjs` (every op, query, collection, sort key) | 0 failures |
| Scale (1k → 100k patients) | measured to 100,000 patients / 945,086 records / 394 MB |

Performance and its honest limits, plus the defects fixed in this cycle, are documented in [`docs/V2_FINAL_RELEASE_AUDIT.md`](docs/V2_FINAL_RELEASE_AUDIT.md) and [`docs/V2_FINAL_ENGINEERING_CHECKPOINT.md`](docs/V2_FINAL_ENGINEERING_CHECKPOINT.md).

## Earlier architecture (introduced in v1.4.0)

**Storage (Phase 2)**
- Relational schema layout v1 on `node:sqlite`: 26 collection tables, typed money columns (`INTEGER` cents), enforced foreign keys (RESTRICT), ~40 indexes, WAL journaling, append-only audit table.
- No artificial limits anywhere — no 200 MB database cap, no 6 MB attachment cap, no record-count caps. Scale is limited only by the machine (benchmarked at 100,000 patients / 945,000 records).
- Safe migration from v1.3.0 (`v4` sql.js database or legacy JSON) with quarantine-not-delete orphan handling, dangling-reference repair (column nulled, payload preserved), exact integer-cent balance recomputation, attachment externalization to a file store, user-secret sanitization, source files preserved (`.v4-preserved.sqlite`) and corruption recovery from the retained `.bak` copy.

**Service layer (Phase 3)**
- One shared operation registry (`src/ops.js`, ~50 operations) and query registry (`src/queries.js`) executed by **both** the Electron main process (SqlRepo) and the browser development mode (LocalRepo) — validation, financial math, inventory guards and audit descriptors can never diverge between runtimes.
- Money invariants enforced server-side: integer cents everywhere, overpayment blocked, invoice re-pricing locked once money exists, refunds never mutate the original payment, forgiveness adjustments capped at the due balance, patient balance cache always consistent with the ledger.
- Server-side RBAC on every operation and query (the UI only hides; the backend enforces), audit entries attributed to the live session, PBKDF2-SHA-256 PIN verification (210k iterations, legacy 120k hashes verified and upgraded on first login) with 5-failure/30-second lockout stored in the database.
- Backup engine: `VACUUM INTO` consistent snapshot + attachment files + SHA-256 manifest; restore validates first, always writes a pre-restore safety backup, and supports v1.3.0 JSON backups with module groups (patients / clinical / finance / operations) and explicit conflict strategies (Keep Existing / Replace / Create New Copy).
- Workspace diagnostics: integrity check, FK violations, storage facts, record counts, free disk.

**Renderer (Phases 4–8)**
- Rebuilt as a pure presentation client over `src/api.js` (`DesktopApi` over the validated IPC bridge, `LocalApi` over `LocalRepo` in browser dev mode). Every page is async and **server-side paginated** — the renderer never holds a full collection and never renders unbounded row sets.
- Light-only design system: design tokens, premium shell, configurable dashboard widgets, ⌘K command palette (debounced; searches patients, appointments, invoices, payments, visits and prescriptions), queue, dental chart with preserved tooth history, patient timeline, statements, accounting with receivables aging, analytics with monthly trends, diagnostics and notifications. The product interface is English-only; patient names and clinical text accept any Unicode script.
- Printing/PDF through an isolated, script-disabled window; PDF active content is never embedded.
- Security boundary: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, allowlisted IPC channels (one `invoke` in the preload, re-validated in main), CSP with `frame-ancestors 'none'`, navigation and webview guards, zero runtime npm dependencies, no network code of any kind.

## Flagship modules

- Dashboard command center: metric strip, today's schedule, queue ring, follow-ups due, operational signals; widget visibility/order persisted per workspace
- Patients: search by name, code, phone, email or address (any Unicode script), filters (status, balance), saved views, duplicate warning, profile workspace with 14 tabs, merge with confirm, CSV import/export, 5,000-row export page
- Appointments: day/week/agenda, overlap detection with explicit confirm, queue serials, check-in/lifecycle, print queue
- Clinical: visits with follow-up automation, dental chart (adult + primary dentition, superseded history preserved), prescriptions with medication catalog, treatment plans with staged progress and explicit visit conversion, referrals with responses, follow-up tasks
- Finance: invoices with reprice lock, payments with receipts, partial refunds, balance adjustments, patient statements, billing/queue/print workflows
- Accounting: collected/billed/expenses/net, payment method mix, receivables aging (0–30/31–60/61–90/90+), expense categories
- Inventory: stock movements only (purchases/usage/corrections), negative stock blocked, low-stock + expiry signals, suppliers, stock valuation
- System: user accounts with effective-permission grid, settings 2.0 (identity, numbering, commerce, backup), backup/restore center with validation and module groups, diagnostics, notifications, help/about, local lock, first-run setup

## Requirements & performance

Measured medians (median of 3 runs) on the real relational store with
`node scripts/dataset-benchmark.mjs 1000,10000,25000,50000,100000`:

| Size | Records | DB size | Patient list p1 | Patient search | Revenue report | Backup |
|---|---|---|---|---|---|---|
| 1,000 patients | 9.5k | 4.4 MB | 0.7 ms | 2.6 ms | 2.6 ms | 29 ms |
| 10,000 patients | 94.6k | 39 MB | 1.4 ms | 23 ms | 13 ms | 168 ms |
| 25,000 patients | 236k | 98 MB | 4.0 ms | 55 ms | 57 ms | 388 ms |
| 50,000 patients | 473k | 196 MB | 5.8 ms | 94 ms | 74 ms | 984 ms |
| **100,000 patients** | **945k** | **394 MB** | **15.8 ms** | **203 ms** | **142 ms** | **2.3 s** |

Integrity check passes at every size; a patient statement stays under 1 ms.
Pages are paginated end to end — the renderer never hydrates a full collection.

**Known limit, stated plainly:** text search is a case-insensitive substring scan
across the searched columns, so its cost grows with the record count. A patient
search is ~200 ms and a command-palette search is ~800 ms on a 100,000-patient
database (945k records, ~400 MB). The palette is debounced so typing stays
smooth, results are never truncated, and an FTS index is the planned v2.1
improvement. Full numbers: [`docs/V2_FINAL_RELEASE_AUDIT.md`](docs/V2_FINAL_RELEASE_AUDIT.md).

## Development

```bash
npm install
npm run dev            # Vite dev server (browser mode on LocalRepo)
npm test               # node:test suite (142 tests)
npm run benchmark:datasets
npm run start:desktop  # build + Electron (desktop mode on SqlRepo)
```

Windows packaging and release: see [`docs/BUILD.md`](docs/BUILD.md). The Windows CI pipeline (`windows-latest`) runs the test suite, the renderer build, the Chromium viewport checks, portable/NSIS/ZIP packaging, ASAR runtime-closure verification, PE inspection, a portable-launch + silent-install + uninstall smoke, and checksum verification, then publishes the four release artifacts (portable `.exe`, NSIS `Setup.exe`, ZIP, `checksums.txt`).

## Documentation

- [`docs/V2_FINAL_RELEASE_AUDIT.md`](docs/V2_FINAL_RELEASE_AUDIT.md) — **v2.0.0 release audit**: every defect found and fixed, the evidence for each fix, measured performance and honest limitations
- [`docs/V2_FINAL_ENGINEERING_CHECKPOINT.md`](docs/V2_FINAL_ENGINEERING_CHECKPOINT.md) — durable engineering checkpoint for the v2.0.0 cycle
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) · [`docs/BUILD.md`](docs/BUILD.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md)
- Historical audits (kept as a record of earlier releases): [`docs/FINAL_AUDIT_REPORT_1.4.0.md`](docs/FINAL_AUDIT_REPORT_1.4.0.md), [`docs/V1.4.0_BASELINE_AUDIT.md`](docs/V1.4.0_BASELINE_AUDIT.md), [`docs/V1.4.0_REQUIREMENTS_MATRIX.md`](docs/V1.4.0_REQUIREMENTS_MATRIX.md), [`docs/V1.4.0_EXECUTION_STATE.md`](docs/V1.4.0_EXECUTION_STATE.md)

## Privacy & safety

No cloud, no telemetry, no network code — this machine is the only copy. PINs are PBKDF2-hashed locally. Executable/script attachments are blocked, PDF active content is never embedded, and restores are validated with SHA-256 before anything is touched. Dentiva Pro records clinical decisions made by qualified professionals; it does not diagnose, prescribe or recommend treatment.

Created by Md. Shohan Khan · helloiamshohan@gmail.com
