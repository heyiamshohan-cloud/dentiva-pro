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
- Billing, invoice line items, discount/tax calculation, due balances, partial payments and money receipts
- Inventory, suppliers, stock movement trace and expiry/low-stock alerts
- Staff and roles architecture, operating expenses and finance reporting
- Reports with date ranges, print preview and UTF-8 CSV export
- Structured backup manifest, validation preview, selective restore and conflict strategies
- Local audit history, integrity checks, light mode, responsive layout and accessibility-friendly focus states
- English-first UI with a Bengali locale setting and Bangladesh defaults (BDT, Asia/Dhaka)
- About section crediting Md. Shohan Khan

## Technology

- Vite + modern JavaScript and CSS for a fast offline-capable UI
- Local structured store with schema versioning and `localStorage` persistence for the browser/desktop profile
- Electron desktop shell with `contextIsolation`, sandboxed renderer, no Node integration and a Windows x64 portable packaging target
- Browser/Windows print preview for direct printing or Save as PDF
- No mandatory cloud service, online account, paid API or external patient-data telemetry

The current codebase is intentionally dependency-light. The browser build is also the renderer used by the desktop shell, which keeps the domain and presentation logic portable for a future SQLite/EF Core infrastructure adapter without rewriting the workflow UI.

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

The targets are a self-contained Windows x64 portable executable and a per-user NSIS installer under `release/`. The verified 1.0.0 Windows assets are published in the [GitHub release](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.0.0). See [`docs/BUILD.md`](docs/BUILD.md) for release hygiene.

## Data handling

Dentiva Pro creates no records until the clinic creates them. Use **Backup & Restore → Export full backup** to create a structured, versioned JSON package with record counts and relationship-preserving arrays. Import always shows a preview and conflict strategy before modifying local records. Use system-level encryption and access control for the machine and backup media.

## Printing and reports

Documents use a branded print layout and the operating-system print dialog. A Windows printer can be selected, or the document can be saved as PDF. Reports and table exports use UTF-8 with a BOM for Bengali-compatible spreadsheet import.

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

Version **1.0.0**, build **2026.09.22**.

Verified Windows x64 assets:

- [DentivaPro.exe / portable application](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/download/v1.0.0/Dentiva-Pro-1.0.0-Windows-x64.exe)
- [Windows installer](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/download/v1.0.0/Dentiva-Pro-1.0.0-Windows-x64-Setup.exe)
- [Complete Windows x64 ZIP](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/download/v1.0.0/Dentiva-Pro-1.0.0-Windows-x64.zip)
- [SHA-256 checksums](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/download/v1.0.0/Dentiva-Pro-1.0.0-checksums.txt)
