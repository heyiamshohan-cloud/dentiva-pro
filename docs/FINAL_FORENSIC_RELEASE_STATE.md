# FINAL FORENSIC RELEASE — EXECUTION STATE (post-v1.5.1 line)

**Current version:** 1.5.1 (tag `v1.5.1` → `b630c18`, published). **Target:** next SEMVER (decided at closeout from actual fix scope — default 1.5.2 unless scope ⇒ minor).
**Branch:** `arena/01a0c9e2-dentiva-pro` · **Checkpoint of record:** this file · **Final report:** docs/FINAL_FORENSIC_AUDIT.md

## Phase map
- [x] P0 Kickoff: baseline inspected (HEAD `ee28e9e` = v1.5.1 closeout; tree clean; GitHub auth OK)
- [ ] P1 Forensic baseline: architecture census + placeholder/dead-code sweep + marker scan
- [ ] P2 Static forensics: Electron security/IPC/settings/docs/deps/licenses sweep
- [ ] P3 Logic suite hardening: reproduce any real defect found → fix → regression test
- [ ] P4 Scale/performance verification (dataset benchmarks on this engine)
- [ ] P5 Version bump + CHANGELOG + full regression + CI green (incl. full installed-app gate)
- [ ] P6 Publish new release (new tag, artifacts, SHA-256, evidence), verify tag↔commit↔assets
- [ ] P7 Final audit doc complete (A–Z sections) + this checkpoint closed
- [ ] P8 FINAL RESPONSE (§48 format)

## Known environment constraints (carried + enforced in report)
- Sandbox cannot reach GitHub asset CDN / binary mirrors → installed-app verification delegated to the Windows CI full-gate (NSIS install→installed-asar verify→launch→persistence→uninstall), plus `npx asar` closure inspection locally. Artifacts verified in-job before publish; hashes published with release.
- Playwright browsers cannot be installed in-sandbox → visual lane executes on Windows CI only.
- GitHub auth token has ~45 min TTL; commit+checkpoint continuously.

## Findings ledger (id, area, status: OPEN/FIXED/DOCUMENTED)
_(populated during P1/P2; each entry lands in FINAL_FORENSIC_AUDIT.md with root cause/fix/proof)_

## Latest CI / last verified commit
- v1.5.1 publish run 35859723467 = SUCCESS (full installed-app gate). Local `npm test` = 109 pass/0 fail at `ee28e9e`.

## Next exact action
P1: full inventory scan (files/LOC/markers/dead-code candidates/IPC surface) → append baseline to audit doc → commit checkpoint.


## Final outcome (2026-09-24)
- Release: **v1.5.2** published at https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.2; tag → commit `8c3dfbc`.
- CI: dry-run full gate 35975694430 SUCCESS → publish run 35976484928 SUCCESS (all gate steps green incl. portable AND installed smoke with install/launch/persistence/restart/uninstall).
- Artifacts: NSIS 100,685,098 B · portable EXE 100,448,597 B · ZIP 201,163,087 B · checksums 309 B. Prior releases untouched.
- Fixes: F1 dateFormat implemented; F2 bootstrap session guard; F3 APP_VERSION drift fixed + anti-drift contract; F4 sw.js removed; F5 print:html predictable errors; F6 strict dependency gate. Final audit: docs/FINAL_FORENSIC_AUDIT.md (A–Z, all sections statused, no TODOs).
- Checklist complete — no remaining work in this task.
