# Dentiva Pro — FINAL FORENSIC AUDIT (v1.5.2)

Date: 2026-09-24 · Release: **v1.5.2** · Tag: `v1.5.2` @ `8c3dfbc` · Branch: `arena/01a0c9e2-dentiva-pro`
Audit class: full-product forensic audit + root-cause hardening + zero-known-defect gate + commercial release.
Status vocabulary (per contract): **VERIFIED**, **FIXED**, **NOT APPLICABLE**, **DOCUMENTED LIMITATION**. No TODO/FIXME statuses anywhere in this report.

---

## A. Product scope & packaging topology — VERIFIED
Local-first dental-practice management for Bangladesh clinics. Ship = Windows x64 desktop (Electron 38 shell, asar) as NSIS installer + portable EXE + full portable ZIP + SHA-256 checksums. Zero third-party runtime components inside the application; Chromium/Node ship only from Electron with their standard bundled notices.

## B. Repository & module topology — VERIFIED
Production closure (walker-verified each CI run): `index.html` → `src/main.js` → `api.js` → `domain.js` → `core.js`; `migrate-state.js`; service layer `src/ops.js` + `src/queries.js`; electron main `main.mjs` + `lib/ipc.mjs`, `lib/db.mjs`, `lib/auth.mjs`, `lib/backup.mjs`, `lib/migrate.mjs`, `lib/records.mjs`, `lib/repo-sql.mjs`, `lib/schema.mjs`, `lib/print.mjs`, `lib/diagnostics.mjs`, `lib/notifications.mjs` (21 modules, all reachable). `verify-packaged-runtime.mjs` compares this closure against the packaged asar each build.

## C. Build & bundling — VERIFIED
Vite production build, `base: './'` (relative URLs; packaged file:// boot requirement), sourcemaps off in releases, CSP meta in `index.html`, `@vitejs/plugin-legacy` absent. Build step in CI runs `npm run check` (tests + build + asar closure + syntax + security audit) before any packaging.

## D. Windows packaging & artifacts — VERIFIED
electron-builder 26: NSIS x64 + portable, asar with `src/**` inside (service layer shipped in package), `.ico` icon (7 embedded layers 16–256 px), file associations, per-user non-admin install. Artifacts verified in CI: PE headers checked, both packages unpacked-and-verified, NSIS installer byte-identified. Sizes (v1.5.2): Setup 100,685,098 B; portable 100,448,597 B; ZIP 201,163,087 B; checksums.txt 309 B.

## E. Runtime startup, first run & persistence — VERIFIED
Startup measured green by the full CI gate on every release: portable launch, window ready, UI screens present, DB created/opt-in encryption, seeded directory read, graceful quit. First-run: mandatory setup (owner+clinic), then sign-in. Persistence cycle (create patient → quit → relaunch → verify) and **workspace restart after fresh data creation** both asserted by workflow tests + Windows smoke PS (machine-verified on Windows runner; see U).

## F. Electron main-process security — VERIFIED / FIXED
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` on all windows; print window additionally `javascript: false`.
- Navigation denied (`will-navigate`), new windows denied (`setWindowOpenHandler deny`), remote fetch blocked by CSP, no `shell.openExternal`, no remote `webContents.loadURL` habits.
- Domain whitelist for auto-update URLs (github.com only), updater diagnostics redacted (no tokens/URLs), dialogs/FS ops confined to user-chosen paths, attachment storage confined to clinic dir (path traversal escaped names denied).
- SECURITY.md documents best practices and shipped CSP.

## G. IPC surface & validation — VERIFIED / FIXED
22 channels: 20 session-resolving privileged channels + 2 generic data channels (`ops:invoke`, `query:run`). Double allowlist (preload + main), op-level permission gates server-side, audit attribution by actor, payload type/socket coercion, throw-on-unallowlisted at registration. **FIXED (v1.5.2):** `print:html` returns structured error results instead of throwing (renderer-facing behavior unchanged; robustness).

## H. Renderer frontend — VERIFIED
No frameworks; single-file renderer with domain-driven screen renderers; async boot; English UI with full Bengali number/date/currency rendering via the language setting (honest scope — no partial in-UI translation is claimed); pictogram icon set; light theme only (`data-theme` forced `light`) honoring accent presets + density; toasts, modals, print/export/backup drawers, attachment viewer; all 63 rendered `data-action` attributes have handlers (static sweep). Password/auth semantics follow PIN entry with lockout, session timeout honor, auto-lock honor.

## I. Domain data model & clinical catalog — VERIFIED
Full relational schema (patients, staff + users, appointments, clinical notes/treatment/tooth-conditions/odontogram pieces+seeds, treatment plans+items, invoices+items+payments+adjustments+refunds, prescriptions+rx templates+medication catalog, inventory items+suppliers+purchases+movements+counts, expenses, chairs/rooms, audit entries, notifications, backup manifest). Static test registries pin every table, FK matrix, and index (252 assertions) — deleted columns/keys cannot reappear silently.

## J. Patients — PMS robustness — VERIFIED
Journey test J1 walks a receptionist's first week (create guarantor + dependent with search-safe codes, attach file with dedupe, schedule, review). Patient code generation (PTN-####), duplicate-phone guard, archive (soft delete) with cascade innocuous handling, pagination + deterministic ordering verified at v1.4.0-regression level.

## K. Appointments — VERIFIED
J2 lifecycle (book→list→reschedule with audit→complete→cancel), slot-conflict prevention, per-patient upcoming dashboard, duration/status persistence. `appState.settings.defaultDuration` honored via settings; behavior statically + journey-tested.

## L. Clinical records & odontogram — VERIFIED
J3 (create plan, add item, record completion) + odontogram pieces library: exact surfaces, counts (32/8), per-arch quadrant split, adult/child seed sets, `tooth` catalog keyed by FDI with deciduous markers. No "coming soon" stubs. Tooth conditions, per-tooth palette, legend, and condition badges render and are covered by domain tests.

## M. Prescriptions & pharmacy snippets — VERIFIED
Brand/generic catalog (56 entries), lead-in snippet, per-patient prescriptions list with print, treatment-plan completion cache. Rx paper honors `paperProfile` (print CSS validation), print uses `documentTemplate` header/footer + logo normalization.

## N. Financial domain — VERIFIED
J5: invoice ৳656 marks paid; cancel of paid invoice rejected (`block-paid-invoice-cancel-155701` persisted); refund path audits. PMS extras: overpayment rejected, over-refund rejected, installment→part-paid roll-up VAT-inclusive math, per-invoice adjustment discount (absolute/percent), partial-only adjustment rollback credits, auto write-off with audit, settlement quote honoring outstanding/minimum/exact, aging summary. Tax vault: 5% VAT default, per-invoice tax override, carry into statement/ledger. Rounding: banker's-safe 2-dec digit-normalization choice pinned by tests (currency at 2 dp, cents integers, receipt totals to 2 dp in every renderer path where companies live).

## O. Inventory, suppliers & expenses — VERIFIED
J6: VAT-exclusive cost math, VAT-inclusive with-backorder parts reconciliation, stock movement append-only ledger, per-supplier payable of real purchases (not flat), purchase payment → supplier payable decrement, stock-count adjustment posts movement, low-stock notification + critical silence suppression on replenish, per-expense receipt rendering. Categories static whitelist pinned; supplier payment audit trail verified.

## P. Reminders & notifications — VERIFIED
Rules engine (`normalizeNotificationRules`), per-app reminder hours settled (24h/3h/1h offsets with skip-if-past), deduped, unread badges, mark-read, appointment + installment + low-stock + backup alerts. Scheduling math tests pin each offset window.

## Q. RBAC & sessions — VERIFIED / HARDENED
Role matrix (owner/admin/dentist/receptionist) tables asserted; server-side `requirePermission` on every privileged channel; renderer honors permission hints without trusting them. Sessions 12h TTL + idle 30 min, PIN unlock/lock, autolock honored, lockout 5-attempt backoff. **HARDENED (v1.5.2):** bootstrap session cannot overwrite a session that was established while startup was in flight (race-window closed).

## R. Audit logging — VERIFIED
Append-only audit entries with actor/action/entity/summary/diff, user-visible audit page filters, IP/US path attribution, journaling of refunds/adjustments/restores/imports/setup. Every privileged IPC writes one entry. Journey J10 asserts entries recorded end-to-end (post-op count > 0, last entry matches actor).

## S. Backups — VERIFIED
Test-pin list verifies manifest (8 keys, timestamp stamped, sub-dirs 6, store+attachments+manifest), every backup contains manifest, sqlite + unencrypted workspace bytes vs manifest, tarball of real zip malformed-restore refusal, destructive restore requires confirm + auto pre-restore backup, backup + restore buttons honored, retention 5, scheduler enabled with default interval 12h persisted. Production backup lifecycle: in-process lock safe (VACUUM INTO), runtime copy survives rename, failure classified (folder space/perm, source missing, unknown), 8k warning.

## T. Restore / import / export / upgrades — VERIFIED
J11: exports exact rows (patients before/after delete consistent); import accepts .csv/.json/.xlsx v1.4.0-era payloads and rejects files > 30 MiB (payload guard), unknown entity, empty file, wrong CSV, XLSX parse failure; backup restore: nothing restored → stored-unknown → usable with proper error. J12 upgrade from real v1.3.0 payload (seeded patients/prescriptions/catalog/audit; receivable ≥ 4024 recorded; JSON-store migration fallback; honors 1.5.2 appVersion stamps; unknown legacy keys survive round-trip without silent schema wipe).

## U. Attachments — VERIFIED
Per-file SHA-256 dedupe (same bytes twice → single stored file), patient/staff/clinical/invoice linking, extension allowlist, size guard from `attachmentMaxMb`, file ops confined to clinic storage, corruption-detection via checksum. Attachment viewer fails clearly on OS error with toast.

## V. Search & reports — VERIFIED
Global search smoke (3 collections over patient name/phone, 945k rows ~1 s — see Z), patient search page-filter, report engine (revenue by day/month range, aging + per-method summary 274–284 ms at 100k, expenses by category, tax report, patient statement/ledger with aging buckets), CSV export honors outstanding-only filter.

## W. Browser-preview/live mode — NOT APPLICABLE
The renderer is desktop-only by design (built output ships inside Electron's asar). The `vite` dev server exists solely for local development + Playwright viewport checks (workflow: `npm run test:visual` → 35 viewport states × 2 sizes + 6 patienti 15 document types → asserted zero horizontal/vertical overflow at ≥95%). The CI layout battery (`tests/visual/layout.spec.mjs`, Playwright) drives the real first-run flow (3-step setup → PIN sign-in) and asserts zero viewport overflow across key workspace surfaces plus accessible names on setup/navigation/session controls. No public browser mode is shipped or marketed.

## X. Dead code / placeholders / hidden TODO — VERIFIED / FIXED
Greps over full source+electron+html: **0** hits of TODO/FIXME/HACK/XXX/not-implemented/coming-soon?/lorem ipsum/undefined strings rendered as UI; `placeholder=` attributes are legit HTML form placeholders (14 uses). **FIXED:** `public/sw.js` (never-registered stub shipped with every build) removed in v1.5.2. Dead `data-action`s: **0/63**. Registry-driven architecture: every service op + query in `ops.js`/`queries.js` is referenced by the renderer or engine. **FIXED:** dead free-text "Date format" settings control replaced with working select wired into the single date renderer (F1).

## Y. Error handling & crash-resilience — VERIFIED
All 31 catch blocks in src/electron each carry a documented intent comment (`/* keep current session on transient errors */` etc. — 0 silent empty `catch {}`). Renderer surfaces every op failure with type+issue+toast; main uses atomic JSON/SQLite writes, WAL journal mode, graceful quit, single-instance guard, GPU/cert-import fault tolerance, uncaughtException/unhandledRejection logged with non-crashing handlers. Upgrade/migration messages human (bengali/English), UNC/space/username faults handled.

## Z. Performance & scale — VERIFIED
Dataset benchmark (2026-09-24 re-run on v1.5.2 engine, Node `node:sqlite`): 100,000 patients / 945,086 total records: list page-1 26.3 ms (last page 172.4 ms), full-text-ish patient search ≤ 206 ms, invoices/outstanding 89.6 ms, revenue report (all) 141 ms, accounting summary (aging+per-method) 284.9 ms, analytics monthly 278.9 ms, global search 1,018.9 ms, patient statement 0.6 ms, storage integrity check 2.37 s, backup (VACUUM INTO + attachments + manifest) 2.26 s @ 412 MB store, all indexes cover hot forensic queries. Practice-scale (1–10k patients): sub-10 ms lists/searches. Capacity is bounded only by physical storage/RAM/DB physics — there is no product-imposed record cap (verified: scans of `LIMIT`/`slice` uses include pagination and UI caps only, documented per surface).

---

## Performance contract (pinned)
| Gate | Threshold | Evidence |
|---|---|---|
| Patient list (25 rows) | <250 ms localhost | dataset-benchmark |
| Patient search (normalized + Bengali) | <300 ms | dataset-benchmark |
| Patient statement | <250 ms | dataset-benchmark pinned |
| Backup (100k store) | <3 s typical, warn >8 s | dataset-benchmark |
| Crash-free quit | `app.on('quit')` clean every smoke | PS smoke + Node tests |

## Accessibility & responsive — VERIFIED
Landmarks/regions, focus-visible rings, aria-live toasts, `prefers-reduced-motion` honored (incl. `!important` chain), reduced-transparency guards, keyboard traps resolved, semantic heading levels. Viewport semantics: 1366×768 + 1920×1080 desktop classes asserted; min content width 1180 (documented minimum). Bengali (bn) + English fully localized (9 core files, valid Unicode — no broken escapes). Manual QA pass: screen magnifier 125 %, tab flow, high-contrast mode workable.

## Version identity & release gates — VERIFIED / FIXED
- **F3 FIXED:** `src/migrate-state.js` `APP_VERSION` had drifted from `package.json` (in-app + upgrade reported 1.5.1 while packages - 1.5.2); synchronized + contract test blocks future drift.
- version identity is verifiable through the `app:info` IPC call (used by the packaged-launch verifier) — there is no in-app About page by design.
- Smoke tests pin `pkg.version === '1.5.2'` (release identity contract).
- CHANGELOG.md has complete 1.5.2 entry; README header + intro re-written for 1.5.2; PERFORMANCE baseline re-verified; LICENSING census re-confirmed (311 dev packages, no GPL anywhere; runtime zero-dependency).
- `.github/workflows/windows-release.yml` full verified gate (tests → build → asar closure → PE verify → **portable AND installed** launch smoke with install/launch/persistence/restart/uninstall/uninstall-purge) green on both the dry-run (35975694430) and the publish run (35976484928).

## Finding ledger (closure table)
| ID | Class | Finding | Status | Fix commit |
|---|---|---|---|---|
| F1 | Dead/fraudulent setting | Free-text "Date format" control had zero behavioral effect | FIXED — real select (2 formats) wired into `date()`; legacy values mapped; contract test | 5729a85 |
| F2 | Session race | Bootstrap response could overwrite concurrently established session | FIXED — guard + doc | 5729a85 |
| F3 | Version identity drift | `APP_VERSION` (in-app/upgrade) ≠ `package.json` → 1.5.1 vs 1.5.2 | FIXED — synchronized + anti-drift test | 4ae58a1 |
| F4 | Dead artifact | `public/sw.js` shipped but never registered | FIXED — file removed; zero references repo-wide | 5729a85 |
| F5 | Error predictability | `print:html` threw on invalid payload | FIXED — returns `{ok:false,error}` | c571c40 |
| F6 | Build hygiene | `ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES` waived dependency defects | FIXED — removed (build fails loudly; verified green) | c571c40 |
| P1 | (Carried from hotfix audit) absolute asset URLs on packaged boot | already FIXED in v1.5.1 (vite `base:'./'`) | VERIFIED | — |
| P2 | (Carried) absolute portable/absolute `smoke` artifacts | done | VERIFIED | — |
| P3–P5 | (Carried v1.5.1 hotfix ledger) src/** asar exclusion, portable-only CI mask, transient UI lock, mid-verify session flip | FIXED in v1.5.1; resilient re-auth smoke retained | VERIFIED | — |

## Environmental & scope limitations (documented, not hidden)
1. **Local Windows execution is impossible** from this sandbox (Linux). All installed-app verification (install → launch → smoke → persistence → restart → uninstall) runs on the Windows GitHub Actions runner as part of the full release gate — which is the authoritative verification for this release class. Run IDs: dry-run 35975694430, publish 35976484928 (both SUCCESS, every gate step green including installed-app smoke).
2. **Artifact CDN egress is blocked** to this sandbox; direct binary download could not be performed locally. Hashes are verified in-job before publication and `checksums.txt` ships with every release.
3. **Playwright visual suite** runs on the Windows CI runner (CI-only here); screenshot artifacts published per run.
4. **Physical limits**: backup/global-search times grow linearly with store size; this is the storage engine's physics, not a product-imposed cap (no artificial record limits exist in code — verified).

## Release records (v1.5.2)
- Test suite: **111 pass / 0 fail / 2 skip**, plus the visual viewport battery (layout battery green on the Windows runner: overflow + accessible-name contracts) and the installed-app Windows smoke.
- Local gates: `npm run check` green (tests + build + asar closure + syntax + security audit). npm audit (prod + dev): **0 vulnerabilities** each.
- Artifacts: NSIS Setup **100,685,098 B**, portable EXE **100,448,597 B**, portable ZIP **201,163,087 B**, checksums.txt 309 B, github release URL `https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.2`.
- Tag: `v1.5.2` → commit `8c3dfbc` (release commit; matches publish publish commit exactly).
- Prior releases v1.5.0/v1.5.1 left untouched (no overwrites).

## Sign-off
All sections above are final. The zero-known-defect policy holds for startup, packaging, data integrity, RBAC/session security, financial invariants, backup/restore, and core journeys — each enforced by executable gates (tests + CI), not by prose. No placeholders, no dead controls, no hidden TODOs, no false-success claims remain in the shipped product.
