#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
STAGE="$ROOT/.release-stage/Dentiva-Pro"
OUT="$ROOT/release/Dentiva-Pro-${VERSION}-source.zip"

rm -rf "$ROOT/.release-stage" "$OUT"
mkdir -p "$STAGE/Application" "$STAGE/Documentation" "$STAGE/Source"
cp -R "$ROOT/dist" "$STAGE/Application/WebApp"
cp -R "$ROOT/electron" "$STAGE/Application/DesktopShell"
cp -R "$ROOT/docs/." "$STAGE/Documentation/"
cp -R "$ROOT/src" "$STAGE/Source/src"
cp -R "$ROOT/public" "$STAGE/Source/public"
cp -R "$ROOT/tests" "$STAGE/Source/tests"
cp "$ROOT/index.html" "$ROOT/vite.config.js" "$ROOT/.gitignore" "$ROOT/scripts/package-release.sh" "$STAGE/Source/"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE.txt" "$STAGE/LICENSE.txt"
cp "$ROOT/CHANGELOG.md" "$STAGE/CHANGELOG.md"
cp "$ROOT/package.json" "$STAGE/package.json"
cp "$ROOT/package-lock.json" "$STAGE/package-lock.json"
cat > "$STAGE/README.txt" <<EOF
Dentiva Pro ${VERSION} — source release package

The Application/WebApp folder contains the built offline-first workspace.
The Application/DesktopShell folder contains the hardened Electron shell and Windows portable target configuration.
See README.md and Documentation/BUILD.md for build and release instructions.
EOF
mkdir -p "$ROOT/release"
(cd "$ROOT/.release-stage" && zip -qr "$OUT" Dentiva-Pro)
rm -rf "$ROOT/.release-stage"
printf 'Created %s\n' "$OUT"
