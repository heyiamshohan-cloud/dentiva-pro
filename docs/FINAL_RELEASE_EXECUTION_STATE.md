# FINAL RELEASE — EXECUTION STATE (authoritative continuation checkpoint)

## Current phase
PHASE 2 — Release-blocker elimination: blockers A–D + RBAC/roles done and pushed. In progress: backend-only features (E), remaining dead settings, PO receive→stock workflow, then docs/parity, CI validation, scale re-run, final audit.

## Completed phases
- Phase 0 — Preserve & audit (baseline docs, v1.4.0 tree import at 3ac0305).
- Blocker A — PRINTING: full pipeline (electron/lib/print.mjs, print:html channel with native print dialog + PDF save dialog, isolated JS-disabled window, A4/A5/Letter/Legal/80mm, in-app sandboxed preview modal, logo/contact honors documentTemplate, Bengali font stack + lang, new documents: report print, appointment slip (80mm), treatment estimate; receipts default 80mm). Tests: security print-IPC suite updated.
- Blocker B — NOTIFICATIONS: real engine `src/notifications.js` (derive+reconcile, stable ids auto_<kind>_<date>, read/dismiss preserved, self-clearing), op `notifications.scan`, rules settings store unified (settings.notificationRules object; legacy array translated), renderer triggers (post-login, post-op debounce, 120s interval), Notifications page w/ per-kind toggles + per-row dismiss + priority. tests/notifications.test.mjs 7 tests on BOTH runtimes.
- Blocker C — AUTO-BACKUP: src/backup-schedule.mjs (pure due logic) + electron/lib/backup-scheduler.mjs (single-flight tick, retention prune, error recording to meta, same-second collision retry) wired into main process; settings UI (enable/interval/retention); backup page live scheduler status; default backupEnabled=true. tests/backup-scheduler.test.mjs 3 tests incl. real end-to-end.
- Blocker D — GLOBAL AUDIT LOG: Activity log page (nav System), filters (type/user/date range/search), pagination, secret-stripped detail modal, streaming CSV export (audit.export perm), dead modal removed.
- RBAC hardening: real Accountant template; Manager/Cleaner/Other selectable in UI; fixed v1.4.0 live bug -> `expenses: 'expenses.view'`→'accounting.view' (expenses page was permission-blocked for EVERYONE incl. Administrator).
- Settings groundwork: documentTemplate (showLogo/showClinicContact/footer) fully honored + UI toggles; settings.update clamps for scheduler numbers.

## Current task
Backend-only feature decisions (waitlist / custom fields / treatment templates / progress / forensics / request log / signature).

## Current file/component
src/ops.js + src/main.js feature surfaces.

## Last successful command
git push of audit-log milestone (70/70 tests green); CI run history: baseline import run green end-to-end on Windows (18m), printing milestone run queued/in-progress.

## Last failed command
(none outstanding)

## Failure reason
—

## Fix already attempted
—

## Next exact action
Read the 7 backend ops; implement or remove per decision; then dead settings (autoLock idle-lock, taxEnabled default propagation, chairs/rooms selects), PO receive→stock movement + partial receive, appointment Completed consistency, admin unlock; BN dictionary; docs parity; benchmark 1k/5k/10k/25k/50k/100k; final audit + report; CI publish.

## Tests already passed
- 70/70 node:test suites locally (60 inherited + notifications 7 + scheduler 3; one security test modernized for print lib).
- Windows CI: baseline v1.4.0 tree — full green (tests, build, 6-viewport visual, PE check, portable launch/restart smoke, ZIP + SHA-256 verification). Later pushes revalidate automatically.

## Tests still required
- CI green re-confirm on each milestone; visual 6-viewport on final; scale benchmark incl. 5k/50k on final code; upgrade test v1.4.0→v1.5.0 data; final release-gate additions for new features.

## Packaging status
CI pipeline proven green on Windows (baseline). Final version/packaging pending after feature freeze. Publish gate `[publish-release]` NOT yet used.

## Release status
NOT PUBLISHED. Target version v1.5.0 (features + fixes vs v1.4.0); tag via CI publish step only after all gates.

## Known remaining risks
- Notification query per-op scan adds small writes; bounded and debounced (OK at 100k scale — verify in final benchmark).
- Print native-dialog verification only possible on Windows CI (headless dialog cannot be asserted; pipeline smoke covers app boot, not printing — recorded limitation for the final audit; markup/validation/preview fully test-covered).
- mailto/Windows GUI behaviors unverifiable in sandbox — CI runners cover boot; manual clinic acceptance noted in report.

## Work log (append most recent at bottom)
- 2026-09-22: 3ac0305 v1.4.0 import; workflow trigger widened to arena/**; baseline+checkpoint docs.
- 2026-09-22: CI run 35757956488 (import commit): SUCCESS (18m) — workflow + build chain fully functional on current runners.
- 2026-09-22: Printing pipeline committed (lib + channel + preview modal + new docs + receipt width + logo/contact + report/slip/estimate).
- 2026-09-22: Notification engine + RBAC fixes (67/70→70/70 with scheduler + audit).
- 2026-09-22: Backup scheduler (real tick test w/ real workspace backup + prune).
- 2026-09-22: Activity log page + CSV export; dead audit modal removed.
