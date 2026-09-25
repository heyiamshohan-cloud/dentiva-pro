# Dentiva Pro v2.0.0 — Final Engineering Checkpoint

> Durable resume point for the v2.0.0 final engineering cycle.
> On "Continue": read this file top to bottom, then resume at **NEXT EXACT ACTION**.
> Never restart completed phases. Never discard completed work.

## Baseline

| Item | Value |
|---|---|
| Authoritative baseline | `v1.6.1` (tag → `0cf6d60`) + docs commit `32e8a76` (branch `origin/arena/01a0c9e2-dentiva-pro`) |
| Session branch | `arena/01a0d7c7-dentiva-pro` (fast-forwarded from `main@50b86e7` onto `32e8a76`) |
| Baseline tests | `npm test` → 133 tests · 131 pass · 0 fail · 2 skipped (manual benchmarks) |
| Baseline CI | run 36094770613 (success) |
| Target | `2.0.0` |

## Environment facts (sandbox)

- Node 22.22.3 (`node:sqlite` built-in). No Wine → Windows packaging + installed-app verification run in GitHub Actions (`.github/workflows/windows-release.yml`, triggers on push to `arena/**`; publishes only when head commit message contains `[publish-release]`).
- Electron binary + Playwright CDN downloads are blocked in the sandbox. A working headless Chromium 153 was obtained from npm (`@sparticuz/chromium`) and lives at `/home/user/.cache/dtools/chrome/chromium` (snapshot-excluded). Env: `source /home/user/.cache/dtools/env.sh`. Launch via Playwright `chromium.launch({ executablePath, args: ['--no-sandbox','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--in-process-gpu'] })`. Fonts: DejaVu + Open Sans via custom fonts.conf.
- If `.cache` was wiped: `npm pack @sparticuz/chromium`, brotli-decompress `bin/*.br` with node zlib, place swiftshader libs next to the binary, write fonts.conf pointing at /usr/share/fonts.

## Phase status

| Phase | Status |
|---|---|
| 1 Forensic reconnaissance | DONE (backend + renderer structure mapped; renderer screen-by-screen audit continues in Phase 3) |
| 2 Feature inventory | pending |
| 3 Frontend audit | pending |
| 4 Backend audit | DONE for ops/queries/IPC/auth/backup/migration/ledger (fixed + tested) |
| 5 DB & lifetime data | pending |
| 6 Search/pagination forensics | pending |
| 7 Financial forensics | pending |
| 8 Backup/restore forensics | pending |
| 9 Import/export | pending |
| 10 Print/PDF engine | pending |
| 11 English-only migration | pending |
| 12 UI/UX redesign | pending |
| 13 Theme system | pending |
| 14 Performance | pending |
| 15 Error/crash forensics | pending |
| 16 Security | BACKEND DONE (16 behavioral tests); renderer XSS/CSP review pending |
| 17 RBAC | pending |
| 18 Electron/Windows | pending |
| 19 Dead code/placeholder purge | pending |
| 20 Documentation | pending |
| 21–27 Test matrix / invariants / golden docs / scale | pending |
| 28 Final static audit | pending |
| 29–30 Build gate / build | BLOCKED until all above complete |

## Architecture map (verified from code, not docs)

- `electron/main.mjs` — app lifecycle, single-instance lock, migration entry, window, CSP header, `print:html` (hidden JS-disabled window, data: URL), smoke harness (DENTIVA_SMOKE=1).
- `electron/preload.cjs` — exposes `window.dentiva.invoke(channel,args)` over an allowlist.
- `electron/lib/ipc.mjs` — channel handlers; session from `SessionManager`; ops via `runOp`, queries via `runQuery`.
- `electron/lib/auth.mjs` — PBKDF2 PIN KDF, lockout, in-memory session, first-run context.
- `electron/lib/db.mjs` — `Workspace` over `node:sqlite` (WAL, FK ON, busy_timeout 5000, synchronous FULL), attachments on disk, integrity check.
- `electron/lib/schema.mjs` — 26 collection tables (typed columns + JSON `payload`), `DB_LAYOUT_VERSION = 1`, schema applied with IF NOT EXISTS on every open (no ALTER migrations framework yet).
- `electron/lib/records.mjs` — record↔row mappers; `rowToRecord` = payload JSON + `_cents` columns.
- `electron/lib/repo-sql.mjs`, `list-sql.mjs`, `ledger-sql.mjs` — SQL repository/list/ledger.
- `electron/lib/backup.mjs`, `backup-scheduler.mjs`, `migrate.mjs`, `diagnostics.mjs`, `print.mjs`.
- `src/ops.js` — shared operation registry (~75 ops) with permissions; `src/queries.js` — query registry.
- `src/core.js` — RBAC templates, money helpers, restore planning; `src/domain.js`; `src/migrate-state.js` (DEFAULT_SETTINGS, APP_VERSION); `src/notifications.js`; `src/doc-engine.js` (documents).
- `src/api.js` — DesktopApi (IPC) / LocalApi (browser dev LocalRepo `src/repo-local.js`).
- `src/main.js` — 378 KB renderer (string-template UI, event delegation via data-action).

## Defect ledger

Severity: CRIT (data loss / security breach / broken core workflow), HIGH, MED, LOW.
Status: OPEN / FIXED (commit) / VERIFIED (test).

| ID | Sev | Area | Finding (root cause) | Status |
|---|---|---|---|---|
| SEC-01 | CRIT | users/auth | `user.update` without a new PIN wipes `pin_hash`/`pin_salt`/`kdf`: `userUpsert` spreads the sanitized payload (`pinHash:''`) and upserts it; mapper writes empty secret columns. If it is the only PIN account → `anyPinSet()` false → workspace falls into first-run → unauthenticated Administrator context. Proven by `/tmp/probe/pin-wipe.mjs`. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-02 | CRIT | IPC/ops | Unauthenticated ops: ipc passes `context || {}`; `authorizeOp` checks `!ctx` so `{}` passes; all `permission:null` ops run while locked. `setup.complete` overwrites clinic/dentist identity printed on prescriptions (proven). Also dashboard/navigation/savedFilter/notification writes. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-03 | HIGH | auth | Server-side inactivity timeout not enforced: `SessionManager.context()` never evaluates `lastActivity`; ops never refresh activity. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-04 | HIGH | auth/RBAC | Session permissions frozen at login; role/permission edits and deactivation not reflected until re-login. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-05 | HIGH | IPC | `workspace:export` has no permission check (any signed-in role can export the whole workspace incl. finance). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-06 | HIGH | Electron | `will-navigate` allows ANY `file:` URL → dropping/navigating to a local HTML file loads it with the privileged preload bridge. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-07 | MED | IPC | `backup:validate` / `backup:restore` accept arbitrary renderer-supplied filesystem paths (not tied to a main-side dialog pick or the managed backup list). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-08 | MED | IPC | No sender/frame validation on IPC handlers. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-09 | MED | auth | Fixed 30 s lockout after 5 failures → 4-digit PIN brute-forceable offline-in-app in hours; needs progressive lockout. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-10 | LOW | CSP | Production CSP header allows `connect-src http://localhost:*`; index.html meta CSP allows `ws:` + localhost. | BACKEND FIXED — renderer pending |
| SEC-11 | MED | users | `user.create/update` accept arbitrary role strings (zero-permission accounts) and unvalidated permission lists. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| EL-01 | HIGH | Electron | Single-instance: on lock failure `app.quit()` is async while `whenReady` handler still registered → second instance may run migration/open DB concurrently. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| EL-02 | MED | Electron | `render-process-gone` reloads unconditionally → infinite crash-reload loop possible. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| EL-03 | MED | dev | Unpackaged `npm run start:desktop` loads `http://localhost:5173` (vite runs on 4173, and start:desktop never starts it) → blank window. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| EL-04 | HIGH | print | `print:html` loads document via `data:` URL — Chromium 2 MB URL cap → long statements / documents with logos fail to print/PDF at scale. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| DB-01 | HIGH | perf | Full `PRAGMA integrity_check` on every app quit (`before-quit` → diagnoseWorkspace) and on every `workspace:info` call → O(DB size) stalls. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| DB-02 | MED | data | `Workspace.listRecords` silently clamps limit to 5000; `SqlRepo.all()` truncates at 5000; `byIds` truncates at 2000. Callers must be audited. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| DB-03 | MED | perf | `bootstrapPayload` runs COUNT(*) over 26 tables twice per bootstrap. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| IPC-01 | MED | perf | `attachment:read` returns the bytes twice (base64 + dataUrl). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| RST-01 | HIGH | restore | `restoreCollection` / `buildRestorePlan` O(n·m) linear scans → JSON restore of large workspaces effectively hangs. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| RST-02 | HIGH | restore | "Create New Copy" strategy keeps `patientCode`/`invoiceNumber`/`receiptNumber` → duplicate-code validation throws → strategy unusable on conflicts. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| TZ-01 | HIGH | dates | Server `ctx.today()` = UTC date; renderer `today()` hardcodes Asia/Dhaka → 00:00–06:00 local, server-side "today" is yesterday; hardcoded TZ wrong for any other locale. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| SEC-12 | HIGH | queries | `null`-permission queries reachable unauthenticated and bypass RBAC: `directory` (patient names/phones), `globalSearch` (patients/invoices/payments with no per-collection check — any role sees billing), `dashboard`, `workspace` (runs integrity check), `notifications`. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FN-01 | CRIT | directory | `listCollection('treatments')` throws `no such column: t.archived` (filter added in 5b2635a, table has no column) → `directory` query fails on desktop → renderer directory empty → patient/staff/treatment pickers empty after restart. Proven `/tmp/probe/treat.mjs`. CI missed it because Playwright runs LocalRepo, not SQLite. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FN-02 | CRIT | pickers | Even when working, `directory` asks pageSize 2000 but `listCollectionSql` clamps to 500 → patient pickers stop at 500 patients (the "500/501 cap"). Needs search-based patient combobox. | BACKEND FIXED — renderer pending |
| FN-03 | CRIT | dental | Dental chart reads `history.records` but query returns `rows` → saved tooth records never display (UI + print). | BACKEND FIXED — renderer pending |
| FN-04 | HIGH | dental | v1.4.0+ stores chart POSITION indices (1–32 / 1–20) instead of FDI; v1.3.0 stored FDI → mixed data. Lower-left quadrant rendered reversed; tooltip Universal numbering wrong for lower-right; print chart numbers 1–32. Needs FDI-canonical storage + disambiguating migration (migratedFrom/migratedAt vs createdAt). | BACKEND FIXED — renderer pending |
| FN-05 | HIGH | dashboard | Dashboard follow-ups use status `'Pending'` which does not exist (Open/Contacted/Scheduled…) → widget always empty. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FN-06 | HIGH | print | `printBilling` asks pageSize 2000, `printReportDocument` 500 → clamped at 500 → totals computed from a silent subset. Statement print loop has a 40-page safety cut. | OPEN |
| TXN-01 | CRIT | ops | Ops are not transactional; multi-write ops (payment→invoice→balance→counter→audit) can partially commit; thrown exceptions are not caught (IPC rejects). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-01 | CRIT | invoices | `invoice.update` accepts any status: billing.edit can mark unpaid invoice `Paid`, or `Cancelled` even with payments (bypasses billing.void and refund-first guard). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-02 | HIGH | 360 | `patientFinancialSummarySql` fallback due formula adds adjustments (sign error) → inflated due whenever an adjustment exists. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-03 | HIGH | receipts | Receipt number falls back to the INVOICE prefix when receiptPrefix empty; visit code falls back to the APPOINTMENT prefix (no visitPrefix default) → visits and appointments share `APT-0001` style codes. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-04 | HIGH | money | Silent money alteration: discount > subtotal clamped, adjustment > due clamped, invalid line price → 0, fractional qty re-derives unit price. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-05 | HIGH | status | `invoiceStatusFrom` keeps `Draft`/`Refunded` forever even after new payments. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-06 | HIGH | reports | Accounting `netOperatingCents` ignores refunds; refunds attributed to payment date (not refund date); analytics monthly `ORDER BY ASC LIMIT 24` keeps oldest months. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-07 | MED | ledger | Statement clamps running balance at 0 (hides credit); same-day ordering depends on reference prefix spelling; refund reference shows internal id `adj_…`; opening balance clamped while accumulation isn't. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| FIN-08 | MED | 360 | `visitBillingForSql` ignores refunds in per-visit paid/due. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| DOC-01 | HIGH | invoice | Invoice document has no Paid / Due rows. | OPEN |
| DOC-02 | HIGH | receipt | Receipt "Received by" prints the current user (not who recorded the payment); "Remaining due" is current due, not due after that payment. | OPEN |
| DOC-03 | MED | docs | Labels "Patient ID" (spec: Patient Code); Rx med table has an unlabeled column; header renders "Name, Dr." (title used as suffix); Bengali-first font chain; line totals recomputed with float math; brand falls back to "Dentiva Pro". | OPEN |
| PAT-01 | HIGH | patients | `patient.update` merges arbitrary payload keys and can archive via `status` (bypasses patients.archive). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| PAT-02 | HIGH | merge | `patient.merge` non-transactional; dental unique index `(patient,tooth,dentition) WHERE superseded=0` can throw mid-merge; duplicate's balance not recomputed. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| APT-01 | MED | appts | `appointment.update` can set `Cancelled` (bypasses appointments.cancel); no status transition validation; queue serial = count+1 (duplicates possible). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| VIS-01 | MED | visits | `visit.update` merges arbitrary payload, no date validation, lastVisit not recomputed. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| DEN-01 | MED | dental | `dental.save` accepts any positive integer tooth (no FDI validation). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| PAG-01 | HIGH | lists | ORDER BY clauses lack a unique tiebreaker (patients by name/balance, invoices by date…) → OFFSET pagination duplicates/skips rows. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| BK-01 | CRIT | restore | `restoreBackup` overwrites the live DB in place and deletes attachments before copying; post-restore integrity failure or copy error leaves a half-restored workspace (no automatic rollback). Session survives restore. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| BK-02 | CRIT | backup | Scheduler retention prune deletes ALL backups beyond N — including manual and pre-restore safety backups. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| BK-03 | HIGH | restore | JSON full restore: per-table DELETE+INSERT in one mixed order under immediate FKs; no safety backup; no validation; O(n·m) planner. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| BK-04 | MED | backup | Custom backupDirectory backups not listed/pruned; scheduler ignores it; lastAutoBackupStatus double-JSON-encoded; same-second manual backup name collision. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| MIG-01 | HIGH | migration | If v4/legacy migration fails, main still opens the primary file and writes the v5 schema into the v4 DB → next launch sees "v5" and never retries (data invisible; preserved copy exists). | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |
| I18N-01 | HIGH | English | 9,493 Bengali chars in src/main.js (dictionary, pickers, language selector), smoke fixtures, tests, scripts, docs, `৳` symbol. | OPEN |
| SET-01 | MED | settings | Legacy `applicationLock/pinHash/pinSalt` in DEFAULT_SETTINGS; timezone list only Asia/Dhaka; money formatting lacks fixed 2 decimals. | OPEN |
| BK-05 | CRIT | restore | Full JSON restore deleted `users` and re-inserted sanitized rows → every PIN wiped → open first-run. | FIXED (71e546e; test BK-05) |
| DEN-02 | HIGH | dental | `dentalHistory` with empty tooth filtered `tooth = 0` (empty history); `supersedeDental` returned undefined → `dental.removeCurrent` always failed. | FIXED (cc2275b) |
| SEC-13 | MED | auth | Changing own PIN did not require the current PIN. | FIXED (71e546e; test SEC-13) |
| RBAC-01 | MED | RBAC | Roles `Cleaner` (settings.view only) and `Other` (none) are effectively zero-permission accounts. | FIXED (71e546e/cc2275b; tests v2-security/v2-domain) |

## Tests completed
- Baseline `npm test` (133/131/0/2).
- After backend hardening: `npm test` 164 / 162 pass / 0 fail / 2 skipped (manual benchmarks).
  - tests/v2-security.test.mjs (16): SEC-01..13, BK-05, transactional rollback, retention.
  - tests/v2-domain.test.mjs (15): invoice math, invalid money, payment lifecycle, FIN-01, drafts,
    adjustments, statement identity (opening+debits−credits=closing, credit balances), receipts
    point-in-time, document codes, reports (refund dates), FDI validation, merge, appointment
    transitions/serials, staged-restore fault injection (4 steps), real v1.6.1 upgrade fixture.

## Tests remaining
- Everything in phases 21–27.

## Files changed (this cycle)
- `docs/V2_FINAL_ENGINEERING_CHECKPOINT.md` (new)
- Backend: electron/lib/{auth,backup,backup-scheduler,db,ipc,ipc-handlers(new),ledger-sql,list-sql,migrate,print,records,repo-sql,schema,schema-migrations(new)}.mjs, electron/main.mjs, electron/smoke.mjs (extracted)
- Domain: src/{core,domain,dental(new),migrate-state,ops,queries}.js
- Tests: tests/helpers/harness.mjs, tests/v2-security.test.mjs, tests/v2-domain.test.mjs, tests/fixtures/v1.6.1-workspace.sqlite

## Migrations performed
- Layout 2 (`v2.0.0-foundation`, electron/lib/schema-migrations.mjs): users.lockout_count; audit(entity_id), invoices(created_at), payments(created_at) indexes; dental FDI canonicalisation (legacy chart positions → FDI, disambiguated by meta.migratedFrom/migratedAt; originals kept in payload.legacyTooth; duplicate current rows superseded); retired settings keys stripped (language, applicationLock, pinHash, pinSalt).
- Pre-upgrade backup (kind `pre-upgrade`) taken by migrateWorkspace before any pending layout migration.

## Release blockers
- All OPEN CRIT/HIGH defects above.

## NEXT EXACT ACTION
Phase 3/11/12 renderer work, in this order:
1. Dev/test server `scripts/dev-server.mjs` (vite middleware + POST /__dentiva/invoke → createIpcHandlers over a real workspace in `.dev-workspace/`, gitignored) and a `window.dentiva` shim injected only in dev; remove LocalApi/LocalRepo from the renderer bundle (api.js → DesktopApi only).
2. Renderer: patient picker combobox (query `patientSearch`/`patientBrief`) replacing `appState.directory.patients` selects; dental chart on FDI (src/dental.js) reading `rows`; lock → `auth:logout`; restore → re-auth; invoice cancel reason prompt; own-PIN change asks current PIN.
3. English-only: delete BENGALI_DICT/localized()/translateDom/language selectors; currency "Tk" (no ৳); money always 2 decimals; clinic timezone `today()`; Bengali-free smoke fixtures.
4. Documents: invoice Paid/Due rows, receipt via `receiptDetail`, statement summary from ledger period totals, labels "Patient Code", Rx columns, print billing/report paging (no caps), dental chart print on FDI.
5. Design system redesign (styles.css tokens + shared helpers), remove dark remnants.
6. Playwright E2E against the dev server (real engine) + visual suite; then push for Windows CI.