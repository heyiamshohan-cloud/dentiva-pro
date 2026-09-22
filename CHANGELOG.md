# Changelog

## v1.4.0 — Relational engine, shared service layer, premium light UI

**Storage**
- Replaced the sql.js whole-state store with a relational `node:sqlite` workspace (layout v1): 26 collection tables, integer-cent money columns, enforced foreign keys, ~40 indexes, WAL journaling, append-only audit.
- Removed every artificial limit: no 200 MB database cap, no 6 MB attachment cap, no record caps. Scale is limited only by hardware (benchmarked: 100,000 patients / 945,086 records, page-1 list 18 ms, backup of a 412 MB store 1.6 s).
- v1.3.0 migration (v4 sql.js DB, legacy JSON, corrupt-primary `.bak` recovery, future v5 `.bak` recovery): quarantines orphans with reasons, repairs dangling references (column nulled, payload preserved), recomputes exact integer-cent balances, externalizes inline attachment bytes to a file store, sanitizes user secrets, preserves the source file (`.v4-preserved.sqlite`) and is idempotent on re-run.
- Backup engine: consistent `VACUUM INTO` snapshot + attachment files + SHA-256 manifest; restore validates first and always keeps a pre-restore safety backup; v1.3.0 JSON backups restore with module groups (patients / clinical / finance / operations) and Keep Existing / Replace / Create New Copy strategies; folder and file pickers; backup listing, pruning and deletion with containment checks.
- Diagnostics: integrity + FK checks, storage facts, per-collection counts, free disk, issue report; last-shutdown health recorded at quit.

**Service layer**
- Shared `src/ops.js` registry (~50 operations) and `src/queries.js` registry executed by both runtimes (Electron main SqlRepo, browser LocalRepo) — one source of truth for validation, money math, inventory guards and audit.
- Financial invariants enforced server-side: overpayment blocked; invoice re-pricing blocked once payments/adjustments exist (explicit error, never silent); refunds write Refund entries and never mutate the original payment; adjustments capped at the due balance; patient balance cache always consistent (including forgiveness adjustments).
- Server-side RBAC on every operation and query; audit entries written server-side and attributed to the live session; session timeout from settings.
- Auth: PBKDF2-SHA-256 with per-user salt (210k iterations; v1.3.0 120k renderer hashes verified and upgraded on first successful login); 5-failure/30-second lockout persisted in the users table; first-run setup creates the administrator account.
- New operations: `workspace.reset` (typed-RESET confirm; wipes records, preserves accounts + settings), `medicationCatalog.save`, `dental.removeCurrent`, `invoice` reprice-lock, movement vocabulary normalization (v1.3.0 `Stock-out`/`Expired`/`Damaged` mapped onto the canonical vocabulary).

**IPC / Electron**
- ESM main process (`electron/main.mjs`) importing the shared service layer; hardened window (context isolation, no Node integration, sandbox, web security); navigation + webview guards; CSP `frame-ancestors 'none'`; single-instance lock; graceful shutdown with health metadata; future-layout guard (`unsupportedSchema`) blocks silent overwrite and offers export + reset.
- Preload exposes a single allowlisted `invoke` (19 channels); all identity comes from the main-process session — never from the renderer.
- PDF printing through an isolated, script-disabled window with blocked-content validation; receipts support the 80 mm profile.

**Renderer**
- Rebuilt as an async, server-side-paginated client over `src/api.js` (DesktopApi / LocalApi). No page hydrates a full collection; lists paginate with server counts; patient lookups resolve through a capped directory query.
- Design System 2.0, light-only: design tokens, premium shell, dashboard 3.0 (configurable widgets), ⌘K command palette, queue 2.0, dental chart 2.0 (preserved tooth history, dentitions), patient timeline, statements, accounting with receivables aging, analytics with monthly trends, diagnostics, notifications 2.0, saved views, first-run setup, local lock.
- Localization: 449-entry EN/BN dictionary carried over 1:1, bn-BD number/date formatters, `translateDom` pass over rendered output.
- All v1.3.0 workflows preserved: patients (merge, CSV import/export, saved views), appointments (day/week/agenda, overlap confirm), queue, visits, dental, prescriptions (medication catalog), treatment plans (stage cycling, explicit visit conversion), billing (reprice lock), payments/refunds/adjustments, expenses, inventory (movements, low stock, expiry), suppliers, staff, referrals, follow-ups, attachments (inert previews, on-demand content), users (effective-permission grid), settings, backup/restore (module groups + strategies), notifications, printing (invoice, receipt, prescription, statement, chart, queue, billing, visit, expense, patient summary).

**Testing**
- 55-test `node:test` suite: smoke (architecture + guardrails + i18n), security (boundary, PDF, no telemetry, no caps, PBKDF2, server-side RBAC), storage (relational persistence, v4/legacy/corrupt migration, backup round-trip with tamper rejection, FK violation detection), workflows (financial formulas, restore strategies, RBAC templates), domain.
- Functional suites verified against both repos: ~60-check ops/queries smoke (SQL + browser parity) and backup/restore/diagnostics round-trip.
- Scale benchmark on the real store: 1k / 10k / 25k / 100k patients.
- `npm audit`: 0 vulnerabilities. Zero runtime dependencies.

**Known limitations**
- The Electron GUI cannot run in the Linux sandbox; the packaged-app smoke (launch/restart persistence, PE checks, packaging) runs in Windows CI as release gating.
- Installed-app launch/restart/uninstall smoke remains manual user verification (unchanged policy from v1.3.0).

## 1.3.0 — 2026-09-22 — published

### Command center and insight surfaces

- Added deterministic analytics projections for period bounds, collections, expenses, net operating result, completion/no-show rates, payment mix and six-month trends.
- Added a configurable dashboard widget command center, expanded command palette actions, actionable notification page and diagnostics workspace.
- Added persisted derived-notification read state for queue, follow-up, stock, expiry, balance and backup signals.
- Added flagship responsive/reduced-motion CSS for analytics, diagnostics, notifications, patient alerts and custom fields while retaining the light-only design system.

### Patient and clinical workflows

- Expanded patient validation and profile context with status/archive handling, age, important alerts, preferred contact, normalized tags and configured custom fields.
- Expanded treatment plans with clinical goals, procedures, tooth numbers, estimated duration, estimated cost, discounts, estimated totals, responsible dentist, statuses and stage progress.
- Added Day, Week, Month and Agenda appointment views, room capture and room-aware overlap messaging alongside existing dentist/chair/duration checks.
- Added structured multi-medicine prescriptions, a local saved medication catalog and reusable prescription fields while preserving first-medicine compatibility and print behavior.
- Expanded patient profiles with appointments, payments, follow-ups, notes and patient-audit sections; treatment plans can create an explicit clinical visit without creating financial transactions.
- Added patient timeline/statement domain projections and routed the profile financial statement and print statement through the same source-of-truth helper.

### Persistence, security and release hygiene

- Bumped the renderer/store schema to v4 with normalized room records, custom-field migration defaults and backup/restore coverage for medication catalog, notification rules and rooms.
- Expanded permission vocabulary and operation-level guards for analytics, diagnostics, imports/exports, plans, rooms, notifications, attachments and backup validation.
- Upgraded the build toolchain to Electron 44.4.3 and electron-builder 26.15.3; complete `npm audit` reports zero vulnerabilities in the resolved dependency tree.
- Added deterministic domain tests; the local Node suite now passes 46 tests and the Vite production build passes.
- Updated release identity and documentation for the new v1.3.0 semantic version. v1.0.0, v1.1.0 and v1.2.0 remain preserved.
- Windows CI run `35710031145` passed the six viewport, packaging, PE, portable persistence, ZIP and checksum gates and published the v1.3.0 release with the portable EXE, NSIS installer, application ZIP and checksum asset.
- The Windows installed-app launch/restart/uninstall smoke remains intentionally excluded from automated release gating and is **MANUAL USER VERIFICATION REQUIRED**.

## 1.2.0 — 2026-09-22 — published

### Persistence and security

- Replaced the fragile desktop JSON persistence path with bundled `sql.js` SQLite tables, atomic staged writes, verified backup recovery, attachment management, a 200 MB guardrail and non-destructive v1.1 JSON migration.
- Added local practice user accounts with staff association, active/inactive state, failed-attempt lockout, last-login/session state and salted PBKDF2-SHA-256 PIN hashes.
- Added permission-enforced role templates for Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role. Protected operations check authorization in handlers rather than relying only on button visibility.
- Added schema v3 collections for users and treatment plans while preserving v1.1 relational history and restore compatibility.

### Verification and release hygiene

- Added SQLite persistence, legacy migration, attachment externalization and corrupt-current/backup-recovery tests.
- Added role-template and underlying permission regression tests; the local suite passes 37 tests and the Vite production build passes.
- Added stage-based treatment plans, patient financial statement views/print output, queue wait-time signals and a validated patient CSV mapping/import preview with duplicate policy and rollback.
- Updated the release checklist, audit report, README, user guide and persistent v1.2 phase log. The installed-app launch/restart/uninstall sequence is explicitly marked **MANUAL USER VERIFICATION REQUIRED** and removed from automated release blocking. Windows CI run `35699971425` published the four required v1.2.0 artifacts without changing v1.0.0 or v1.1.0.

## 1.1.0 — 2026-09-22

### Audit and safety hardening

- Introduced schema-v2 migration defaults and a durable Electron JSON store with atomic fsync/rename writes, last-known-good recovery and a 200 MB safety ceiling.
- Added structured backup validation, canonical SHA-256 payload hashes, patient/module selective restore, conflict-safe relationship remapping and snapshot rollback.
- Hardened PDF generation against active and remote resources; kept Electron context isolation, sandbox, no Node integration, navigation restrictions and CSP.
- Added regression coverage for malformed backups, orphan relationships, refunds, resource conflicts, ID remapping and canonical serialization.

### Workflow upgrades

- Added auditable payment refunds/reversals with adjustment records, effective payment totals and invoice/report reconciliation.
- Added inventory purchase, usage, stock-out, expiry, damage and correction movements with negative-stock protection.
- Added configurable payment methods, A4/Letter/80 mm receipt profiles, clinic-logo validation, attachment metadata/edit/preview/download and visit links.
- Added custom report ranges, PDF export, patient advanced search filters, derived action notifications, audit-log view and 50-row patient pagination for large directories.
- Added appointment chair/dentist duration-overlap checks and expanded relationship/integrity checks.

## 1.0.0 — 2026-09-22

- Created the Dentiva Pro offline-first practice workspace.
- Added empty, local record store with schema versioning and structured backup metadata.
- Added patient directory and profile workspace with visits, timeline, dental chart, prescriptions, invoices and payments.
- Added calendar, appointment queue, treatment/clinical capture and status workflow.
- Added billing, partial payments, receipts, inventory, suppliers, staff and expense tracking.
- Added reports, UTF-8 CSV export, print layouts, browser Save as PDF workflow and data-health checks.
- Added selective backup restore preview with conflict strategies.
- Added English-first light visual system and Bengali locale setting.
- Added Electron desktop shell, multi-size Windows icon, Windows x64 portable/NSIS packaging configuration and a Windows runner release workflow.
