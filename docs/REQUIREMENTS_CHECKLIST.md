# Dentiva Pro v1.3.0 requirements checklist and release gate

**Status date:** 2026-09-22 (Asia/Dhaka)
**Branch:** `arena/01a0c66a-dentiva-pro`
**Baseline:** published `v1.2.0`, preserved
**Evidence rule:** `[x]` means implemented and supported by a meaningful test or deterministic domain evidence. `[~]` means implementation exists but a required visual, packaged, human or Windows check remains open. `[ ]` means not implemented or not evidenced and must not be marketed as complete.

## Release identity and product boundaries

- [x] New semantic version `1.3.0` is synchronized in package metadata, lockfile and renderer identity.
- [x] Existing `v1.0.0`, `v1.1.0` and `v1.2.0` tags/assets are preserved; no prior release is overwritten.
- [x] First-run production store remains empty; no demo/test records or fake dashboard values are shipped.
- [x] Offline/local operation remains the default; no mandatory cloud, telemetry, paid API or external patient-data service.
- [x] Light-only premium visual direction and Bangladesh defaults remain in place.
- [x] No automated diagnosis, treatment recommendation or prescribing is introduced.
- [~] Windows CI artifact, checksum and packaging gates passed on run `35708916503`; `v1.3.0` tag/GitHub release publication remains pending the explicit workflow-dispatch step.

## Design system, navigation and command center

- [x] Existing light-only design system, typography, icon set, navigation groups and responsive desktop layout are preserved.
- [x] Flagship CSS adds analytics, diagnostics, notification, patient-alert, custom-field and reduced-motion states.
- [x] Dashboard provides schedule, queue, follow-up, signal, metric and shortcut command-center surfaces.
- [x] Dashboard widget visibility, order and reset-to-default are configurable and persisted locally.
- [x] Command palette supports commands, permission-scoped navigation and local record search.
- [x] Six-viewport visual/layout regression — Windows CI run `35708916503` installed Chromium and passed the required 1280×720, 1366×768, 1600×900, 1920×1080, 2560×1440 and 3840×2160 projects; local Chromium remains unavailable.
- [~] Subjective premium visual review — human review remains required even if automated layout checks pass.

## Clinical and patient workflows

- [x] Patient directory, profile, relational timeline, visits, dental chart, prescriptions, referrals, attachments and financial statement remain available.
- [x] Patient saves validate required identity/contact shape, normalize tags, retain status/archive state and persist configured custom fields.
- [x] Patient profile surfaces status, age, alert, preferred contact, tags, custom values, clinical context, appointments, payments, follow-ups, notes, audit and recent activity.
- [x] Treatment catalog and staged treatment plans remain available.
- [x] Treatment plans capture goal, procedures, tooth numbers, duration, estimate, discount, estimated total, review date, responsible dentist and progressable stages.
- [x] Appointments offer Day, Week, Month and Agenda views, capture dentist/chair/room/duration, and conflict warnings name the overlapping resource.
- [x] Queue lifecycle preserves serial, wait timestamp and status transitions.
- [x] Prescriptions preserve first-medicine compatibility and support multiple structured medicines with print output.
- [x] Clinical copy states that Dentiva Pro records clinician input and does not diagnose or prescribe automatically.
- [~] Packaged clinical/prescription/document walkthrough — Windows packaged GUI and human print review remain open.

## Finance, payment center and source of truth

- [x] Integer-cent invoice, tax, discount, payment and refund helpers remain deterministic.
- [x] Billing, payment center, patient statements, receipts, refunds/adjustments and expenses remain separate auditable records.
- [x] Patient profile statement UI and print statement use `statementEntries`, the same deterministic projection used by domain tests.
- [x] Analytics summarizes collected, billed, expense, net, completion/no-show and payment-mix values from saved records.
- [~] Packaged printer/PDF and edge-case financial walkthrough — required on Windows; source/domain evidence alone is not sufficient.

## Inventory, suppliers, accounting and staff

- [x] Inventory, supplier, stock movement, reorder, expiry, damage/correction and negative-stock guardrails remain available.
- [x] Supplier cards summarize linked stock items, recorded purchase movements and purchase value when unit prices are available.
- [x] Accounting keeps expenses separate from patient billing and feeds analytics/reports.
- [x] Staff directory and local user accounts retain role, association, active state, lockout and last-login fields.
- [~] Packaged inventory restore/audit walkthrough and large-dataset UI profiling — open for Windows/human acceptance.

## RBAC, audit and diagnostics

- [x] Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role templates remain defined.
- [x] Expanded permission vocabulary covers analytics, diagnostics, imports/exports, plans, notifications, attachments, backup validation and customization.
- [x] Route, search, form, mutation, export, print and backup boundaries check permissions; hidden buttons are not the only control.
- [x] Audit records capture security, settings, dashboard, clinical, financial, inventory, backup and restore actions.
- [x] Diagnostics surfaces schema, local storage, record count, relationship, attachment, backup and account health.
- [~] Packaged multi-role/sign-in/lockout/restart matrix — Windows GUI evidence remains open.
- [~] OS/full-disk encryption — documented boundary, not provided by SQLite; operator control remains required.

## Search, notifications, reporting and import/export

- [x] Global local search and command palette remain offline and permission-scoped.
- [x] Notifications cover outstanding invoices, low stock, expiry, follow-up, queue wait and stale backup signals; category rules can be muted in Settings, read state persists, and actions open the relevant page/record.
- [x] Reports retain patient, visit, appointment, outstanding, inventory, expense and revenue workflows with custom ranges and CSV/PDF paths.
- [x] Backup center shows last backup, storage/schema facts and recent backup/restore history from the audit ledger; structured manifest, canonical SHA-256 payload hash, relationship validation and explicit restore strategies remain available.
- [x] Restore module groups include settings, users, medication catalog, notification rules and normalized rooms; patient-scoped dependent records are filtered.
- [x] Patient CSV import has mapping, preview, required-field validation, duplicate Skip/Create New Copy policy and rollback.
- [~] Broader multi-entity CSV relationship mapping — not silently claimed; current importer remains patient-focused.

## Attachments, backup/restore and data integrity

- [x] Attachment MIME/name/size/data safety checks remain enforced; unsafe active content is not embedded.
- [x] SQLite persistence retains staged atomic writes, integrity-checked recovery backup, managed attachments and 200 MB safety ceiling.
- [x] Legacy JSON migration is non-destructive; future schemas are preserved and blocked from silent downgrade.
- [x] Backup restore validates payload, relationships and attachment safety before mutation and rolls back in-memory state on persistence failure.
- [~] Electron packaged corruption/interrupted-write/restore GUI evidence — Windows CI/manual acceptance remains open.

## Localization and documents

- [x] Bengali resource map and DOM translation cover the release-critical navigation, document and workflow labels present in source.
- [x] Bengali locale-aware number, currency, date and time formatting is used when selected.
- [~] Native Bangladeshi Bengali review of every dynamic validation/error/empty/loading state — human review required.
- [~] Bengali print/PDF/invoice/receipt/prescription/patient/report visual review — human/Windows review required.
- [x] Print templates retain clinic identity, safe logo handling, configurable footer/logo/contact controls and A4/A5/Letter/Receipt options.
- [~] Full configurable template editor for every document type — not claimed; current settings expose shared safe print profiles and shared document controls.

## Electron, Windows and security hardening

- [x] Context isolation, sandbox, no Node integration, web security, restricted navigation, CSP, no webviews and narrow preload bridge remain configured.
- [x] PDF IPC rejects scripts, frames, embeds and remote resources; isolated PDF window disables JavaScript.
- [x] Windows release workflow does not gate on the excluded installed-app smoke and still blocks on portable persistence, visual, package, PE, ZIP and checksum checks.
- [~] Linux sandbox cannot run the real Electron GUI because the Electron binary cache/download is unavailable; Windows CI is authoritative.
- [~] Windows installed-app launch/restart/uninstall sequence — explicitly **MANUAL USER VERIFICATION REQUIRED**, never claimed as automated PASS.

## Performance, regression, license and metadata

- [x] `node --check` passes for renderer, domain and Electron source.
- [x] `npm test` passes 46 tests in the local sandbox.
- [x] `npm run build` passes for the production Vite bundle.
- [x] Synthetic dataset benchmark passes at 1,000, 5,000, 10,000 and 25,000 records with zero relationship errors; synthetic records are never written to the app store.
- [x] Proprietary license/creator metadata, icon configuration, artifact names and build date remain explicit.
- [x] Resolved dependency audit is clean after the Electron 44.4.3/electron-builder 26.15.3 upgrade; license inventory is documented in `docs/THIRD_PARTY_LICENSES.md`.
- [x] Playwright visual checks and Windows packaging/artifact checks — Windows CI run `35708916503` passed visual, packaging, PE, portable smoke, ZIP and checksum gates; direct archive download is unavailable from this sandbox.
- [~] Commercial license/dependency review — technical inventory is complete; final legal owner review of packaged Electron/Chromium notices remains required before broad distribution.

## Current release decision

**NOT YET PUBLISHED in this working-tree evidence.** Local deterministic gates and Windows CI artifact/visual/package gates pass on run `35708916503`. The explicit publication workflow, remaining native Bengali/document/security human review and final commercial owner review are still reported separately and honestly.

**The Windows installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains for manual user verification.** It is not a release blocker and is not a claimed PASS.
