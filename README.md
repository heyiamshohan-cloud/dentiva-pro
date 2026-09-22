# Dentiva Pro

**Premium offline-first dental practice management for Windows · v1.5.0**

Dentiva Pro is a local, relational dental-practice workspace for clinics in Bangladesh. v1.5.0 builds on the v1.4.0 **relational SQLite engine** (Node's built-in `node:sqlite`, zero native dependencies), a **shared service layer** with server-side validation, RBAC and audit, and a rebuilt **async, paginated renderer** on a light-only Design System 2.0.

The repository starts with an empty store by design. There are no sample patients, demo transactions, fake dashboard numbers or placeholder records — every record visible in the UI is created by the clinic.

## What changed in v1.4.0

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
- Light-only Design System 2.0: design tokens, premium shell, dashboard 3.0 with configurable widgets, ⌘K command palette, queue 2.0, dental chart 2.0 with preserved tooth history, patient timeline, statements, accounting with receivables aging, analytics with monthly trends, diagnostics, notifications 2.0, full EN/BN localization (449-entry Bengali dictionary, bn-BD formatters).
- Printing/PDF through an isolated, script-disabled window; PDF active content is never embedded.
- Security boundary: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, allowlisted IPC channels (one `invoke` in the preload, re-validated in main), CSP with `frame-ancestors 'none'`, navigation and webview guards, zero runtime npm dependencies, no network code of any kind.

## Flagship modules

- Dashboard command center: metric strip, today's schedule, queue ring, follow-ups due, operational signals; widget visibility/order persisted per workspace
- Patients: search (Latin + Bengali), filters (status, balance), saved views, duplicate warning, profile workspace with 14 tabs, merge with confirm, CSV import/export, 5,000-row export page
- Appointments: day/week/agenda, overlap detection with explicit confirm, queue serials, check-in/lifecycle, print queue
- Clinical: visits with follow-up automation, dental chart (adult + primary dentition, superseded history preserved), prescriptions with medication catalog, treatment plans with staged progress and explicit visit conversion, referrals with responses, follow-up tasks
- Finance: invoices with reprice lock, payments with receipts, partial refunds, balance adjustments, patient statements, billing/queue/print workflows
- Accounting: collected/billed/expenses/net, payment method mix, receivables aging (0–30/31–60/61–90/90+), expense categories
- Inventory: stock movements only (purchases/usage/corrections), negative stock blocked, low-stock + expiry signals, suppliers, stock valuation
- System: user accounts with effective-permission grid, settings 2.0 (identity, numbering, commerce, backup), backup/restore center with validation and module groups, diagnostics, notifications, help/about, local lock, first-run setup

## Requirements & performance

Verified on the real relational store (`scripts/dataset-benchmark.mjs`):

| Size | Records | List page 1 | Search (BN) | Revenue report | Backup |
|---|---|---|---|---|---|
| 1,000 patients | 9.5k | 2 ms | 3 ms | 3 ms | 42 ms |
| 10,000 patients | 94.6k | 2–18 ms | 23 ms | 15–32 ms | 171 ms |
| 25,000 patients | 236k | 5–38 ms | 55 ms | 33–67 ms | 410 ms |
| **100,000 patients** | **945k** | **18 ms** | **221 ms** | **138 ms** | **1.6 s (412 MB)** |

Integrity check passes at every size; patient statement stays under 1 ms.

## Development

```bash
npm install
npm run dev            # Vite dev server (browser mode on LocalRepo)
npm test               # node:test suite (55 tests)
npm run benchmark:datasets
npm run start:desktop  # build + Electron (desktop mode on SqlRepo)
```

Windows packaging and release: see [`docs/BUILD.md`](docs/BUILD.md). The Windows CI pipeline runs tests, build, Chromium viewport checks, portable/NSIS packaging, PE inspection, the portable launch/restart persistence smoke and checksum verification, then publishes the four release artifacts.

## Documentation

- [`docs/FINAL_AUDIT_REPORT_1.4.0.md`](docs/FINAL_AUDIT_REPORT_1.4.0.md) — audit and release report
- [`docs/V1.4.0_BASELINE_AUDIT.md`](docs/V1.4.0_BASELINE_AUDIT.md) — per-capability classification of v1.3.0 before the transformation
- [`docs/V1.4.0_REQUIREMENTS_MATRIX.md`](docs/V1.4.0_REQUIREMENTS_MATRIX.md) — requirement → evidence matrix
- [`docs/V1.4.0_EXECUTION_STATE.md`](docs/V1.4.0_EXECUTION_STATE.md) — execution checkpoint
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) · [`docs/BUILD.md`](docs/BUILD.md) · [`docs/CHANGELOG.md`](docs/CHANGELOG.md) · [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md)

## Privacy & safety

No cloud, no telemetry, no network code — this machine is the only copy. PINs are PBKDF2-hashed locally. Executable/script attachments are blocked, PDF active content is never embedded, and restores are validated with SHA-256 before anything is touched. Dentiva Pro records clinical decisions made by qualified professionals; it does not diagnose, prescribe or recommend treatment.

Created by Md. Shohan Khan · helloiamshohan@gmail.com
