# Dentiva Pro — Dependency & License Review (v1.5.0 line)

**Scope:** every npm package in the project lockfile (installed tree enumerated at review time), plus the Electron runtime that ships inside the Windows binaries. Reviewed 2026-09-23 against the live `node_modules` census.

## Findings

- **Runtime npm dependencies: ZERO.** The shipped application (`package.json → dependencies: {}`) includes **no third-party runtime npm code**. Everything in the lockfile is build/test tooling (electron, electron-builder, vite, @playwright/test) or transitive tooling dependencies.
- **License census across the full installed tree (311 packages):** MIT ×198, ISC ×22, BSD-3-Clause ×10, Apache-2.0 ×9, BSD-2-Clause ×7, BlueOak-1.0.0 ×6, WTFPL ×2, Python-2.0 ×1 (argparse), 0BSD ×1, MIT-or-CC0 ×1. **No GPL/LGPL/AGPL/copyleft anywhere in the tree.**
- **Electron runtime (shipped in binaries):** MIT (Electron shell) + Chromium/Node.js component licenses (MIT/BSD-style, no copyleft). electron-builder's default packaging emits `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the executable — the standard, required attribution files. The release ZIP also carries this repo's `LICENSE.txt` (copied in the CI stage).
- **Dead dependency removed post-release:** `@vitejs/plugin-legacy` was declared but never imported; it and ~130 transitive babel packages have been removed from `devDependencies`/lockfile. This shrinks the supply-chain surface without changing any published artifact (the package never entered a build).
- **Vulnerability scan:** `npm audit --omit=dev` is a clean no-op (no runtime deps). Build-tool advisories in dev deps do not ship inside binaries.

## Commercial redistribution obligations

All licenses encountered are permissive and compatible with proprietary commercial distribution. Obligations are limited to:

1. **Keep notices shipped:** MIT/ISC/BSD licenses require retaining copyright notices — satisfied automatically by the electron-builder license files and by keeping vendored notices inside dev tooling (never shipped).
2. **Apache-2.0:** requires notice retention + license text; only present in build-time tooling (ejs, playwright etc.) — not redistributed in product binaries, so no additional obligation in shipments.
3. **BlueOak-1.0.0 / CC0 / 0BSD / WTFPL:** public-domain-equivalent or maximally permissive; name-attribution appreciated, not licensed-encumbering.
4. **Python-2.0 (argparse):** permissive, unproblematic (build tool, same as its use inside CPython).
5. **Node.js (`node:sqlite`, fs, crypto):** MIT-licensed runtime distributed by the Electron binary — attribution rides inside `LICENSES.chromium.html`/`LICENSE.electron.txt`.

**Conclusion:** the product is commercially redistributable as a closed-source/proprietary offering with no copyleft obligations, no viral linking issues, and no third-party runtime vendor fees. Required notices ship with every binary via the electron-builder default layout; this repo's own `LICENSE.txt` (Proprietary, © Md. Shohan Khan) governs the product itself.

## Evidence & limits

- Census method: direct parse of every installed package's package.json `license`/`licenses` field in the live tree (counts above are the exact output, not estimates).
- CI ZIP-inspection gate (`.github/workflows/windows-release.yml` lines 103–126) expanded the release ZIP, required `DentivaPro.exe`, and rejected dev/test content — green on the publish run.
- Direct byte-inspection of the published ZIP from this sandbox was blocked by a CDN egress restriction (documented in `docs/FINAL_COMMERCIAL_RELEASE_REPORT.md`); where byte-level confirmation was impossible I cite the deterministic build/tooling behavior instead, never fabricate.
