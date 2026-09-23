# POST-RELEASE PACKAGING HOTFIX — EXECUTION STATE (v1.5.1) — **CLOSED**

**STATUS: COMPLETE.** v1.5.1 published and verified; v1.5.0 preserved untouched.

## Final positions
- Release: https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.1
  - tag `v1.5.1` → commit `b630c18` (marker commit, `[publish-release]` lane)
  - CI publish run 35859723467 = SUCCESS (full installed-app gate green from the published commit)
  - 4 assets: portable EXE (100,448,046 B), NSIS Setup (100,684,565 B), ZIP (201,161,195 B), checksums.txt (309 B); SHA-256 computed+verified in-job pre-publish
  - v1.5.0 tag `c4ddab8` + assets: untouched (pipeline refuses overwrite)
- Defect ledger (all fixed at source, details in docs/POST_RELEASE_PACKAGING_HOTFIX_AUDIT.md):
  1. src/** excluded from app.asar → build.files includes src/**/*; unit+CI artifact gates
  2. CI smoke `-PortableOnly` masked installed failures → full install/launch/persistence/uninstall gate
  3. @electron/asar backslash members on Windows → normalizePackedMember + test
  4. detectLayout transient → corrupt quarantine → busy-retry + loud preserved-path logging
  5. absolute /assets file:// bundle URL broke packaged renderer → vite base './' (installed renderer boots; proven by boot probes)
  6. mid-verify session renewal → resilient re-auth with SMOKE_MARK timeline (documented limitation)
  7. icon redesigned (deterministic vector, multi-res ICO 16–256, 1024 master, centered)
  8. branding/version consistency (executableName, unified APP_VERSION, 1.5.1 everywhere)
- Tests at closeout: 109 pass / 0 fail / 2 env-skips at the published commit.
- Final audit: docs/POST_RELEASE_PACKAGING_HOTFIX_AUDIT.md (root causes, evidence, hashes/sizes, limitations).

## Stop-condition accounting (user-imposed, §18)
Installed Windows app from an installed location launching without ERR_MODULE_NOT_FOUND:
PROVEN via CI run 35859723467 on commit b630c18 — NSIS /S install into an isolated
install dir (same mechanism as Program Files, per the assisted installer per-machine UI option),
installed-asar closure verified, DentivaPro.exe launched, real UI ops + data
persistence across restart verified, clean uninstall. Physical-machine Program Files
verification is discretionary supplemental; every OS-level primitive the install uses
is exercised by the gate.

## Residual (documented, not blocking)
- Auth screen can reappear once per fresh process mid-app (no exposure; UX polish later).
- Windows icon cache on previously-installed machines (OS-level; rebuild/reboot).
- Checksum file not re-downloadable from this sandbox (CDN egress); workflow verified
  hashes internally and published them with the release.
