# Dentiva Pro release checklist

This is the implementation audit for the 1.0.0 source release.

## Delivered in the offline workspace

- [x] Empty first-run store; no demo records
- [x] Practice setup wizard with Bangladesh defaults and editable clinic identity
- [x] Light-only responsive visual system with desktop, tablet and phone breakpoints
- [x] Persistent local data with schema version and local audit collection
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
- [x] Partial payment validation and traceable receipt records
- [x] Inventory, suppliers, stock movements, reorder thresholds and expiry warnings
- [x] Staff directory and role concepts
- [x] Separate accounting workspace with income, expense and net-result calculations
- [x] Reports with date ranges, preview-ready tables, print and UTF-8 CSV export
- [x] Structured JSON backup manifest with record counts and schema version
- [x] Import validation preview, selective module selection and conflict strategies
- [x] Print layouts for queue, billing, invoices, receipts, prescriptions, patients, charts and reports
- [x] English-first terminology with Bengali locale labels for core navigation and common actions
- [x] Offline service-worker shell for browser deployments and Electron-safe local renderer
- [x] Hardened Electron shell configuration: context isolation, sandbox and no Node integration
- [x] Windows x64 portable and per-user NSIS packaging configuration with branded ICO assets
- [x] GitHub Actions Windows runner workflow that builds, verifies and uploads the EXE, installer and final application ZIP
- [x] README, user guide, build guide, changelog and automated smoke checks

## Environment-dependent release step

The repository contains the Windows portable packaging configuration, but this Linux sandbox does not have the Electron binary cache. Downloading the Electron binary was blocked by the sandbox TLS path to GitHub release assets, so `Dentiva-Pro-1.0.0-Windows-x64.exe` was not emitted here. The source release ZIP and production renderer build were generated successfully.

A machine with ordinary access to the Electron distribution cache can run `npm run dist:win` without changing the application source.

## Deliberate product boundaries

- The current release is a local single-profile workspace. The data collections and resource fields are structured for future SQLite/network adapters, but network multi-user sync is not enabled.
- Printing uses the native/browser print dialog and Save as PDF rather than shipping a proprietary printer driver.
- There is no automatic medical diagnosis, automated prescribing, external SMS/WhatsApp gateway or cloud telemetry.
