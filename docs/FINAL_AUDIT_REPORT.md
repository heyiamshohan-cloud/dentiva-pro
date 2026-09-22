# Dentiva Pro 1.2.0 final audit and release-gate report

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Repository:** `heyiamshohan-cloud/dentiva-pro`
**Working branch:** `arena/01a0c66a-dentiva-pro`
**Target release:** Dentiva Pro v1.2.0
**Prior releases:** v1.0.0 and v1.1.0 remain separate and untouched. The historical v1.1.0 report is preserved at [`FINAL_AUDIT_REPORT_1.1.0.md`](FINAL_AUDIT_REPORT_1.1.0.md).

This report is intentionally a **release gate**, not a marketing summary. A source label, route, button, or static test is not treated as a behavioral PASS. Every limitation recorded in the v1.1.0 audit is carried forward as an open item until the required runtime evidence exists.

## 1. Executive result

The v1.2.0 implementation cycle is underway and is **not yet releasable**. The working tree contains material improvements, but no v1.2.0 tag, GitHub release, Windows EXE, installer, application ZIP, or checksum file has been produced. No v1.0.0 or v1.1.0 artifact has been overwritten or reused.

The currently verified scope is:

- application/package/renderer identity is `1.2.0`;
- the Electron production store now uses bundled `sql.js` SQLite with relational `metadata` and `records` tables, atomic staged writes, a verified `.bak` recovery path, attachment externalization, a 200 MB guardrail, and non-destructive legacy JSON migration;
- the renderer has account records, PBKDF2 PIN hashing, active/inactive state, staff association, failed-attempt lockout, last-login timestamps, sessions, role templates and permission checks at navigation, form and important operation boundaries;
- 33 Node regression tests pass and the Vite production build passes;
- Electron GUI, Windows packaging, Windows installation/restart/uninstall automation, full-resolution visual checks, renderer SQLite migration and realistic large-dataset UI measurements remain unverified.

**Release disposition: BLOCKED.** The open items in section 4 must be closed or documented as an accepted product decision by a human release owner before v1.2.0 is tagged or published.

## 2. Changes technically verified in this cycle

### Persistence and migration

- `electron/storage.cjs` creates a local SQLite database with relational `metadata` and `records` tables while reconstructing the renderer state shape during the incremental migration.
- Writes are staged through a temporary database, flushed and renamed atomically. A prior integrity-checked database is retained as `.bak`; a corrupt current database can recover from that backup.
- Legacy `dentiva-pro-store.json` is imported only after validation and copied to a `.migrated` marker. The legacy source is not silently deleted.
- Attachment data URIs are moved to an application-managed `attachments/` directory and hydrated on load. Relative attachment paths are validated before use.
- Size limits, reset and storage-info IPC are present. Standalone Node tests cover persistence, attachment externalization, migration and corrupt-current/backup recovery.

### Users, sessions and RBAC

- `src/core.js` defines permission names and role templates for Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role.
- `src/main.js` creates a first-run Administrator account, requires a 4–12 digit administrator PIN during setup, stores only salted PBKDF2-SHA-256 hashes, and never persists PIN input or confirmation values.
- Accounts have active/inactive state, associated staff ID, failed-attempt counters, temporary lock state, created-at and last-login timestamps.
- Sign-in checks account state, lockout and the stored hash. Renderer routes, searches, forms, exports, print actions, backup actions and protected mutations use permission checks; important mutation handlers check again instead of relying on hidden controls.
- User-account administration supports role templates and explicit Custom Role permissions. At least one active Administrator is required.

This is a meaningful authorization implementation, but it is still pending Electron-runtime and Windows acceptance testing. It must not be described as network authorization, encrypted storage, or multi-clinic synchronization.

### Existing behavior and safety regression coverage

The existing v1.1 workflows remain in the source and the full local suite passes: patient/clinical relationships, appointment resource overlap, financial cents calculations, payment/refund validation, inventory movements, attachment allowlists, backup manifests, relationship validation, selective restore and rollback. The suite now also tests role permission behavior and the v1.2 release identity.

## 3. Verification evidence available now

| Check | Result | Evidence / boundary |
|---|---|---|
| `node --check src/main.js` | PASS | Renderer syntax check completed after the v1.2 user/RBAC changes. |
| `node --check src/core.js` | PASS | Domain helper syntax check completed. |
| `npm test` | PASS | 34 tests passed on Node.js 22.22.3. |
| `npm run build` | PASS | Vite production build completed; output is in ignored `dist/`. |
| SQLite standalone smoke | PASS | Persistence, attachments, reset, migration and recovery tests pass without native SQLite builds. |
| Electron main/store syntax | PASS | `electron/main.cjs` and `electron/storage.cjs` syntax checks passed before/with storage tests. |
| Electron GUI launch | OPEN BLOCKER | Electron binary is unavailable in this Linux sandbox; rebuilding reached the sandbox certificate boundary. No fake desktop PASS is claimed. |
| Renderer SQLite integration | OPEN BLOCKER | The store is exercised through Node tests, not an actual Electron renderer session. |
| Windows portable launch/create/restart persistence | AUTOMATED GATE | Must pass on the Windows x64 runner and produce logs/artifacts. |
| Installed-app launch/restart/uninstall | MANUAL USER VERIFICATION REQUIRED | Intentionally excluded from automated release blocking at the release owner's direction; no automated PASS is claimed. |
| DOM/screenshot regression at required resolutions | CI PASS | Six Playwright projects passed on Windows CI run 35693850283; evidence artifact is retained by the workflow. |
| 1,000/5,000/10,000/25,000 patient UI stress measurements | PARTIAL / OPEN BLOCKER | `npm run benchmark:datasets` validates and serializes synthetic 1k/5k/10k/25k stores with zero relationship errors. Startup, search, list, profile, timeline, report, backup/restore and memory measurements still require Electron/Windows runtime evidence. |
| GitHub release assets/checksums | NOT STARTED | Must be generated only after the release gate closes. |

## 4. Open blockers carried from the v1.1.0 audit

Every item below remains open unless this report explicitly records a reproducible verification result. These are not silently downgraded to PASS because related source code exists.

| Area | Current status | Required v1.2 evidence |
|---|---|---|
| Complete Bangladeshi Bengali | OPEN | Review every page, dialog, validation, error, success, empty/loading state, print view, PDF, invoice, receipt, prescription, patient summary and report with native Bengali copy and correct date/number formatting. Existing map/DOM translation is partial. |
| RBAC behavior | PARTIALLY IMPLEMENTED / OPEN | Run scripted multi-user workflows in Electron/Windows for all six roles, including direct operation attempts, inactive users, lockouts, session transitions and audit attribution. |
| Secure users and sessions | IMPLEMENTED IN SOURCE / OPEN RUNTIME | Verify first-run setup, migration from v1.1, PIN changes, last-login persistence, failed-attempt lockout, inactive account rejection and restart persistence in a packaged app. |
| SQLite migration | IMPLEMENTED IN NODE / OPEN RUNTIME | Validate v1.1 JSON import in Electron, attachments, interrupted writes, corrupt current/backup rollback, restart persistence and no silent loss. |
| Large datasets | PARTIAL / OPEN | `npm run benchmark:datasets` validates and serializes synthetic 1k/5k/10k/25k stores with zero relationship errors. Startup, search, list, profile, timeline, report, backup/restore and memory measurements remain open in the packaged runtime. |
| Windows automation | PARTIAL BY DESIGN | Portable create/restart persistence is automated and blocking. Installed-app launch/restart/uninstall remains MANUAL USER VERIFICATION REQUIRED and is not used as an automated release gate. |
| Visual/layout regression | CI PASS / MANUAL REVIEW OPEN | Six Playwright projects passed on Windows CI run 35693850283; retain the evidence artifact and complete any remaining premium-UI manual review. |
| Treatment plans | OPEN | Provide a usable treatment-plan workflow with staged procedures, statuses, dates, responsible staff, pricing/financial linkage and patient summary/print output. The collection alone is not completion. |
| Patient financial statements | OPEN | Add patient-level statement view and configurable print/PDF output reconciled to invoice/payment/refund source-of-truth records. |
| Appointment intelligence and queue | PARTIAL / OPEN | Verify conflict/resource handling, queue transitions, wait-time/priority signals, actionable notifications and print output in runtime workflows. |
| Inventory auditability | PARTIAL / OPEN | Verify every purchase, usage, expiry, damage, correction and stock-out path with before/after quantities, actor, reason and restore behavior. |
| CSV mapping/import | PARTIAL / OPEN | Patient CSV import now has safe mapping, preview, required-field validation, duplicate policy and rollback. Multi-entity relationship mapping remains open. |
| Advanced filters and command palette | PARTIAL / OPEN | Validate saved filters, keyboard command behavior, permission-scoped search and large-result performance. |
| Print/PDF profiles | PARTIAL / OPEN | Verify Bengali rendering, clinic identity, A4/Letter/receipt layouts, configurable profiles, Electron PDF output and Windows print dialog behavior. |
| Backup/restore | PARTIAL / OPEN | Exercise corrupted current DB, corrupted backup, interrupted save, invalid attachments, malformed relationships and rollback in Electron; retain evidence. |
| Privacy/security/crash resilience | PARTIAL / OPEN | Complete packaged Electron security review, renderer crash recovery, error UX, attachment handling, navigation/CSP checks and data redaction review. |
| Release artifacts | NOT STARTED | Produce exactly the four v1.2.0 artifacts and independently validate PE headers, ZIP contents, install behavior and checksums. |

## 5. Release artifact contract

When—and only when—the gate closes, the Windows workflow must create a new release with these exact names:

- `Dentiva-Pro-1.2.0-Windows-x64.exe`
- `Dentiva-Pro-1.2.0-Windows-x64-Setup.exe`
- `Dentiva-Pro-1.2.0-Windows-x64.zip`
- `Dentiva-Pro-1.2.0-checksums.txt`

The artifacts must be generated from the v1.2.0 commit, must not contain `.git`, `node_modules`, tests or test data, and must not replace v1.0.0 or v1.1.0 assets. No checksum is recorded in this report until the Windows runner self-validates the final bytes.

## 6. Honest limitations and operational boundaries

- Dentiva Pro remains offline/local; no mandatory cloud service, paid API, AI diagnosis or AI prescribing is introduced.
- SQLite is application-local persistence, not database encryption. Operators still need OS account controls, full-disk encryption and protected backup media.
- A local PIN is an access control and is not a recovery key. Forgotten credentials require the clinic's verified recovery policy.
- Browser preview storage is not the production desktop persistence path and is still subject to browser profile/quota behavior.
- Non-image clinical attachments remain download-only to avoid embedding active PDF content. Attachment size/type allowlists remain enforced.
- The installed-app launch/restart/uninstall smoke is intentionally deferred to manual user verification; no automated PASS is claimed. Portable persistence and six-resolution visual checks remain automated gates.

## 7. Next release-gate actions

The persistent phase log is [`V1.2_PROGRESS.md`](V1.2_PROGRESS.md). The installed-app launch/restart/uninstall sequence is a documented manual acceptance step, not an automated release blocker. The remaining sequence is: close all other Bengali, feature, data, backup, security and artifact gates; run `npm run check`; run the Windows portable/visual/package gates; then package and publish the four new v1.2.0 assets.
