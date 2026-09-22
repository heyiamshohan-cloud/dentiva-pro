# Dentiva Pro user guide

## Start here

Dentiva Pro opens to an empty practice workspace. No patient, transaction, appointment or demo record is created for you. Complete **Setup** to add the clinic identity, then use the shortcut panel on Dashboard.

## Recommended workflow

1. Register a patient.
2. Book an appointment.
3. Check the patient in from **Today’s Queue**.
4. Record the clinical visit and any tooth-level note.
5. Create a prescription or invoice if needed.
6. Record each payment separately.
7. Set a follow-up date and export a verified backup.

## Data and privacy

Core records are stored locally in the application profile. Dentiva Pro does not require an account, cloud service or paid API. Keep the workstation protected and use **Backup & Restore** regularly.

## Backup and restore

Use **Export full backup** to download a structured `.dentiva.json` package. It contains a manifest, schema version, record counts and all local data required to restore relationships. On import, Dentiva Pro shows detected record counts, possible ID conflicts and validation warnings before any data is changed.

Restore strategies:

- **Keep Existing** — keep local records when IDs conflict.
- **Skip** — skip records with an existing ID.
- **Replace** — update the local record with the backup record.
- **Create New Copy** — import the conflicting record with a new local ID.

Always keep a copy of the backup in a trusted location. For sensitive data, use an encrypted drive or operating-system file protection.

## Printing and PDF

Print actions open a clean print preview. Select a Windows printer, paper size and copies in the system dialog, or choose **Save as PDF**. Invoice, payment receipt, prescription, patient summary, queue, chart and report layouts include the current clinic identity when it has been configured.

## Financial records

Invoices calculate subtotal, discount, configured tax and total from line items. Payments are separate traceable records. Outstanding is calculated from invoice total minus valid payments. Do not silently edit historical payments; use an adjustment or reversal record in your clinic process.

## Clinical safety

Dentiva Pro is record-management software. It does not independently diagnose disease or prescribe medication. The dentist remains responsible for clinical decisions and the accuracy of professional input.
