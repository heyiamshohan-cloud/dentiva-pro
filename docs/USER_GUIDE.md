# Dentiva Pro v1.2.0 user guide

## Release note

The v1.2.0 implementation is currently in a release-gate cycle. The user workflows below describe implemented behavior, while unresolved runtime, Bengali, Windows, visual and feature-gap items are listed in [`FINAL_AUDIT_REPORT.md`](FINAL_AUDIT_REPORT.md). v1.0.0 and v1.1.0 remain separate releases.

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

Keep a verified backup in a trusted location. The v1.2 release gate still requires packaged Electron corruption, interrupted-write and rollback testing; do not treat a browser preview as that evidence.

## Printing and PDF

Print actions open a clean print preview. Select a Windows printer, paper size and copies in the system dialog, or choose **Save as PDF**. Invoice, payment receipt, prescription, patient summary, queue, chart and report layouts include the current clinic identity when it has been configured.

A4, Letter and 80 mm Receipt profiles exist. Complete Bengali rendering, configurable profile coverage and Windows printer/PDF acceptance remain v1.2 release-gate items until tested on the packaged app.

## Financial records

Invoices calculate subtotal, discount, configured tax and total from line items. Payments are separate traceable records. Outstanding is calculated from invoice total minus valid payments and refunds. Refunds are append-only payment-adjustment records, and the original receipt amount remains unchanged. Do not silently edit historical payments; use the Refund action and document the reason.

A complete patient financial statement and configurable statement print/PDF are still open v1.2 feature work; existing billing and payment views must not be described as that finished capability.

## Inventory

Create a stock item with its opening quantity, then use **Adjust stock** for purchases, usage, stock-outs, expiry quarantine, damage or corrections. The application records before/after values and blocks a movement that would make stock negative. Full packaged audit-actor and restore evidence remains open.

## Clinical safety

Dentiva Pro is record-management software. It does not independently diagnose disease or prescribe medication. The dentist remains responsible for clinical decisions and the accuracy of professional input.

## Attachments

Image attachments can be previewed after their type, size and data URL are validated. PDFs and other clinical files are downloaded rather than embedded as active inline content; open them with a trusted local application. Attachments are limited to 6 MB and unsafe executable/HTML types are rejected.

## CSV, search and filters

The patient directory includes a CSV import preview with column mapping for identity/contact fields, required name/phone validation, duplicate Skip/Create New Copy policy and snapshot rollback, plus UTF-8 CSV exports. Multi-entity relationship mapping remains outside the current patient importer; do not treat patient CSV import as a clinical or financial import.

## Future-version workspaces

If a workspace was created by a newer Dentiva Pro schema, the application preserves it without silently downgrading or overwriting it. Use **Export preserved data** and open that file with a compatible release. Reset is destructive and should only be used after a verified export.
