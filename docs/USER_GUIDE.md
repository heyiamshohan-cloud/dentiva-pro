# Dentiva Pro v1.4.0 user guide

## Release note

The v1.4.0 workflows below describe the current implementation. Evidence
boundaries and open review items are listed in
[`FINAL_AUDIT_REPORT_1.4.0.md`](FINAL_AUDIT_REPORT_1.4.0.md). Earlier releases
(v1.0.0–v1.3.0) remain separate; **upgrading is automatic on first launch** —
the v1.3.0 local database migrates in place with every record preserved (the
source file is kept as `dentiva-pro.sqlite.v4-preserved.sqlite`), and a fresh
backup is always recommended before upgrading.

New in this release: the relational local database (no size limits — the
workspace scales with your hardware, benchmarked at 100,000 patients),
faster lists and search at every size, a premium light interface with a
⌘K command palette, dashboard 3.0 with configurable cards, an Accounting
center with receivables aging, a Diagnostics page, backup/restore with
validation and module groups (patients / clinical / finance / operations),
and server-side permission enforcement on every operation.

## Start here

Dentiva Pro opens to an empty practice workspace. No patient, transaction, appointment or demo record is created for you. Complete **Setup** to add the clinic identity and create the local Administrator PIN. The PIN is never stored as readable text. After setup, sign in with the account selector and PIN.

## Local accounts and permissions

Open **User Accounts** as an Administrator to create a local account for each person who uses the workstation. Associate the account with a staff member, choose Administrator, Dentist, Manager, Receptionist, Dental Assistant or Custom Role, set an active/inactive status and, for Custom Role, select the effective permissions.

PINs are stored only as salted PBKDF2-SHA-256 hashes. Five failed attempts temporarily lock an account. Inactive accounts cannot sign in. Last-login time and account lock state are retained in the local database. Authorization is enforced in the operation handlers as well as in the visible navigation, so a user cannot gain a protected mutation by calling a hidden or stale control. The account model is local to this practice; it is not network identity management.

Keep at least one active Administrator. A forgotten PIN cannot be recovered by the application; follow the clinic's verified recovery policy.

## Recommended workflow

1. Complete Setup and sign in as the Administrator.
2. Create local accounts and associate them with the staff directory.
3. Register a patient.
4. Book an appointment.
5. Check the patient in from **Today’s Queue**.
6. Record the clinical visit and any tooth-level note.
7. Create a prescription or invoice if needed.
8. Record each payment separately; use the Refund action for a documented reversal instead of editing history.
9. Record stock usage or stock-out movements when materials leave inventory.
10. Set a follow-up date and export a verified backup.

## Data and privacy

The Windows desktop profile stores data in a local SQLite database created by bundled `sql.js`. The database is written through a staged atomic path, retains an integrity-checked `.bak` recovery copy and has a 200 MB ceiling. Attachment bytes are kept as managed files rather than inflating every database record. Browser preview remains a local-storage fallback and is subject to browser quota/profile behavior.

SQLite is not encryption. Protect the Windows account, workstation and backup media with OS controls and full-disk/file encryption appropriate to the clinic.

## Backup and restore

Use **Backup & Restore → Export full backup** to download a structured `.dentiva.json` package. It contains a manifest, schema version, record counts, attachment data and a SHA-256 hash over canonical backup data. On import, Dentiva Pro verifies the hash when present, validates relationships and attachment safety, then shows detected record counts, possible ID conflicts and warnings before any data is changed.

Restore strategies:

- **Keep Existing** — keep local records when IDs conflict.
- **Skip** — skip records with an existing ID.
- **Replace** — update the local record with the backup record.
- **Create New Copy** — import the conflicting record with a new local ID and remap supported patient, invoice, payment, inventory and supplier references.

You may restore whole modules or select patients from the preview. If validation or persistence fails, the local state is restored from the pre-import snapshot and the operation reports the reason. A patient-scoped restore can only include records whose relationships remain valid.

Keep a verified backup in a trusted location. The Node/storage tests cover corruption recovery, migration, atomic writes and restore rollback; the packaged Windows GUI remains the authoritative environment for final persistence and crash-recovery review.

## Printing and PDF

Print actions open a clean print preview. Select a Windows printer, paper size and copies in the system dialog, or choose **Save as PDF**. Invoice, payment receipt, prescription, patient summary, queue, chart and report layouts include the current clinic identity when it has been configured.

A4, A5, Letter and 80 mm Receipt profiles exist. Settings can control the document footer and whether the clinic logo/contact appears in generated documents. Bengali rendering, native copy review and Windows printer/PDF acceptance remain explicit human review items until checked on the packaged app.

## Financial records

Invoices calculate subtotal, discount, configured tax and total from line items. Payments are separate traceable records. Outstanding is calculated from invoice total minus valid payments and refunds. Refunds are append-only payment-adjustment records, and the original receipt amount remains unchanged. Do not silently edit historical payments; use the Refund action and document the reason.

The patient profile Financial statement tab and Print statement action use the same invoice/payment/refund projection as the financial source of truth. Refunds remain append-only adjustments and do not mutate the original receipt amount.

## Inventory

Create a stock item with its opening quantity, then use **Adjust stock** for purchases, usage, stock-outs, expiry quarantine, damage or corrections. The application records before/after values and blocks a movement that would make stock negative. Full packaged audit-actor and restore evidence remains open.

## Notifications

Notifications combine due invoices, low stock, expiry, queue wait, clinical follow-up and stale-backup signals. Settings can enable or mute queue, clinical, inventory, balance and backup categories. Read state is stored locally; open a notification to jump to its relevant page or record.

## Flagship command center, analytics and diagnostics

The Dashboard is a command center rather than a static report. Use **Customize dashboard** to show or hide schedule, queue, follow-up and operational-signal cards, move enabled cards up or down, or reset the layout; preferences are saved for the current practice workspace. Open the command palette with **Ctrl K** (or **Cmd K** on macOS) to run common actions and permission-scoped searches without leaving the current workflow. Dashboard periods include Today, 7 days, 1 month, 3 months, 6 months, 1 year and a custom date range.

**Analytics** summarizes saved collections only: collected payments, billed invoices, expenses, net operating result, appointment completion/no-show rates, six-month trends and payment mix. It does not create targets, diagnose patients or infer clinical recommendations. **Diagnostics** shows storage source/size, schema version, record counts, relationship issues, attachment issues, backup age and local-account health. Run an integrity check after an import or before a high-risk restore.

## Patient profile and treatment planning

Start from **Patients** and open a profile to keep overview, visits, treatment plan, dental chart, prescriptions, billing, financial statement, attachments, referrals and timeline context together. Patient records can include important alerts, preferred contact method, normalized tags and configured custom fields. Archive status is distinct from an active patient directory result; archived records are not silently deleted.

Treatment plans are clinician-authored planning records. Capture a clinical goal, procedures, tooth numbers, responsible dentist, duration, estimated cost, discount, review date and line-based stages. Estimates do not create invoices. Stage buttons cycle the saved stage status and remain auditable.

## Appointments, queue, rooms and prescriptions

Appointments offer **Day**, **Week**, **Month** and **Agenda** views. Use the date arrows and Today button to move through the schedule; the Agenda view keeps upcoming visits in a compact chronological list. Appointment forms retain dentist, chair, room and duration. A save that overlaps an existing dentist, chair or room asks for explicit confirmation and names the shared resource. Today’s Queue cycles checked-in, waiting, in-treatment and completed states and records wait timestamps.

Prescription forms preserve the first medicine fields for compatibility and accept additional medicines one per line using `medicine | strength | dosage | frequency | duration | route | instructions`. The resulting prescription remains clinician-authored, printable and free of automated medical recommendations.

## Clinical safety

Dentiva Pro is record-management software. It does not independently diagnose disease or prescribe medication. The dentist remains responsible for clinical decisions and the accuracy of professional input.

## Attachments

Image attachments can be previewed after their type, size and data URL are validated. PDFs and other clinical files are downloaded rather than embedded as active inline content; open them with a trusted local application. Attachments are limited to 6 MB and unsafe executable/HTML types are rejected.

## CSV, search and filters

The patient directory includes a CSV import preview with column mapping for identity/contact fields, required name/phone validation, duplicate Skip/Create New Copy policy and snapshot rollback, plus UTF-8 CSV exports. Multi-entity relationship mapping remains outside the current patient importer; do not treat patient CSV import as a clinical or financial import.

## Future-version workspaces

If a workspace was created by a newer Dentiva Pro schema, the application preserves it without silently downgrading or overwriting it. Use **Export preserved data** and open that file with a compatible release. Reset is destructive and should only be used after a verified export.
