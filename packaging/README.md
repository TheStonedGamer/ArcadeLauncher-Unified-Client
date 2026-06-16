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
| Arch / Manjaro      | AUR `-git` package        | `packaging/arch/PKGBUILD` (builds `main`)  |

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

`packaging/arch/PKGBUILD` is a **source `-git` package** (`arcadelauncher-git`):
it clones the `main` branch, runs `tauri build --bundles none` to compile the
current release binary, and installs it with `arcadelauncher.desktop` and the
hicolor icons. `pkgver()` derives the version straight from git
(`<appver>.r<commits>.<hash>`), so reinstalling always rebuilds whatever is out
right now — there is no tag or GitHub Release to manage.

Local test build:

```sh
cd packaging/arch
makepkg -si
```

### Publishing to the AUR (one-time, needs your AUR account)

The `.SRCINFO` is committed alongside the PKGBUILD, so no regeneration is needed
for a `-git` package (its `pkgver` is resolved at build time on the user's
machine). To publish, from a machine with your AUR SSH key registered:

```sh
git clone ssh://aur@aur.archlinux.org/arcadelauncher-git.git aur-arcadelauncher
cp packaging/arch/PKGBUILD packaging/arch/.SRCINFO \
   packaging/arch/arcadelauncher.desktop aur-arcadelauncher/
cd aur-arcadelauncher
git add PKGBUILD .SRCINFO arcadelauncher.desktop
git commit -m "Initial import: arcadelauncher-git"
git push
```

Arch users then install with `yay -S arcadelauncher-git` (or
`paru -S arcadelauncher-git`), which rebuilds the current `main` each time.

Later, once GitHub Releases publish a `.deb`/AppImage, an `arcadelauncher-bin`
PKGBUILD can download and repackage the prebuilt artifact (no Rust/Node build on
the user's machine) — the faster path for users who don't want to compile.

> **Note:** the Tauri auto-updater (`createUpdaterArtifacts`) targets the
> Windows and AppImage builds. Distro-packaged installs (`.deb`/`.rpm`/AUR)
> update through the system package manager, not the in-app updater.
