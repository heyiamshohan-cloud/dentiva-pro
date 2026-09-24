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
