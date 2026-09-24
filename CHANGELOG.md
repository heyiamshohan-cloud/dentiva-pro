# Changelog

## 1.6.0 (2026-09-24) — Flagship product-wide upgrade

### Clinical — the prescription is a clinical document (never a bill)
- Prescription builder: C/C multi-select (Pain On, G. Carries, Swelling, Gum Bleeding, Bad Breath, Sensitivity) and O/E multi-select (Carries / G Carries, BDR / BDC, Gingivitis, Parodental Pocket, Perio Dontitis, Pulpitis, Impected Teeth, Dry Socket, Attrition / Erosion) with Custom/Other, plus dedicated R/E, Diagnosis and Advice sections.
- Structured medication rows: medicine with catalog bind, form, strength, dose, frequency patterns (1-0-1…1-1-1-1, SOS), before/after/with-food, duration value+unit, quantity, instructions; add/remove/duplicate/reorder; clinician-authored templates; lossless preview round-trip.
- Contract test enforces a money-free prescription (no totals, discount, tax, paid/due, currency symbols).

### Patients
- Patient Code is first-class: DP-prefixed, stable for the patient's lifetime, unique; shown with the name on lists, Patient 360, documents, reports and search; contract-tested.
- Flagship patient list: 10 sort keys (incl. balance/billed/paid/visits via single-JOIN aggregates), 11 configurable columns, advanced filters (tag, registration dates, tooth status, phone), density toggle, persisted preferences, saved views.
- Patient 360: lifetime billed/paid/due, professional statement (opening/closing balance, period filter, pager, print/PDF), per-visit clinical+billing cards, timeline, patient-scoped audit.
- Command palette: action commands + global search across 7 collections; full keyboard navigation.

### Documents
- One shared document engine renders Prescription, Invoice, Payment Receipt and Patient Statement: preview ≡ print ≡ PDF on A4/A5/Letter/80mm.
- Receipt: received/refunded/net, remaining due for the linked invoice, method reference guidance (bKash/Nagad/Rocket/Upay/Bank/Card/Cash), received-by attribution.
- Forensic render coverage: 40-row medication tables, long Bengali/English mixed content, multipage-safe layout.

### Quality & integrity
- Dental chart: true FDI labels (primary renders its actual 20 teeth), anatomical quadrant layout, multi-tooth bulk apply.
- Double-submit guard on all forms; overpayment blocked server-side; refunds never mutate the original payment.
- Settings: clinic website + dentist BMDC registration feed every document header.
- +52 Bangla strings; dead-action registry diff (1 dead UI action fixed); op/query registry parity verified; negative-stock and double-booking guards verified.
- Tests: 133 tests — 131 pass, 0 fail, 2 skipped (manual benchmarks); scale benchmarks 1k/10k/25k/100k (aggregate list page 2.3–39.8 ms; statement 0.6 ms).
- Windows CI installed-app smoke of THIS build: install→launch→login→patient→backup→restart persistence, 12/12 passed on the Windows runner.

## 1.5.2 (2026-09-24)

**Final forensic-audit hardening release** — the entire product (runtime, IPC, frontend, scale, packaging, docs-truth) was re-audited and every valid finding fixed at root cause.

### Fixed
- **Dead "Date format" setting is now real.** Settings offered a free-text date-format field that never changed anything; it is now a select ("23 Sep 2026" / "23/09/2026") wired into the single date renderer used across every list and table, with legacy free-text values safely mapped.
- **Bootstrap session race.** A sign-in completed while the startup bootstrap was still in flight can no longer be overturned by the older bootstrap reply (the renderer never stomps a freshly established session).
- **`print:html` errors are predictable** — invalid print payloads get a structured `{ok:false,error}` result instead of an IPC exception.
- **In-app version drift.** The version shown in the app and used by the upgrade path (`APP_VERSION` in `src/migrate-state.js`) had drifted from `package.json`; they are now synchronized and a contract test blocks future drift.

### Changed / Hardened
- **Dead code removed**: `public/sw.js` (a never-registered service-worker stub shipped with every build) is deleted.
- **Build gate tightened**: `ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES` removed — with zero runtime dependencies, any unresolved dependency is a packaging defect that must fail the build.

### Verified for this release
- npm audit (production + dev): 0 vulnerabilities.
- 100k-patient dataset benchmark (945,086 rows): list pages ≤172 ms, backups 2.3 s, integrity OK (see `docs/PERFORMANCE_BASELINE.md`).
- Every UI action rendered to the desktop client has a handler (63/63).

## v1.5.1 — Post-release packaging hotfix: installed-app startup restored, professional icon, packaging gates enforced

**Fixes (release-blocking)**
- **Installed Windows app crashed at startup** in v1.5.0 with `ERR_MODULE_NOT_FOUND: …\app.asar\src\core.js` (imported from `app.asar\electron\lib\records.mjs`). Root cause: electron-builder `build.files` shipped only `dist/`, `electron/`, `package.json` — the shared service layer `src/**` (`core.js`, `domain.js`, `migrate-state.js`, `notifications.js`, `ops.js`, `queries.js`, `backup-schedule.mjs`) was excluded from `app.asar` even though the production module graph (main → `lib/db.mjs` → `lib/records.mjs` → `../../src/core.js`) requires it at boot. `build.files` now ships `src/**/*`.
- **New application icon**: programmatically rendered vector tooth mark — mathematically centered, balanced margins, teal brand tile retained — with a true multi-resolution Windows ICO (16/24/32/48/64/128/256 PNG layers, 256 PNG-compressed per Windows spec) plus a 1024×1024 PNG master and regenerated `icon.svg`. Replaces the cropped/uncentered artwork everywhere the OS consumes it (exe, installer, desktop/Start-menu shortcuts, taskbar, Add/Remove Programs).

**Robustness hardening**
- Migration entry no longer declares a database "corrupt" on the first transient open error: `detectLayout` retries lock/busy-class errors (SQLITE_BUSY, EACCES, sharing violations, e.g. a winding-down prior instance) before quarantining, and quarantines now log the preserved path loudly. Prevents a healthy workspace from being side-lined after a non-clean shutdown.

**Regression gates (this class of defect cannot pass silently again)**
- `tests/packaging.test.mjs` computes the production runtime module closure from `electron/main.mjs` + `electron/preload.cjs` via shared `scripts/runtime-module-graph.mjs` and fails unless every runtime module is covered by `build.files` (verified to fail on the v1.5.0 config and pass on the fixed one).
- New CI step **Verify packaged ASAR contains the complete runtime module closure** (`scripts/verify-packaged-runtime.mjs`) inspects the actual built `app.asar` after packaging, before any launch.
- Windows smoke gate hardened: the previous `-PortableOnly` CI invocation masked the installed-app failure. CI now NSIS-installs silently, verifies the **installed** `resources/app.asar` module closure, launches the installed executable with a real UI data operation, verifies restart persistence, and uninstalls. Launch logs are rejected on any `ERR_MODULE_NOT_FOUND` / `ERR_REQUIRE*` / `Cannot find module` content explicitly.
- `build.executableName: DentivaPro` for a consistent installed binary name.

**Verification**
- `node --test tests/*.test.mjs`: green on this commit; packaging regression gate proven both directions.
- `v1.5.0` (tag `v1.5.0`, commit `c4ddab8`) remains published and untouched; no release history was rewritten.
- Full post-release audit: `docs/POST_RELEASE_PACKAGING_HOTFIX_AUDIT.md`.


## v1.5.0 — Live signals, automated protection, complete surfaces

**New & completed**
- Live notification engine: workspace signal scan (appointments, follow-ups, payments, stock, expiry, queue waiting, backup reminders) with persistent read/dismiss state, per-category rule toggles, debounced post-write refresh, 120s background refresh. Signal source is never fabricated — all rows derive from real workspace data.
- Automatic backup scheduler: enable/cadence/retention from Settings; runs in the main process with single-flight, same-second collision retry, verified full snapshots identical to manual backups, automatic prune, and failure surfacing on the Backup & Restore page. Enabled by default (opt-out, ~45s post-boot first check, 5-minute cadence check).
- Global audit trail (Activity log): every protected op attributed to the account that ran it — filter by record type, user, or date range; paginated; per-entry detail with secrets stripped before display; streaming CSV export (all pages) respecting `audit.export`.
- Custom patient fields: practice-defined fields (label + type, up to 40), stored per patient, rendered dynamically in the patient form and profile; definitions normalized and clamped.
- Start-visit one-click from appointment cards/details; recording a visit against an appointment walks it to Completed with timestamps + audit breadcrumb.
- Inventory movement ledger on the Inventory page (immutable before/after, reason, attribution; most-recent 12 of full history).
- Idle application lock: `autoLockMinutes` is now enforced (watchdog on pointer/key/wheel activity; zero disables).

**Fixes**
- v1.4.0 live bug: the Expenses page was permission-blocked for every account including Administrator (collection→permission mapping); restored via `accounting.view`.
- `patient.update` silently dropped custom-field edits; now round-trips on both runtimes.
- Bengali UI: 130+ surface strings localized; residual-scan coverage verified.
- Queue page grid switches to intrinsic autofill (no fixed-column squeeze at marginal widths).
- Notification rules storage unified (legacy array entries translated to object map).

**Verification (see docs/FINAL_COMMERCIAL_RELEASE_AUDIT.md)**
- 104/104 node:test suites on both runtimes (journeys J1–J10, upgrade-safety, scheduler, custom fields, audit, notifications, security print-IPC).
- Scale: 100,000 patients / 945,086 real records re-measured on the final engine (page-1 list < 25 ms; global search ≈ 1 s; backup 1.9 s; integrity ✓).
- Upgrade: v1.4.0 workspaces forward-migrated without data loss; future-schema workspaces quarantined without writes.


## v1.4.0 — Relational engine, shared service layer, premium light UI

**Storage**
- Replaced the sql.js whole-state store with a relational `node:sqlite` workspace (layout v1): 26 collection tables, integer-cent money columns, enforced foreign keys, ~40 indexes, WAL journaling, append-only audit.
- Removed every artificial limit: no 200 MB database cap, no 6 MB attachment cap, no record caps. Scale is limited only by hardware (benchmarked: 100,000 patients / 945,086 records, page-1 list 18 ms, backup of a 412 MB store 1.6 s).
- v1.3.0 migration (v4 sql.js DB, legacy JSON, corrupt-primary `.bak` recovery, future v5 `.bak` recovery): quarantines orphans with reasons, repairs dangling references (column nulled, payload preserved), recomputes exact integer-cent balances, externalizes inline attachment bytes to a file store, sanitizes user secrets, preserves the source file (`.v4-preserved.sqlite`) and is idempotent on re-run.
- Backup engine: consistent `VACUUM INTO` snapshot + attachment files + SHA-256 manifest; restore validates first and always keeps a pre-restore safety backup; v1.3.0 JSON backups restore with module groups (patients / clinical / finance / operations) and Keep Existing / Replace / Create New Copy strategies; folder and file pickers; backup listing, pruning and deletion with containment checks.
- Diagnostics: integrity + FK checks, storage facts, per-collection counts, free disk, issue report; last-shutdown health recorded at quit.

**Service layer**
- Shared `src/ops.js` registry (~50 operations) and `src/queries.js` registry executed by both runtimes (Electron main SqlRepo, browser LocalRepo) — one source of truth for validation, money math, inventory guards and audit.
- Financial invariants enforced server-side: overpayment blocked; invoice re-pricing blocked once payments/adjustments exist (explicit error, never silent); refunds write Refund entries and never mutate the original payment; adjustments capped at the due balance; patient balance cache always consistent (including forgiveness adjustments).
- Server-side RBAC on every operation and query; audit entries written server-side and attributed to the live session; session timeout from settings.
- Auth: PBKDF2-SHA-256 with per-user salt (210k iterations; v1.3.0 120k renderer hashes verified and upgraded on first successful login); 5-failure/30-second lockout persisted in the users table; first-run setup creates the administrator account. First-run/auth hardening from the first CI validation: admin-coverage guard now projects the post-upsert population (the very first Administrator was previously rejected), browser KDF results map to the repo's `pinHash`/`pinSalt` keys (first-run sign-in previously stored unusable hashes), and desktop PIN verification compares digest bytes correctly (every Electron sign-in previously failed).
- New operations: `workspace.reset` (typed-RESET confirm; wipes records, preserves accounts + settings), `medicationCatalog.save`, `dental.removeCurrent`, `invoice` reprice-lock, movement vocabulary normalization (v1.3.0 `Stock-out`/`Expired`/`Damaged` mapped onto the canonical vocabulary).

**IPC / Electron**
- ESM main process (`electron/main.mjs`) importing the shared service layer; hardened window (context isolation, no Node integration, sandbox, web security); navigation + webview guards; CSP `frame-ancestors 'none'`; single-instance lock; graceful shutdown with health metadata; future-layout guard (`unsupportedSchema`) blocks silent overwrite and offers export + reset.
- Preload exposes a single allowlisted `invoke` (19 channels); all identity comes from the main-process session — never from the renderer.
- PDF printing through an isolated, script-disabled window with blocked-content validation; receipts support the 80 mm profile.

**Renderer**
- Rebuilt as an async, server-side-paginated client over `src/api.js` (DesktopApi / LocalApi). No page hydrates a full collection; lists paginate with server counts; patient lookups resolve through a capped directory query. Modal interaction hardened from the CI validation runs: backdrop-click-to-close now fires only on the overlay itself (previously any click inside a dialog — including every submit button — closed the modal and canceled the form submission), and `data-action` buttons inside forms never trigger implicit form saves.
- Design System 2.0, light-only: design tokens, premium shell, dashboard 3.0 (configurable widgets), ⌘K command palette, queue 2.0, dental chart 2.0 (preserved tooth history, dentitions), patient timeline, statements, accounting with receivables aging, analytics with monthly trends, diagnostics, notifications 2.0, saved views, first-run setup, local lock.
- Localization: 449-entry EN/BN dictionary carried over 1:1, bn-BD number/date formatters, `translateDom` pass over rendered output.
- All v1.3.0 workflows preserved: patients (merge, CSV import/export, saved views), appointments (day/week/agenda, overlap confirm), queue, visits, dental, prescriptions (medication catalog), treatment plans (stage cycling, explicit visit conversion), billing (reprice lock), payments/refunds/adjustments, expenses, inventory (movements, low stock, expiry), suppliers, staff, referrals, follow-ups, attachments (inert previews, on-demand content), users (effective-permission grid), settings, backup/restore (module groups + strategies), notifications, printing (invoice, receipt, prescription, statement, chart, queue, billing, visit, expense, patient summary).

**Testing**
- 60-test `node:test` suite: smoke (architecture + guardrails + i18n), security (boundary, PDF, no telemetry, no caps, PBKDF2, server-side RBAC), storage (relational persistence, v4/legacy/corrupt migration, backup round-trip with tamper rejection, FK violation detection), **first-run** (setup→administrator PIN→sign-in on both runtimes, last-Administrator protections, zero-admin store guard), workflows (financial formulas, restore strategies, RBAC templates), domain.
- Functional suites verified against both repos: ~60-check ops/queries smoke (SQL + browser parity) and backup/restore/diagnostics round-trip.
- Scale benchmark on the real store: 1k / 10k / 25k / 100k patients.
- `npm audit`: 0 vulnerabilities. Zero runtime dependencies.

**Known limitations**
- The Electron GUI cannot run in the Linux sandbox; the packaged-app smoke (launch/restart persistence, PE checks, packaging) runs in Windows CI as release gating.
- Installed-app launch/restart/uninstall smoke remains manual user verification (unchanged policy from v1.3.0).

## 1.3.0 — 2026-09-22 — published

### Command center and insight surfaces

- Added deterministic analytics projections for period bounds, collections, expenses, net operating result, completion/no-show rates, payment mix and six-month trends.
- Added a configurable dashboard widget command center, expanded command palette actions, actionable notification page and diagnostics workspace.
- Added persisted derived-notification read state for queue, follow-up, stock, expiry, balance and backup signals.
- Added flagship responsive/reduced-motion CSS for analytics, diagnostics, notifications, patient alerts and custom fields while retaining the light-only design system.

### Patient and clinical workflows

- Expanded patient validation and profile context with status/archive handling, age, important alerts, preferred contact, normalized tags and configured custom fields.
- Expanded treatment plans with clinical goals, procedures, tooth numbers, estimated duration, estimated cost, discounts, estimated totals, responsible dentist, statuses and stage progress.
- Added Day, Week, Month and Agenda appointment views, room capture and room-aware overlap messaging alongside existing dentist/chair/duration checks.
- Added structured multi-medicine prescriptions, a local saved medication catalog and reusable prescription fields while preserving first-medicine compatibility and print behavior.
- Expanded patient profiles with appointments, payments, follow-ups, notes and patient-audit sections; treatment plans can create an explicit clinical visit without creating financial transactions.
- Added patient timeline/statement domain projections and routed the profile financial statement and print statement through the same source-of-truth helper.

### Persistence, security and release hygiene

- Bumped the renderer/store schema to v4 with normalized room records, custom-field migration defaults and backup/restore coverage for medication catalog, notification rules and rooms.
- Expanded permission vocabulary and operation-level guards for analytics, diagnostics, imports/exports, plans, rooms, notifications, attachments and backup validation.
- Upgraded the build toolchain to Electron 44.4.3 and electron-builder 26.15.3; complete `npm audit` reports zero vulnerabilities in the resolved dependency tree.
- Added deterministic domain tests; the local Node suite now passes 46 tests and the Vite production build passes.
- Updated release identity and documentation for the new v1.3.0 semantic version. v1.0.0, v1.1.0 and v1.2.0 remain preserved.
- Windows CI run `35710031145` passed the six viewport, packaging, PE, portable persistence, ZIP and checksum gates and published the v1.3.0 release with the portable EXE, NSIS installer, application ZIP and checksum asset.
- The Windows installed-app launch/restart/uninstall smoke remains intentionally excluded from automated release gating and is **MANUAL USER VERIFICATION REQUIRED**.

## 1.2.0 — 2026-09-22 — published

### Persistence and security

- Replaced the fragile desktop JSON persistence path with bundled `sql.js` SQLite tables, atomic staged writes, verified backup recovery, attachment management, a 200 MB guardrail and non-destructive v1.1 JSON migration.
- Added local practice user accounts with staff association, active/inactive state, failed-attempt lockout, last-login/session state and salted PBKDF2-SHA-256 PIN hashes.
- Added permission-enforced role templates for Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role. Protected operations check authorization in handlers rather than relying only on button visibility.
- Added schema v3 collections for users and treatment plans while preserving v1.1 relational history and restore compatibility.

### Verification and release hygiene

- Added SQLite persistence, legacy migration, attachment externalization and corrupt-current/backup-recovery tests.
- Added role-template and underlying permission regression tests; the local suite passes 37 tests and the Vite production build passes.
- Added stage-based treatment plans, patient financial statement views/print output, queue wait-time signals and a validated patient CSV mapping/import preview with duplicate policy and rollback.
- Updated the release checklist, audit report, README, user guide and persistent v1.2 phase log. The installed-app launch/restart/uninstall sequence is explicitly marked **MANUAL USER VERIFICATION REQUIRED** and removed from automated release blocking. Windows CI run `35699971425` published the four required v1.2.0 artifacts without changing v1.0.0 or v1.1.0.

## 1.1.0 — 2026-09-22

### Audit and safety hardening

- Introduced schema-v2 migration defaults and a durable Electron JSON store with atomic fsync/rename writes, last-known-good recovery and a 200 MB safety ceiling.
- Added structured backup validation, canonical SHA-256 payload hashes, patient/module selective restore, conflict-safe relationship remapping and snapshot rollback.
- Hardened PDF generation against active and remote resources; kept Electron context isolation, sandbox, no Node integration, navigation restrictions and CSP.
- Added regression coverage for malformed backups, orphan relationships, refunds, resource conflicts, ID remapping and canonical serialization.

### Workflow upgrades

- Added auditable payment refunds/reversals with adjustment records, effective payment totals and invoice/report reconciliation.
- Added inventory purchase, usage, stock-out, expiry, damage and correction movements with negative-stock protection.
- Added configurable payment methods, A4/Letter/80 mm receipt profiles, clinic-logo validation, attachment metadata/edit/preview/download and visit links.
- Added custom report ranges, PDF export, patient advanced search filters, derived action notifications, audit-log view and 50-row patient pagination for large directories.
- Added appointment chair/dentist duration-overlap checks and expanded relationship/integrity checks.

## 1.0.0 — 2026-09-22

- Created the Dentiva Pro offline-first practice workspace.
- Added empty, local record store with schema versioning and structured backup metadata.
- Added patient directory and profile workspace with visits, timeline, dental chart, prescriptions, invoices and payments.
- Added calendar, appointment queue, treatment/clinical capture and status workflow.
- Added billing, partial payments, receipts, inventory, suppliers, staff and expense tracking.
- Added reports, UTF-8 CSV export, print layouts, browser Save as PDF workflow and data-health checks.
- Added selective backup restore preview with conflict strategies.
- Added English-first light visual system and Bengali locale setting.
- Added Electron desktop shell, multi-size Windows icon, Windows x64 portable/NSIS packaging configuration and a Windows runner release workflow.
