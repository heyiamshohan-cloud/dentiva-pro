# Build and release

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Windows packaging is provided by Electron Builder and targets a self-contained portable Windows x64 executable.

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

The build targets are `release/Dentiva-Pro-1.0.0-Windows-x64.exe` and `release/Dentiva-Pro-1.0.0-Windows-x64-Setup.exe` when run on a machine with access to the Electron binary cache. The package is configured with an application ID, multi-size ICO icon, asar packaging, non-admin execution and no publish target.

For a portable source + built-renderer delivery package that does not include `node_modules`, use:

```bash
npm run package:release
```

This creates `release/Dentiva-Pro-1.0.0-source.zip`.

## Release hygiene

Do not commit `node_modules`, `dist`, `release`, local backups, screenshots containing patient data or logs containing sensitive data. Use the structured in-app backup for clinic data, not source control.
