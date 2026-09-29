# Local Docker release (no self-hosted runners)

Use this when the self-hosted runners are off. It builds on a workstation with
Docker Desktop (Linux engine) and uses only GitHub-hosted runners in CI.

1. **Build.** From PowerShell, with `C:\Program Files\Docker\Docker\resources\bin`
   on PATH:
   ```powershell
   docker build -t al-client-builder -f scripts/docker-release/Dockerfile scripts/docker-release
   docker run --rm -v "<repo>:/src:ro" -v "<repo>/scripts/docker-release:/build:ro" `
     -v "<outdir>:/out" -v al-cargo-reg:/usr/local/cargo/registry `
     -v al-client-rel-target:/target -v al-xwin-cache:/root/.cache `
     -e CARGO_TARGET_DIR=/target al-client-builder bash /build/build-client.sh vX.Y.Z
   ```
   The build script needs LF line endings. This produces an unsigned
   `_x64-setup.exe` (NSIS, cross-compiled with cargo-xwin), plus `.deb`, `.rpm`
   and `.AppImage`. There's no MSI: the release is NSIS-only since `0ef21eb` (ICE38).
2. **Draft.** Disable `release.yml` first. A tag push would otherwise start it
   on the offline runners.
   ```sh
   gh workflow disable release.yml
   gh release create vX.Y.Z --draft --target main --title "ArcadeLauncher vX.Y.Z" --notes "..." <outdir>/*
   ```
3. **Sign and build deltas** on a GitHub-hosted runner, using the updater key secrets:
   ```sh
   gh workflow run sign-release.yml -f release_id=<draft id> -f version=X.Y.Z
   ```
   This uploads the `.sig` files, `latest.json` (GitHub URLs), qbsdiff `.patch`
   files built against the installers currently served, and `latest.server.json`.
4. **Verify.** Check every `.sig` against the pubkey in `tauri.conf.json` with
   `minisign -Vm`. `qbspatch old new patch` must reproduce the new file's sha256.
5. **Stage** on the download server at the k3s node's
   `/srv/arcade-library/.arcadelauncher/downloads`. Replace the desktop
   installers and `*.patch` files. Install `latest.server.json` as `latest.json`.
   Leave the APKs and `android-latest.json` alone unless the release includes Android.
6. **Publish and re-enable:** `gh release edit vX.Y.Z --draft=false --latest`, then
   `gh workflow enable release.yml`. The Discord changelog job runs when the
   release is published.
