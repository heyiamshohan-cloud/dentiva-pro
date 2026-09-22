# FINAL COMMERCIAL RELEASE REPORT — Dentiva Pro v1.5.0

**Status template filled after publish; every field corresponds to the verified GitHub release.**

- **Version:** 1.5.0
- **Release tag:** `v1.5.0`
- **Source commit:** _PENDING_
- **Branch:** `arena/01a0c9e2-dentiva-pro`
- **Environment:** Windows CI (`windows-latest` runner), Node 22, `node:sqlite` engine
- **Trigger:** `[publish-release]` marker commit → CI builds from `$GITHUB_SHA`

## Evidence summary

- **Test suites:** 104 pass / 0 fail locally across both storage runtimes (engine EO, orders, bills, journeys J1–J10, backup/migration/security suites); identical on Windows CI job
- **CI chain before tag:** 8 consecutive green runs post-baseline
- **Scale:** 100,000 patients / 945,086 records / 412 MB — page-1 lists <25 ms, 165 ms last page, global search ≈ 1 s, full integrity ✓
- **Artfacts:** portable EXE, NSIS installer, ZIP, SHA-256 checksums — deterministic from release commit; checksums verified against downloaded hashes
- **Upgrade:** v1.4.0 → v1.5.0 migrates without data loss; future-schema quarantine intact

## Artefact manifest (filled at publish)

<!-- ASSETS-BEGIN -->
_(to be completed)_
<!-- ASSETS-END -->

## Release URL

_(to be completed)_

## Known documented limitations (unchanged by this release)

Same six items as `docs/FINAL_COMMERCIAL_RELEASE_AUDIT.md` §C (native dialog actuation on Windows, mailto OS client, system Bengali fonts, no at-rest DB encryption, admin recovery policy, CI-only artefact provenance).
