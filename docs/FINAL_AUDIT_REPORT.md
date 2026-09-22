# Dentiva Pro 1.2.0 final audit and release report

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Repository:** `heyiamshohan-cloud/dentiva-pro`
**Branch:** `arena/01a0c66a-dentiva-pro`
**Release commit/tag:** `e858e742c48b870c290440fad782a83c77451b2f` / `v1.2.0`
**Prior releases:** `v1.0.0` and `v1.1.0` remain separate and untouched.

This is an evidence report. A source label, route, button or static assertion is not treated as behavioral proof. The report distinguishes verified implementation, CI evidence, open runtime review and the one explicitly deferred installed-application smoke sequence.

## 1. Executive result

Dentiva Pro **v1.2.0 was published** by the Windows release workflow on 2026-09-22. GitHub Actions run [`35699971425`](https://github.com/heyiamshohan-cloud/dentiva-pro/actions/runs/35699971425) completed successfully on the release commit and published the four required assets at [`github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.2.0`](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.2.0).

The installed-application launch/restart/uninstall smoke was intentionally removed from automated release blocking at the release owner's direction. It remains **MANUAL USER VERIFICATION REQUIRED**. It is not reported as passed.

The release is therefore a **conditional audited release**: the portable, visual, packaging, PE, archive, checksum and publication gates passed; several areas still have explicit runtime/manual limitations recorded below. Those limitations must not be marketed as closed merely because v1.2.0 is published.

## 2. Published artifact evidence

| Artifact | Result | CI/release evidence |
|---|---|---|
| `Dentiva-Pro-1.2.0-Windows-x64.exe` | PASS | Published asset; 78,229,459 bytes; PE validation passed in run `35699971425`. |
| `Dentiva-Pro-1.2.0-Windows-x64-Setup.exe` | PASS | Published asset; 78,455,491 bytes; PE validation and NSIS build passed in run `35699971425`. |
| `Dentiva-Pro-1.2.0-Windows-x64.zip` | PASS | Published asset; 156,518,285 bytes; ZIP assembly, extraction and development-content inspection passed. |
| `Dentiva-Pro-1.2.0-checksums.txt` | PASS | Published asset; CI generated and independently checked SHA-256 lines before publication. |
| `v1.2.0` tag | PASS | Points to `e858e742c48b870c290440fad782a83c77451b2f`; `v1.0.0` and `v1.1.0` tags remain unchanged. |

## 3. Verification completed

### Local domain, persistence and build checks

- `npm test`: **37 passed, 0 failed** after the release-gate regression tests were added.
- `npm run build`: **PASS**; Vite production output generated successfully.
- `npm run check`: **PASS in the Windows CI runner** (the authoritative dependency installation/build environment).
- `node --check src/main.js`, `src/core.js`, `electron/main.cjs` and `electron/storage.cjs`: **PASS**.
- `git diff --check`: **PASS**.
- SQLite tests cover atomic/staged writes, relational collections, managed attachments, legacy JSON migration, future-schema protection, corrupt-current recovery, backup recovery and reset behavior.
- Domain tests cover patient/visit/appointment relationships, duplicate search, appointment resource overlap, invoice/payment/refund calculations, inventory movements, backup manifests, restore plans, relationship validation, role templates and operation-level permission checks.

### Windows CI gates

Run `35699971425` completed successfully with these blocking steps:

1. dependency installation;
2. Node regression suite and renderer build;
3. Chromium installation;
4. six required Playwright viewport projects;
5. portable and NSIS Windows packaging;
6. PE header validation for both executables;
7. portable Electron create/restart persistence smoke;
8. release ZIP assembly and extraction inspection;
9. SHA-256 checksum assembly and self-validation;
10. GitHub release publication and artifact upload.

The six viewport projects cover **1280×720, 1366×768, 1600×900, 1920×1080, 2560×1440 and 3840×2160**. The prior viewport failure was diagnosed and corrected before the successful run.

### Dataset/domain benchmark

Synthetic data never enters the production store. Latest local benchmark results:

| Patients | Validation | Serialization | Manifest | Payload |
|---:|---:|---:|---:|---:|
| 1,000 | 1.50 ms | 19.66 ms | 0.48 ms | 302,747 bytes |
| 5,000 | 4.58 ms | 51.28 ms | 0.12 ms | 1,538,747 bytes |
| 10,000 | 6.56 ms | 77.36 ms | 0.07 ms | 3,083,748 bytes |
| 25,000 | 23.08 ms | 183.69 ms | 0.07 ms | 7,808,748 bytes |

These are domain validation/serialization measurements, not a claim of packaged Electron startup, memory or UI-rendering performance at those sizes.

## 4. Requirement-to-evidence status

| Requirement area | Status | Implementation/evidence | Boundary or follow-up |
|---|---|---|---|
| New identity and preservation of prior releases | PASS | Package identity, tag and release metadata; historical tags preserved. | None. |
| Offline/local operation and Bangladesh defaults | PASS for implemented boundary | No mandatory cloud, paid API, telemetry or AI dependency; BDT and Asia/Dhaka defaults. | OS account/full-disk encryption remain operator responsibilities. |
| SQLite desktop persistence | PASS in Node/storage tests; packaged runtime partial | `electron/storage.cjs` uses relational SQLite, atomic staged writes, recovery backup, size guardrail and non-destructive JSON migration. | Full packaged Electron migration/fault-injection review remains a follow-up. |
| Managed attachments | PASS in storage/security tests | Safe MIME/size checks, sanitized names, managed external files and safe relative paths. | Manual packaged preview/restore review remains. |
| RBAC roles and permission enforcement | PASS for domain/renderer boundaries | Administrator, Dentist, Manager, Receptionist, Dental Assistant and Custom Role templates; handlers re-check permissions. | Packaged multi-user role matrix and inactive/lockout walkthrough remain manual QA. |
| Secure users/sessions | PASS for implemented source path | Staff association, salted PBKDF2 PINs, active state, lockout, last-login and session state. | Packaged first-run/migration/restart walkthrough remains open; plaintext PINs are not stored. |
| Bengali localization | PARTIAL / MANUAL REVIEW OPEN | Bengali resource map, DOM translation and `bn-BD` formatting are present; release-gate tests cover required surface keys. | Native Bangladeshi language review of every dynamic error, empty/loading state, print/PDF and document surface is still required. |
| Patient/clinical workflows | PASS for covered domain paths | Patient profiles, timelines, visits, dental charts, prescriptions, referrals, attachments and treatment-plan UI exist with relationship tests. | Full packaged workflow and document review remains follow-up evidence. |
| Treatment plans and patient statements | IMPLEMENTED / RUNTIME REVIEW OPEN | Staged plans and patient financial statements/print views are implemented and covered by source/domain tests. | Verify full clinical/financial PDF and runtime behavior manually. |
| Appointments/queue | PASS for domain coverage; runtime review open | Calendar, serials, status lifecycle, queue signals and chair/dentist conflict helpers are implemented. | Manual queue/intelligence walkthrough remains. |
| Billing/payments/accounting | PASS for deterministic domain calculations | Integer-cent invoice formula, discount/tax, partial/multiple payments, refunds, due balances, statements and expense ledger are covered. | Packaged Bengali print and edge-case walkthrough remains. |
| Inventory/suppliers | PASS for domain model | Purchase, usage, expiry, damage, correction, stock-out, reorder and movement audit fields are implemented/tested. | Packaged audit/restore walkthrough remains. |
| Reports/import/export | PARTIAL / RUNTIME REVIEW OPEN | CSV exports, patient mapping/preview/duplicate policy/rollback, report ranges and PDF/print paths are implemented. | Multi-entity CSV mapping and full PDF/print review remain bounded limitations. |
| Backup/restore | PASS for domain validation; packaged review open | Canonical SHA-256 manifest, relationship validation, selective patient/module restore, conflict strategies and rollback tests pass. | Corrupt-backup/renderer integration walkthrough remains. |
| Electron security | PASS for static boundary checks | Context isolation, sandbox, no Node integration, CSP, navigation restrictions, external-link handling and active-content PDF blocking are tested. | Physical packaged crash/security review remains manual. |
| Performance | PASS for domain benchmark | 1k/5k/10k/25k synthetic validation/serialization/manifest measurements recorded. | No claim is made for packaged UI memory/startup/report latency without a Windows profiling run. |
| Visual/layout regression | PASS | CI Playwright projects passed at all six required viewport sizes. | Premium-UI subjective review remains optional manual review. |
| Windows portable persistence | PASS | Blocking portable create/restart workflow completed in run `35699971425`. | None for the portable gate. |
| Installed-app launch/restart/uninstall | MANUAL USER VERIFICATION REQUIRED | Explicitly removed from the automated blocking workflow at the release owner's direction. | User must perform this exact sequence; it is not a claimed PASS. |
| Release artifacts/checksums | PASS | CI built, inspected, self-hashed and published the exact four names. | Verify downloads on the user's Windows machine. |

## 5. Known limitations and release-owner actions

These are recorded rather than silently converted to PASS:

- The Linux sandbox could not perform a genuine Electron GUI run because Electron's binary download crossed the sandbox certificate boundary. Windows CI provided the authoritative portable/runtime gate.
- Human Bangladeshi Bengali review of dynamic content and Bengali PDF/print rendering remains recommended before broad commercial rollout.
- Packaged multi-role, crash-recovery, corrupt-database and large-dataset UI profiling evidence is not equivalent to the passing Node/domain tests.
- The installed-app launch/restart/uninstall smoke is intentionally deferred to manual user verification.
- SQLite is local persistence, not encryption; use OS controls, full-disk encryption and protected backup media.
- A forgotten local PIN is not recoverable by Dentiva Pro; follow the clinic's verified recovery policy.

## 6. Explicit manual acceptance statement

**The Windows installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains for manual user verification.**

No part of this report claims that this exact installed-app smoke passed.
