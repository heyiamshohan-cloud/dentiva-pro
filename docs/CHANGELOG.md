# Changelog

## v1.4.0 — Relational engine, shared service layer, premium light UI

**Storage**
- Replaced the sql.js whole-state store with a relational `node:sqlite` workspace (layout v1): 26 collection tables, integer-cent money columns, enforced foreign keys, ~40 indexes, WAL journaling, append-only audit.
- Removed every artificial limit: no 200 MB database cap, no 6 MB attachment cap, no record caps. Scale is limited only by hardware (benchmarked: 100,000 patients / 945,086 records, page-1 list 18 ms, backup of a 412 MB store 1.6 s).
- v1.3.0 migration (v4 sql.js DB, legacy JSON, corrupt-primary `.bak` recovery, future v5 `.bak` recovery): quarantines orphans with reasons, repairs dangling references (column nulled, payload preserved), recomputes exact integer-cent balances, externalizes inline attachment bytes to a file store, sanitizes user secrets, preserves the source file (`.v4-preserved.sqlite`) and is idempotent on re-run.
- Backup engine: consistent `VACUUM INTO` snapshot + attachment files + SHA-256 manifest; restore validates first and always keeps a pre-restore safety backup; v1.3.0 JSON backups restore with module groups (patients / clinical / finance / operations) and Keep Existing / Replace / Create New Copy strategies; folder and file pickers; backup listing, pruning and deletion with containment checks.
- Diagnostics: integrity + FK checks, storage facts, per-collection counts, free disk, issue report; last-shutdown health recorded at quit.

**Service layer**
- Shared `src/ops.js` registry (~50 operations) and `src/queries.js` registry executed by both runtimes (Electron main SqlRepo, browser LocalRepo) — one source of truth for validation, money math, inventory guards and audit.
- Financial invariants enforced server-side: overpayment blocked; invoice re-pricing blocked once payments/adjustments exist (explicit error, never silent); refunds write Refund entries and never mutate the original payment; adjustments capped at the due balance; patient balance cache always consistent (including forgiveness adjustments).
- Server-side RBAC on every operation and query; audit entries written server-side and attributed to the live session; session timeout from settings.
- Auth: PBKDF2-SHA-256 with per-user salt (210k iterations; v1.3.0 120k renderer hashes verified and upgraded on first successful login); 5-failure/30-second lockout persisted in the users table; first-run setup creates the administrator account.
- New operations: `workspace.reset` (typed-RESET confirm; wipes records, preserves accounts + settings), `medicationCatalog.save`, `dental.removeCurrent`, `invoice` reprice-lock, movement vocabulary normalization (v1.3.0 `Stock-out`/`Expired`/`Damaged` mapped onto the canonical vocabulary).

**IPC / Electron**
- ESM main process (`electron/main.mjs`) importing the shared service layer; hardened window (context isolation, no Node integration, sandbox, web security); navigation + webview guards; CSP `frame-ancestors 'none'`; single-instance lock; graceful shutdown with health metadata; future-layout guard (`unsupportedSchema`) blocks silent overwrite and offers export + reset.
- Preload exposes a single allowlisted `invoke` (19 channels); all identity comes from the main-process session — never from the renderer.
- PDF printing through an isolated, script-disabled window with blocked-content validation; receipts support the 80 mm profile.

**Renderer**
- Rebuilt as an async, server-side-paginated client over `src/api.js` (DesktopApi / LocalApi). No page hydrates a full collection; lists paginate with server counts; patient lookups resolve through a capped directory query.
- Design System 2.0, light-only: design tokens, premium shell, dashboard 3.0 (configurable widgets), ⌘K command palette, queue 2.0, dental chart 2.0 (preserved tooth history, dentitions), patient timeline, statements, accounting with receivables aging, analytics with monthly trends, diagnostics, notifications 2.0, saved views, first-run setup, local lock.
- Localization: 449-entry EN/BN dictionary carried over 1:1, bn-BD number/date formatters, `translateDom` pass over rendered output.
- All v1.3.0 workflows preserved: patients (merge, CSV import/export, saved views), appointments (day/week/agenda, overlap confirm), queue, visits, dental, prescriptions (medication catalog), treatment plans (stage cycling, explicit visit conversion), billing (reprice lock), payments/refunds/adjustments, expenses, inventory (movements, low stock, expiry), suppliers, staff, referrals, follow-ups, attachments (inert previews, on-demand content), users (effective-permission grid), settings, backup/restore (module groups + strategies), notifications, printing (invoice, receipt, prescription, statement, chart, queue, billing, visit, expense, patient summary).

**Testing**
- 55-test `node:test` suite: smoke (architecture + guardrails + i18n), security (boundary, PDF, no telemetry, no caps, PBKDF2, server-side RBAC), storage (relational persistence, v4/legacy/corrupt migration, backup round-trip with tamper rejection, FK violation detection), workflows (financial formulas, restore strategies, RBAC templates), domain.
- Functional suites verified against both repos: ~60-check ops/queries smoke (SQL + browser parity) and backup/restore/diagnostics round-trip.
- Scale benchmark on the real store: 1k / 10k / 25k / 100k patients.
- `npm audit`: 0 vulnerabilities. Zero runtime dependencies.

**Known limitations**
- The Electron GUI cannot run in the Linux sandbox; the packaged-app smoke (launch/restart persistence, PE checks, packaging) runs in Windows CI as release gating.
- Installed-app launch/restart/uninstall smoke remains manual user verification (unchanged policy from v1.3.0).

## v1.3.0 — Flagship command center

See `docs/FINAL_AUDIT_REPORT_1.3.0.md`.

## v1.2.0 and earlier

Preserved releases; see tags.
