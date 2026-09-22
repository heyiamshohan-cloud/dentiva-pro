# Dentiva Pro 1.1.0 final audit, QA and release report

**Audit date:** 2026-09-22 (Asia/Dhaka)  
**Repository:** `heyiamshohan-cloud/dentiva-pro`  
**Working branch:** `arena/01a0c66a-dentiva-pro`  
**Release:** [Dentiva Pro v1.1.0](https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.1.0)  
**Baseline:** 1.0.0 source/release state; `v1.0.0` remains intact.  

This report records what was implemented and what was actually verified. It does not convert a source label, route or button into a behavioral PASS. The complete 150-row atomic matrix is [AUDIT_TRACEABILITY.md](AUDIT_TRACEABILITY.md).

## 1. Executive result

Dentiva Pro 1.1.0 is a new release, not an overwrite of 1.0.0. The application was upgraded and hardened around an offline, local, single-profile workflow. The release workflow successfully produced and published all four required Windows x64 delivery assets:

- a Windows x64 portable PE executable;
- a Windows x64 per-user NSIS installer;
- a complete application ZIP assembled without source `node_modules`, repository `.git`, tests or test data;
- a SHA-256 checksum text file.

The domain and persistence audit is substantially complete. The release is not marketed as multi-user authorization software, encrypted database software, arbitrary-printer-driver software or a fully translated Bengali product. GUI screenshot review at every requested resolution and launching the Windows app are recorded as outstanding verification boundaries because they were not performed by the available Linux sandbox.

### Atomic scorecard

| Classification | Rows | Meaning |
|---|---:|---|
| PASS | 123 | Implementation path plus executable/static/build/release evidence is recorded. |
| INCOMPLETE | 20 | Implementation is present, but visual, desktop runtime or another specified verification remains outstanding. |
| LIMITATION | 6 | Deliberate product boundary documented to the operator. |
| ARCHITECTURALLY DEFICIENT | 1 | The requested stronger multi-user/authorization architecture is not provided by this product boundary. |
| **Total** | **150** | No requirement is left `OPEN`; baseline findings remain visible in the matrix. |

`DEFECTIVE`, `LOW-QUALITY`, `MISSING` and `UNSUPPORTED` are retained as baseline-finding language where applicable; no final row is silently left in one of those states. Unsupported behavior is classified as `LIMITATION` where the product intentionally declines to claim it.

## 2. What changed

### Clinical and operational workflows

- Kept the empty-store guarantee: no patients, appointments, transactions or demo data are seeded.
- Preserved relational patient history across visits, appointments, prescriptions, dental chart records, referrals, attachments, invoices, payments and follow-up tasks.
- Added patient pagination and filters for status, visit period, tooth status and balance; added searchable audit activity.
- Added appointment duration/resource overlap detection for chair and dentist conflicts, with an explicit save-after-warning decision.
- Added clinical attachment categorization, visit linking, metadata editing, safe image preview, download and deletion with a 6 MB allowlist boundary. PDF and other non-image files are downloaded instead of being embedded as active inline content.
- Kept clinical safety wording: the product records professional input and does not diagnose or prescribe automatically.

### Financial and inventory integrity

- Made invoice totals deterministic in integer cents: subtotal minus discount plus tax; tax is configurable for new invoices and stored per invoice.
- Reworked payment status as a derived source of truth from payment and refund adjustment records.
- Added partial/full/excessive payment validation, configurable payment methods, printable receipts, append-only refunds and auditable adjustment reasons.
- Added two-decimal money validation to invoice, refund and expense entry paths.
- Added inventory purchase, usage, stock-out, expiry, damage and correction movements with before/after quantities and negative-stock protection.
- Separated operating expenses from patient billing and preserved report reconciliation.

### Backup, restore and migration safety

- Added schema-v2 migration defaults and an explicit future-schema block that preserves data and prevents silent downgrade/overwrite.
- Added canonical SHA-256 payload hashes, manifest record counts, schema/product checks, attachment type/size/data validation and relationship validation.
- Added dry-run restore preview, module groups, patient-scoped selection, conflict strategies, relationship-safe Create New Copy remapping, duplicate/conflict reporting and snapshot rollback.
- Fixed restore UI module selection to use the named `clinical`, `finance`, `operations`, `settings` and `patients` groups mapped by the domain layer.
- Added regression tests for malformed relationships, orphaned payment adjustments, hash stability, patient selective restore, ID remapping and rollback paths.

### Electron and release hardening

- Hardened the Electron shell with context isolation, sandbox, no Node integration, web security, navigation/webview restrictions, CSP, blocked active/remote PDF resources and renderer crash reload handling.
- Replaced fragile desktop persistence with a bounded atomic fsync/rename JSON store and last-known-good recovery backup. A corrupt current store is not rotated over the recovery copy.
- Kept browser preview/localStorage as a documented fallback; the Windows desktop profile is the supported production persistence target.
- Added A4, Letter and 80 mm Receipt print profiles and hardened desktop HTML-to-PDF export. The OS dialog remains responsible for physical printer selection and copies.
- Added a Windows x64 workflow that builds, verifies PE headers, inspects application ZIP contents, generates and self-validates checksums, publishes a new release and uploads workflow artifacts.

## 3. Verification record

### Local Linux sandbox

| Check | Result | Evidence |
|---|---|---|
| `npm run check` | **PASS** | 29 Node tests passed; Vite production build passed. Latest build output: 203.01 kB JS, 72.13 kB CSS, 57.84/13.53 kB gzip. |
| `node --check electron/main.cjs` | **PASS** | Electron main process syntax check passed. |
| `git diff --check` | **PASS** | No whitespace errors in the final changesets. |
| Production preview | **PASS** | Vite preview on `0.0.0.0:4174` returned HTTP 200; built `index` was 981 bytes and referenced the hashed production bundle. |
| Service-worker shell route | **PASS** | `/sw.js` returned HTTP 200 from the production preview. |
| Electron local launch | **NOT AVAILABLE** | The installed Electron package had no binary. `npm rebuild electron` reached the sandbox TLS/certificate boundary (`unable to verify the first certificate`); no fake local desktop PASS is claimed. |
| Browser GUI automation | **NOT AVAILABLE** | No Chromium/Playwright/Puppeteer GUI runner is installed in the sandbox; visual and end-to-end DOM interaction rows remain `INCOMPLETE`. |

### Automated regression suite

The 29 tests cover:

- Electron isolation/navigation/CSP and bounded atomic persistence;
- PDF active/remote-content blocking and safe attachment boundaries;
- no cloud telemetry, diagnostic HTTP client or runtime dependency API;
- schema/collection structure and future-schema preservation;
- invoice cents/tax/due calculations, payment/refund edge cases and two-decimal money validation;
- patient duplicate matching, relational history, inventory signals and appointment resource overlap;
- backup manifest/hash behavior, malformed backups, relationship errors, patient-scope restore and Create New Copy remapping;
- source release identity and Windows target configuration.

### Performance sample

This is a repeatable domain-helper benchmark, not a claim of a fully automated browser rendering benchmark. It used Node.js 22.22.3 against generated empty-clinic records with one visit per patient.

| Patient/visit rows | Relationship validation | Canonical serialization | Canonical payload bytes | Errors |
|---:|---:|---:|---:|---:|
| 1,000 | 1.48 ms | 8.41 ms | 89,883 | 0 |
| 5,000 | 5.87 ms | 29.18 ms | 465,883 | 0 |
| 10,000 | 4.69 ms | 36.27 ms | 935,883 | 0 |

The patient directory is paginated at 50 rows per page. A 10,000-patient interactive browser measurement, memory profile and visual review remain part of the `INCOMPLETE` performance/UI classification rather than being inferred from this helper benchmark.

## 4. Windows build and artifact evidence

### Workflow evidence

- **Latest checksum-verification workflow:** [run 35691449396](https://github.com/heyiamshohan-cloud/dentiva-pro/actions/runs/35691449396)
- **Result:** completed successfully.
- **Successful steps:** dependency install; Windows test/build; portable and installer packaging; PE verification; application ZIP assembly and forbidden-content inspection; checksum generation and self-validation; release publication; artifact upload.
- The prior checksum-verification build [run 35691191448](https://github.com/heyiamshohan-cloud/dentiva-pro/actions/runs/35691191448) and initial release build [run 35690886125](https://github.com/heyiamshohan-cloud/dentiva-pro/actions/runs/35690886125) also completed successfully and created the initial v1.1.0 release assets.

The workflow checks the first two bytes of both EXE files for the Windows PE `MZ` signature. It expands the application ZIP and requires `DentivaPro.exe`; it rejects `.git`, `node_modules`, `tests` and `test-data` content. The latest workflow also rehashes every EXE/ZIP and compares each hash to the generated checksum file before publication.

### Published assets

GitHub Release API asset metadata was checked after the latest upload. The API-reported SHA-256 digests are the remote asset digests; sizes are bytes.

| Asset | Size | SHA-256 digest reported by GitHub |
|---|---:|---|
| `Dentiva-Pro-1.1.0-Windows-x64.exe` | 74,377,875 | `6b0047e40869a1c6d9342a3b65c9be85a196323a50622ebd9940721af3bebddf` |
| `Dentiva-Pro-1.1.0-Windows-x64-Setup.exe` | 74,604,244 | `4e9dc53ea203c0c0e5132583fd94266c09df1802e55171e894d7904d5ccc1890` |
| `Dentiva-Pro-1.1.0-Windows-x64.zip` | 148,813,319 | `2e9677efa46975d629cc1428745ef859d391457bf00407c9207c71e4af69fbf7` |
| `Dentiva-Pro-1.1.0-checksums.txt` | 309 | `cf506b451b64ac949e3c05a20fc89461fb96cf0702cc18c87ad0167064510ea0` |

The sandbox could not complete a direct CDN download of the large release assets because the release-assets connection returned EOF/SSL errors. Therefore this report does not pretend to have independently rehashed downloaded bytes locally; it records the successful Windows runner's self-validation and the authoritative GitHub asset digests instead.

## 5. Repository and version evidence

- Final application implementation commit: `0f73d50c07cd4902bc81992995a945f155b7f209` (`release: audit and harden Dentiva Pro 1.1.0`).
- Checksum workflow hardening commit: `f43551f647e9218ad222c776ad6834d59923f7eb` (`ci: verify release checksums before publishing`).
- `package.json` and `package-lock.json`: version `1.1.0`.
- Renderer `APP_VERSION`: `1.1.0`.
- Remote branch `arena/01a0c66a-dentiva-pro` points to the final report commit `39db07f`.
- `v1.0.0` remains at its existing commit; `v1.1.0` is a separate tag/release pointing to the new 1.1.0 implementation commit.
- Release URL: <https://github.com/heyiamshohan-cloud/dentiva-pro/releases/tag/v1.1.0>
- Release assets are not committed to Git; they are published through the GitHub Release and kept out of the source checkout by repository ignore rules.

## 6. Explicit product limitations and residual risk

1. **Desktop runtime launch:** the Linux sandbox could not run the Electron binary, and the Windows CI workflow packaged/verified rather than launching a GUI session. The Windows EXE/installer are genuine PE outputs, but first-launch UI, persistence restart and printer-driver behavior still require a Windows desktop test environment.
2. **Visual QA:** required 1280×720, 1366×768, 1920×1080, 2560×1440 and 3840×2160 screenshot/interaction checks were not possible without a browser GUI runner. Responsive CSS exists, but those rows remain `INCOMPLETE`.
3. **Browser storage:** browser preview uses localStorage and is subject to browser quota/profile loss. The Electron store is the supported clinic target; use verified backups.
4. **Security model:** the local JSON store is not application-level encrypted. Use OS account controls, full-disk encryption and protected backup media. The local PIN is a salted PBKDF2-SHA-256 access lock, not encryption or recoverable identity management.
5. **Roles:** staff roles are descriptive metadata. There is no per-user authorization, multi-user session model, network sync or remote access control.
6. **Localization:** Bengali covers a resource-map/DOM translation layer for common labels; a complete professional translation review of every dynamic message was not claimed.
7. **Printing:** A4, Letter and 80 mm Receipt profiles are supported. Arbitrary custom dimensions and proprietary printer drivers are not claimed; the operating-system print dialog controls the final device.
8. **Attachments:** images can be previewed; PDFs and other non-image files are download-only to avoid embedding active document content. Clinical files are limited to 6 MB and validated against an allowlist.

## 7. Final disposition

The 1.1.0 upgrade is released with the required four Windows delivery artifacts and a traceable audit matrix. The implementation is suitable for continued controlled Windows acceptance testing, with the limitations above visible to the operator. No v1.0.0 asset or tag was overwritten, no demo data was introduced, and no mandatory cloud or paid service was added.
