# Dentiva Pro user guide

## Start here

Dentiva Pro opens to an empty practice workspace. No patient, transaction, appointment or demo record is created for you. Complete **Setup** to add the clinic identity, then use the shortcut panel on Dashboard.

## Recommended workflow

1. Register a patient.
2. Book an appointment.
3. Check the patient in from **Today’s Queue**.
4. Record the clinical visit and any tooth-level note.
5. Create a prescription or invoice if needed.
6. Record each payment separately; use the Refund action for a documented reversal instead of editing history.
7. Record stock usage or stock-out movements when materials leave inventory.
8. Set a follow-up date and export a verified backup.

## Data and privacy

Core records are stored locally in the application profile. Dentiva Pro does not require an account, cloud service or paid API. Keep the workstation protected and use **Backup & Restore** regularly.

## Backup and restore

Use **Export full backup** to download a structured `.dentiva.json` package. It contains a manifest, schema version, record counts, attachment data and a SHA-256 hash over canonical backup data. On import, Dentiva Pro verifies the hash when present, validates relationships and attachment safety, then shows detected record counts, possible ID conflicts and warnings before any data is changed.

Restore strategies:

- **Keep Existing** — keep local records when IDs conflict.
- **Skip** — skip records with an existing ID.
- **Replace** — update the local record with the backup record.
- **Create New Copy** — import the conflicting record with a new local ID and remap patient, invoice, payment, inventory and supplier references where applicable.

You may restore whole modules or select patients from the preview. If validation or persistence fails, the local state is restored from the pre-import snapshot and the operation reports the reason. A patient-scoped restore can only include records whose relationships remain valid.

Always keep a copy of the backup in a trusted location. For sensitive data, use an encrypted drive or operating-system file protection.

## Printing and PDF

Print actions open a clean print preview. Select a Windows printer, paper size and copies in the system dialog, or choose **Save as PDF**. Invoice, payment receipt, prescription, patient summary, queue, chart and report layouts include the current clinic identity when it has been configured.

## Financial records

Invoices calculate subtotal, discount, configured tax and total from line items. Payments are separate traceable records. Outstanding is calculated from invoice total minus valid payments and refunds. Refunds are append-only payment-adjustment records, and the original receipt amount remains unchanged. Do not silently edit historical payments; use the Refund action and document the reason.

## Inventory

Create a stock item with its opening quantity, then use **Adjust stock** for purchases, usage, stock-outs, expiry quarantine, damage or corrections. The application records before/after values and blocks a movement that would make stock negative.

## Clinical safety

Dentiva Pro is record-management software. It does not independently diagnose disease or prescribe medication. The dentist remains responsible for clinical decisions and the accuracy of professional input. Staff roles in this local single-profile release are descriptive; they do not provide per-user permissions or network collaboration.

## Desktop, browser and attachments

The Windows desktop build is the supported production persistence target. It writes an atomic local JSON store with a last-known-good recovery copy and a 200 MB safety ceiling. The browser build is an offline preview fallback using browser storage; browser profile deletion or quota limits can still affect it, so use the desktop build and verified backups for clinic operations.

Image attachments can be previewed after their type, size and data URL are validated. PDFs and other clinical files are downloaded rather than embedded as active inline content; open them with a trusted local application. Attachments are limited to 6 MB and unsafe executable/HTML types are rejected.

## Tax, payment methods and print profiles

Enable **Apply default invoice tax** and set a two-decimal percentage in Settings for new invoices. An invoice stores its own tax rate, so later settings changes do not rewrite historical totals. Payment methods are configurable in Settings while Cash, Bank and Card remain available. Choose A4, Letter or 80 mm Receipt for the practice print profile; the Windows print dialog remains the final authority for printer selection and copies.

## Future-version workspaces

If a workspace was created by a newer Dentiva Pro schema, the application preserves it without silently downgrading or overwriting it. Use **Export preserved data** and open that file with a compatible release. Reset is destructive and should only be used after a verified export.
