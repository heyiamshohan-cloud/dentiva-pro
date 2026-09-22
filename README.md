# Dentiva Pro

**Flagship offline-first dental practice management · v1.3.0**

Dentiva Pro is a local dental-practice workspace for clinics in Bangladesh. The flagship edition keeps the calm daily workflow from earlier releases and expands it with a configurable command center, patient workspaces, structured clinical history, safe financial statements, analytics, diagnostics and stronger recovery tooling.

The repository starts with an empty store by design. There are no sample patients, demo transactions, fake dashboard numbers or placeholder records.

> **Release status:** v1.3.0 is published from `arena/01a0c66a-dentiva-pro`. Windows CI run `35710031145` passed tests/build, six viewport checks, portable/NSIS packaging, PE, ZIP, checksum and portable persistence gates, then published the [v1.3.0 GitHub release](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.3.0). v1.0.0, v1.1.0 and v1.2.0 remain preserved. The installed-app launch/restart/uninstall smoke is intentionally excluded from automated release gating and remains **MANUAL USER VERIFICATION REQUIRED**. See [`docs/FINAL_AUDIT_REPORT_1.3.0.md`](docs/FINAL_AUDIT_REPORT_1.3.0.md) and [`docs/V1.3_PROGRESS.md`](docs/V1.3_PROGRESS.md).

## Flagship modules

- Configurable dashboard command center with locally persisted widget visibility, ordering and reset, command palette, keyboard shortcuts, schedule, queue, follow-up, balance, stock and backup signals
- Patient directory with advanced local search/filtering, pagination, status/archive handling, duplicate warning, profile workspace, alerts, age, preferred contact, normalized tags and configured custom fields
- Patient timeline combining appointments, visits, prescriptions, invoices, payments, referrals, attachments and follow-up tasks
- Dental chart with FDI adult/primary dentition, tooth-level status and notes
- Clinical visits, treatment catalog, staged treatment plans with clinical goals, procedures, teeth, duration, estimate/discount and stage progress
- Appointments with calendar, serial queue, duration, dentist/chair/room context, overlap confirmation and Today’s Queue lifecycle
- Prescriptions with multiple medicines, structured line input, explicit clinician-authored instructions and print workflow
- Billing, payment center, receipts, partial/full payment validation, refunds/adjustments, patient statements and one deterministic financial source of truth
- Inventory, suppliers, movement audit, reorder thresholds, expiry warnings and negative-stock protection
- Accounting, staff directory, local user accounts, salted PINs, active/inactive state, lockout and operation-level role authorization
- Reports plus analytics for collections, billing, expenses, net result, completion/no-show rate, six-month trends and payment mix
- Actionable notification center for queue, follow-up, expiry, low stock, balances and stale backups
- Diagnostics workspace with local storage info, schema, record counts, relationship checks, attachment checks, backup health and account state
- Structured backup manifest with SHA-256 payload hash, validation preview, relationship checks, module/patient selection, conflict strategies, ID remapping and rollback
- UTF-8 CSV patient import preview/mapping/duplicate policy and dataset exports
- English/Bengali interface layer, Bengali-aware number/currency/date/time formatting, Bangladesh defaults (BDT, Asia/Dhaka)
- A4, A5, Letter and 80 mm receipt print profiles, shared footer/logo/contact controls, branded print layouts and safe Electron PDF generation
- Offline SQLite desktop persistence, managed attachment files, atomic writes, recovery backup and non-destructive legacy JSON migration

## Product boundaries

Dentiva Pro is record-management software. It does not independently diagnose disease, recommend treatment or prescribe medication. Clinical decisions and the accuracy of professional input remain with the dentist. No mandatory cloud account, telemetry, paid API or external patient-data service is required.

The interface is intentionally light-only. Patient and financial data remain local to the browser preview or Electron profile. SQLite is persistence, not encryption; protect the operating-system account, workstation and backup media with appropriate OS/full-disk controls.

## Security and privacy model

The desktop store uses bundled `sql.js` SQLite with relational metadata/records tables, atomic staged writes, an integrity-checked `.bak`, a 200 MB guardrail and managed attachment files. Legacy JSON stores are migrated without silently deleting the original. Future schemas are preserved and blocked from silent downgrade.

Local accounts store no plaintext PINs. Setup and account management derive salted PBKDF2-SHA-256 hashes. Failed attempts temporarily lock accounts; inactive accounts cannot sign in. Role permissions are checked at routes, searches, forms and mutation/export/print/backup operations rather than only by hiding buttons. Audit entries record important data, security, backup and settings changes.

Attachments are constrained to safe MIME types and 6 MB per file. PDF files are never embedded as active inline content. Electron uses context isolation, sandboxing, no Node integration, restricted navigation, CSP and a narrow preload bridge.

## Run locally

Use Node.js 22.12 or newer for the Electron 44 release toolchain.

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0` for local-network and sandbox preview compatibility. Browser preview uses a local-storage fallback; Electron uses the SQLite store.

## Test, build and benchmark

```bash
npm test
npm run build
npm run check
npm run benchmark:datasets
```

`npm test` covers deterministic domain workflows, financial calculations, role authorization, backup/restore relationships, attachment safety, storage recovery, release gates and security boundaries. The Windows CI workflow installs Chromium before running the six required viewport checks.

Run the Windows package on a Windows x64 machine with access to the Electron binary cache:

```bash
npm run dist:win
```

## Windows release contract

The workflow produces a new versioned portable executable, assisted NSIS installer, application-only ZIP and SHA-256 checksum file. It runs tests/build, visual checks, PE header checks, the blocking portable create/restart persistence smoke, ZIP inspection and checksum validation before publication. The installed-app launch/restart/uninstall workflow is intentionally excluded from automated release gating and is reserved for manual user verification.

For a source + built-renderer delivery ZIP without `node_modules`, use:

```bash
npm run package:release
```

This is not a substitute for the four Windows release artifacts. Never overwrite an existing release tag or asset.

## Data handling and backup

Use **Backup & Restore → Export full backup** to create a structured, versioned `.dentiva.json` package with record counts and a SHA-256 hash over canonical backup data. Import verifies the hash when present, validates MIME/size/relationships, shows a dry-run preview, supports module and patient selection and commits through a snapshot/rollback restore plan. Existing records are not silently overwritten.

Keep a verified backup in a trusted location. A forgotten PIN cannot be recovered by the application; follow the clinic's verified recovery policy.

## Printing and documents

Documents use a branded print layout and the operating-system print dialog. Settings support A4, Letter and 80 mm receipt profiles. Patient statements, invoices, receipts, prescriptions, patient summaries, queues, charts and reports can be printed; the desktop PDF path rejects active scripts and remote resources. Bengali rendering and native copy review remain human acceptance items even though the locale and formatter paths are covered by source/domain tests.

## Project structure

```text
src/main.js              renderer, sessions, workflows, reports and print views
src/domain.js            deterministic analytics, statement, timeline and validation helpers
src/core.js              financial, relationship, restore, attachment and RBAC rules
src/styles.css           base light-only design system and responsive layout
src/styles-flagship.css  v1.3 analytics, diagnostics, notification and customization surfaces
electron/                 hardened desktop shell, preload bridge and SQLite persistence
public/                   icon, manifest and service-worker assets
docs/                     audit, requirements, progress, user and build documentation
tests/                    Node regression and persistence tests
```

## Creator

**Md. Shohan Khan**
Email: helloiamshohan@gmail.com
WhatsApp: 01516591935

## Release identity

Current code identity: **1.3.0**, build **2026.09.22**. This is the published new semantic version after v1.2.0; earlier release tags and artifacts are not overwritten.

The v1.3 artifact contract is published at [github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.3.0](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.3.0):

- `Dentiva-Pro-1.3.0-Windows-x64.exe` — portable PE executable
- `Dentiva-Pro-1.3.0-Windows-x64-Setup.exe` — assisted NSIS installer
- `Dentiva-Pro-1.3.0-Windows-x64.zip` — application-only delivery ZIP
- `Dentiva-Pro-1.3.0-checksums.txt` — SHA-256 records for release artifacts

The evidence ledger is [`docs/FINAL_AUDIT_REPORT_1.3.0.md`](docs/FINAL_AUDIT_REPORT_1.3.0.md). The dependency/license review is [`docs/THIRD_PARTY_LICENSES.md`](docs/THIRD_PARTY_LICENSES.md). Historical v1.2 documentation remains in [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md) and [`docs/V1.2_PROGRESS.md`](docs/V1.2_PROGRESS.md).

**The Windows installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains for manual user verification.**
