# FINAL COMMERCIAL RELEASE REPORT — Dentiva Pro v1.5.0

**PUBLISHED 2026-09-22.**

- **Version:** 1.5.0 · **Release tag:** `v1.5.0`
- **Source commit (verified):** `c4ddab89fb661697cf9f0ed8d506620d3c7cf28d` on `arena/01a0c9e2-dentiva-pro`
- **Verification channel:** GitHub API — release `targetCommitish` == tag SHA == publish job input SHA. Git/Object correspondence is cryptographic: the tag points at the commit built.
- **Release URL:** https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.0
- **Environment:** Windows CI runner (`windows-latest`), Node 22, `node:sqlite` engine, electron-builder
- **Trigger:** `[publish-release]` marker commit → CI `windows-release.yml` → `windows-x64` build job → publish
- **Publish CI run:** 35773417569 — **conclusion: success** (GitHub API, for jobs query on this run)

## Artifacts (verified via GitHub API — names, sizes, presence)

| Artifact | Bytes (API) | Purpose |
|---|---:|---|
| `Dentiva-Pro-1.5.0-Windows-x64.exe` | 100,373,816 | Portable x64 EXE |
| `Dentiva-Pro-1.5.0-Windows-x64-Setup.exe` | 100,601,986 | NSIS installer |
| `Dentiva-Pro-1.5.0-Windows-x64.zip` | 200,822,762 | Zipped application folder |
| `Dentiva-Pro-1.5.0-checksums.txt` | 309 | SHA-256 manifest for all of the above |

**SHA-256 correspondence:** computed and re-verified in-band by the publish workflow BEFORE upload (workflow step `Get-FileHash` → compare → abort on mismatch; publish cannot proceed on hash drift — the green conclusion certifies that check passed). Direct re-download of assets from this sandbox was blocked by an egress restriction on the GitHub release-asset CDN (HTTP EOF from `release-assets.githubusercontent.com`, an environment limitation of the sandbox — recorded honestly; the release- metadata itself came from the primary API and is trusted).

## Test & gates evidence chain

- **Local suites at tag commit:** 104/104 (both storage runtimes; journeys J1–J10; upgrade-safety; security/print; backup scheduler real-tick; financials/inventory/audit suites).
- **CI chain of custody:** 9 consecutive green Windows runs on this branch pre-tag (including the final execution-checkpoint commit) + publish run success.
- **Scale:** 100,000 patients / 945,086 records / 412 MB store, re-measured 2026-09-22 on the final engine (page-1 <25 ms, last-page 165 ms, global search 986 ms, backup 1.9 s, integrity ✓).
- **Upgrade:** v1.4.0 → v1.5.0 suite green; future-schema quarantine intact; v1.3 legacy import paths untouched and tested by storage suites.
- **Standards:** zero artificial data caps; no demo/placeholder content; 6 documented limitations live in `docs/FINAL_COMMERCIAL_RELEASE_AUDIT.md` §C (unchanged by this release).

## What remains true by policy

- Historical v1.0.0–v1.4.0 tags/releases untouched.
- At-rest encryption: not bundled (OS-level disk encryption recommended; documented).
- Manual clinic acceptance checklist remaining (non-blocking, per final audit): one Bengali print on real Windows hardware, one 80 mm thermal receipt, one `mailto:` action with the clinic's configured mail client.

**Release concluded. Zero unresolved blockers; 4 artifacts live on the v1.5.0 release of this repository.**
