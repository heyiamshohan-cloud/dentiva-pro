# Dentiva Pro 1.1.0 audit traceability

Audit date: **2026-09-22** (Asia/Dhaka)  
Baseline: 1.0.0 source checkout at the start of this audit.  
Target: a new, independently versioned Windows x64 release.

This is the persistent atomic matrix for the 150 baseline rows. A row is `PASS` only when an implementation path and executable/static verification are identified. `INCOMPLETE` means the capability exists or is substantially implemented but a required verification remains outstanding. `LIMITATION` is a deliberate, documented product boundary. `ARCHITECTURALLY DEFICIENT` identifies a baseline architecture that cannot honestly be marketed as a stronger capability (notably role authorization and a single-profile renderer). No row is called PASS merely because a page, button or source label exists.

## Status key

- **PASS** — implemented and verified by code-path, domain regression, static security check, production build, or release evidence.
- **INCOMPLETE** — implementation is present but the specified final verification or coverage is still outstanding.
- **LIMITATION** — deliberately bounded behavior, documented to the operator rather than implied to be supported.
- **ARCHITECTURALLY DEFICIENT** — the requested stronger architecture is not provided by this single-profile offline product; the boundary is explicit.

## Atomic requirement matrix

| # | Requirement | Baseline finding | Implementation and verification | Status |
|---:|---|---|---|---|
| 1 | Product identity | Dentiva Pro branding exists | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 2 | First-run setup | Wizard exists; persistence needs audit | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 3 | Clinic information | Clinic fields exist | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 4 | Dentist information | Dentist fields exist | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 5 | Phone | Phone fields exist | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 6 | Address | Address fields exist | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 7 | Logo | Print fallback exists; upload path not complete | `package.json`, `src/main.js` setup/settings, `tests/workflows.test.mjs`; `npm run check` | PASS |
| 8 | Patient management | CRUD exists | `src/main.js` patient/profile/pagination paths, `src/core.js`; workflow + performance regression tests; `npm run check` | PASS |
| 9 | Patient code | Counter-based code exists | `src/main.js` patient/profile/pagination paths, `src/core.js`; workflow + performance regression tests; `npm run check` | PASS |
| 10 | Patient profile | Profile tabs exist | `src/main.js` patient/profile/pagination paths, `src/core.js`; workflow + performance regression tests; `npm run check` | PASS |
| 11 | Patient timeline | Timeline rendering exists | `src/main.js` patient/profile/pagination paths, `src/core.js`; workflow + performance regression tests; `npm run check` | PASS |
| 12 | Unlimited long-term history architecture | Arrays/localStorage; no pagination and desktop storage is fragile | `src/main.js` patient/profile/pagination paths, `src/core.js`; workflow + performance regression tests; `npm run check` | LIMITATION |
| 13 | Visits | Visit form exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 14 | Chief complaint | Visit fields are mixed with reason | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 15 | Reason for visit | Appointment/visit reason exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 16 | Diagnosis record | Free-text diagnosis exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 17 | Treatment | Free-text treatment/catalog exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 18 | Tooth numbers | Dental chart and visit tooth fields exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 19 | Visit dates | Date fields exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 20 | Prescriptions | Single structured medication form exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 21 | Medications | Medication fields exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 22 | Follow-ups | Follow-up date exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 23 | Additional notes | Notes fields exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 24 | Attachments | Base64 attachments exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 25 | X-rays | Images labeled X-ray; no preview/visit link | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 26 | PDFs | PDF MIME allowlist exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 27 | Reports | Several reports exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 28 | Documents | Print views exist | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 29 | Referrals | Referral form/tab exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 30 | Referral doctor | Referral destination exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 31 | Referral reason | Referral reason exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 32 | Referral response/report | Response exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 33 | Dental chart | Adult/primary chart exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 34 | Adult FDI | Adult FDI list exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 35 | Primary FDI | Primary FDI list exists | `src/main.js` clinical/dental/attachment/print paths, `src/core.js`; workflow/security tests; `npm run check` | PASS |
| 36 | Appointments | Appointment CRUD exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 37 | Today queue | Queue view exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 38 | Serial numbers | Counter-based serial exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 39 | Check-in | Status exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 40 | Waiting | Status exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 41 | Treatment status | In Treatment status exists | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 42 | Search | Global and patient search exist | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 43 | Advanced search | No real filters/date/tooth search | `src/main.js` appointment, queue and patient-filter paths, `src/core.js`; overlap/search tests; `npm run check` | PASS |
| 44 | Billing | Billing page exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 45 | Invoice | Invoice CRUD exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 46 | Money receipt | Payment print exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 47 | Partial payment | Payment limit exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 48 | Full payment | Paid status exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 49 | Outstanding | Due fields exist | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 50 | Cash | Payment method exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 51 | Bank | Payment method exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 52 | Card | Payment method exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 53 | bKash | Method option exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 54 | Nagad | Method option exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 55 | Rocket | Method option exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 56 | Upay | Method option exists | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 57 | Configurable MFS | Options are hard-coded | `src/main.js` invoice/payment/refund/settings paths, `src/core.js`; financial/money regression tests; `npm run check` | PASS |
| 58 | Inventory | Inventory CRUD exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 59 | Accessories | Category can represent consumables only | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 60 | Medicine | Category option exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 61 | Dental materials | Category option exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 62 | Supplier | Supplier CRUD exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 63 | Purchase | Initial movement exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 64 | Quantity | Numeric quantity exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 65 | Stock | Current stock exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 66 | Stock-out | No explicit stock-out action | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 67 | Expiry | Expiry field/alert exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 68 | Batch/lot | Batch field exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 69 | Stock movement | Purchase movement exists | `src/main.js` inventory movement/expiry paths, `src/core.js`; inventory regression tests; `npm run check` | PASS |
| 70 | Accounting | Accounting page exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 71 | Income | Payments/revenue exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 72 | Expense | Expense CRUD exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 73 | Rent | Expense category exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 74 | Electricity | Expense category exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 75 | Internet | Expense category exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 76 | Staff salary | Expense category exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 77 | Other expenses | Expense category exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 78 | Staff management | Staff CRUD exists | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | PASS |
| 79 | Staff roles | Role field exists; no permissions | `src/main.js` accounting/staff/role metadata paths; workflow tests; role boundary documented in `README.md` and `docs/USER_GUIDE.md` | LIMITATION |
| 80 | Reports | Report page exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 81 | Daily | Dashboard date today; report lacks daily option | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 82 | 7-day | Report range exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 83 | Monthly | Report range exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 84 | 3-month | Quarter range exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 85 | 6-month | Missing | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 86 | 1-year | Report range exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 87 | Custom period | Missing | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 88 | Default today | Dashboard defaults today | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 89 | Export | CSV/backup export exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 90 | Import | JSON import exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 91 | Full restore | Current restore mutates in place | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 92 | Selective restore | Module checkboxes exist | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 93 | Patient-level selective restore | Missing | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 94 | Financial selective restore | Module level only | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 95 | Conflict detection | ID count only | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 96 | Conflict resolution | Four strategies exist | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 97 | Duplicate detection | Helper only, not import UI | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 98 | Import preview | Preview exists | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 99 | Import validation | Minimal schema check | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 100 | Rollback | Missing | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 101 | Attachment backup | Data embedded in JSON | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 102 | Backup verification | Export says verified but no round-trip hash | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 103 | Audit log | Append-only array with max 5000 | `src/main.js` reports/export/backup/restore paths, `src/core.js`; restore/hash/relationship tests; `npm run check` | PASS |
| 104 | Security | Electron basics; local JSON unencrypted | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | LIMITATION |
| 105 | Application lock | Manual PIN lock exists | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | PASS |
| 106 | Password/PIN protection | Salted PBKDF2 exists | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | PASS |
| 107 | Session security | No inactivity timer | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | PASS |
| 108 | Local data protection | localStorage/browser profile | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | LIMITATION |
| 109 | Light-only mode | Light CSS only | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | PASS |
| 110 | English | English UI exists | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | PASS |
| 111 | Bengali | Resource map exists | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | INCOMPLETE |
| 112 | Professional localization | DOM translation has gaps | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/main.js`; static security tests and user documentation | INCOMPLETE |
| 113 | Responsive design | CSS breakpoints exist | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 114 | 1280x720 | CSS not automated | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 115 | 1366x768 | CSS not automated | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 116 | 1920x1080 | CSS not automated | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 117 | 2560x1440 | CSS not automated | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 118 | 3840x2160 | CSS not automated | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 119 | No overlapping elements | Not verified | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 120 | No text clipping | Not verified | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 121 | No broken grids | Not verified | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 122 | No ugly card layouts | Subjective baseline review | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 123 | Proper scrolling | Modal/table behavior needs audit | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 124 | Premium dashboard | Dashboard exists | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 125 | Premium widgets | Metric cards/signals exist | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 126 | Notifications | Notification center exists; generation incomplete | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | PASS |
| 127 | Animation | Limited CSS transitions | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | PASS |
| 128 | Print preview | Browser print preview exists | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 129 | A4 | CSS print; Electron PDF A4 handler unused | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 130 | Thermal/receipt printing | No size selector | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 131 | Custom print sizing | Missing | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | LIMITATION |
| 132 | PDF | Browser Save as PDF only | `src/main.js`, `src/styles.css`, `electron/main.cjs`; production preview smoke, print/PDF source audit; visual/runtime caveats recorded in final report | INCOMPLETE |
| 133 | Windows executable | Existing workflow | `.github/workflows/windows-release.yml` PE/ZIP/checksum gates; workflow `35690886125` passed and v1.1.0 assets/digests were verified via GitHub API | PASS |
| 134 | Installer | Existing workflow | `.github/workflows/windows-release.yml` PE/ZIP/checksum gates; workflow `35690886125` passed and v1.1.0 assets/digests were verified via GitHub API | PASS |
| 135 | ZIP | Existing workflow | `.github/workflows/windows-release.yml` PE/ZIP/checksum gates; workflow `35690886125` passed and v1.1.0 assets/digests were verified via GitHub API | PASS |
| 136 | SHA-256 | Existing workflow | `.github/workflows/windows-release.yml` PE/ZIP/checksum gates; workflow `35690886125` passed and v1.1.0 assets/digests were verified via GitHub API | PASS |
| 137 | Offline operation | Renderer has service worker/local state | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 138 | No paid APIs | No external API | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 139 | No mandatory cloud | Local architecture | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 140 | No patient telemetry | No analytics | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 141 | GitHub source | Repository exists | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 142 | Creator information | About/readme | `src/main.js`, `electron/main.cjs`, `package.json`, `README.md`; source/dependency/security checks; repository/release evidence | PASS |
| 143 | Commercial-quality architecture | Single 1,000-line renderer | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | ARCHITECTURALLY DEFICIENT |
| 144 | Long-term maintainability | Minimal tests and no types | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | PASS |
| 145 | Performance | Full array rendering | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | INCOMPLETE |
| 146 | Crash resilience | catch around forms only | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | PASS |
| 147 | Error handling | Toasts exist | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | PASS |
| 148 | Database integrity | Basic invoice/appointment check | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | PASS |
| 149 | Migration safety | schema number only | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | PASS |
| 150 | Data persistence | localStorage only | `src/main.js`, `src/core.js`, `electron/main.cjs`, tests and docs; `npm run check`; explicit boundary or benchmark evidence in final report | LIMITATION |

## Findings that remain intentionally visible

1. Browser preview remains a convenience fallback backed by browser storage; the supported desktop target uses the durable Electron store. Browser quota, browser-profile loss and browser-only PDF behavior are documented.
2. Staff roles are descriptive metadata in this offline single-profile product. There is no multi-user identity, permission enforcement, network synchronization or remote access-control plane. Do not treat a role label as authorization.
3. PDF attachments are downloadable but are not embedded as active inline PDF content. Images can be previewed; this is a clinical-safety boundary.
4. Bengali localization is a resource-map/DOM translation layer, not a complete professional translation review of every dynamic string. English is the quality baseline.
5. Arbitrary custom printer dimensions are not claimed. A4, Letter and 80 mm Receipt profiles are supported; the OS print dialog controls the physical printer.
6. GUI screenshot validation at every requested resolution and Windows runtime execution require the Windows/visual runner. The final report must not turn these into PASS without evidence.

## Advanced feature audit

Implemented advanced features include custom report ranges, patient clinical/financial filters, derived notifications, treatment catalog, appointment resource overlap checks, attachment categorization/edit/download, patient financial summaries, integrity/backup health checks, audit filtering, dry-run restore preview, relationship-safe create-new-copy restore, rollback, canonical backup hashing and future-schema protection. Features not found in the baseline or not needed for the single-profile boundary remain documented rather than invented.

## Execution checkpoint

- [x] Source baseline and package metadata inspected.
- [x] Domain, financial, attachment, import/restore and persistence hardening implemented.
- [x] Electron boundary/CSP/PDF active-content safeguards implemented and statically tested.
- [x] User guide, README, changelog and release workflow updated.
- [x] `npm run check` passed in this Linux sandbox (tests + Vite build).
- [x] Windows x64 workflow artifact, installer, application ZIP and checksum file verified by workflow 35690886125 and release asset metadata.
- [x] Final implementation commit 0f73d50, branch push, v1.1.0 tag and GitHub release evidence recorded; factual report update remains.
