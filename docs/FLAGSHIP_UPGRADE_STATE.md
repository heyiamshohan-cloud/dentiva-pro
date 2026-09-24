# 🦷 Dentiva Pro Flagship Upgrade — Live State (v1.6.0)

## CURRENT STATE
- **Branch:** `arena/01a0c9e2-dentiva-pro` · **Version:** 1.5.2 → **1.6.0** · Tests: **128 pass / 0 fail / 2 skipped (benchmarks)**
- Phases completed: baseline audit + foundation (Cluster 1–9), online-payments-first stack (A–F), saved patient views, street-suggestion community sync, **document engine** (Cluster A v2), **high-density patient list + command palette + patient profile/statement + prescription builder + payment guard** (Clusters B–I).

## LAST COMPLETED ACTION
v1.6.0 version bump + version-contract tests made drift-proof; payment modal method-reference hints (bKash/Nagad/Rocket/Upay/Bank/Card); command palette upgraded (backend globalSearch × 7 collections + action commands + arrow-key nav); settings UI fields (BMDC registration, clinic website); full suite 128/0.

## Clusters → Status
- **A (aggregates, listQuery sort pipeline):** DONE — `listQuery` now forwards `sort` from overrides; ui prefs (columns/density) loaded at boot.
- **B (command palette):** DONE — Actions section + patients/appointments/invoices/payments/prescriptions/visits via `globalSearch` SQL query for paginated datasets to support sqlite performance; search-backed dynamic actions; keyboard nav.
- **C (patient list):** DONE — 10 sort keys incl. balance/billed/paid/visits aggregates, 11 configurable columns (patient+status locked), advanced filters (tag/registered dates/tooth status/has-phone), density toggle, persisted prefs.
- **D (patient profile):** DONE — clickable timeline (visit detail/invoice/rx links), visits tab rewritten with filters (dentist/date-range/chip), expandable per-visit clinical+billing cards, print view per visit; professional statement (opening/closing/balance/pager/period); patient-scoped audit via `entity:'Patient'`; financial summary cards; profile quick actions.
- **E (prescription builder):** DONE — clinical sections, structured medication rows (medicine/catalog datalist, form, strength, dosage, frequency pattern chips w/ datalist, food relation, duration+unit, quantity, instructions), reorder/duplicate/remove rows, visit linking, clinician templates (apply/save/delete with caps + perms), preview with full state round-trip; old `Additional medicines` template replaced.
- **G (double-submit guard):** DONE — `handleSubmit` wrapper disables all submit buttons + `ui.submitting` re-entry guard (try/finally).
- **H (payment):** DONE-surface — amount prefilled to invoice due, method→reference hints (Cash/Bank/Card/bKash/Nagad/Rocket/Upay), overpayment still enforced server-side, audit + guard noted in UI. Remaining: refund row UX is done (Cluster A v2).
- **I (settings):** DONE — `dentistRegistration` + `clinicWebsite` fields on Clinic identity card; whitelist already had keys; renderer picks registration for prescription signature footer.

## Version drift contract
- `tests/smoke.test.mjs` + `tests/upgrade-v140.test.mjs` now compute expected version from `migrate-state.js APP_VERSION` ↔ `package.json` (no hardcoded patch version). Bumping requires editing exactly 2 files.
- README pinned to v1.6.0.

## PROGRESS SINCE
- **b535005** flagship milestone (B–I clusters).
- **c9e3724** dental chart: FDI labels, anatomical quadrant rows, primary-dentition 20-teeth fix, multi-tooth bulk apply.
- **38bef59** payment receipt onto doc engine (+refund precedence bug fix), Bangla dictionary +52 strings, aggregate benchmarks.
- Benchmarks fresh (Node 22, sandbox): 1k 2.3ms / 10k 18.9ms / 25k 39.8ms / 100k aggregate list page1 — full table in bench.log output of last run (100k last page 138.5ms, statement 0.6ms flat).
- repo-local dev parity for includeAggregates.

## EXTERNAL BLOCKER (rule: record + continue)
**GitHub auth in this sandbox is broken**: `GH_TOKEN is no longer valid` (gh auth status fails; git push → 403 terminal prompts disabled). Push, PR #2 update, CI run proof, tag + release publish are ALL impossible until the user reconnects GitHub in Arena. NOT a code issue — work queued at local HEAD 38bef59. User action required: reconnect GitHub in Arena, then say Continue.

## NEXT EXACT ACTIONS (pick up here)
1. On GitHub reconnection: `git push origin arena/01a0c9e2-dentiva-pro`, update PR #2 body w/ flagship changelog, verify windows-release CI green, tag v1.6.0, build NSIS+portable+ZIP+SHA-256, publish release (draft→release), archive artifacts locally.
2. FLAGSHIP_UPGRADE_AUDIT.md refresh draft is next local action pre-push.

## CURRENT ISSUE
GitHub connection expired (sandbox credential) — waiting on user reconnect; code side fully green (128/128).
