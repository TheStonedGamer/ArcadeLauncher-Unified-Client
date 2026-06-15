# Packaging

ArcadeLauncher ships the same app on Windows and Linux from one Tauri project.
This directory documents the per-distro packaging story.

## Distro matrix

| Platform            | Artifact                  | How it's produced                          |
|---------------------|---------------------------|--------------------------------------------|
| Windows             | NSIS installer (`.exe`)   | `tauri build` (per-user install)           |
| Debian / Ubuntu     | `.deb`                    | `tauri build` (bundled by default)         |
| Fedora / RHEL       | `.rpm`                    | `tauri build` (bundled by default)         |
| Any Linux           | AppImage                  | `tauri build` (bundled by default)         |
| Arch / Manjaro      | AUR package (`PKGBUILD`)  | `packaging/arch/PKGBUILD`                  |

`bundle.targets` is `"all"`, so a Linux `tauri build` emits `.deb`, `.rpm`, and
an AppImage in `src-tauri/target/release/bundle/`. The `.deb`/`.rpm` dependency
lists and the `Game` desktop category are set in `src-tauri/tauri.conf.json`.

## Building the bundles

```sh
npm ci
npm run tauri build           # native bundles for the current OS
```

Build host requirements:

- **Debian/Ubuntu:** `libwebkit2gtk-4.1-dev build-essential curl wget file
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- **Arch:** `webkit2gtk-4.1 gtk3 libayatana-appindicator base-devel rust nodejs npm`

## Arch / AUR

`packaging/arch/PKGBUILD` is a **source** package: it clones the tagged release,
runs `tauri build --bundles none` to compile the release binary, and installs it
with `arcadelauncher.desktop` and the hicolor icons.

Local test build:

```sh
cd packaging/arch
makepkg -si
```

### Publishing to the AUR (later)

1. Bump `pkgver` to match the released tag (`vX.Y.Z`).
2. `makepkg --printsrcinfo > .SRCINFO`.
3. Push `PKGBUILD`, `.SRCINFO`, and `arcadelauncher.desktop` to the AUR git repo
   `ssh://aur@aur.archlinux.org/arcadelauncher.git`.

Once GitHub Releases publish a `.deb`/AppImage, add an `arcadelauncher-bin`
PKGBUILD that downloads and repackages the prebuilt artifact (no Rust/Node build
on the user's machine) — the faster, more common AUR path.

> **Note:** the Tauri auto-updater (`createUpdaterArtifacts`) targets the
> Windows and AppImage builds. Distro-packaged installs (`.deb`/`.rpm`/AUR)
> update through the system package manager, not the in-app updater.
