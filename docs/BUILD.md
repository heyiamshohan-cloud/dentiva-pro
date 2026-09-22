# Build and release

## Requirements

- Node.js 22.12 or newer (the Electron 44 toolchain requires the current Node 22 line)
- npm 10 or newer
- Windows packaging is provided by Electron Builder and targets a self-contained portable Windows x64 executable plus an assisted NSIS installer that remains per-user capable; machine scope is selected by default for current Windows compatibility.

## Development

```bash
npm install
npm run dev
```

The Vite workspace binds to `0.0.0.0` so it can be previewed from a local network or a sandbox preview.

## Production web build

```bash
npm run build
npm run preview
```

The output is written to `dist/` and is intentionally ignored by Git.

## Windows portable package

```bash
npm run dist:win
```

The v1.3.0 build targets are `release/Dentiva-Pro-1.3.0-Windows-x64.exe` and `release/Dentiva-Pro-1.3.0-Windows-x64-Setup.exe` when run on a machine with access to the Electron binary cache. The package is configured with an application ID, multi-size ICO icon, asar packaging, non-admin execution and no publish target. Windows CI run `35708916503` passed tests/build, Chromium checks at all six required viewports, PE `MZ` verification for both EXEs, the blocking portable create/restart persistence smoke, delivery ZIP content inspection and SHA-256 self-validation. It uploaded the artifact contract outputs; an explicit workflow-dispatch run is still required to create the new v1.3.0 tag/release. The installed-app launch/restart/uninstall smoke is intentionally excluded from automated release blocking and remains manual user verification.

For a portable source + built-renderer delivery package that does not include `node_modules`, use:

```bash
npm run package:release
```

This creates a versioned source + built-renderer delivery ZIP for the current package version; it is not a substitute for the four Windows release artifacts.

## Release hygiene

Do not commit `node_modules`, `dist`, `release`, local backups, screenshots containing patient data or logs containing sensitive data. Use the structured in-app backup for clinic data, not source control. Never overwrite an existing release tag; update `package.json`, `package-lock.json`, renderer metadata, README, changelog and docs together.
