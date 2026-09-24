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
1. **Product-wide audit sweep (§7) module by module**: Dashboard/Appointments-Day-Week-Month/conflicts/Queue-waitlist/Treatment plans+conversion/Inventory-purchases-negative stock guards/Accounting/Reports(richer patient-code surfaces)/Attachments/Import-export/Notifications/Saved views — verify workflows, errors, perms, persistence, polish; FIX defects on sight (not merely record).
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
NOT YET for v1.6.0 (requires CI runner; §13 explicitly required — no substitution claims from v1.5.2).

## GITHUB / RELEASE STATUS
v1.6.0 NOT tagged, NOT published (per §14). Local HEAD `5b2635a` on `arena/01a0c9e2-dentiva-pro`. PR #2 stale (will update on reconnect).

## NEXT EXACT ACTION
Continue product-wide audit sweep modules 1→4 (Dashboard/Appointments/Queue/Treatments) fixing defects in place; commit; then sweep 5→8 (Clinical/Financial/Inventory/Reports). Do NOT release.
