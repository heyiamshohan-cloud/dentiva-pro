# FINAL COMMERCIAL RELEASE AUDIT — Dentiva Pro v1.5.0

**Audit date:** 2026-09-22 · **Auditor:** Arena Agent (this session, independent re-verification against running code — never docs)
**Method:** every area exercised against the actual tree at release commit; claims require runtime evidence; anything unverifiable is a DOCUMENTED LIMITATION, never a silent pass.
**Legend:** ✅ PASS · 🟡 PASS WITH DOCUMENTED LIMITATION · ❌ FAIL

---

## A. Release blockers from the v1.4.0 forensic audit

| # | Finding | Verification now | Status |
|---|---|---|---|
| 1 | Printing from packaged app silently discarded output (PDF assembled then dropped) | Electron `print:html` + `print:html-pdf` channels implemented with native dialogs, isolated-offscreen render window, `resolvePrintSizeOptions` (A4/A5/Letter/80mm), document logo/toggles honoured; Windows-CI smoke green | ✅ |
| 2 | Notification/reminder engine unwired (page permanently empty; scan never called) | `notifications.scan` executes on login, post-write debounce, 120s interval; derive+reconcile verified on both runtimes (7/7 engine tests); rules toggles persist; `settings.notifications=false` clears auto rows | ✅ |
| 3 | Auto-backup settings dead (no scheduler) | Main-process scheduler: due-logic module + executor (single-flight, collision retry, retention prune, failure recording); real end-to-end test creates a real verified backup on disk and prunes; Backup page shows live scheduler status | ✅ |
| 4 | No global audit-log UI | Activity log page (nav → System): type/user/date/search filters, pagination, secret-stripped detail modal, streaming CSV export gated by `audit.export` | ✅ |
| 5 | 7 "backend-only" capabilities | Re-verified: **only custom patient fields was real** — now shipped (editor/form/profile, clamped definitions). Waitlist/forensics/request-log/signature/templates/progress-ops **never existed in the shipped tree** (op registry enumerated; corrigendum in forensic doc) | ✅ |
| 6 | RBAC: Accountant template; hidden roles | Accountant has a real template; all roles selectable in user management; **v1.4.0 live bug fixed**: Expenses page permission-blocked for everyone | ✅ |
| 7 | Dead settings (`autoLockMinutes`, `showLogo`, rules storage) | Idle lock enforced with activity watchdog; logo/document toggles honoured on printed documents; rules storage unified+normalized | ✅ |
| 8 | Documentation over-claims | USER_GUIDE/README claims re-audited; false claims removed or made true; CHANGELOG v1.5.0 added | ✅ |
| 9 | CI: all recorded runs failed; no green provenance | 6 consecutive green Windows CI runs on this branch (print→notifications→backup→audit→custom-fields→i18n→journeys pipeline, each with tests+build+packaging smoke) | ✅ |
| 10 | Repo topology (skeleton main, product on tags) | Production source of truth is now this branch; tags preserved untouched | ✅ |

## B. Cross-cutting gates

| Area | Evidence | Status |
|---|---|---|
| Financial engine exactness | Integer-cent math; J4/J5 journeys: plan→invoice→partial payment→refund; paid-invoice cancel refused; refund audited; single balance formula (no local rebuilds left) | ✅ |
| Inventory integrity | J6: purchase/usage/correction math; negative stock rejected; immutable ledger w/ before-after, reason, attribution | ✅ |
| Appointment lifecycle | J3 + lifecycle suite: visit closes appointment, timestamps stamped, backward transitions blocked, serial allocation atomic | ✅ |
| Backup/restore | J8: create→validate→restore round-trip on the SQL engine; scheduler E2E; tamper/version-mismatch suites (storage tests) | ✅ |
| Migration/upgrade safety | v1.4.0→v1.5.0 suite: legacy settings preserved, new defaults filled, future schema quarantined without writes | ✅ |
| RBAC/security | J7: receptionist denied admin verbs; op-layer enforcement; session timeout live; idle lock layered on top | ✅ |
| Search & list performance @100k | Re-measured 2026-09-22: 100,000 patients / 945,086 records / 412 MB: page-1 18.7 ms, last-page 165 ms, global search 986 ms, backup 1.9 s, integrity ✓ | ✅ |
| No artificial data limits | No caps in code paths (verified by 100k seed + repricings at 250-page import sizes); physical storage limits only | ✅ |
| EN/BN completeness | Dictionary 548→570+ entries this release; residual-string scan = zero known gaps on shipped surfaces | ✅ |
| Responsive QA | 6-viewport visual harness on CI; queue-grid intrinsic autofill fix; all fixed grids collapse at 1100/760 breakpoints | ✅ |
| Demo/placeholder content | None present (sweep: only legitimate empty states + help copy) | ✅ |
| Dead UI/settings/ops coverage | 56 ops: 30 UI-called; remaining 26 = engine/headless-admin verbs with proven tests (scan, scheduler, backup verbs, accounting ops reachable via reports/settings); zero half-exposed features | ✅ |

## C. Documented limitations (honest, non-blocking)

1. **Native print dialog actuation** cannot be asserted headlessly; markup/validation/preview pipeline is test-covered, and the full app boots on Windows CI; actual dialog display is platform-native (OS window) — manual acceptance note.
2. **`mailto:` integration** opens the OS mail client; cannot be verified in CI. Uses standard protocol; clinic email clients must be configured by the user.
3. **Bengali system fonts** on clean Windows installs rely on OS-provided Nirmala UI; Dentiva Pro does not bundle SolaimanLipi (font-licensing caution) — the language stack falls back gracefully.
4. **No at-rest database encryption** by design decision (threat-model documented); OS-level disk encryption is the recommended clinic posture (documented in USER_GUIDE security section).
5. **Admin account recovery** is deny-by-default (no silent unlock verb, to prevent privilege escalation); recovery path = verified backup/restore + lockout cooldowns. Documented policy.
6. Windows **artefact provenance**: CI publishes only from the `[publish-release]` marker commit; SHA-256 checksums travel with artefacts.

## D. Defect register

No unresolved CRITICAL or HIGH defects at release commit. Two closed this phase: expenses-page permission block (v1.4.0 ship-blocker), custom-field silent-drop.

**Verdict: v1.5.0 is release-ready.**
