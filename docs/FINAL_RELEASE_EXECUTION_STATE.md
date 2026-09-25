# FINAL RELEASE — EXECUTION STATE (authoritative continuation checkpoint)

## Current phase
✅ RELEASE COMPLETE — v1.5.0 published from verified commit c4ddab8. All fix work complete + documented; waiting for CI green on tip; then `[publish-release]` marker commit which tags v1.5.0 and publishes the GitHub release from that SHA.

## Completed phases
- Phase 0 — Preserve & audit
- Phase 1 — All v1.4.0 forensic blockers closed (printing / notifications engine / auto-backup scheduler / Activity log / RBAC incl. expenses live-bug / dead settings)
- Phase 2 — Backend-only feature resolution (custom fields built; 6 proven absent; corrigendum committed)
- Phase 3 — Consistency & polish: appointment↔visit lifecycle + Start-visit; movement ledger; idle lock; i18n sweep (+130 strings); queue responsive fix; 100,000-patient benchmark re-measured on final engine; 10-journey both-runtime contract tests; v1.4.0→v1.5.0 upgrade-safety tests; version bump v1.5.0 (package/APP_VERSION/smoke pin); CHANGELOG/README/docs parity; FINAL_COMMERCIAL_RELEASE_AUDIT.md (zero unresolved critical; 6 documented limitations); FINAL_RELEASE_CHECKLIST.md; baseline resolution tracker.

## Current task
Publish gate.

## Current file/component
.github/workflows/windows-release.yml (marker commit); docs/FINAL_COMMERCIAL_RELEASE_REPORT.md (to be filled post-publish).

## Last successful command
git push ea90ed9 (docs closeout); npm test = 104 pass / 0 fail; CI history: runs for print/notifications/backup/audit/custom-fields/i18n/corrigendum all SUCCESS.

## Last failed command
CI status of tip run in progress at checkpoint write time.

## Failure reason
—

## Fix already attempted
—

## Next exact action
1. `gh run list` → confirm both tip runs (35770586036, 35770931957) green.
2. Commit empty `[publish-release]` marker → push → watch run until publish step done.
3. `gh release view v1.5.0 --json assets,url` → verify 4 artefacts + checksums correspondence.
4. Fill docs/FINAL_COMMERCIAL_RELEASE_REPORT.md (commit SHA, tag, artefacts, SHA-256s, release URL) → commit + push (non-marker).
5. Final `npm test` + `gh run list` re-verify; close checklist publish boxes.

## Tests already passed
- 104/104 node:test suites (60 inherited + notifications 7 + scheduler 3 + audit 6 + journeys 10 + custom-fields + RBAC + upgrade 4 + lifecycle 1).
- Windows CI: 6 consecutive green on the branch before tag.
- Scale: 100k patients / 945,086 records, page1 < 25 ms, integrity ✓, re-run 2026-09-22 on the final engine.

## Tests still required
Windows CI on the marker commit (includes packaging smoke + publish).

## Packaging status
Portable EXE + NSIS Setup + ZIP + checksums produced by CI publish step only; gate: `[publish-release]` in commit message (or workflow_dispatch). Not yet triggered.

## Release status
**PUBLISHED** 2026-09-22 — tag `v1.5.0` at `c4ddab89fb661697cf9f0ed8d506620d3c7cf28d`, 4 artifacts (portable EXE, NSIS Setup, ZIP, checksums.txt), URL https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.0. Publish run 35773417569 = success. SHA verification performed in-band by workflow pre-upload; sandbox CDN download limitation documented in the release report.

## Known remaining risks
- Historical v1.4.0 artefacts on GitHub remain as-is by policy (untouched).
- MANUAL follow-up recommended on real clinic hardware: one Bengali print, one 80 mm receipt (fonts/OS variations; documented in audit limitations).

## Work log (append most recent at bottom)
- 2026-09-22: v1.4.0 import; CI trigger widened; baseline docs; first green CI after i18n/corrigendum commits; sandbox crash + recovery (tip restored from origin hash-identity; fetchspec fix).
- 2026-09-22 19:00Z: suites 104/104; journeys & upgrade tests in repo; v1.5.0 bump; docs closeout pushed (ea90ed9); publish gate armed.
- 2026-09-22 20:30Z: RELEASE CUT — marker commit c4ddab8 → CI publish green → v1.5.0 live with 4 artifacts; report/checklist closed; execution state finalized.
- 2026-09-23: POST-RELEASE CLOSEOUT — dependency/license review completed (`docs/LICENSING.md`): zero runtime npm deps, zero copyleft in 311-package tree, attribution verified via electron-builder default layout + CI ZIP gate; dead dev-dep `@vitejs/plugin-legacy` + ~130 babel-transitives removed; final audit §E appended (license gate PASS). Local suites 104/104; CI chains: release-report run green, deps-hygiene run 35775625067 SUCCESS. Final tip 7dd6a78. Workspace clean. No items outstanding; release line v1.5.0 stands.
