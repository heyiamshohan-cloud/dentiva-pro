# 🧾 DENTIVA PRO v1.6.0 FLAGSHIP UPGRADE — FORENSIC AUDIT
**Scope:** full upgrade v1.5.2 → v1.6.0 · branch `arena/01a0c9e2-dentiva-pro` · engine built on the v1.4.0 relational core (Node built-in `node:sqlite`, zero runtime deps). Every finding carries ID / Severity / Evidence / Root cause / Fix / Verification / Status(FIXED|VERIFIED|NOT APPLICABLE|DOCUMENTED LIMITATION).

## A. Baseline & contract
| # | Finding |
|---|---|
| A1 | Working baseline pinned at v1.5.2 tag (`50b86e7`) before any change; upgrade strictly incremental. — VERIFIED |
| A2 | Version contract: `package.json.version` ↔ `src/migrate-state.js APP_VERSION` now enforced by two tests at runtime (smoke + upgrade-v140 derive expected version, never hardcode). Bump = edit 2 files. — FIXED+VERIFIED (`b535005`) |
| A3 | Backup/restore covers the whole DB incl. `settings.medicationTemplates` (they live inside the settings blob; `backupExport` serializes the full store) + uploads/files + icon. Manifest hash chain intact. — VERIFIED |

## B. Data integrity & migrations
| # | Sev | Finding |
|---|---|---|
| B1 | 🔴 | Tooth labels claimed "FDI 11–48" while rendering universal indexes (1–32), and the primary dentition grid showed 32 teeth instead of 20. **Root cause:** display layer asserted FDI without a mapping. **Fix:** display-side FDI map (adult 11-48 / primary 51-85) over the stored 1-32 index — zero data migration, both numbers in tooltip; primary renders its real 20 teeth in anatomical order (UR·UL / LR·LL). **Verification:** manual spec review + 128/128 suite. — FIXED |
| B2 | 🔴 | Prescriptions rendered/printed only freeform text rows. **Root cause:** legacy `medicine|strength|…` textarea path. **Fix:** structured rows (medicine, catalog datalist bind, form, strength, dosage, frequency w/ pattern codes 1-0-1…1-1-1-1 & SOS, food relation, duration value+unit, quantity, instructions), reorder/duplicate/remove row tools, visit link, clinician-authored templates (apply/save/delete, cap 60, `prescriptions.edit`/`settings.edit` perms) + state-loss-proof preview round-trip (`ui.rxPreviewReturn`). Server normalize `normalizeMedicationRows` stays additive (legacy keys always populated). — FIXED+VERIFIED |
| B3 | 🟠 | Patient profile tabs name-matched audit rows. **Fix:** server-side `auditList{entity:'Patient',entityId}` — no heuristics. — FIXED |

## C. Financial integrity
| # | Sev | Finding |
|---|---|---|
| C1 | 🔴 | Received/refunded amounts with `refundedCents`/`refundedAmount` mixed units produced wrong net on receipts (operator-precedence hazard). **Root cause:** `a \|\| b ? …` chain. **Fix:** explicit `refundedCents !== undefined ? centsToMoney : refundedAmount` branch. — FIXED |
| C2 | 🟠 | Payment modal allowed manual amount entry over invoice due until server rejected. **Fix:** amount prefilled to invoice due, method→reference guidance (bKash/Nagad/Rocket/Upay/Bank/Card/Cash), edited amounts for partial payments still allowed; overpayment stays blocked server-side. UI states the double-submit guard + audit attribution. — FIXED |
| C3 | 🟠 | Double-tap submit could race two payments/invoices. **Fix:** `handleSubmit` wrapper (`ui.submitting` + disables all submit buttons, try/finally reset). — FIXED |
| C4 | 🟢 | All money math remains integer-cents (`*_Cents`, `centsToMoney`) end-to-end incl. statement debit/credit/balance columns and engine `totalsSection`. — VERIFIED |
| C5 | 🔵 | Payment refunds never mutate the original: refund rows exist (`payment.refund` op), receipt shows Received/Refunded/Net. — VERIFIED |

## D. Document engine (preview ≡ print ≡ PDF)
| # | Sev | Finding |
|---|---|---|
| D1 | 🔴 | Receipt was the only premium doc on the legacy `openPrintPreview` path (paper-size changes rebuilt older content). **Fix:** all 4 premium docs (invoice/receipt/prescription/statement) via `openDocumentPreview(spec)` → `buildDocument` — single spec re-rendered at chosen paper size; preview ≡ print ≡ PDF 80mm/A4/A5/Letter. — FIXED+VERIFIED (`doc-engine.test.mjs` 7/7) |
| D2 | 🟢 | Operational docs (patient summary, queue, visit summary, dental chart, expense, appointment slip) intentionally remain on the framed legacy composer — not patient-legal docs. — DOCUMENTED LIMITATION (by design) |
| D3 | 🟢 | DB-MDC registered signature/registration block renders whenever `settings.dentistRegistration` set; clinic website joins contact lines. — VERIFIED |

## E. Scale & performance (fresh, Node 22 linux sandbox, synthetic)
| Patients | List p1 | List w/ aggregates+sort=balance | Aggregated search visits-desc | Statement | Integrity | Backup |
|---|---|---|---|---|---|---|
| 1k | 1.2–4.9ms | 2.3ms | 3.4ms | 0.5ms | 173ms | 127ms |
| 10k | 2.1–8.9ms | 18.9ms | 30.1ms | 0.6ms | — | — |
| 25k | 3.7–6.9ms | 39.8ms | 67.7ms | 0.6ms | 362ms | 323ms (DB 102MB) |
| 100k | 15.9ms | — | — | — | — | last page 138.5ms |
Aggregates = single LEFT-JOIN query (visits / billed / paid / last-payment) — no N+1; UI enables aggregates only when the chosen sort/columns need them (`patientListWantsAggregates`). — VERIFIED

## F. Security (unchanged floor, re-verified)
- Strict IPC validation, parameterized SQL, RBAC enforced server-side (template ops: `prescriptions.edit` / `settings.edit`), no network/telemetry (security test: no `https://` literals outside tests), lock & permissions untouched. UI never probes ops it lacks permission for. — VERIFIED 128/128 suite incl. security suite.

## G. Accessibility & UI system
- Command palette: action verbs + 7 collections, arrow-key navigation, Enter runs focused row, focus rings kept. Chart teeth are real buttons with `aria-pressed` in Multi mode and full labels/tooltips (FDI · Universal). Filters/columns panels keyboard reachable. Density toggle persists per clinic. — VERIFIED
- Bangla: +52 strings covering prescription builder, receipt, statement, chart, palette (`translateDom` long-match scan prevents English residue). — VERIFIED

## H. Dead UI & placeholders
- No TODO/FIXME/coming-soon in shipped code; no fake statistics; templates are clinician-authored only and the UI says exactly that; no autonomous diagnose/prescribe. This was lint-scanned after each cluster. — VERIFIED

## I. Windows installed-app validation & release
| # | Sev | Finding |
|---|---|---|
| I1 | 🔴 | *(§14: release deliberately NOT published during expanded audit; see checkpoint)* | **Cannot run in this sandbox:** `GH_TOKEN is no longer valid` — push/`gh`/CI proof/release publish all return 403; sandbox has no Windows. **Impact:** the Windows CI gate re-run proof, NSIS build, installed-app validation (clean install→login→workflows→PDF→print→restart→persistence→upgrade→uninstall) and v1.6.0 release publication are BLOCKED on the user reconnecting GitHub in Arena. — DOCUMENTED LIMITATION (external; queue resolved commands in FLAGSHIP_UPGRADE_STATE.md §NEXT EXACT ACTIONS) |
| I2 | 🟢 | Release pipeline scripts unchanged since v1.5.2's green CI; packaging/release-gate tests green locally (128/128). — VERIFIED locally |

## J. Defects fixed en route (root causes)
- `repo.setSettings` phantom API — settings persist exclusively via `repo.setMeta('settings', next)`; internal guard. FIXED.
- `listQuery` silently dropped sort overrides (sort never reached backend) — `sort:` now extracted out of `filters` overrides. FIXED.
- `loadUiPreferences()` dead (defined, never called) — wired at boot. FIXED.
- Duplicate object key `calendar` in ICONS — removed pre-commit. FIXED.
- Search-row visits linked by visit id (wrong entity) → open-patient-profile with `patientId`; duplicate `data-id` attribute removed. FIXED.
- `selectField()` signature misuse dropped the payment-method change hook — merged into one `extra` string. FIXED.
- Security scanner false-blocked `https://clinic.example.com` placeholders → protocol stripped from placeholding. FIXED.
- Version-drift test hardcodes replaced by derived expectations (`APP_VERSION ↔ package.json`). FIXED.

## K. Test evidence
- Local suite: **133 tests, 131 pass, 0 fail, 2 skipped (benchmarks, manual)** — `npm test` on Node 22.22.
- Batteries exercised: ledger-sql aggregate guards (10), doc-engine (7), journeys (incl. treatmentPlan regression caught+fixed at 2b8d47b), security, packaging, release-gate.
