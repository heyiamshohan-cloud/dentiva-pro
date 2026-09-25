# Build and release — v1.4.0

## Requirements

- Node.js 22.12 or newer — the Electron 44 toolchain requires the current Node 22 line, and the store engine is Node's **built-in `node:sqlite`** (SQLite 3.51.3). There are **no native npm dependencies** to compile, which is also why the package ships with zero runtime dependencies.
- npm 10 or newer
- Windows packaging by Electron Builder: self-contained portable x64 executable plus NSIS installer.

## Development

```bash
npm install
npm run dev             # Vite dev server — browser mode (LocalRepo + WebCrypto PBKDF2)
npm test                # node:test suite (55 tests)
npm run benchmark:datasets
npm run start:desktop   # production build + Electron (desktop mode, SqlRepo)
```

Browser mode exercises the exact same `src/ops.js` / `src/queries.js` service
layer as desktop; only the repository and the KDF differ. The workspace
persisted by browser mode uses the classic state shape, so a v1.3.0 dataset in
the browser remains migratable by the desktop app.

## Production web build

```bash
npm run build           # dist/ (git-ignored)
npm run preview
```

## Windows packages

```bash
npm run dist:win        # release/Dentiva-Pro-1.4.0-Windows-x64.exe + -Setup.exe
```

The Electron main process is ESM (`electron/main.mjs`, package `"type":
"module"`); the preload stays CJS (`electron/preload.cjs`) because sandboxed
preloads must be CommonJS. `asar` packaging needs no native-module
`asarUnpack` because nothing native is loaded.

Windows CI (`.github/workflows/windows-release.yml`) gates the release on:
tests, production build, Chromium viewport checks, portable/NSIS packaging,
PE `MZ` inspection, the portable launch/restart persistence smoke
(`DENTIVA_SMOKE=1`, phases `create` and `verify`), ZIP content inspection and
independent SHA-256 verification, then publishes the artifact contract:

- `Dentiva-Pro-1.4.0-Windows-x64.exe`
- `Dentiva-Pro-1.4.0-Windows-x64-Setup.exe`
- `Dentiva-Pro-1.4.0-Windows-x64.zip`
- `Dentiva-Pro-1.4.0-checksums.txt`

Normal branch pushes run verification only; the controlled release commit
(`[publish-release]`) enables publication. The installed-app
launch/restart/uninstall smoke remains manual user verification.

## Release hygiene

Do not commit `node_modules`, `dist`, `release`, local backups, screenshots
containing patient data or logs containing sensitive data. Use the in-app
backup for clinic data, never source control. Never overwrite an existing
release tag; update `package.json`, renderer metadata, README, changelog and
docs together.
