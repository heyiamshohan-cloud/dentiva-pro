# Dentiva Pro v2.0.0 — FINAL ENGINEERING CHECKPOINT

> Durable checkpoint for the v2.0.0 engineering cycle.
> **If the session stops: read this file and resume from `NEXT EXACT ACTION`. Never restart completed work.**

- **Baseline:** v1.6.1 @ `32e8a76` (133 tests: 131 pass / 0 fail / 2 skipped)
- **Target:** v2.0.0
- **Branch:** `arena/01a0d7ca-dentiva-pro`
- **Last updated:** 2026-09-25 (session 2)
- **Current suite:** 142 tests / 140 pass / 0 fail / 2 skipped (`npm test`)
- **Differential probe:** `node scripts/v2-audit/differential-probe.mjs` → **0 findings**
  (0 invariant, 0 integrity, 0 engine divergence) at `/tmp/div8.json`
- **Surface sweep:** `node scripts/v2-audit/surface-sweep.mjs` → **0 failures**

---

## 1. Current phase

**Phase B — defect elimination (COMPLETE for every defect found so far) → Phase C — regression
lock-in + release evidence (IN PROGRESS)**

## 2. Completed phases

- [x] Repository structure, packaging, Electron architecture mapped
- [x] Test baseline reproduced on this machine (133 tests / 131 pass / 0 fail / 2 skipped)
- [x] Dependency + feature map of the shared op/query registry (64 ops, 27 queries)
- [x] Differential audit harness built (`scripts/v2-audit/differential-probe.mjs`)
- [x] Full-surface sweep built and run against the **real SQLite engine**
      (`scripts/v2-audit/surface-sweep.mjs`) — every query, every collection,
      every collection × sort key, every op with junk payloads
- [x] Schema ⇄ SQL-spec column validator (every `t.<column>` in `list-sql.mjs`
      checked against `PRAGMA table_info`)

## 3. Discovered issues (verified, with evidence)

| ID | Sev | Area | Defect | Evidence | Status |
|----|-----|------|--------|----------|--------|
| V2-01 | **Critical** | Desktop data layer | `SPECS.treatments` in `list-sql.mjs` filters `t.archived = 0`, but `treatments` has no `archived` column → SQL error `no such column: t.archived` → the **`directory` query fails entirely in the packaged desktop app**, so every patient/staff/treatment/medication picker is empty and `patientName()` renders "Unassigned patient". Blocks appointments, invoices, visits, prescriptions, attachments and the dental chart. | `surface-sweep`: `list treatments`, `sort treatments/price-desc`, `query directory` all fail with `query-failed` | **FIXED** |
| V2-02 | Medium | Query registry | `QUERIES.patientTimeline` has no entry in `QUERY_PERMISSION` → `authorizeQuery` rejects it as `Unknown query`; the capability is unreachable and the registry parity claim is false. | `surface-sweep`: `query patientTimeline → Unknown query` | **FIXED** |
| V2-03 | Medium | Op robustness | `medicationTemplate.save` **throws** (`Cannot read properties of undefined`) when the submitted template has no valid medication rows, and silently returns the *old* 60th template once the 60-template ceiling is reached. Violates the "ops never throw" contract. | `surface-sweep`: `op medicationTemplate.save: THREW` | **FIXED** |
| V2-04 | Medium | Cross-runtime parity | 8 patient-list sort keys (`visits`, `visits-desc`, `billed`, `billed-desc`, `paid`, `paid-desc`) have no comparator in `LocalRepo.#sortRecords`, so browser mode silently falls back to name order while SQL orders correctly. | comparators table vs `PATIENT_SORTS` | **FIXED** |
| V2-05 | **High** | English-only migration | 1 694 Bengali strings in product source: `BENGALI_DICT` (~1 500 entries in `src/main.js`), 35 in `electron/main.mjs`, 1 in `src/notifications.js`; plus the `localized()`/`translateDom()` layer, the `language` setting + selector, `bn-BD` number/date formatters and `docLang()` document locale. | repo-wide Unicode scan | **FIXED** |
| V2-06 | **High** | Ceiling (§8) | `directory` requests `pageSize: 2000`, but every list clamps to 500 → **patient pickers silently stop at 500 patients**; patient #501+ is unreachable from appointment/invoice/visit/prescription/attachment/dental forms. | `list-sql.mjs` `safeSize = min(500, …)` | **FIXED** (searchable server-side patient picker) |
| V2-07 | Medium | Financial semantics | `collectedCents` includes fully refunded money and `netOperatingCents = collected − expenses` never subtracts refunds, so "Net operating" overstates profit by the refunded amount. Invoice/patient ledgers are correct; the accounting KPI is not. | `reportStats('accounting')` JS + SQL both | **FIXED + TESTED** (session 2: both engines now `collected − refunded − expenses`; UI label corrected to "Collected − refunded − expenses"; locked by `tests/v2-parity.test.mjs` → "refunds reduce the net operating KPI…") |
| V2-08 | **Critical** | Patient picker | The picker called `q('patientLookup', …)` but **no such query existed** in `src/queries.js` — only a permission entry. Every picker returned `Unknown query`, so patient-selecting forms (appointment, visit, invoice, payment, prescription, attachment, dental, treatment plan) had no working patient selector at all. | renderer-call-site audit: 19 `q()` names vs 27 registered, `patientLookup` missing | **FIXED** (`QUERIES.patientLookup`: name/code/phone/address search, archived included and flagged, paging clamped, both runtimes; probe + tests cover it) |
| V2-09 | **High** | Financial math | `patientFinancialSummary` fallback formula used `billed + adjusted − paid + refunded`, treating a goodwill **adjustment as a charge** → the fallback "due" was inflated by every adjustment (2 × adjustment too high). Ledger rows, `updatePatientBalance` and the invoice denorm all treat adjustments as credits. | `tests/v2-parity.test.mjs` ledger identity: summary 359 000 vs ledger/invoice 339 000 | **FIXED** (both engines: `billed − adjusted − netPaid`; ledger identity now asserted in tests) |
| V2-10 | **High** | Date semantics | Every `today`/date default used **UTC**, not the clinic's day: a Dhaka clinic at 01:00 local dated new invoices/payments to *yesterday*, the dashboard "today" panel queried the wrong day, aging buckets and reporting windows shifted, and `shiftDate()` was a no-op in non-UTC zones (`setDate` on a local-time parse). | `src/ops.js` ctx `today`, `src/queries.js`, `repo-local.js` `isoDate()`, SQL `date('now')`/`julianday('now')` | **FIXED** (shared `clinicDate/clinicToday/timeZoneOf/daysBetween` in `src/core.js`; ops ctx derives from the clinic timezone; SQL boundaries now bound parameters on the clinic day; renderer formats with `timeZone: 'UTC'`; regression-tested in `tests/v2-parity.test.mjs`) |
| V2-11 | Medium | Cross-engine ordering | List default order was inferred (`spec.date ? 'date-desc' : 'recent'`) instead of mirroring `list-sql.mjs` `defaultOrder`, so the same list came back in different orders in the two runtimes (treatments insertion- vs alphabetical, dental current-vs-superseded first). | `/tmp/dbg-order.mjs` dual-engine run | **FIXED** (per-collection `defaultSort` in `LocalRepo.LIST_SPECS`, `''` = storage order; dental `created_at DESC, superseded ASC, tooth ASC` in both; ordering rules asserted in `tests/v2-parity.test.mjs` for 18 collections) |
| V2-12 | Medium | Query payloads | Query payloads identified patients by id only, so any row outside the 2 000-row directory snapshot rendered "Unassigned patient" (arrow labels, printed documents, dialogs) in a lifetime practice. | code path audit of `patientName()`/`cachedPatient()` | **FIXED** (`enrichPatientNames` in `src/queries.js` adds `patientName`/`patientCode` to every query payload through one batched PK lookup; renderer harvests them into the label cache; tested) |
| V2-13 | Medium | Dead setting | `settings.paperProfile` existed in defaults and the update whitelist but **nothing read it** and no UI exposed it — a setting that silently does nothing. | settings-usage scan of all 51 keys | **FIXED** (retired from defaults + whitelist, stripped during migration) |
| V2-14 | Medium | Performance | The command palette ran a full multi-collection search **per keystroke** (1.34 s at 100k patients) and searched 8 collections while rendering only 6, paying for an exact `COUNT(*)` per group that it never displayed. | `scripts/dataset-benchmark.mjs` medians + `EXPLAIN QUERY PLAN` | **FIXED** (180 ms debounce + stale-response guard; rows-only `count: false` contract in both runtimes; searches exactly the 6 rendered groups) → 25k palette search 320 ms → 209 ms |
| V2-15 | Low | Runtime parity | `listCollection` on an unknown collection returned `{rows,total:0}` from SQL and a differently-shaped payload from JSON, and `count:false` was honoured by only some paths — a caller could get different fields per engine. | dual-engine probe on `globalSearch` after adding `count:false` | **FIXED** (`count`/`totalExact` contract uniform in both runtimes for every collection, including unknown ones; asserted for 21 collections) |

## 4. In-flight investigation

- Windows packaging + installed-app verification (Phase 20/29)
- `docs/V2_FINAL_RELEASE_AUDIT.md` (evidence document for the release)
- Long-history patient (500 visits / 500 invoices / 500 payments) pagination
- Document golden tests are in place (prescription zero-financial, invoice ≠ receipt)

## 5. Unresolved / open

- **Documented limitation (not a defect):** the command-palette search is a
  substring scan across six collections. Measured medians: 9 ms @1k / 73 ms @10k /
  209 ms @25k patients, ≈0.8 s @100k (945k records). It is debounced (180 ms), never
  truncates results, and runs off the renderer thread, but on a 1M-record database a
  palette search is a ~1 s operation. Documented honestly in the release audit;
  an FTS5 index is the planned v2.1 improvement.
- **Not yet verified on a real Windows machine:** the CI workflow
  (`.github/workflows/windows-release.yml`) and `scripts/verify-packaged-runtime.mjs`
  cover packaging, but a manual installed-app pass is still outstanding.

## 6. Tests completed

- `npm test` — **142 tests, 140 pass, 0 fail, 2 skipped**
- `tests/v2-parity.test.mjs` (new, 9 tests) — dual-runtime contract tests:
  list ordering rules for 18 collections, ledger/statement/summary cent-for-cent
  parity + money identity, refund→KPI, clinic-day defaults, `patientLookup`
  (uncapped, paged, role-allowed, archived), patient-name enrichment on query
  payloads, rows-only listing for 21 collections (incl. unknown), palette groups.
- `surface-sweep.mjs` — 64 ops + 28 queries + 24 collections + every declared sort key → **0 failures**
- `differential-probe.mjs` — SQL vs JSON runtime comparison → **0 findings**
- `dataset-benchmark.mjs` — median-of-N measurements at 1k/10k/25k/50k/100k patients

## 7. Tests remaining

- Packaged Windows installed-app verification (CI workflow `windows-release.yml`)
- Optional: golden-image visual pass over the redesigned screens

## 8. Files changed

**Session 1**
- `electron/lib/list-sql.mjs` — treatments spec fix
- `src/queries.js` — `patientTimeline` authorisation, directory redesign
- `src/ops.js` — `medicationTemplate.save` guard
- `src/repo-local.js` — patient aggregate sort comparators, treatments filter parity
- `src/main.js` — English-only migration, searchable patient picker
- `electron/main.mjs`, `src/notifications.js` — English-only migration
- `scripts/v2-audit/*` — audit tooling (new)

**Session 2**
- `src/core.js` — `DEFAULT_TIMEZONE`, `timeZoneOf`, `clinicDate`, `clinicToday`, `daysBetween`
- `src/ops.js` — `runOp` derives `today` from the clinic timezone + caller clock; `paperProfile` retired
- `src/domain.js` — `periodBounds(..., timeZone)`
- `src/queries.js` — `patientLookup` implemented; clinic-day anchors on every range/today;
  `enrichPatientNames`; palette searches only rendered groups with `count:false`; stale comment removed
- `src/repo-local.js` — `defaultSort` per collection; ledger-parity block; clinic-day `#today()`;
  aging in whole days; rollups window on the clinic month; adjustments as credits; `count` contract
- `src/main.js` — `clinicDate` `today()`; UTC-safe date formatting/`shiftDate`; honest KPI label;
  patient-label harvesting; debounced command palette; `count`-aware contracts unchanged
- `src/migrate-state.js` — `paperProfile` retired + stripped on migration
- `electron/lib/list-sql.mjs` — dental default order; dashboard counters + aging on the clinic day;
  `count`/`totalExact` contract; unknown-collection payload shape
- `electron/lib/repo-sql.mjs` — clinic-day boundaries; `count` flag through every lister
- `electron/lib/ledger-sql.mjs` — rollup window on the clinic day; adjustments as credits
- `scripts/v2-audit/differential-probe.mjs` — canonical-JSON diff, storage-shape whitelist, `patientLookup` coverage
- `scripts/dataset-benchmark.mjs` — median-of-N timings + honest labels
- `tests/helpers/harness.mjs` — SQL workspace now boots through `migrateWorkspace` (production path)
- `tests/v2-parity.test.mjs` — **new** dual-runtime contract suite

## 9. Migrations performed

- No schema change. `DB_LAYOUT_VERSION` stays 1 / `CURRENT_SCHEMA_VERSION` stays 5.
- `settings.paperProfile` is removed from existing workspaces during `migrateState`
  (a dead key; nothing read it).

## 10. Release blockers

- [x] V2-01 (desktop directory failure)
- [x] V2-05 (Bengali content)
- [x] V2-06 (500-patient picker ceiling)
- [ ] Packaged Windows installed-app verification (CI)

## 11. NEXT EXACT ACTION

1. Record the final scale-ladder medians (1k/10k/25k/50k/100k) into
   `docs/V2_FINAL_RELEASE_AUDIT.md` — the run is executed by
   `node scripts/dataset-benchmark.mjs 1000,10000,25000,50000,100000`.
2. Run `npx vite build` + `npm test` + probe + sweep one final time (pre-build gate).
3. Bump `APP_VERSION`/`package.json` to 2.0.0, then build the Windows x64 artifacts
   (NSIS + portable + ZIP) and publish checksums.
4. Write `docs/V2_FINAL_RELEASE_AUDIT.md` and finish the README/CHANGELOG
   truth audit (§22) for v2.0.0.
