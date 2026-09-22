# FINAL RELEASE BASELINE — what this release inherits

**Date:** 2026-09-22 · **Session branch:** `arena/01a0c9e2-dentiva-pro`
**Baseline commit:** `3ac0305` = verbatim import of tag `v1.4.0` (`a560b20`) + this documentation.

## Inheritance inventory (verified against the tree, not docs)

| Inherited | State | Verification |
|---|---|---|
| Electron desktop shell (`electron/main.mjs`, preload, 11 lib modules) | Working, hardened (contextIsolation/sandbox, per-channel validation, fresh isolated dialog windows) | source audit 2026-09-22 (`docs/V1.4.0_FORENSIC_AUDIT.md`) |
| `node:sqlite` storage engine, 26 tables, WAL, ~50 indexes | Working; 0 FK violations after live money cycle + restore | live execution |
| Shared service layer `src/ops.js` (61 ops) / `src/queries.js` (40 queries) | Server-enforced permissions; parity across Electron/browser repos | live + 60/60 tests |
| Financial engine (integer cents, reprice lock, overpayment block, refunds, adjustments, one balance formula) | Verified live (1045.00 invoice → Paid → refund/adjustment → exact 5000-cent balance) | live execution |
| Backup/restore/migration engines w/ SHA-256 manifest, tamper rejection, pre-restore safety copy, v1.3 JSON import, v4→v5 migration w/ quarantine | Verified live (442 MB @100k round trip; tampered byte rejected) | live execution |
| PBKDF2-210k PIN auth, timing-safe compare, 5-fail/30 s persisted lockout, server inactivity sessions | Verified | source + tests |
| 60-test node:test suite | 60/60 PASS on this exact tree (sandbox, 2026-09-22) | `npm test` |
| Renderer (~3k lines, light-only design system, 123 icons, EN/BN dictionary 449 entries) | Functionally complete UI; issues listed below | source audit |
| Scale benchmark script + measured results @100k patients / 945k records / 442 MB | All lists/searches ≤ 43 ms, backup 2.3 s | live rerun |
| GitHub release history v1.0.0–v1.4.0 (binaries + tags) | Preserved untouched; provenance of v1.4.0 binaries unknown (no green CI) | gh api |
| `.github/workflows/windows-release.yml` | Present; **0/20 historical runs green** (2026-03/04, logs expired); trigger pointed at old branch only | gh api + workflow source |

## Known problems being inherited (fix targets — mandatory)

**Critical / release blockers**
1. Printing silently discards output: `print:html-pdf` handler generates PDF then drops it; no `webContents.print`, no preview, no dialog (all 7 print-hub documents affected).
2. Notification/reminder engine unwired: `notification.scan` exists, nothing calls it; Notifications page permanently empty; `settings.notifications` toggle dead; rule storage split/confused.
3. Auto-backup: `backupEnabled/backupIntervalHours/backupRetention/backupDirectory` settings exist + are editable, but no scheduler executes them.
4. No global audit-log UI (backend `listAudit` complete; dead `modalAuditLog`).
5. CI: all recorded runs failed; v1.4.0 binaries have no verified provenance; FINAL_AUDIT §6 verification table unfilled while claiming green gates.
6. Repo topology: `main` is a skeleton README; product lived only on tags/orphan branch. (Resolved by this branch: production source of truth is now `arena/01a0c9e2-dentiva-pro`.)

**High**
7. `Accountant` selectable in UI but has no role template → zero perms; `Manager/Cleaner/Other` templates not selectable.
8. Seven backend-only capabilities: waitlist, custom patient fields, treatment templates, treatment progress, patient forensics, request log, signature capture.
9. Dead settings beyond the four above: `autoLockMinutes` (no idle-lock), `documentTemplate.showLogo` (never read; logo never printed), `settings.notificationRules` storage confusion, `taxEnabled` wiring gap, `chairs/rooms` unreferenced.
10. Documentation over-claims: USER_GUIDE print-preview claim false; notification combination claim false; logo-on-documents claim false; audit claim of 250 MB PDF cap vs actual 100 MB.

**Medium / hardening**
11. PO receive creates no stock movements (workflow gap); partial receive unsupported.
12. No admin unlock for locked accounts; op-level appointment conflict treats Completed as blocking (SqlRepo frees it) — inconsistent.
13. `payment.record` writes duplicate prep audit rows; `@vitejs/plugin-legacy` + tailwind toolchain dead dev deps; analytics dashboard fine but trend chart minimal; no at-rest DB/backup encryption (threat-model documentation needed).
14. Receipt/80 mm page size absent from print path; Bengali font stack not asserted on printed docs.

## What stays unchanged by policy
- Historical tags/releases v1.0.0–v1.4.0 — not modified.
- v1.3.0 JSON restore + v4→v5 migration engines remain supported (upgrade safety).
- Light-only design; offline-first single-workspace architecture; zero runtime npm dependencies.

## Provenance statement
All baseline claims above were verified during the forensic audit (same day, `docs/V1.4.0_FORENSIC_AUDIT.md`) or re-verified on commit `3ac0305`. Anything not re-verifiable in-session is labeled UNKNOWN in the final release audit, not assumed.
