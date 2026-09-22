# Dentiva Pro third-party dependency and license review

**Reviewed:** 2026-09-22
**Product license:** Dentiva Pro is proprietary; see [`../LICENSE.txt`](../LICENSE.txt).
**Review rule:** Direct runtime and build dependencies must have licenses compatible with commercial distribution. This inventory is evidence for the repository state and is not legal advice.

## Direct dependencies

| Package | Locked version | License | Role | Distribution note |
|---|---:|---|---|---|
| `sql.js` | 1.13.0 | MIT | Offline SQLite engine | Permissive; retain upstream notice if required by the final distribution policy. |
| `electron` | 44.4.3 | MIT | Hardened Windows desktop runtime | Electron's bundled Chromium/Node notices remain part of the packaged runtime. The release workflow should retain the upstream `LICENSES.chromium.html`/Electron notices included by electron-builder. |
| `electron-builder` | 26.15.3 | MIT | Windows portable/NSIS packaging | Build-time only; not shipped as an application feature. |
| `vite` | 6.4.3 | MIT | Renderer production build | Build-time only. |
| `@vitejs/plugin-legacy` | 6.1.1 | MIT | Legacy browser build support | Build-time only. |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Windows CI visual checks | Test/CI-only; not included in the application package. |

Versions above are read from the installed lockfile-resolved packages on the audit date. `package-lock.json` is the source of truth for CI installation.

## Verification commands

```bash
npm ci --ignore-scripts
npm audit --json
node -e "for (const p of ['sql.js','electron','electron-builder','vite','@playwright/test']) console.log(p, require('./node_modules/' + p + '/package.json').license)"
```

On 2026-09-22, `npm audit --json` reported **0 info, 0 low, 0 moderate, 0 high and 0 critical vulnerabilities** for the complete installed dependency tree after upgrading Electron to 44.4.3 and electron-builder to 26.15.3. `npm audit --omit=dev` also reported zero vulnerabilities.

The prior local audit identified vulnerabilities in the old Electron 33/electron-builder 25 development toolchain. That toolchain was upgraded rather than ignored; the resolved audit is the evidence used for the published v1.3.0 release.

## Commercial distribution boundary

The Windows ZIP is assembled from the built application and selected documentation, not from `node_modules`. The Electron runtime carries its own upstream notices. Before broad commercial distribution, the owner should review the exact packaged `resources` directory and confirm that the release ZIP includes any notices required by Electron/Chromium and transitive packages. No dependency is presented as a substitute for that final legal review.
