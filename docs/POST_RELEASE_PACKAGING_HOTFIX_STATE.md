# POST-RELEASE PACKAGING HOTFIX — EXECUTION STATE (v1.5.1)

Session: hotfix for the v1.5.0 installed-app startup crash + icon. Branch `arena/01a0c9e2-dentiva-pro`.
v1.5.0 (tag `c4ddab8`) is PRESERVED and must never be edited/overwritten.

## Root cause (confirmed, deterministic)
- `electron/lib/records.mjs` (line 6) statically imports `../../src/core.js`; it sits in the
  boot chain (`main → lib/db.mjs:11 → records.mjs`) so the process dies at startup when the
  target is absent.
- v1.5.0 `build.files` = `["dist/**/*","electron/**/*","package.json"]` → electron-builder
  allowed-list excluded the entire `src/**` service layer from `app.asar` (cause E of the
  absence matrix: config-level exclusion). Runtime closure from `electron/main.mjs` +
  `electron/preload.cjs` = 21 repo modules incl. 7 under `src/` — all missing in the asar.
- CI masking mechanism: the workflow invoked `scripts/windows-smoke.ps1 … -PortableOnly`,
  which skips the NSIS install → installed-exe launch phase entirely, so the defect shipped
  green. The user's `Program Files` install then crashed instantly (Node reports the exact
  missing `app.asar/src/core.js` path ⇒ absence, per §3 matrix).

## Evidence boundaries (sandbox)
- GitHub release-asset CDN + Electron-binary mirrors unreachable from the sandbox
  (TLS EOF / fetch failed on `release-assets.githubusercontent.com`, `npmmirror`). Direct
  download of v1.5.0 artifacts + local Windows packaging are BOTH impossible here.
- Deterministic substitutes executed instead: (1) config-level reproduction —
  `tests/packaging.test.mjs` FAILS 2/4 on the v1.5.0 `build.files` and passes 4/4 on the
  fixed config; (2) authoritative verification delegated to Windows CI, which now inspects
  the REAL built asar and launches the REAL installed exe before publishing.

## Fix already applied (this branch)
1. `package.json build.files` += `"src/**/*"`; added `build.executableName: "DentivaPro"`;
   version → `1.5.1`; CHANGELOG v1.5.1 entry.
2. Shared graph walker `scripts/runtime-module-graph.mjs` (single source of truth).
3. `tests/packaging.test.mjs` refactored onto it (4 tests, green; proven red on v1.5.0 config).
4. NEW `scripts/verify-packaged-runtime.mjs` — inspects the actual `app.asar` (explicit path
   or auto-discovered under `release/win-unpacked`) and fails listing every missing runtime
   module / src file; wired as a CI step after packaging.
5. CI workflow hardened: removed `-PortableOnly` (full gate: portable + NSIS silent install +
   installed-exe launch + restart persistence + uninstall); installed `resources/app.asar`
   re-verified before installed launch; job timeout 45 min.
6. `scripts/windows-smoke.ps1` hardened: explicit rejection of
   `ERR_MODULE_NOT_FOUND|ERR_REQUIRE|Cannot find module|Cannot find package|Failed to resolve …`
   in stdout/stderr streams; installed exe lookup tolerant (`DentivaPro.exe`/`Dentiva Pro.exe`);
   `-PortableOnly` kept for local debugging but prints a loud "NOT sufficient for release" warning.
7. `tests/release-gate.test.mjs` upgraded to the stricter hotfix contract (workflow must
   contain asar-verify step, smoke must be full-gate, invocation must not pass `-PortableOnly`).
8. Icon redesigned: `scripts/generate-icon.py` renders a vector tooth mark (mathematically
   centered, teal tile, smile cut) at 1024 + all ICO layers (16/24/32/48/64/128/256, PNG-in-ICO);
   rewrites `public/icon.ico`, `public/icon.png`, `public/icon.svg`; verified by per-size
   per-resolution inspection sheet. manifest declares `1024x1024`.

## Tests run so far (this branch, local)
- `npm test` (node:test all suites incl. new packaging gate): **108 pass / 2 env-skips / 0 fail**.
- Packaging gate directionality: red on v1.5.0 config (2/4), green on fixed config (4/4).
- `verify-packaged-runtime.mjs` fail-path exercised (clean message when asar absent).

## Live status (2026-09-23)
**Core hotfix PROVEN on the installed artifact (CI run 35844145583):**
- asar-closure step ✓ (all 21 runtime modules + 11 src files inside built app.asar)
- portable create + restart-persistence ✓  (module graph boots from asar)
- NSIS silent install ✓ → INSTALLED exe LAUNCHED with **NO ERR_MODULE_NOT_FOUND**
  (its asar also re-verified before launch; DB opened, storageInfo live).
**New gate found a SECOND (previously invisible) issue at installed-verify:**
- `patients navigation was unavailable`, renderer `body:""`, all recordCounts 0 while
  portable phases on the SAME `$userData` passed ⇒ installed exe either saw a fresh
  workspace or the renderer shell died. This is EXACTLY why the gate exists.
- Diagnosis commit `faa6cf3` (LOCAL, unpushed): smoke-only DENTIVA_SMOKE_DIAG
  (userData/dbBytes/migration/main counts) + renderer console/load bridge in
  electron/main.mjs; pwsh-side profile-DB persistency probe before installed launch.

**⚠ EXTERNAL BLOCKER (in effect now):** sandbox GitHub credentials expired mid-session
(gh: "Bad credentials", git push: prompts disabled). `faa6cf3` committed locally,
NOT pushed. Retry auth before next CI iteration; if it stays 401, user must reconnect
GitHub for the sandbox/session.

## Remaining work (in order)
1. Push faa6cf3 (+ any fix) → CI run; read DENTIVA_SMOKE_DIAG + renderer bridge lines;
   root-cause the installed-verify fresh-workspace/blank-renderer state; fix real cause.
2. CI fully green (asar ✓, portable ✓, installed launch+persistence ✓, uninstall ✓).
3. `[publish-release]` marker commit → CI publishes **v1.5.1** (publish refuses existing tags).
4. Verify release/tag↔commit↔assets↔checksums.
5. Write `docs/POST_RELEASE_PACKAGING_HOTFIX_AUDIT.md`; final §18 checklist; closeout.

## STOP CONDITION (user-imposed)
Task is DONE only when the actual installed Windows app launches from the installed location
and the exact `ERR_MODULE_NOT_FOUND` is proven fixed — that proof is the new CI full smoke gate
(same OS, same NSIS silent-install path as the failing report) + the asar closure verification
inside it. Do not declare readiness on unit tests alone.

## Known remaining risks
- Windows icon cache on previously-installed machines may show stale icons until Explorer cache
  rebuild (documented for users; fresh runners/machines unaffected).
- CI runner NSIS silent install path must permit `/S /D=` (it did historically; the script was
  authored for this runner image).
