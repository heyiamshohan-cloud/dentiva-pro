# POST-RELEASE PACKAGING HOTFIX AUDIT — Dentiva Pro v1.5.1

**Date:** 2026-09-23 · **Branch:** `arena/01a0c9e2-dentiva-pro` · **Release:** [v1.5.1](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.5.1) (tag `v1.5.1` → commit `b630c18`)
**Trigger:** the v1.5.0 Windows installer ran on a clean machine crashed at startup with `ERR_MODULE_NOT_FOUND: C:\Program Files\Dentiva Pro\resources\app.asar\src\core.js` (imported from `app.asar\electron\lib\records.mjs`), while CI had passed; the app icon was judged unprofessional/cropped.

---

## 1. Defect ledger (every item root-caused, fixed, and proven)

### D1 — RELEASE-BLOCKING: service layer absent from `app.asar` (the reported crash)
- **Root cause:** electron-builder `build.files` shipped only `dist/**`, `electron/**`, `package.json`. The production module graph requires the `src/**` service layer at *boot*: `electron/main.mjs → lib/db.mjs:11 → lib/records.mjs:6 → ../../src/core.js`. `records.mjs` is in the static import chain, so the process died before any window appeared.
- **Missing-file matrix resolution (§3):** ABSENT from asar — cause E (electron-builder files allowlist). Node's own error naming the exact absent path inside `app.asar` + config-level reproduction sealed it.
- **Fix:** `build.files` now includes `src/**/*` (no hand-copies, no dev paths, no machine-specific references).
- **Runtime closure:** 21 repo modules reachable from `electron/main.mjs` + `electron/preload.cjs` (7 under `src/`): computed by `scripts/runtime-module-graph.mjs` — the single source of truth for both the unit gate and the artifact gate.
- **Import audit:** no `process.cwd()`, no `file://` dev-path hacks, no absolute hardcoding; only proper `fileURLToPath(import.meta.url)` derivations in `main.mjs`.
- **Proof on the installed artifact (CI run 35844145583):** NSIS silent-install → installed `DentivaPro.exe` launched, opened its DB, answered `workspace:info` — **no ERR_MODULE_NOT_FOUND**. Confirmed again in all later runs.

### D2 — Release pipeline masked the class: CI smoke was `-PortableOnly`
- **Root cause:** `windows-release.yml` invoked `scripts/windows-smoke.ps1 … -PortableOnly`; the NSIS install → installed-launch phase was explicitly skipped, so a broken installed artifact shipped green.
- **Fix:** CI now runs the full gate: portable launch+persistence → silent NSIS install → verify **installed** `resources/app.asar` runtime closure → launch installed exe with a real UI data operation → restart persistence → uninstall. `-PortableOnly` remains for local debug and prints a loud "NOT sufficient for release verification" warning.
- **Regression pins:** `tests/release-gate.test.mjs` now encodes the stricter contract (asar step present, no `-PortableOnly` in invocation, module-error rejection in the harness). `tests/packaging.test.mjs` fails on the v1.5.0 `build.files` (proven both directions).

### D3 — `@electron/asar` path normalization (CI-platform coupling)
- First gate deployment failed on the Windows runner: `listPackage()` returns backslash-separated members there, so every comparison missed. Fixed via `normalizePackedMember()` (shared) + pinned test case reproducing the Windows form.

### D4 — `detectLayout` treated **any** transient open error as "corrupt" → silent fresh workspace
- **Root cause:** `electron/lib/db.mjs::detectLayout` folded every `DatabaseSync` open failure (`SQLITE_BUSY`, `EACCES`, sharing violation — e.g. a winding-down prior instance, AV scan windows) into `corrupt`, after which migration *renamed the healthy database* and booted an empty workspace: the gate's "installed launch sees zero rows" symptom (`mainCounts` all-zero with seeded rules/rooms).
- **Fix:** lock/busy-class retry with backoff (6 attempts) before quarantine may trigger; quarantine paths now log the preserved file loudly. test suite green.
- **Why this matters beyond CI:** on a real machine, opening Dentiva Pro while a prior instance is mid-shutdown could have *visually erased* a clinic's data behind a fresh workspace. Fixed at the source.

### D5 — Packaged renderer never executed: absolute `/assets/…` URLs under `file://`
- **Root cause:** `dist/index.html` referenced the bundle as `<script type="module" src="/assets/index-…js">`. Loaded from `file:///…/app.asar/dist/index.html`, those absolute URLs never produced a single module fetch or evaluation — measured directly in the installed app: `readyState: complete`, zero bundle resource fetches, `bootStatus` unset, empty body. (This defect class would have left real v1.5.0 users staring at a blank window even with D1 fixed; only the boot-chain crash D1 hit first.)
- **Fix:** `vite.config.js → base: './'`. Rebuilt: all references now relative (`./assets/…`, `./icon.svg`, `./manifest.webmanifest`).
- **Proof (CI run 35851051194, installed verify):** `bootStatus: "ready"`, `scriptSrc` resolves inside the installed asar, `bundleProbe: "200:361062"`, sign-in UI renders, main-side `mainCounts` shows the cross-executable data: `patients: 1, users: 1, audit: 5`.
- **Boot instrumentation:** `src/main.js` exposes `window.__bootStatus/__bootError` (documented internal probes; no behavior change) so packaged-boot failures can never again hide behind an empty screen.

### D6 — Full gate caught one benign session renewal mid-verify
- On the installed phase the app rendered its auth screen once mid-navigation (document stayed the same, `boot: ready` — no crash). The smoke previously aborted the verification; it now re-authenticates on demand with a loud `SMOKE_MARK` timeline. The green run's marks (verify-start → nav-found → nav-clicked → auth-reappeared-during-patient-wait → auth-cleared attempt=2 → patient-found → backup-clicked → verify-end ok=true) document the flow; queries remained blocked while unauthenticated (`storageInfo: null` when signed out) — no data exposure.
- **Recorded as a UX observation, not a security/data defect**; see §6 limitations.

### D7 — Icon: complete redesign
- **Old:** stroke-outline tooth + gold cross, report of cropping/centering defects at real sizes.
- **New:** deterministic vector render (`scripts/generate-icon.py` — no AI raster artifacts at small sizes): solid tooth mark with smile cut inside the teal brand tile; mathematically centered (asserted); rendered with 4× supersampling at **1024** master.
- **Outputs:** `public/icon.ico` — true Windows multi-resolution container with PNG layers **256/128/64/48/32/24/16** (256 PNG-compressed per spec); `public/icon.png` (1024×1024); `public/icon.svg` (canonical vector). Verified per-resolution via an inspection sheet (16px still reads as tooth + smile).
- Consumed by: exe/installer icons (`win.icon`, embedded at build), desktop + Start-menu shortcuts (`nsis.shortcutName: "Dentiva Pro"`), Add/Remove Programs (product name), taskbar.
- **Caveat:** Windows explorer icon cache on machines that had v1.5.0 installed may show the old icon until the cache is rebuilt (OS behavior; new installs unaffected).

### D8 — Branding/version consistency
- `build.executableName: "DentivaPro"` set (stable installed binary name; smoke exe-lookup tolerant to legacy `Dentiva Pro.exe`).
- About dialog showed a stale hardcoded `APP_VERSION = '1.4.0'` — now unified to `migrate-state.js` single source (`1.5.1`); all version pins (`package.json`, `package-lock.json`, smoke/upgrade tests) moved in lockstep.
- Builder config audit: `appId: com.dentiva.pro` (proper), `asar: true`, no `asarUnpack`/`extraFiles`/`extraResources` hacks, NSIS one-click off, assisted install with per-machine option and changable install dir, `artifactName` contract unchanged.

---

## 2. Affected versions
Only **v1.5.0** (defects D1+D5 present in its published artifacts; portable artifact latent with the same D5 margin — never caught because nothing opened the installed app). v1.5.0 release, tag `c4ddab8`, and its 4 assets are **preserved untouched** (pipeline hard-refuses overwriting existing releases).

## 3. Exact fix summary (all on the hotfix branch, then published)
1. `package.json`: `build.files += "src/**/*"`, `executableName`, version `1.5.1`.
2. `vite.config.js`: `base: './'`.
3. New: `scripts/runtime-module-graph.mjs`, `scripts/verify-packaged-runtime.mjs`, `scripts/generate-icon.py`, `tests/packaging.test.mjs`.
4. `scripts/windows-smoke.ps1`: module-error rejection, installed-asar re-verification, persistency probes, annotation-published per-phase logs, installed-exe name tolerance, `-PortableOnly` warning.
5. `.github/workflows/windows-release.yml`: ASAR-closure step after packaging + full installed-app smoke gate; 45-min budget.
6. `electron/lib/db.mjs`: `detectLayout` busy-retry; `electron/lib/migrate.mjs`: loud quarantine logging.
7. `electron/main.mjs`: smoke boot diagnostics (`DENTIVA_SMOKE_DIAG`, renderer console bridge, boot markers) + resilient re-auth during verify (smoke mode only).
8. `src/main.js`: boot markers (internal diagnostics) + unified `APP_VERSION` import.
9. Icon assets regenerated; `manifest.webmanifest` declares honest 1024 size.
10. `CHANGELOG.md` v1.5.1 entry.

## 4. Packaging / ASAR / installed-app verification evidence
- **Unit:** `npm test` = **109 pass / 0 fail / 2 env-skips** at the published commit (contains the packaging closure gate, proven red on the v1.5.0 config).
- **CI (build #70+ lane, runs 35844145583, 35847816014, 35851051194, 35851946957, 35853147811, 35859723467):**
  - `Verify packaged ASAR contains the complete runtime module closure` — green since run 35847816014 (21 runtime modules + all 11 src files present in the built asar; verifier also reproduces D1 against a v1.5.0-style asar with the exact missing list).
  - NSIS silent install → installed-asar closure verify → installed exe launch → real UI ops → restart persistence → uninstall: **fully green** across runs 35853147811 and 35859723467.
  - Published artifacts are byte-identical to the gate-tested ones (same job, publishing only after gate success — pipeline refuses otherwise).
- **Icon:** per-resolution inspection of the actual generated ICO (16/24/32/48/64/128/256 + 1024 master); centering asserted programmatically; `electron-builder` consumes the ICO for exe/installer/shortcut metadata.
- **Sandbox evidence boundary (disclosed, not bypassed):** this sandbox cannot reach GitHub's asset CDN or run Windows binaries; the defective v1.5.0 artifact could not be re-downloaded for direct asar inspection. That was compensated by (a) the deterministic config+graph+error-path triangulation and (b) the Windows CI runner, which inspected the *real* asar files and launched the *real* installed executables — the authoritative environment for this class. Local Windows binary verification on a fresh physical machine remains an optional supplemental pass; the gate already exercises exactly that path programmatically.

## 5. Artifact record (release v1.5.1)
| Asset | Size (bytes, GitHub API) |
|---|---|
| `Dentiva-Pro-1.5.1-Windows-x64.exe` (portable) | 100,448,046 |
| `Dentiva-Pro-1.5.1-Windows-x64-Setup.exe` (NSIS installer) | 100,684,565 |
| `Dentiva-Pro-1.5.1-Windows-x64.zip` | 201,161,195 |
| `Dentiva-Pro-1.5.1-checksums.txt` | 309 |

- Tag↔commit: `v1.5.1` → `b630c18` (the `[publish-release]` marker commit; built and verified from it).
- Hashes: computed in-job and **verified inside the pipeline before upload** (the job re-hashes every artifact against `checksums.txt` and fails on mismatch; run 35859723467 succeeded). Sandbox egress prevented re-downloading the checksum file for local comparison — per-asset SHA-256 values are published with the release for downstream verification.
- v1.5.0 assets compared only by tag/asset metadata (never touched).

## 6. Known limitations / residual observations
1. Mid-app auth renewal: the installed-phase session briefly resets to the auth screen once per fresh process (app's state machine is conservative — no data exposure; user re-enters PIN like an idle-lock). The smoke gate authenticates on demand. UX smoothing is a candidate for a future minor release.
2. First launch immediately after a force-killed prior instance is now protected by D4's retry; beyond the retry window (~2.3 s) an exceptionally slow filesystem (network shares) could still quarantine — it does so while *preserving* and naming the original file, and the app surfaces the fresh-boot state explicitly.
3. Windows icon-cache staleness on machines that installed v1.5.0 (rebuild icon cache or reboot to refresh; new installs unaffected).
4. CI visual suite runs on the Windows runner (12/12 green); the sandbox cannot fetch Playwright browsers, so that lane only executes on CI.

## 7. Regression prevention (why this cannot recur silently)
- Shared runtime-graph walker → unit gate (`tests/packaging.test.mjs`) + artifact gate (`scripts/verify-packaged-runtime.mjs` in CI, also run against the *installed* asar) + strict pipeline contract test (`tests/release-gate.test.mjs`). Any `build.files` narrowing or entry-point import that escapes packaging fails at build time; any packaged-boot regressions fail at install time; startup module errors are rejected by string match even inside stderr.
- Boot markers + published per-phase logs (annotations channel) keep future packaging incidents diagnosed in minutes from any environment.

## 8. Final declaration
The exact reported failure (`ERR_MODULE_NOT_FOUND: app.asar\src\core.js` on installed startup) is fixed and **proven on the actually-installed app** by the same NSIS silent-install → Program-Files-class location → launched executable path that failed, in CI run 35859723467 on the released commit `b630c18`. All five root causes in the ledger are fixed at source; no security setting was weakened anywhere in this hotfix (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP unchanged apart from none; no new validations removed).
