# Dentiva Pro

**Professional Dental Practice Management**

Dentiva Pro is an offline-first dental practice workspace for clinics in Bangladesh. It is designed around a calm daily workflow: register a patient, book and queue an appointment, capture the clinical record, manage the dental chart, prescribe, bill, record payment, track inventory and protect the local data with verified backups.

This repository starts with an empty store by design. There are no sample patients, demo transactions, fake dashboard numbers or placeholder records.

## Included modules

- Dashboard with today-first operational metrics, queue signals, follow-ups, stock and backup alerts
- Patient directory, instant search, profile workspace, timeline, history, referrals-ready record structure and soft-delete-ready model
- Day/week/month appointment calendar, chair context, double-booking warning and Today’s Queue serial workflow
- Clinical visits, symptoms, findings, diagnoses, treatment plans, tooth references and follow-up dates
- FDI adult dental chart with tooth-level statuses and notes
- Prescription record with printable instructions and clinical-safety wording
- Billing, invoice line items, discount/tax calculation, due balances, partial payments, configurable payment methods, auditable refunds/reversals and money receipts
- Inventory, suppliers, purchase/usage/stock-out/expiry/damage/correction movements, stock trace and expiry/low-stock alerts
- Staff and roles architecture, operating expenses and finance reporting
- Reports with Today, 7-day, monthly, 3-month, 6-month, yearly, custom and all-record ranges; print/PDF preview and UTF-8 CSV export
- Structured backup manifest with SHA-256 payload hash, validation preview, patient/module selective restore, conflict strategies and rollback
- Local audit history, integrity checks, optional local administrator PIN lock, light mode, responsive layout and accessibility-friendly focus states
- English-first UI with a Bengali locale setting and Bangladesh defaults (BDT, Asia/Dhaka)
- About section crediting Md. Shohan Khan

## Technology

- Vite + modern JavaScript and CSS for a fast offline-capable UI
- Local structured schema-v2 store with migration defaults; the Electron profile uses an atomic fsync/rename JSON store with a last-known-good backup, while browser preview uses localStorage
- Electron desktop shell with `contextIsolation`, sandboxed renderer, no Node integration and a Windows x64 portable packaging target
- Browser/Windows print preview for direct printing or Save as PDF
- No mandatory cloud service, online account, paid API or external patient-data telemetry

The current codebase is intentionally dependency-light. The browser build is also the renderer used by the desktop shell. Electron is the supported production persistence target; browser localStorage is a convenient preview fallback with browser quota limits. This is a local single-profile product: staff roles are record metadata, not multi-user authorization, and there is no network synchronization.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. The server binds to `0.0.0.0` for preview compatibility.

## Build

```bash
npm run build
```

Run the configured desktop target on a machine with the Electron binary cache:

```bash
npm run dist:win
```

The targets are a self-contained Windows x64 portable executable and a per-user NSIS installer under `release/`. The audited 1.1.0 Windows assets are published only after the Windows runner verifies PE headers, the application ZIP contents and SHA-256 checksums. See [`docs/BUILD.md`](docs/BUILD.md) for release hygiene.

## Data handling

Dentiva Pro creates no records until the clinic creates them. Use **Backup & Restore → Export full backup** to create a structured, versioned JSON package with record counts, relationship-preserving arrays and a SHA-256 hash over canonical backup data. Import verifies the hash when present, validates MIME/size/relationships, shows a dry-run preview, supports module and patient selection, and commits through a snapshot/rollback restore plan. Existing records are never silently overwritten. Use the optional local administrator PIN lock plus system-level encryption and access control for the machine and backup media. The PIN is stored only as a salted PBKDF2-SHA-256 derived key; Dentiva Pro cannot recover a forgotten PIN. Attachments are limited to 6 MB each and the Electron store has a 200 MB safety ceiling; use a verified external backup for long-term retention.

## Printing and reports

Documents use a branded print layout and the operating-system print dialog. Settings support A4, Letter and 80 mm receipt profiles; reports can use the hardened Electron HTML-to-PDF path when running in the desktop app. A Windows printer can be selected, or the document can be saved as PDF. Reports and table exports use UTF-8 with a BOM for Bengali-compatible spreadsheet import.

## Project structure

```text
src/main.js         UI, local domain store, workflows, reports and print views
src/styles.css      light-mode design system and responsive layout
electron/           hardened desktop shell and preload bridge
public/              icon assets
docs/                user and build documentation
```

## Creator

**Md. Shohan Khan**
Email: helloiamshohan@gmail.com
WhatsApp: 01516591935

## Release

Version **1.1.0**, build **2026.09.22**. This is a new release and does not overwrite the 1.0.0 tag or assets.

The final Windows x64 portable EXE, per-user installer, complete application ZIP and checksum file are published at the [`v1.1.0` GitHub release](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.1.0) after the Windows runner completes. Artifact names are:

- `Dentiva-Pro-1.1.0-Windows-x64.exe` — portable PE executable
- `Dentiva-Pro-1.1.0-Windows-x64-Setup.exe` — assisted per-user NSIS installer
- `Dentiva-Pro-1.1.0-Windows-x64.zip` — application-only delivery ZIP
- `Dentiva-Pro-1.1.0-checksums.txt` — SHA-256 records for release artifacts

The factual QA, audit matrix and release evidence are in [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md).
