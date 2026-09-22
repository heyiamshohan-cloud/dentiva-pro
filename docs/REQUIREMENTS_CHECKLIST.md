# Dentiva Pro v1.2.0 requirements checklist and release gate

**Status date:** 2026-09-22 (Asia/Dhaka)
**Branch:** `arena/01a0c66a-dentiva-pro`
**Rule:** `[x]` means behavior is implemented and evidenced, not merely present in source. `[~]` means partial implementation with an explicit open verification or feature gap. `[ ]` is an open blocker.

## Release identity and product boundaries

- [x] Version identity is `1.2.0` in `package.json`, lockfile and renderer.
- [x] v1.0.0 and v1.1.0 remain separate; no prior release artifact is overwritten.
- [x] Empty first-run store; no demo/test data is seeded.
- [x] Offline/local operation remains the default; no mandatory cloud or paid API.
- [x] Light-only premium visual direction and Bangladesh defaults remain present.
- [x] No AI diagnosis or automated prescribing is introduced.
- [~] Final v1.2.0 Windows assets, tag and checksums — **OPEN until Windows validation completes**.

## Data, SQLite and migration

- [x] Bundled `sql.js` persistence with relational `metadata`/`records` tables.
- [x] Atomic staged writes, fsync/rename behavior, integrity-checked `.bak` recovery and size guardrail.
- [x] Managed attachment directory with validated relative paths and renderer hydration.
- [x] Non-destructive legacy JSON migration and `.migrated` marker.
- [x] Reset and storage-info APIs.
- [x] Node regression coverage for persistence, attachments, migration and corrupt-current/backup recovery.
- [~] Electron-runtime migration, interrupted-write recovery and restart persistence — **OPEN**.
- [ ] Production dataset measurement at 1,000, 5,000, 10,000 and 25,000 patients — **OPEN**.

## Users, authentication and authorization

- [x] Six role definitions: Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role.
- [x] Explicit permission vocabulary and role templates in the domain layer.
- [x] First-run Administrator PIN setup.
- [x] Salted PBKDF2-SHA-256 PIN hashes; no plaintext credentials persisted.
- [x] Active/inactive account state, staff association, failed-attempt lock state and last-login timestamps.
- [x] Sign-in session state and account lockout handling in the renderer.
- [x] Permission checks at route, search, form and important operation boundaries; button hiding is not the only control.
- [x] Custom Role explicit permission selection and active Administrator protection.
- [~] Packaged Electron/Windows end-to-end role matrix, migration, lockout and restart evidence — **OPEN**.
- [ ] OS-level threat model/encryption boundary review — **OPEN**; SQLite is not encryption.

## Localization

- [~] English-first UI has an existing Bengali resource map and DOM translation layer.
- [ ] Professional Bengali review of every user-facing page, dialog, validation, error, success, empty/loading state — **OPEN**.
- [ ] Bengali print view, PDF, invoice, receipt, prescription, patient summary and report review — **OPEN**.
- [ ] Native Bengali copy review by a Bangladeshi language reviewer — **OPEN**.

## Clinical and patient workflows

- [x] Patient directory, profile, relational timeline, visits, dental chart, prescriptions, referrals and attachments remain available.
- [~] Treatment catalog — present and tested for basic CRUD, but treatment plans are not a complete staged workflow.
- [ ] Treatment plans with status, stages, dates, staff, cost linkage, patient summary and print/PDF — **OPEN**.
- [ ] Patient financial statement with invoice/payment/refund reconciliation and print/PDF — **OPEN**.
- [~] Patient advanced filters, pagination and local search — present, but large dataset UI evidence is open.
- [~] Attachment safety and metadata — implemented; packaged Electron crash/error/recovery testing is open.

## Scheduling and queue

- [x] Appointment calendar, duration and chair/dentist overlap warning.
- [x] Queue serial and status lifecycle.
- [~] Appointment intelligence, actionable notifications, wait-time/priority signals and queue print — **OPEN runtime verification/feature refinement**.

## Finance and inventory

- [x] Integer-cent invoice formula and payment/refund source-of-truth helpers.
- [x] Partial/full/excessive payment validation and separate expense ledger.
- [x] Configurable Bangladesh payment methods and print-ready receipts.
- [~] Financial edge-case UI/runtime testing, statement output and restore reconciliation — **OPEN**.
- [x] Inventory purchase/usage/stock-out/expiry/damage/correction movement model with negative-stock guardrails.
- [~] Inventory audit actor/reason/restore workflows — **OPEN packaged runtime evidence**.

## Import, export, filters and command tools

- [x] Structured backup manifest, SHA-256 canonical payload hash and relationship validation.
- [x] Selective module/patient restore, explicit conflict strategies, ID remapping and rollback plan.
- [~] Backup corruption and restore rollback — covered in Node tests; Electron/Windows evidence is open.
- [x] UTF-8 CSV exports for supported datasets.
- [~] Patient CSV import now has column mapping, preview, required-field validation, duplicate Skip/Create New Copy policy and snapshot rollback; broader multi-entity relationship mapping remains **OPEN**.
- [~] Global local command/search palette — existing search modal is present; permission-scoped and large-result verification is open.
- [~] Advanced filters and saved-filter behavior — **OPEN** where not behaviorally evidenced.
- [~] Actionable notification center — existing derived notifications need runtime/role verification.

## Print, visual and Windows automation

- [~] A4, Letter and 80 mm print profiles — source workflow exists; Bengali/PDF/Windows verification is open.
- [ ] Configurable print/PDF profiles across all required documents — **OPEN**.
- [x] DOM/layout regression at 1280×720, 1366×768, 1600×900, 1920×1080, 2560×1440 and 3840×2160 — Playwright CI gate passed on run 35693850283.
- [~] Windows portable launch/create/restart persistence and release validation are automated; the installed-app launch/restart/uninstall sequence is intentionally **MANUAL USER VERIFICATION REQUIRED** and excluded from automated release blocking.
- [~] Electron context isolation, sandbox, navigation/CSP and PDF restrictions — static tests pass; packaged GUI/crash evidence is open.

## Documentation and release gate

- [x] Changelog, README, user guide, build guide and this checklist identify v1.2 work and open evidence honestly.
- [x] Persistent phase record is maintained in `docs/V1.2_PROGRESS.md`.
- [~] Final audit report — updated as an explicit release gate; it must be updated again with Windows/visual/performance evidence before release.
- [ ] Exact new artifacts: portable EXE, NSIS setup EXE, application ZIP and checksum file — **OPEN**.
- [ ] New `v1.2.0` tag/release — **OPEN**.

## Current release decision

**CONDITIONAL / IN PROGRESS.** The automated installed-app launch/restart/uninstall smoke is deliberately deferred to manual user verification and is not a release blocker. Every other open item above remains a release blocker; do not publish until those items have evidence-backed status.
