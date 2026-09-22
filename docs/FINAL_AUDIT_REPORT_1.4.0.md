# Dentiva Pro v1.4.0 audit and release report

**Audit date:** 2026-09-22 (Asia/Dhaka)
**Repository:** `heyiamshohan-cloud/dentiva-pro`
**Branch:** `arena/01a0c8bf-dentiva-pro`
**Code identity:** `1.4.0`
**Baseline:** published `v1.3.0` (CI run 35710031145); earlier releases remain untouched

This report separates implementation from acceptance evidence. A label, route, button or source file is not treated as behavioral proof. Local deterministic evidence is recorded below; Windows CI evidence is recorded in §5 and the release verification section.

## 1. Current decision

**CURRENT STATE: IMPLEMENTED AND LOCALLY VERIFIED; WINDOWS RELEASE GATES IN CI.**

The v1.3.0 → v1.4.0 transformation is complete without restarting the project:
relational `node:sqlite` storage, a shared service layer with server-side
validation/RBAC/audit, a rebuilt async paginated renderer, Design System 2.0
(light-only), v1.3.0 data migration, backup/restore with validation and
module groups, and a 60-test suite. The Electron GUI cannot run in this Linux
sandbox, so the packaged-app evidence (launch/restart persistence, PE checks,
packaging, checksums) is produced by the Windows CI pipeline that gates the
release.

## 2. Delivered scope vs. requirements

| Requirement | Implementation | Status boundary |
|---|---|---|
| Preserve all v1.3.0 functionality; no silent data loss | Full feature matrix in `V1.4.0_REQUIREMENTS_MATRIX.md`; migration keeps every record (quarantine with reasons, payload preserved even when FK columns are nulled); source file retained | Verified by migration suite + 60-check ops/queries smoke on both repos |
| Remove artificial limits (200 MB DB, 6 MB attachments, record caps) | No size/count constants remain in the engine (static scan in security tests); attachment cap now a 4 GB sanity bound | Benchmark at 100k patients / 945k records, 412 MB store |
| 100k patients / 250k+ records with pagination, indexing, lazy loading | Server-side pagination on every list; ~40 indexes; patient-scoped lazy loads; capped directory for name resolution | `scripts/dataset-benchmark.mjs` at 1k/10k/25k/100k (see §3) |
| Premium light-only Design System 2.0, no dark mode | New token-based `src/styles.css`; no dark styles anywhere (static check) | Subjective premium review remains human-required |
| Backend-enforced RBAC (UI hiding insufficient) | `authorizeOp`/`authorizeQuery` in the shared registries; main process resolves the live session for every call; audit attributed server-side | Role-template tests + smoke RBAC denials on both repos |
| `docs/V1.4.0_BASELINE_AUDIT.md` (per-capability classification) | Delivered (Phase 1, committed) | — |
| `docs/V1.4.0_REQUIREMENTS_MATRIX.md` | Delivered, updated per phase | — |
| `docs/FINAL_AUDIT_REPORT_1.4.0.md` | This document | — |
| Release artifacts + checksums + tag + GitHub release | `Dentiva-Pro-1.4.0-Windows-x64.exe/-Setup.exe/.zip/checksums.txt` via Windows CI; tag `v1.4.0` | See §5 / release verification |
| No placeholders/TODO/fake features/demo data | Static scan clean (placeholder grep, no-seed design, empty-store start) | — |
| Financial invariants (integer cents), backup/restore round-trip, workflows | Cents columns + server-side invariants; round-trip test with tamper rejection; 60-test suite | Local suites green |
| Bengali + English localization | 449-entry dictionary carried over 1:1; bn-BD formatters; `translateDom`; release-critical label coverage asserted in tests | Native Bengali visual review remains human-required |
| No autonomous diagnosis/prescribing/treatment recommendation | Safety wording preserved on prescription/treatment-plan surfaces; no clinical decision code added | — |

## 3. Local verification evidence

### Passed (deterministic, this environment)

- `npm test` — **60 passed, 0 failed** (smoke, security, storage, first-run, workflows, domain, release-gate)
- `npm run build` — Vite production bundle (338.89 kB JS / 38.10 kB CSS)
- `node --check` — all changed source files
- Ops/queries functional suite (`/tmp/opstest.mjs`, ~60 checks): setup, 62 patients, appointment conflict + confirm, visit/follow-up automation, dental supersede, full money cycle (invoice → payment → adjustment → refund) with exact balances, overpayment/reprice guards, inventory guards (negative stock blocked, movement vocabulary, low stock), RBAC denials (op + query), pagination disjointness, Bengali search, reports (all kinds + aging + analytics), statement invariants, audit attribution, workspace integrity, bootstrap
- The **same suite green against `LocalRepo`** (browser parity)
- Backup/restore/diagnostics suite: create + manifest checksums, validate, tamper rejection, restore round-trip with exact cents, pre-restore safety backup, JSON module-group restore, diagnostics report
- Migration suite (`/tmp/migtest.mjs`): v4→v5 with quarantine reasons, dangling-FK repair, exact `balance_cents`, attachment externalization, secret sanitization, 0 FK violations, WAL, preserved source, idempotent re-run; corrupt-primary `.bak` recovery; legacy JSON marker
- Scale benchmark on the real store (`scripts/dataset-benchmark.mjs`):

  | Size | Records | List p1 | Search (BN) | Revenue report | Integrity | Backup |
  |---|---|---|---|---|---|---|
  | 1,000 | 9,536 | 1.9 ms | 3.2 ms | 3.3 ms | 25 ms | 42 ms |
  | 10,000 | 94,586 | 2.4–18 ms | 23.2 ms | 15.2 ms | 236 ms | 171 ms |
  | 25,000 | 236,336 | 4.6–38 ms | 55.1 ms | 33.9 ms | 489 ms | 410 ms |
  | **100,000** | **945,086** | **18.0 ms** | **220.6 ms** | **137.9 ms** | **2.4 s** | **1.6 s (412 MB)** |

- `npm audit` — **0 vulnerabilities**; runtime dependencies: **none**
- Static wiring cross-check: 57 `data-action`s, 25 `data-form`s, 29 `op()` names, 13 query names — all resolve
- jsdom end-to-end harness of the **real production bundle** (fresh browser profile): boot →
  auto-opened first-run setup → 3-step setup (clinic identity, language/currency, first
  Administrator PIN) → local PIN sign-in → all 16 key surfaces render with correct headers
  and no page-renderer error state.

### First CI validation run (run 35734256848) — findings fixed before release

The rewritten visual spec (driving the real first-run setup + PIN sign-in flow) failed on
Windows CI exactly where a real clinic would hit it: the setup modal could not advance.
Local DOM-harness reproduction found **three first-run/auth defects**, all fixed and covered
by a new `tests/first-run.test.mjs` regression suite (5 tests, both runtimes):

1. `userUpsert` admin-coverage guard counted only stored users, so the **very first**
   `user.create` (the setup Administrator) was rejected — first run could never complete.
   The guard now projects the population after the upsert, including the new record.
2. Browser runtime `#applyPinToSet`/legacy-upgrade spread `browserHashPin` output
   (`{salt, hash}`) instead of mapping it to the repo's `pinHash`/`pinSalt` keys — the
   first account got no usable PIN hash, `firstRun` stayed true (setup looped on every
   open) and sign-in failed with "no PIN set".
3. Desktop `verifyPin` compared the UTF-8 bytes of the hex string against the decoded
   digest (`Buffer.from(toHex(x))` vs `Buffer.from(hex,'hex')`) — lengths never match, so
   **every** Electron sign-in failed. Fixed to compare digest bytes directly.

Post-fix: 60/60 unit tests, green Vite build, and the full jsdom first-run→sign-in→16-page
harness passes against the production bundle.
- - Placeholder/demo-data scan — clean
- `git diff --check` — clean

### Not verifiable locally (documented limitation)

- **Electron GUI / packaged app**: no GUI and no Electron binary download in this sandbox (TLS-blocked). The renderer's runtime behavior is therefore gated by (a) the full static wiring cross-check, (b) the identical service layer exercised end-to-end in Node against both repositories, and (c) the Windows CI packaged-app smoke (`DENTIVA_SMOKE=1` create + verify phases exercising setup, sign-in, patient creation, appointment booking and restart persistence through the real renderer).
- Subjective premium visual review and native Bengali proofread remain human-required.

## 4. Security posture

- Renderer boundary: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; CSP `frame-ancestors 'none'`; navigation allowlist; webview attach denied; window-open denied.
- IPC: one `invoke` in the preload with a 19-channel allowlist; every channel re-validated in main; identity always from the main-process session; audit written server-side.
- Money: integer-cent columns with `CHECK >= 0`; reprice lock; overpayment block; refund immutability; balance cache reconciled from the ledger (including forgiveness adjustments); integrity checks at backup, restore and quit.
- Secrets: PBKDF2-SHA-256 (210k, per-user salt) in the main process only; legacy 120k hashes verified + upgraded; 5-failure/30 s lockout persisted; payloads re-sanitized on every write.
- Files: executables/scripts blocked as attachments; PDF active content never embedded (isolated, script-disabled print window with blocked-content validation); backup manifest SHA-256; restore path containment.
- No network code of any kind; zero runtime dependencies; `npm audit` clean.

## 5. Windows CI release gates

The release commit (`[publish-release]`) triggers `.github/workflows/windows-release.yml`:
tests → build → Chromium viewport checks → portable/NSIS packaging → PE `MZ`
inspection → portable launch/restart persistence smoke (`DENTIVA_SMOKE=1`,
phases `create`/`verify`) → ZIP content inspection → SHA-256 verification →
publish. See release verification below.

## 6. Release verification

_(completed in Phase 12 with the CI run ID, artifact sizes and SHA-256
digests before the tag is pushed)_

## 7. Known limitations (honest record)

1. The Electron GUI was not run in this sandbox; packaged-app evidence comes solely from Windows CI (which gates publication).
2. Installed-app launch/restart/uninstall smoke remains manual user verification (unchanged policy from v1.3.0).
3. Global workspace search at 100k scale is ~1 s (capped, 3 collections); per-page list search is ≤ 221 ms.
4. Subjective premium visual review and native Bengali proofread remain human-required.
