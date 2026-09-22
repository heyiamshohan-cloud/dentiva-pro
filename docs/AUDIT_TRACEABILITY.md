# Dentiva Pro v1.2.0 audit traceability

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Branch:** `arena/01a0c66a-dentiva-pro`
**Historical baseline:** v1.1.0's 150-row matrix is preserved at [`AUDIT_TRACEABILITY_1.1.0.md`](AUDIT_TRACEABILITY_1.1.0.md).

This is the v1.2.0 requirement-to-evidence index. It intentionally distinguishes source implementation from runtime evidence. `PASS` requires executable or reproducible evidence; `PARTIAL` means a bounded implementation exists but a requested verification or sub-feature remains; `OPEN` is a release blocker.

## Status vocabulary

- **PASS** — behavior is implemented and verified by tests or a recorded runtime result.
- **PARTIAL** — a substantive implementation exists, but the full requirement is not closed.
- **OPEN** — not implemented or not yet verified; cannot be marketed as complete.
- **LIMITATION** — a deliberate product boundary that remains visible to operators.

## Traceability matrix

| ID | Master requirement area | Evidence path | Status |
|---:|---|---|---|
| 1 | New v1.2.0 identity | `package.json`, `package-lock.json`, `src/main.js`, `tests/smoke.test.mjs` | PASS |
| 2 | Preserve v1.0.0/v1.1.0 | Git tags/releases; no v1.2 artifact exists yet | PASS for preservation / OPEN for new release |
| 3 | Empty production store | `DEFAULT_STATE` in `src/main.js`; smoke test rejects demo data | PASS |
| 4 | Offline/local operation | Electron preload/main boundary; no cloud client test | PASS |
| 5 | Bangladesh defaults and light UI | `DEFAULT_STATE`, `src/styles.css`, settings | PASS for implementation / visual runtime OPEN |
| 6 | No AI diagnosis/prescribing | clinical-safety copy and no AI/network dependency | PASS |
| 7 | SQLite production desktop persistence | `electron/storage.cjs`, `tests/storage.test.mjs` | PARTIAL: Electron runtime open |
| 8 | Relational metadata/records storage | SQLite schema and encode/decode path | PASS in Node test |
| 9 | Atomic staged writes | fsync/staged rename path and storage tests | PARTIAL: Windows fault injection open |
| 10 | Verified backup recovery | integrity check and corrupt-current recovery test | PARTIAL: packaged runtime open |
| 11 | Legacy v1.1 JSON migration | migration path and non-destructive marker test | PARTIAL: Electron runtime open |
| 12 | Managed attachments | allowlist, external files, safe path and hydration tests | PARTIAL: packaged crash/restore open |
| 13 | 200 MB guardrail/reset/info | `MAX_STORE_BYTES`, store API and tests | PASS in Node path |
| 14 | Administrator/Dentist/Manager roles | `PERMISSIONS`, `permissionsForRole` in `src/core.js` | PASS domain / runtime matrix open |
| 15 | Receptionist/Assistant/Custom roles | role templates and custom permission filtering | PASS domain / runtime matrix open |
| 16 | Permission-enforced operations | `requirePermission`, form permission map, route/action guards | PARTIAL: packaged direct-operation matrix open |
| 17 | Secure application users | `users` collection, user-account modal and first-run setup | PARTIAL: runtime migration and restart open |
| 18 | Staff association | `staffId` on user records and user directory UI | PASS source / runtime open |
| 19 | Authentication/session state | sign-in form, PBKDF2 hashing, `authenticatedUserId` | PARTIAL: packaged restart/multi-user open |
| 20 | Active/inactive and lock state | account status, failed attempts, `lockedUntil`, `lastLogin` | PARTIAL: runtime lockout tests open |
| 21 | No plaintext credentials | only `pinHash`/`pinSalt` are persisted; source/security tests | PASS static/source |
| 22 | Bengali navigation/common labels | BENGALI resource map and DOM translation | PARTIAL |
| 23 | Bengali all dialogs/validation/errors | no full surface review yet | OPEN |
| 24 | Bengali print/PDF/invoice/receipt/report | no packaged visual/PDF review yet | OPEN |
| 25 | Patient directory/profile/timeline | renderer workflows and domain tests | PARTIAL: large/runtime evidence open |
| 26 | Treatment plans | schema, staged plan UI, patient tab and stage cycling | PARTIAL: pricing linkage/runtime review open |
| 27 | Financial statements | patient statement tab and print output | PARTIAL: refunds/packaged/PDF review open |
| 28 | Appointment overlap | `appointmentsOverlap` tests and form warning | PASS domain / runtime open |
| 29 | Queue and wait signals | queue statuses, timestamps, notifications | PARTIAL: scripted queue workflow open |
| 30 | Inventory movement auditability | movement records with before/after/reason | PARTIAL: actor/runtime/restore evidence open |
| 31 | Financial source of truth | integer cents helpers and payment/refund tests | PASS domain / UI edge runtime open |
| 32 | Backup manifest/hash | canonical JSON, manifest, SHA-256 and tests | PASS domain / packaged open |
| 33 | Restore conflict/relationship/rollback | restore plan/apply tests and UI preview | PARTIAL: packaged corruption/rollback open |
| 34 | Patient CSV mapping | mapping preview, required fields, duplicate policy, snapshot rollback | PARTIAL: runtime/import QA open |
| 35 | Multi-entity CSV mapping | no implementation | OPEN |
| 36 | Command palette/search | local modal search and keyboard shortcut | PARTIAL: permission/large-result evidence open |
| 37 | Advanced filters | patient filters and pagination | PARTIAL: saved filters and large UI evidence open |
| 38 | Actionable notifications | derived dues/stock/follow-up/wait signals | PARTIAL: action routing/runtime open |
| 39 | Print profiles | A4/Letter/Receipt setting and print functions | PARTIAL: Bengali/PDF/Windows review open |
| 40 | Electron security | static isolation/CSP/navigation/PDF tests | PARTIAL: packaged crash/security open |
| 41 | Crash/error UX | renderer reload boundary exists; fault-injection evidence absent | OPEN |
| 42 | Dataset 1,000 | `scripts/dataset-benchmark.mjs` domain benchmark | PARTIAL: UI/startup evidence open |
| 43 | Dataset 5,000 | same benchmark | PARTIAL: UI/startup evidence open |
| 44 | Dataset 10,000 | same benchmark | PARTIAL: UI/startup evidence open |
| 45 | Dataset 25,000 | same benchmark | PARTIAL: UI/startup evidence open |
| 46 | Required viewport checks | Playwright config and six-project layout test; CI run 35693850283 | PASS |
| 47 | Windows portable launch/create/restart persistence | `scripts/windows-smoke.ps1 -PortableOnly`, workflow step | PASS when the current Windows workflow completes |
| 48 | Installed-app launch/restart/uninstall | Manual user acceptance sequence; intentionally removed from automated release-blocking gate | MANUAL USER VERIFICATION REQUIRED |
| 49 | Exact release artifacts | workflow configuration only | OPEN |
| 50 | Checksums/new tag | workflow configuration only | OPEN |

## Current gate

The matrix distinguishes the deliberate manual installed-app exception from all other release gates. The authoritative release decision and complete open-blocker list are in [`FINAL_AUDIT_REPORT.md`](FINAL_AUDIT_REPORT.md), with the continuation order in [`V1.2_PROGRESS.md`](V1.2_PROGRESS.md).
