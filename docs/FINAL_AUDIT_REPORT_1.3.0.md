# Dentiva Pro v1.3.0 flagship audit and release report

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Repository:** `heyiamshohan-cloud/dentiva-pro`
**Branch:** `arena/01a0c66a-dentiva-pro`
**Code identity:** `1.3.0`, build `2026.09.22`
**Baseline:** published `v1.2.0`; earlier releases remain untouched

This report separates implementation from acceptance evidence. A label, route, button or source file is not treated as behavioral proof. It will be updated with the Windows workflow run and artifact hashes before a v1.3.0 publication is called complete.

## 1. Current decision

**CURRENT STATE: RELEASE CANDIDATE — WINDOWS RELEASE GATES PENDING.**

The v1.3.0 source transformation is implemented without restarting the project or removing prior workflows. Local deterministic and build checks pass. The source is not yet called commercially released because this sandbox cannot provide Windows packaging or a Playwright Chromium executable, and the Windows workflow must remain the authority for those gates.

No `v1.3.0` tag or GitHub release should be treated as evidence until it points to the verified release commit and the workflow has completed.

## 2. Implemented flagship scope

| Requirement family | Current evidence | Status boundary |
|---|---|---|
| Light-only premium shell, responsive layouts and iconography | Existing `src/styles.css` retained; v1.3 surfaces in `src/styles-flagship.css`; reduced-motion state added | Automated six-viewport check remains pending because local Chromium is unavailable |
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
- `git diff --check` — passed at the time of the audit
- HTTP preview smoke — Vite served the application index on port 4173

The benchmark data is synthetic and remains process-local; it is never written to a clinic application store.

### Not passed / unavailable locally

- `npm run test:visual` — attempted, but all 12 projects could not launch because the Playwright Chromium executable was absent. `npx playwright install chromium` also failed because the sandbox could not establish the download connection. This is an environment limitation, not a visual PASS.
- Electron GUI/SQLite renderer smoke — not run in this Linux sandbox because the Electron binary is unavailable through the sandbox certificate boundary. Windows CI remains required.
- Windows portable/NSIS build, PE inspection, ZIP extraction inspection and SHA-256 artifact validation — pending Windows workflow execution.

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

At the current audit point, their existence, PE headers, ZIP contents and hashes are **PENDING**, not PASS.

## 7. Required final evidence before publication

1. Windows workflow completes tests/build, Chromium visual checks at 1280×720, 1366×768, 1600×900, 1920×1080, 2560×1440 and 3840×2160, portable persistence smoke, PE checks, ZIP inspection and checksum verification.
2. Release assets are inspected and the checksum file is independently checked.
3. A new `v1.3.0` tag/release is created without touching v1.0.0, v1.1.0 or v1.2.0.
4. Native Bengali and printed/PDF document review is performed by a human reviewer.
5. Commercial license/dependency and metadata/icon review is recorded.
6. The user performs the installed-app launch/restart/uninstall workflow manually.

## 8. Explicit manual acceptance statement

**The Windows installed-app launch/restart/uninstall smoke was intentionally excluded from automated release gating and remains for manual user verification.**

This exact sequence is not reported as passed and must remain documented as `MANUAL USER VERIFICATION REQUIRED`.
