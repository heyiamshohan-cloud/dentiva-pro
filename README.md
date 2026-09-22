# Dentiva Pro

**Professional Dental Practice Management · v1.2.0**

Dentiva Pro is an offline-first dental practice workspace for clinics in Bangladesh. It is designed around a calm daily workflow: register a patient, book and queue an appointment, capture the clinical record, manage the dental chart, prescribe, bill, record payment, track inventory and protect local data with verified backups.

This repository starts with an empty store by design. There are no sample patients, demo transactions, fake dashboard numbers or placeholder records.

> **Release status:** v1.2.0 is published. The portable, visual, packaging, PE, archive and checksum gates passed in Windows CI; the installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains **MANUAL USER VERIFICATION REQUIRED**. v1.0.0 and v1.1.0 are preserved. See [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md) and [`docs/V1.2_PROGRESS.md`](docs/V1.2_PROGRESS.md).

## Included modules

- Dashboard with today-first operational metrics, queue signals, follow-ups, stock and backup alerts
- Patient directory, local search, profile workspace, timeline, referrals, financial statements and safe attachments
- Day/week/month appointment calendar, chair context, double-booking warning and Today’s Queue workflow
- Clinical visits, symptoms, findings, diagnoses, staged treatment plans, treatment notes, tooth references and follow-up dates
- FDI adult and primary dental chart with tooth-level statuses and notes
- Prescription records with printable instructions and clinical-safety wording
- Billing, invoice line items, discount/tax calculation, due balances, partial payments, configurable payment methods and auditable refunds/reversals
- Inventory, suppliers, purchase/usage/stock-out/expiry/damage/correction movements, reorder thresholds and expiry warnings
- Staff directory, user accounts, staff association, role templates, PIN sign-in, account lockout and permission-enforced operations
- Reports, UTF-8 CSV export, patient CSV mapping/import preview, print/PDF workflows and local audit history
- SQLite-backed desktop persistence, managed attachment files, legacy JSON migration and verified backup/recovery behavior
- Structured backup manifest with SHA-256 payload hash, validation preview, patient/module selective restore, conflict strategies and rollback
- English-first UI with an existing Bengali locale layer and Bangladesh defaults (BDT, Asia/Dhaka)
- About section crediting Md. Shohan Khan

## Security and privacy model

The desktop store uses bundled `sql.js` SQLite rather than a native database build. It writes through an atomic staged path, retains an integrity-checked `.bak`, enforces a size ceiling and keeps attachment bytes in a managed directory. A v1.1 JSON store is migrated without silently deleting the original.

Local user accounts store no plaintext PINs. Setup and account management derive salted PBKDF2-SHA-256 hashes. Accounts include role, effective permissions, staff association, active/inactive state, failed-attempt lock state and last-login time. Permission checks are applied to routes, search results, forms and important mutation/export/print operations; hiding a button is not the authorization boundary.

SQLite is local persistence, not database encryption. Use OS account controls, full-disk encryption and protected backup media for production. Dentiva Pro does not require a cloud account, paid API or external patient-data telemetry, and does not diagnose or prescribe automatically.

## Technology

- Vite + modern JavaScript and CSS for the offline-capable renderer
- `sql.js` SQLite persistence for the Electron desktop profile; browser preview retains a local-storage fallback
- Electron shell with `contextIsolation`, sandbox, no Node integration, navigation restrictions, CSP and safe PDF boundaries
- Browser/Windows print preview for direct printing or Save as PDF
- No mandatory cloud service, online account, paid API or external patient-data telemetry

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. The server binds to `0.0.0.0` for preview compatibility.

## Test and build

```bash
npm test
npm run build
npm run check
```

Run the Windows target on a Windows x64 machine with the Electron binary available:

```bash
npm run dist:win
```

The Windows release workflow is designed to produce a new v1.2.0 portable executable, an assisted NSIS installer (per-user capable; machine scope is selected by default for current Windows compatibility), an application-only ZIP and a SHA-256 checksum file after tests, packaging and validation pass. It runs a blocking portable create/restart persistence smoke; the installed-app launch/restart/uninstall sequence is intentionally reserved for manual user verification. The v1.2.0 artifacts are published at [GitHub Releases](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.2.0).

## Data handling and backup

Dentiva Pro creates no records until the clinic creates them. Use **Backup & Restore → Export full backup** to create a structured, versioned `.dentiva.json` package with record counts, relationship-preserving collections and a SHA-256 hash over canonical backup data. Import verifies the hash when present, validates MIME/size/relationships, shows a dry-run preview, supports module and patient selection, and commits through a snapshot/rollback restore plan. Existing records are never silently overwritten.

Keep a verified backup in a trusted location. Attachments are limited to 6 MB each and the Electron store has a 200 MB safety ceiling. A forgotten PIN cannot be recovered by the application; follow the clinic's verified recovery policy.

## Printing and reports

Documents use a branded print layout and the operating-system print dialog. Settings support A4, Letter and 80 mm receipt profiles; reports can use the hardened Electron HTML-to-PDF path when running in the desktop app. A Windows printer can be selected, or the document can be saved as PDF. Bengali output and all requested print/PDF surfaces retain the documented human-review boundary. The installed-app launch/restart/uninstall smoke is the sole explicitly deferred automated sequence and remains manual user verification.

## Project structure

```text
src/main.js         UI, user sessions, permission gates, workflows, reports and print views
src/core.js         pure financial, relationship, restore and RBAC domain helpers
src/styles.css      light-mode design system and responsive layout
electron/           hardened desktop shell and SQLite storage/preload bridge
public/              icon assets
docs/                audit, progress, user and build documentation
tests/              Node regression and persistence tests
```

## Creator

**Md. Shohan Khan**
Email: helloiamshohan@gmail.com
WhatsApp: 01516591935

## Release identity

Current code identity: **1.2.0**, build **2026.09.22**. This is a published release and does not overwrite the existing 1.0.0 or 1.1.0 tags/assets.

The eventual artifact contract is:

- `Dentiva-Pro-1.2.0-Windows-x64.exe` — portable PE executable
- `Dentiva-Pro-1.2.0-Windows-x64-Setup.exe` — assisted per-user NSIS installer
- `Dentiva-Pro-1.2.0-Windows-x64.zip` — application-only delivery ZIP
- `Dentiva-Pro-1.2.0-checksums.txt` — SHA-256 records for release artifacts

The factual QA, open blockers and release evidence are maintained in [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md). Historical v1.1.0 evidence is preserved in [`docs/FINAL_AUDIT_REPORT_1.1.0.md`](docs/FINAL_AUDIT_REPORT_1.1.0.md).
