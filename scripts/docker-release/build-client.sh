#!/bin/bash
# Build unsigned ArcadeLauncher desktop bundles inside al-client-builder.
#   /src  = ArcadeLauncher-Unified-Client checkout (read-only)
#   /out  = artifacts
# Usage: build-client.sh v0.15.34
# Signing (.sig) happens afterwards on a GitHub-hosted runner that holds the
# updater key secret, so createUpdaterArtifacts is switched off here.
set -euo pipefail
TAG="$1"
rm -rf /work/app && mkdir -p /work/app /out
cd /src && tar --exclude=node_modules --exclude=src-tauri/target -cf - . | tar -C /work/app -xf -
cd /work/app
npm ci --no-audit --no-fund --loglevel=error
node scripts/set-version.mjs "$TAG"
NOSIGN='{"bundle":{"createUpdaterArtifacts":false}}'

echo "=== updater sidecars"
mkdir -p src-tauri/binaries
cargo build --release -p arcade_updater --manifest-path src-tauri/Cargo.toml
cp "$CARGO_TARGET_DIR/release/updater" src-tauri/binaries/updater-x86_64-unknown-linux-gnu
cargo xwin build --release -p arcade_updater --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
cp "$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release/updater.exe" src-tauri/binaries/updater-x86_64-pc-windows-msvc.exe

echo "=== windows (NSIS, cross)"
npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --config "$NOSIGN"
cp "$CARGO_TARGET_DIR"/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe /out/

echo "=== linux (deb, rpm, AppImage)"
npx tauri build --bundles deb,rpm,appimage --config "$NOSIGN"
cp "$CARGO_TARGET_DIR"/release/bundle/deb/*.deb "$CARGO_TARGET_DIR"/release/bundle/rpm/*.rpm \
   "$CARGO_TARGET_DIR"/release/bundle/appimage/*.AppImage /out/
ls -l /out
