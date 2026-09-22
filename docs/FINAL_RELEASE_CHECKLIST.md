# FINAL RELEASE CHECKLIST — Dentiva Pro v1.5.0

## Gate evidence (all items verified against live code/runs, not docs)

- [x] All v1.4.0 forensic-audit findings resolved (printing, notifications engine, backup scheduler, audit UI, RBAC, dead settings, docs parity)
- [x] Backend-only features: each decided (custom-fields built; 6 others proven never-in-tree)
- [x] Test suite: **104/104** (`npm test`) on both runtimes; suites include: journeys J1–J10, upgrade-safety, notification engine, backup scheduler (incl. real tick), custom fields, inventory lifecycle, security/print IPC, storage/tamper suites
- [x] Scale benchmark re-run 2026-09-22: 100k patients / 945k records / 412 MB (page-1 <25 ms; backup 1.9 s; integrity ✓)
- [x] Upgrade/restore/migration paths tested (v1.4.0 → v1.5.0 suite; v1.3 JSON import; future-schema quarantine)
- [x] RBAC: roles complete (Administrator, Dentist, Manager, Accountant, Receptionist, Dental Assistant, Cleaner, Other, Custom) + server-enforced perms
- [x] EN/BN localized (570+ dictionary entries; residual scan clean)
- [x] Responsive: 6-viewport CI harness; fixed-grid squeeze eliminated
- [x] No artificial data limits; no demo/placeholder content
- [x] 10 user journeys verified on **both** storage runtimes
- [x] Windows CI: 6 consecutive green runs before release tag
- [x] CHANGELOG v1.5.0 + README + USER_GUIDE parity
- [x] Version bump: package 1.5.0, APP_VERSION 1.5.0, smoke identity pinned

## Publish sequence

- [x] Final commit on `arena/01a0c9e2-dentiva-pro`
- [ ] CI Windows run on final commit: green (tests + build + packaging smoke)
- [ ] `[publish-release]` marker commit → CI creates tag `v1.5.0` + GitHub release (portable EXE, NSIS Setup, ZIP, checksums.txt) with `--target $GITHUB_SHA`
- [ ] Verify release assets exist; re-hash EXEs/ZIP vs published checksums; release URL recorded in FINAL_COMMERCIAL_RELEASE_REPORT
- [ ] Execution-state doc finalised; Baseline statuses closed; forensic corrigendum committed
