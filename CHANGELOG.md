# Changelog

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
