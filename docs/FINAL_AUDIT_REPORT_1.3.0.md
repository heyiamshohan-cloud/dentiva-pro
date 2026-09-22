# Dentiva Pro v1.3.0 flagship audit and release report

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Repository:** `heyiamshohan-cloud/dentiva-pro`
**Branch:** `arena/01a0c66a-dentiva-pro`
**Code identity:** `1.3.0`, build `2026.09.22`
**Baseline:** published `v1.2.0`; earlier releases remain untouched

This report separates implementation from acceptance evidence. A label, route, button or source file is not treated as behavioral proof. Windows workflow evidence is recorded below; direct artifact hashes are retained in the uploaded checksum asset and were verified by the workflow before publication.

## 1. Current decision

**CURRENT STATE: PUBLISHED WITH DOCUMENTED LIMITATIONS.**

The v1.3.0 source transformation is implemented without restarting the project or removing prior workflows. Local deterministic and build checks pass. Windows CI run `35710031145` completed successfully: tests/build, Chromium visual checks, Windows packaging, PE inspection, portable persistence smoke, ZIP inspection and checksum verification all passed, and the three workflow evidence artifacts were uploaded. The [v1.3.0 GitHub release](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.3.0) is public with the portable EXE, NSIS installer, application ZIP and checksum asset.

The GitHub release/blob download endpoints terminate with `EOF` from this sandbox, so the archive could not be unpacked locally. The workflow's own PE/ZIP/checksum verification passed, and GitHub release API metadata exposes the published SHA-256 asset digests below. v1.0.0, v1.1.0 and v1.2.0 remain preserved.

## 2. Implemented flagship scope

| Requirement family | Current evidence | Status boundary |
|---|---|---|
| Light-only premium shell, responsive layouts and iconography | Existing `src/styles.css` retained; v1.3 surfaces in `src/styles-flagship.css`; reduced-motion state added | Windows six-viewport check passed; subjective premium review remains human-required |
| Command palette and command center | Local command palette plus dashboard metric/schedule/queue/follow-up/signal cards; widget visibility, ordering and reset are persisted | Browser behavior needs visual/interactive review |
| Patient profile, timeline and custom fields | Patient validation, profile context, archive/status, tags, alerts, preferred contact, custom fields, appointments, payments, follow-ups, notes and audit sections in `src/main.js`; timeline projection in `src/domain.js` | Packaged UI walkthrough remains pending |
| Dental chart and clinical history | Existing relational records and tooth-level chart preserved; clinical safety wording retained | Packaged walkthrough remains pending |
| Treatment plans | Goal, procedures, teeth, duration, estimate, discount, estimated total, responsible dentist, statuses and stages are saved; stage progress is auditable | Print/clinical human review remains pending |
| Appointments and queue | Day/Week/Month/Agenda views, room-aware form and overlap identification; queue lifecycle and wait timing preserved | Packaged queue/room walkthrough remains pending |
| Prescriptions and follow-ups | Multiple medicine line parsing preserves first-medicine fields and print path; local medication catalog and reusable fields are available; follow-up signals are derived | Clinician/human document review remains pending |
| Billing and financial source of truth | `statementEntries` is the shared profile/print projection; integer-cent core helpers remain unchanged | Windows print/PDF and edge-case walkthrough remains pending |
| Inventory, suppliers, accounting and staff | Existing workflows retained; supplier cards summarize linked purchase movements; diagnostics and configurable notifications surface relevant health signals | Packaged audit/restore walkthrough remains pending |
| RBAC and audit | Expanded permission vocabulary, operation-level checks and audit events; role template tests pass | Packaged role matrix remains pending |
| Analytics and notifications | `analyticsSnapshot`, `deriveOperationalNotifications`, analytics page, local category rules, actionable navigation and persisted read state | Visual review remains pending |
| Attachments, backup, restore, CSV | Existing safety/manifest/relationship/rollback workflows retained; backup center surfaces storage/schema/last-operation/recent-history facts; new v4 collections are in restore groups | Packaged corruption/recovery review remains pending |
| Electron/IPC/CSP/security | Existing context isolation, sandbox, no Node integration, navigation/CSP/PDF checks retained | Native Electron GUI cannot run in this Linux sandbox |
| Customization, print and localization | Rooms, custom fields, notification rules, shared document footer/logo/contact controls, print profiles and expanded Bengali/locale formatting implemented | Native Bengali and all printed document visual review remains human-required |

## 3. Local verification evidence

### Passed

- `node --check src/main.js`
- `node --check src/domain.js`
- `node --check electron/main.cjs`
- `node --check electron/storage.cjs`
- `npm test` — **46 passed, 0 failed**
- `npm run build` — **passed**; Vite production bundle generated
- `npm run benchmark:datasets` — 1,000, 5,000, 10,000 and 25,000 synthetic records; zero relationship errors
- `git diff --check` — passed
- HTTP preview smoke — Vite served the application index on port 4173

The benchmark data is synthetic and remains process-local; it is never written to a clinic application store.

### Windows CI evidence

- Run `35710031145` — **success** on `arena/01a0c66a-dentiva-pro`; Chromium was installed and all six required viewport projects passed.
- The same run passed `npm run check`, Windows portable/NSIS packaging, PE `MZ` checks, the required portable launch/restart persistence smoke, application-only ZIP extraction/content inspection and independent SHA-256 verification before publishing v1.3.0.
- Uploaded evidence: `Dentiva-Pro-37-Windows-x64` (416,894,656 bytes), `Dentiva-Pro-37-viewport-regression` (5,626,704 bytes) and `Dentiva-Pro-37-windows-portable-smoke-evidence` (794 bytes), according to GitHub metadata.

### Not passed / unavailable locally

- `npm run test:visual` — attempted locally, but Chromium was absent. The Windows CI run is the authoritative visual result.
- Electron GUI/SQLite renderer smoke — not run in this Linux sandbox; the Windows portable smoke is the authoritative packaged persistence result.
- Direct artifact download into this sandbox — GitHub's signed blob connection terminates with `EOF`; the workflow's own PE/ZIP/checksum steps passed, but this environment cannot independently unpack the uploaded archive.

## 4. Data integrity and financial review

The release retains integer-cent invoice/payment/refund helpers in `src/core.js`. Patient statements now use `statementEntries` from `src/domain.js`, and the local domain test verifies invoice, collection and refund running balances. SQLite storage tests cover atomic writes, attachment externalization, legacy migration, corrupt-current recovery, relationship validation, selective restore and create-new-copy remapping.

These tests are meaningful source/domain evidence. They do not replace a Windows packaged restart/restore walk-through. SQLite is local persistence, not encryption; production operators must use OS account controls, full-disk encryption and protected backup media.

## 5. Security and privacy review

- No mandatory cloud, telemetry, paid API or diagnostic HTTP client was introduced.
- Complete resolved dependency audit after upgrading Electron 44.4.3/electron-builder 26.15.3: **0 info, 0 low, 0 moderate, 0 high, 0 critical**.
- No sample/demo/test data is seeded.
- No automated diagnosis or prescribing claim exists.
- Renderer boundary tests cover context isolation, sandbox/no Node integration, navigation/CSP and blocked active/remote PDF resources.
- PINs use salted PBKDF2-SHA-256 hashes; plaintext PIN storage is not intended.
- Attachment paths and MIME/size/data safety remain bounded.
- Important writes create audit entries and restore validates relationships before commit.

Open security evidence is the packaged Windows role matrix, crash/recovery review and operator review of workstation encryption policy.

## 6. Release artifact contract

The Windows workflow must produce and independently verify these new v1.3.0 names without modifying earlier releases:

- `Dentiva-Pro-1.3.0-Windows-x64.exe`
- `Dentiva-Pro-1.3.0-Windows-x64-Setup.exe`
- `Dentiva-Pro-1.3.0-Windows-x64.zip`
- `Dentiva-Pro-1.3.0-checksums.txt`

The Windows workflow created these outputs and its own existence, PE header, ZIP content and hash checks passed on run `35710031145`. The public release contains the four named assets. GitHub release API digests are recorded below; direct archive download cannot be completed in this sandbox because the signed connection ends with `EOF`.

| Published asset | Bytes | GitHub SHA-256 digest |
|---|---:|---|
| `Dentiva-Pro-1.3.0-Windows-x64.exe` | 104,174,827 | `f443a712aa385c485125830a4147b68a53fc98d726599a9668330819e9302a42` |
| `Dentiva-Pro-1.3.0-Windows-x64-Setup.exe` | 104,402,996 | `ca823b5f59be11cb079b13853b686ac5d2afc92c1c49cb41c3bc2b578626bffe` |
| `Dentiva-Pro-1.3.0-Windows-x64.zip` | 208,422,246 | `986e3cb9b741ad1ff75e8265b648e583b12cfb25b79f42361a59cabcd7a455ca` |
| `Dentiva-Pro-1.3.0-checksums.txt` | 309 | `f5c5c1902bbdb8d0fd45d5b58d7ed24772e5dc9e815bcec435686dd7b82d2b87` |

## 7. Remaining human/manual evidence

1. Native Bengali and printed/PDF document review is performed by a human reviewer.
2. Commercial license/dependency and metadata/icon review is recorded.
3. The user performs the installed-app launch/restart/uninstall workflow manually.

## 8. Explicit manual acceptance statement

**The Windows installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains for manual user verification.**

This exact sequence is not reported as passed and must remain documented as `MANUAL USER VERIFICATION REQUIRED`.
