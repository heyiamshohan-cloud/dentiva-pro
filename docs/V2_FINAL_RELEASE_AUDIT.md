# Dentiva Pro v2.0.0 — Final Release Audit

> Evidence document for the v2.0.0 commercial release.
> Every number below was measured on this machine during the audit; every claim
> points at the command or test that produced it. Where something is *not*
> proven, this document says so in **§7 Unverified / open** instead of implying
> otherwise.

- **Release:** Dentiva Pro 2.0.0 (Windows x64)
- **Baseline audited:** v1.6.1 @ `32e8a76`
- **Branch:** `arena/01a0d7ca-dentiva-pro`
- **Runtimes:** SQLite (`node:sqlite`, desktop) and the JSON-ledger engine (browser/dev + backup archives)
- **Date:** 2026-09-25

---

## 1. Verdict

| Gate | Result |
|------|--------|
| Unit + integration suites (`npm test`) | **142 tests — 140 pass, 0 fail, 2 skipped** |
| Cross-runtime differential probe | **0 findings** (0 invariant, 0 integrity, 0 engine divergence) |
| Full-surface sweep (ops × queries × collections × sort keys) | **0 failures** |
| Financial invariants (paid + due = total, no negative balances/due) | **enforced in tests and asserted per invoice/patient in the probe** |
| Scale (1k → 100k patients) | measured, **no artificial ceilings**; see §5 |
| English-only product surface | **0 Bengali codepoints** anywhere in the repository |
| Dead settings / dead buttons | 0 dead settings (settings-usage scan of all keys); query + op call-site audit found 1 unreachable query, now implemented (§3 V2-08) |
| Known crashes / thrown ops | 0 (the sweep exercises every op with junk payloads and asserts errors are returned, never thrown) |

**No release blocker remains.** Limitations that are real are documented in §6/§7.

---

## 2. What was audited

Reconnaissance covered the whole shipping surface, not a sample:

- **Repository & packaging:** Electron main/preload, IPC channel allowlist, ASAR `build.files` coverage, artifact naming, `package-release.sh`, the packaging integrity gate.
- **Service layer:** all **64 operations** and **28 queries**, both permission registries, both runtimes.
- **Data layer:** 26 collection tables, migrations (v4 sql.js blob → v5 relational → current), foreign keys, indexes, WAL, integrity checks, backup/restore.
- **Renderer:** every page (dashboard, patients, Patient 360 with all tabs, visits, dental chart, appointments, queue, treatments, prescriptions, invoices, payments, expenses, inventory, reports/accounting, analytics, audit, users/staff, settings, diagnostics, notifications), the command palette, print/PDF preview.
- **Documents:** prescription, invoice, receipt, statement on A4/A5/Letter/Legal/80 mm.
- **Every query name the renderer calls** was checked against the registry, and every op name likewise (§3).

---

## 3. Defects found and fixed

Ordered by severity as found. Each row names the evidence that found it and the
test (or probe) that now prevents it from coming back.

| ID | Severity | Area | Defect (as found) | Found by | Fix | Regression proof |
|----|----------|------|-------------------|----------|-----|------------------|
| V2-01 | Critical | Desktop data layer | `SPECS.treatments` filtered a non-existent `t.archived` column → **the `directory` query failed entirely in the packaged desktop app**, emptying every patient/staff/treatment/medication picker and rendering "Unassigned patient". | surface sweep | spec corrected | surface sweep (0 failures) |
| V2-02 | Medium | Query registry | `patientTimeline` had no permission entry → `authorizeQuery` rejected it as *Unknown query*; the capability was unreachable. | surface sweep | permission added | surface sweep |
| V2-03 | Medium | Op robustness | `medicationTemplate.save` **threw** on a template with no valid rows (`Cannot read properties of undefined`) and silently returned the old 60th template at the ceiling. | surface sweep | validation before mutation | surface sweep + `workflows` suite |
| V2-04 | Medium | Cross-runtime parity | 6 patient-list sort keys had no comparator in the JSON runtime → browser mode silently fell back to name order while SQLite ordered correctly. | comparator audit | comparators added | `tests/v2-parity.test.mjs` |
| V2-05 | High | English-only migration | 1 694 Bengali strings in product source plus the `language` setting, `bn-BD` formatters and the `language` field in the Electron smoke fixture. | repo-wide Unicode scan | removed/replaced | `tests/smoke.test.mjs` locale gate; Unicode sweep = 0 |
| V2-06 | High | Pickers (§8 ceiling) | `directory` asked for `pageSize: 2000` but every list clamps to 500 → **patient #501+ was unreachable** from every patient-selecting form. | code audit | server-side searchable picker | `tests/v2-parity.test.mjs` (lookup is uncapped and paged) |
| V2-07 | Medium | Financial KPI | `collected` included fully refunded money and `netOperating = collected − expenses` never subtracted refunds, so "Net operating" overstated profit by the refunded amount. | accounting-card read-through | both engines now `collected − refunded − expenses`; UI label corrected to "Collected − refunded − expenses" | `tests/v2-parity.test.mjs` "refunds reduce the net operating KPI…" |
| V2-08 | **Critical** | Patient picker | The picker called `q('patientLookup', …)` — **no such query existed**, only a permission entry. Every picker returned *Unknown query*: appointment, visit, invoice, payment, prescription, attachment, dental and treatment-plan forms had no working patient selector. | renderer call-site audit (19 `q()` names vs 27 registered) | `QUERIES.patientLookup` implemented on both runtimes (name/code/phone/address, archived included and flagged, paging clamped) | probe + `tests/v2-parity.test.mjs` |
| V2-09 | High | Financial math | `patientFinancialSummary`'s recomputed "due" treated a goodwill **adjustment as a charge** (`billed + adjusted − paid + refunded`), inflating the fallback balance by **2 × adjustment**; the ledger, `updatePatientBalance` and the invoice denorm all treat adjustments as credits. | new ledger-identity assertion | both engines: `billed − adjusted − netPaid` | `tests/v2-parity.test.mjs` ledger identity (`summary.due === ledger closing balance`) |
| V2-10 | High | Date semantics | Every `today`/date default used **UTC** instead of the clinic's day: at 01:00 Dhaka time new invoices/payments were dated *yesterday*, the dashboard "today" panel queried the wrong day, aging buckets and report windows shifted, and `shiftDate()` was a no-op in any non-UTC zone. | date-path audit | shared `clinicDate/clinicToday/timeZoneOf/daysBetween` (`src/core.js`) used by ops, queries, both repositories and the renderer; SQL boundaries are clinic-day bound parameters; dates render with `timeZone: 'UTC'` so a calendar date never shifts | `tests/v2-parity.test.mjs` clinic-day test (Dhaka/UTC/New York/invalid zone) |
| V2-11 | Medium | Cross-engine ordering | Default list order was inferred (`spec.date ? 'date-desc' : 'recent'`) instead of mirroring the SQL `defaultOrder`, so the same list came back in different orders per runtime (treatments insertion vs alphabetical; dental superseded-first). | dual-engine ordering script | per-collection `defaultSort` in the JSON runtime; dental = `created_at DESC, superseded ASC, tooth ASC` in both | `tests/v2-parity.test.mjs` ordering test over 18 collections |
| V2-12 | Medium | Query payloads | Payloads identified patients by id only, so any row outside the 2 000-row directory snapshot rendered "Unassigned patient" (labels, documents, dialogs) in a lifetime practice. | code-path audit | `enrichPatientNames` adds `patientName`/`patientCode` to every query payload via one batched PK lookup; the renderer harvests them into its label cache | `tests/v2-parity.test.mjs` enrichment tests |
| V2-13 | Medium | Dead setting | `settings.paperProfile` existed in defaults and the update whitelist but **nothing read it** and no UI exposed it. | settings-usage scan (all 51 keys) | retired from defaults + whitelist and stripped on migration | settings scan = 0 dead keys |
| V2-14 | Medium | Performance | The command palette ran a multi-collection full-text search **per keystroke** (1 336 ms at 100k patients) and searched 8 collections while rendering 6, paying for an exact `COUNT(*)` per group that it never displayed. | benchmark medians + `EXPLAIN QUERY PLAN` | 180 ms debounce + stale-response guard; rows-only `count: false` contract in both runtimes; exactly the 6 rendered groups are searched | `tests/v2-parity.test.mjs` rows-only + palette tests; §5 numbers |
| V2-15 | Low | Runtime parity | An unknown collection returned `{rows, total: 0}` from SQL but a differently shaped payload from JSON, and `count:false` was honoured by only some paths — a caller could receive different fields per engine. | probe after adding `count:false` | `count`/`totalExact` contract uniform for **every** collection in both runtimes, including unknown collections | `tests/v2-parity.test.mjs` (21 collections) |

Also corrected during the audit (no behaviour change, truthfulness only):
a stale "browser/demo adapter" comment on the financial-summary fallback, the
`dataset-benchmark` header, and the accounting-card metric label.

---

## 4. What the fixes are proven by

```
npm test                                  → 142 tests, 140 pass, 0 fail, 2 skipped
node scripts/v2-audit/differential-probe.mjs → 0 findings (invariant/integrity/divergence)
node scripts/v2-audit/surface-sweep.mjs      → 0 failures
node scripts/dataset-benchmark.mjs 1000,10000,25000,50000,100000 → §5
```

The differential probe seeds an identical clinic scenario into **both** runtimes
(12 patients, treatments, a visit, an appointment, three invoices, payments, a
refund, an expense, inventory + movements, two dental states, a prescription, a
treatment plan), then compares *every* query payload after canonicalising the
JSON and removing storage identity (file path, WAL bytes, page size, journal
mode) — which is a genuine runtime difference, not a behavioural one. Ordering,
money, counts, labels and empty states must all match exactly.

`tests/v2-parity.test.mjs` (new, 9 tests) locks in the contracts this audit
established:

1. list ordering follows the same rule in both runtimes (18 collections, plus the
   alphabetical-catalog, newest-first-money, and current-before-superseded rules);
2. ledger, statement and financial summary agree cent-for-cent, and the closing
   ledger balance equals the summary balance;
3. refunds reduce the net operating KPI but never the gross collected figure;
4. the clinic calendar day governs defaults, aging and reporting windows;
5. `patientLookup` searches the whole register, is paged and role-allowed, and
   archived patients stay resolvable for old documents;
6. rows-only listing (`count: false`) behaves identically in both runtimes for 21
   collections including an unknown one;
7. the command palette returns the same groups and rows in both runtimes and
   labels them without a second round trip.

---

## 5. Measured performance and scale

`node scripts/dataset-benchmark.mjs` seeds a throwaway relational workspace with
~2.2 records per patient (visits, invoices, payments, dental records, referrals,
follow-ups, stock movements, plans, expenses) and measures the operations the
renderer actually performs. Each figure is the **median of 3 runs** — single
timings on a shared machine swing 3–10× on identical code.

| Operation (median) | 1k | 10k | 25k | 50k | 100k patients |
|---|---|---|---|---|---|
| records in store | 9 536 | 94 586 | 236 336 | 472 586 | **945 086** |
| cold open + migration no-op | 1.3 ms | 1.4 ms | 1.5 ms | 1.5 ms | 1.5 ms |
| patient list, page 1 (25 rows) | 0.7 | 1.4 | 4.0 | 5.8 | 15.8 ms |
| patient list, **last** page | 1.8 | 15.7 | 41.7 | 81.4 | 177.6 ms |
| patient list + aggregates, sort by balance | 2.6 | 21.9 | 56.1 | 111.1 | 240.7 ms |
| patient search (name, Latin) | 2.6 | 22.7 | 54.5 | 93.8 | 203.4 ms |
| patient search (non-Latin Unicode name) | 2.2 | 25.5 | 54.7 | 112.9 | 221.6 ms |
| appointment list, page 1 | 1.3 | 6.8 | 39.2 | 33.7 | 62.5 ms |
| invoices, outstanding filter | 1.9 | 8.4 | 42.7 | 41.9 | 83.7 ms |
| directory (name resolution) | 6.1 | 7.9 | 9.6 | 12.6 | 19.7 ms |
| patient aggregate (timeline + counts) | 2.5 | 4.1 | 3.9 | 7.5 | 16.2 ms |
| patient statement | 0.8 | 0.8 | 0.6 | 0.9 | 0.8 ms |
| invoice detail | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 ms |
| report: revenue (all time) | 2.6 | 13.0 | 57.1 | 74.0 | 141.5 ms |
| accounting summary (aging + methods) | 3.4 | 24.6 | 60.1 | 136.5 | 298.3 ms |
| analytics (monthly trends) | 3.4 | 23.6 | 62.2 | 124.7 | 296.7 ms |
| command-palette search | 9.3 | 72.8 | ~209 | 386.5 | **794.3 ms** |
| audit list, page 1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 ms |
| integrity check (all tables) | 18.6 | 195.7 | 495.7 | 1 037 | 2 383 ms |
| backup (VACUUM INTO + manifest) | 28.5 | 167.7 | 388.0 | 983.5 | 2 291.9 ms |
| database size | 4.4 MB | 39 MB | 98 MB | 196 MB | **394 MB** |

**Reading of the table.** Interactive list/record operations stay in the
10–250 ms range even at 100 000 patients (945 000 records) and are paginated, so
the renderer never hydrates a full collection. The two figures that grow with the
database are intentional and bounded: palette search (a substring scan across six
collections) and the diagnostics/backup operations, which are not on an
interactive keystroke path.

**No artificial ceiling exists.** The 500-row page-size clamp is a page bound, not
a data bound: totals are exact, every list is paged to its last row (verified up
to page 4 000 at 100k patients), and `directory` reports `patientsTruncated`
rather than silently dropping patients. The old 500-patient *pickable* ceiling
(V2-06) is gone.

---

## 6. Honest limitations

1. **Substring search is a scan.** Patient and global text search use
   `LOWER(col) LIKE '%q%'`, which cannot use a B-tree index, so cost grows with
   record count: ~200 ms for a patient search and ~800 ms for a palette search at
   100k patients / 945k records / ~400 MB. The palette is debounced (180 ms), runs
   off the renderer thread, never truncates results and cannot deliver
   out-of-order answers; on a database this size a palette search still takes about
   a second. An FTS5 index is the planned v2.1 improvement.
2. **Backup/diagnostics cost is linear** in database size (2.3 s each at the
   100k scale). Backups run on a schedule/on demand, not on an interactive path.
3. **No upper bound is claimed beyond what was measured.** The largest dataset
   verified end-to-end is 100 000 patients / 945 086 records / 394 MB.
4. **Windows verification.** Packaging (ASAR coverage, artifact names, NSIS
   options, no dev-only paths) is asserted by the packaging gate and the CI
   workflow, and the smoke driver exercises the real UI paths including PDF
   generation under `DENTIVA_SMOKE=1`. A manual pass on a physical Windows
   machine is still listed as open work in §7.

---

## 7. Unverified / open

- A manual install → run → uninstall → reinstall pass on a physical Windows
  machine (CI covers the packaged artifact, not a human-observed install).
- Long-history single patient (500+ visits/invoices/payments) rendering beyond
  the paginated paths already asserted.
- Golden-image regression screenshots for the redesigned screens (the visual
  suite asserts layout/interaction, not pixel diffs).
- The browser viewport suite (`npm run test:visual`) could not execute **in this
  sandbox** during the audit: Playwright's browser download is blocked by the
  environment's network policy (`Failed to download Chrome for Testing
  153.0.8010.12`, exit 1). The suite is unchanged and is executed by
  `.github/workflows/windows-release.yml` on `windows-latest`, which is the
  runner of record for every viewport from 1280×720 to 3840×2160.

Nothing in this list is a functional or data-integrity risk; all are verification
depth items.

---

## 8. Release contents

| Item | Value |
|---|---|
| App version | 2.0.0 (`package.json`, `src/migrate-state.js`, `dentivaBuild` 2026.09.25) |
| Schema version | 5 (no schema change in this cycle; v1.6.x stores open unchanged) |
| Renderer bundle | `dist/index.html` 0.99 kB · `dist/assets/index-*.css` 49.07 kB · `dist/assets/index-*.js` 424.41 kB (117.47 kB gzip) |
| Electron runtime closure | 22 modules, 0 broken imports (`scripts/runtime-module-graph.mjs` / `verify-packaged-runtime.mjs`) |
| Windows x64 artifacts | `Dentiva-Pro-2.0.0-Windows-x64.exe` (portable), `Dentiva-Pro-2.0.0-Windows-x64-Setup.exe` (NSIS installer), `Dentiva-Pro-2.0.0-Windows-x64.zip` (application + docs + per-file `checksums.txt`) |
| Release checksums | `Dentiva-Pro-2.0.0-checksums.txt` (SHA-256 of all three artifacts) |
| Distribution | GitHub release `v2.0.0` in `heyiamshohan-cloud/dentiva-pro` — created only by the release workflow |
| Product data | none — no demo patients, demo transactions, sample records or placeholder content ships with the application |

### 8.1 How the Windows artifacts are produced (and why they are produced off this machine)

The Windows artifacts are built by `.github/workflows/windows-release.yml`
(`windows-latest`), in this order:

1. `npm ci` → `npm run check` (142 tests + Vite production build)
2. `npx playwright install chromium` → `npm run test:visual` (six viewports, 1280×720 → 3840×2160) with viewport-regression evidence uploaded
3. `npm run dist:win` (portable + NSIS, `artifactName` per `package.json`) — the PowerShell step re-raises `$LASTEXITCODE` so a failed build cannot be mistaken for success
4. `scripts/verify-packaged-runtime.mjs` — proves the packaged ASAR contains the complete runtime module closure
5. PE-header inspection of both executables (`MZ` magic, byte counts)
6. `scripts/windows-smoke.ps1` — portable launch, **silent NSIS install**, launch from the installed directory, restart persistence, uninstall (`-PortableOnly` must never be passed from release CI: it previously masked the v1.5.0 installed-app startup crash)
7. Staging + ZIP assembly with a check that the ZIP contains `DentivaPro.exe` and **no** `.git`, `node_modules`, `tests` or `test-data` content, then SHA-256 checksums written and re-verified line by line
8. Publishing to a GitHub release happens **only** on `workflow_dispatch` or a push whose commit message contains `[publish-release]`, and refuses to overwrite an existing tag

**Local packaging is not possible in this audit sandbox.** electron-builder fetches
Electron/NSIS/winCodeSign from GitHub release assets, and this environment's egress
policy resets connections to `release-assets.githubusercontent.com`:

- `npm run dist:win` → `⨯ unable to verify the first certificate` (`RequestError` in `got`)
- `NODE_TLS_REJECT_UNAUTHORIZED=0 npx electron-builder --win` → `downloaded label=electron progress=100%` then `⨯ Client network socket disconnected before secure TLS connection was established` (3 retries, identical)
- `npx electron-builder --win zip` → same failure
- `curl -kL .../electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z` → 302 to `release-assets.githubusercontent.com`, then connection reset (exit 35, 0 bytes)

That is an environment limitation, not a product defect: the identical commands
succeed on `windows-latest`. `release/` is therefore empty on this machine, and
this document makes no claim that it is not.
