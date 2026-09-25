# 🦷 Dentiva Pro Flagship Upgrade — Live State (v1.6.0, NOT RELEASED)

## CURRENT PHASE
Phase: **SCOPE-EXPANDED PRODUCT-WIDE AUDIT (§6–§16 correction applied)**. Prescription clinical mandate + Patient Code contract DONE at `5b2635a`. Release is ON HOLD per §14 until product-wide audit + Windows CI validation complete. GitHub token expired (external blocker, §14 acknowledged).

## COMPLETED WORK (cumulative)
- Clusters A–I (patient list aggregates/columns/density, command palette ×7, Patient 360 statement/visits/audit, structured rx builder + templates, double-submit guard, payment hints, settings BMDC/web fields, dental chart FDI+quadrants+primary fix+multi-apply, receipt on doc engine, +52 Bangla strings, aggregate benchmarks 1k→100k).
- §1 Prescription = clinical document: NO financial vocabulary/totals/currency in content — enforced by contract test.
- §2 C/C (Pain On, G. Carries, Swelling, Gum Bleeding, Bad Breath, Sensitivity) & O/E (Carries / G Carries, BDR / BDC, Gingivitis, Parodental Pocket, Perio Dontitis, Pulpitis, Impected Teeth, Dry Socket, Attrition / Erosion) multi-select pickers + Custom/Other; C/C·O/E·R/E·Advice render on preview/print/PDF.
- §3 Prescription header from settings (logo/name/credentials/BMDC/contact) — doc-engine clinicHeader (no hardcoding).
- §4 Patient Code: prefix default DP (DP-000001…), stable across visit/rx/invoice, unique; on list/360/visit-linked rows/rx/invoice/receipt/statement/search; contract test asserts.
- §5 Receipt: Received/Refunded/Net + Remaining Due (when invoice-linked) + Received-by; document semantic separation kept in UI/data/rendering.
- Forensic doc render test: 40 med rows, long Bengali names, mixed scripts, multipage-safe CSS.
- Benchmarks: 1k/10k/25k/100k green; aggregate list p1 2.3–39.8ms; statement 0.6ms; backup 323ms @25k.

## REMAINING WORK
1. **Product-wide audit sweep (§7) module by module** — IN PROGRESS. DONE: dead-action registry diff (62 UI actions × handler cases → 1 dead fixed: `open-attachment-add`); UI op()/q() references × server registries = all defined; appointment double-booking guard (warn→confirm) VERIFIED server-side; negative-stock movement guard VERIFIED. DONE batch 2: plan-conversion clinical-only VERIFIED; attachment client+server validation VERIFIED; Bangla picker/receipt strings; §4 reports show name+DP-code everywhere (patients report explicit Code column). Two Windows CI builds in flight (75576f1, 2be9e9f). GitHub RECONNECTED ✓ pushed through c34592d..latest.
2. **§10 printed-forensic pass** on Invoice/Receipt/Statement parity with the new contract tests (long names, many rows, Bengali, multipage) + visual print smoke when CI available.
3. Bengali audit re-run over newest strings (picker labels, receipt additions).
4. Windows CI validation of the NEW v1.6.0 build (§13): install→launch→login→patient workflow→360→rx→invoice→receipt→PDF→persistence→restart→upgrade→uninstall→reinstall.
5. Release sequence after user reconnection+«Continue»: push, PR #2, CI green proof, artifacts (NSIS+portable+ZIP+SHA-256), tag v1.6.0, publish (v1.5.x intact), final audit close.

## OPEN FINDINGS
- F-AUTH-1 (external): GH_TOKEN invalid — push/CI/release blocked until Arena GitHub reconnection. NOT a product defect.
- F-BENCH-1: none open.

## TEST STATUS
`npm test`: **133 tests · 131 pass · 0 fail · 2 skipped (manual benchmarks)** — Node 22.22.3.
New: tests/patient-code-contract.test.mjs (3 contract + forensic render tests).

## WINDOWS VALIDATION STATUS
✅ CI run 36027991625 (commit 2be9e9f) — Windows runner completed: tests+build, Chromium viewport checks, portable+NSIS build, ASAR module-closure verification, PE artifact verification, **installed-app smoke 12/12** (launch→login→patient render→backup→restart→persistence ok, DB 576KB migration=current), release package assembly with SHA-256 verification loop. Evidence artifact Dentiva-Pro-82-windows-smoke-evidence uploaded (local re-download blocked by sandbox Azure EOF — documented infra limitation, not a product defect).

## GITHUB / RELEASE STATUS (supersedes earlier)
GitHub RECONNECTED (token valid). Branch pushed through merge 75576f1 + batch 2. Parallel v1.5.1/v1.5.2 published line merged; tags v1.5.0/v1.5.1/v1.5.2 untouched. v1.6.0 ✅ PUBLISHED 2026-09-24T16:51:49Z via CI run 36029590185 (Windows gate green, installed-app smoke 12/12) — https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.6.0 · tag → commit f29f6f2 · assets: NSIS Setup, portable exe, ZIP, checksums.txt (SHA-256 verified in-pipeline). Prior releases v1.3.0–v1.5.2 confirmed untouched. Local asset re-download from this sandbox blocked by Azure-EOF (infra-only limitation; integrity was verified inside CI).

## PROJECT STATE: COMPLETE (release gate passed). See docs/FLAGSHIP_UPGRADE_AUDIT.md and CHANGELOG.md.

## GITHUB / RELEASE STATUS
v1.6.0 NOT tagged, NOT published (per §14). Local HEAD (pending this sweep batch) on `arena/01a0c9e2-dentiva-pro`. PR #2 stale (will update on reconnect).

## NEXT EXACT ACTION
Continue product-wide audit sweep modules 1→4 (Dashboard/Appointments/Queue/Treatments) fixing defects in place; commit; then sweep 5→8 (Clinical/Financial/Inventory/Reports). Do NOT release.

## 15. v1.6.1 polish checkpoint (2026-09-24)

**Scope**: user mandate sections A–H landed on top of published v1.6.0 (never overwritten).

**Delivered locally (all pushed until token expiry):**
1. Installed-app DOCUMENT WORKFLOW verification: `smokeDocs()` phase in electron/main.mjs (DENTIVA_SMOKE_PHASE=docs) drives the REAL UI (PIN sign-in → ops seed patient/visit/18-line invoice/bKash payment → rx builder → preview → `print:html` PDF) and produces 7 PDFs (rx A4+A5, invoice A4+Letter, receipt 80mm+A5, statement A4) with smoke-only tmpdir bypass at main.mjs:384. windows-smoke.ps1 wires it after installed-verify, prints `DOCS-PDF <name> <bytes>` and uploads PDFs to the `windows-smoke-evidence` artifact.
2. Prescription money-leak regression test strengthened (content-scoped forbidden tokens incl. the Taka sign / doc-totals / Payment method / Money receipt) + positive identity asserts.
3. Playwright screen-audit suite (4 tests × 6 viewports): patients list, command palette, Patient 360, prescription builder.
4. Version 1.6.1 (package.json, migrate-state, README) + CHANGELOG entry.

**Real product defects found by the audit and fixed (root cause, product-side):**
- D1: Ctrl+K palette opened EMPTY until first keystroke → instant Actions pre-render (src/main.js handleKeydown).
- D2 (critical): Patient 360 unreachable — the v1.6.0 list rewrite dropped the `ui.patientId → renderPatientProfile()` branch in renderPatients (row/View clicks did nothing).
- D3: Sidebar "Patients" never cleared profile context (profile stuck forever); added explicit "All patients" back button on the profile.
- D4: premium glass backdrop for Sign-In / Lock screens (auth screens were the only unfollowed design-system surface).

**CI history**: run 36036246065 — 4 of 6 audit tests green; 36037591332 — all but tag-filter→profile-routing (then fixed). Latest run 36039103674 (auth-polish commit) — outcome unknown: **GitHub token expired mid-run (HTTP 401) while it was in progress.**

**BLOCKER (external)**: GitHub authentication expired in the sandbox (gh 401 Bad credentials; git push fails). Until the user reconnects GitHub in Arena: cannot watch CI, cannot publish v1.6.1. Local commit "polish: premium glass auth backdrop" (1.6.1+1 commit) awaits push as soon as auth returns. Pending after reconnect: (1) push, (2) watch CI green (visual stage → build → docs marks → publish via existing [publish-release] markers), (3) verify DOCS-PDF lines + 7 PDFs in artifact, (4) confirm v1.6.1 release (tag + 4 assets), (5) finalize audit ledger entries D5-F closure → final verdict.

## 16. v1.6.1 screen-audit loop status (2026-09-24, second pass)

**Audit-caught defects fixed since §15:** D5 — four patients-toolbar buttons (Advanced/Columns/density/Clear) were stranded in `handleChange` instead of `handleClick` → 100% dead clicks in v1.6.0 (confirmed by the tag-filter failure across 3 CI runs). D6 — `patientFinancialSummary` now returns honest zeros in the web-preview adapter so the Patient 360 finance strip always renders. Additional selector fix: statement print action is `print-patient-statement` (the phantom `export-patient-statement-pdf` had no rendered button — smokeDocs + visual test corrected).

**Gate progression (head commits):** patients list ✅ → command palette ✅ → patients-list held ✅ across last 3 runs. Remaining red: Patient 360 (.patient-sub never in DOM after create — code path reads correct; dump-in-error diagnostics pushed to surface CI DOM) and rx builder (90s timeout on runner; step diagnostics added).

**Environment ceilings hit (recorded, not retried):** Azure blob + results-receiver hosts are firewall-reset (artifact screenshots/traces + raw job logs unreachable); Playwright Chromium CDN blocked (no local visual repro); console.* output absent from `gh run view --verbose` folded output.

**GitHub auth blocker #2:** token expired again ~40 min after reconnect (401 on all gh/git at this point) with the diagnostics commit already pushed. Outcome of run 36045953943 diagnostics unread. On reconnect: read 360-DUMP/RX-DUMP errors → surgical fix → green CI → Windows build → docs-phase marks → v1.6.1 tag+assets → final ledger.

## 17. Docs-phase walkthrough (2026-09-24; auth blocker #4 pending)

Lines of verified progress on the installed Windows app (head = probe+D8-fix chain):
- Visual suite ALL GREEN ×6 viewports (patients/palette/360/rx stages 1-3).
- docs-patient (patient created via REAL UI, code on profile ✅), docs-rx-filled, docs-rx-content-ok ✅ (identity + C/C/O/E/R/E + meds + Бангla, money-free), docs-rx-pdf-a4/a5 ✅, docs-invoice-content-ok ✅, docs-invoice-pdf-ok (A4+Letter) ✅.
- Fixed en route: D9 (rx-preview identity store-fallback), node:os import for smoke-PDF bypass, smoke rollback recovery (local .git rolled back to 50b86e7 — remote chain verified intact at 93d166c and restored), version bump 1.6.1 re-applied, invId anchored to create response (PUSH PENDING — auth expired #4).
- Remaining known step: receipt 'Remaining due' (fix committed locally, awaiting push), then statement + DOCS-PDF bytes + tag v1.6.1.

## 18. v1.6.1 RELEASED (2026-09-25, run 36093866550 — conclusion: success)

**Release**: tag `v1.6.1`, Latest, 4 assets — Setup.exe (100,723,326 B), portable .exe (100,486,725 B), .zip (201,240,906 B), checksums.txt (309 B). v1.6.0 preserved as previous line.

**Full verification matrix on the NEW build (installed Windows app, CI windows-latest):**
- Visual screen-audit suite: 6 viewports × (patients list / palette / Patient 360 / rx stages 1-3) — all green.
- smokeDocs marks: docs-patient → docs-rx-filled → docs-rx-content-ok (identity DP-code, C/C+O/E mandated chips, R/E, Advice, 2 med rows, Bengali, money-free) → docs-rx-pdf-a4/a5 → docs-invoice-content-ok (18 rows + discount + Bengali) → docs-invoice-pdf-ok (A4+Letter) → docs-receipt-content-ok (bKash ref, remaining-due row) → docs-receipt-pdf-ok (80mm via @page retry + A5) → docs-statement-content-ok (opening balance, patient code) → docs-statement-pdf-ok (A4). 7 PDFs in `windows-smoke-evidence/document-pdfs/`.

**Defect ledger closed (10 product defects found by the audit, all root-fixed):**
D1 palette-empty-on-open · D2 Patient 360 unreachable · D3 profile-sticky nav · D4 auth polish · D5 four dead patients-toolbar buttons · D6 360 finance-strip fallback · D7 renderPatientTab ReferenceError · D8 print-preview ignored docSpec (blank-document previews) · D9 rx-preview identity fallback · D10 buildDocument totals object-to-[object Object] (receipts dropped totals rows). Infrastructure fixes: node:os smoke-PDF import, Receipt80 custom-page printToPDF retry, Playwright prebuilt_preview webServer, .git snapshot-rollback recovery (remote history restored intact), v1.6.1 version-bump re-application.
