# Dentiva Pro release checklist

This is the implementation audit for the 1.1.0 audited release.

## Delivered in the offline workspace

- [x] Empty first-run store; no demo records
- [x] Practice setup wizard with Bangladesh defaults and editable clinic identity
- [x] Light-only responsive visual system with desktop, tablet and phone breakpoints
- [x] Persistent local data with schema version and local audit collection
- [x] Optional local administrator PIN lock with hashed PIN, manual lock and unlock screen
- [x] Dashboard with today-first schedule, queue, follow-up, stock, balance and backup signals
- [x] Patient directory, search, profile workspace and chronological timeline
- [x] Visits, symptoms, findings, diagnoses, treatment notes, teeth and follow-up dates
- [x] Adult and primary FDI dental chart with tooth statuses and notes
- [x] Treatment catalog and configurable defaults
- [x] Appointment calendar, chair context, status lifecycle and double-booking warning
- [x] Today’s queue with serials and status cycling
- [x] Prescriptions with multiple structured medication fields and print view
- [x] Patient attachments with safe MIME allowlist, size guard and local backup inclusion
- [x] Referrals with reason, specialty, response and follow-up notes
- [x] Invoices, discounts, configurable tax rate, due calculation and payment statuses
- [x] Multiple payment methods including configurable Bangladesh MFS names
- [x] Partial payment validation, auditable refund/reversal adjustments and traceable receipt records
- [x] Inventory, suppliers, purchase/usage/stock-out/expiry/damage/correction movements, reorder thresholds and expiry warnings
- [x] Staff directory and role concepts
- [x] Separate accounting workspace with income, expense and net-result calculations
- [x] Reports with date ranges, preview-ready tables, print and UTF-8 CSV export
- [x] Structured JSON backup manifest with record counts, schema version and SHA-256 payload hash
- [x] Import validation preview, module/patient selection, conflict strategies, relationship-safe ID remapping and atomic rollback
- [x] Print layouts for queue, billing, invoices, receipts, prescriptions, patients, charts and reports
- [x] English-first terminology with Bengali locale labels for core navigation and common actions
- [x] Offline service-worker shell for browser deployments and Electron-safe local renderer
- [x] Hardened Electron shell configuration: context isolation, sandbox and no Node integration
- [x] Windows x64 portable and per-user NSIS packaging configuration with branded ICO assets
- [x] A4, Letter and 80 mm receipt print profiles plus hardened desktop PDF export
- [x] GitHub Actions Windows runner workflow that builds, verifies and uploads the EXE, installer and final application ZIP
- [x] README, user guide, build guide, changelog and automated smoke checks

## Verified Windows release

Final status is recorded in `docs/FINAL_AUDIT_REPORT.md` after the Windows x64 workflow completes. Browser/desktop and visual verification limitations are not hidden in the scorecard. The release must remain separate from `v1.0.0` and must include the PE-verified portable EXE, installer, application ZIP and checksum file.

- Portable executable: `Dentiva-Pro-1.1.0-Windows-x64.exe`
- Installer: `Dentiva-Pro-1.1.0-Windows-x64-Setup.exe`
- Application ZIP: `Dentiva-Pro-1.1.0-Windows-x64.zip`

The workflow also ran the renderer build and test suite on Windows before packaging.

## Deliberate product boundaries

- The current release is a local single-profile workspace. The Electron store is durable JSON rather than a multi-user database; staff roles are descriptive metadata and do not provide per-user authorization or network sync.
- Printing uses the native/browser print dialog and Save as PDF rather than shipping a proprietary printer driver.
- There is no automatic medical diagnosis, automated prescribing, external SMS/WhatsApp gateway or cloud telemetry.
