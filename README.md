# ArcadeLauncher — Unified Client

One cross-platform desktop client for ArcadeLauncher, built on **Tauri v2**
(Rust core) + **React** + TypeScript. Replaces the two native UI codebases
(Windows C++/Direct2D + Linux C++/nanovg) with a single codebase that runs on
Windows and Linux.

**Install model:** Steam-style. Per-user install (`%LocalAppData%` / `~/.local`),
so admin is needed at most once and **updates never require admin** (Tauri's
signed updater).

**Releases:** [GitHub Releases](https://github.com/TheStonedGamer/ArcadeLauncher-Unified-Client/releases/latest)
— Windows NSIS, Linux `.deb`/`.rpm`/AppImage, signed in-app updater.

The phase plan lives in [`ROADMAP.md`](docs/ROADMAP.md). The native C++ clients are
retired as of T10c; this is the sole shipping client.

## Architecture (modular by design)

```
src/                         # React frontend
  app/        AppShell.tsx    # top-level shell (header, nav slot)
  features/                   # one folder per feature, self-contained
    catalog/                  #   model, api, hook, view, components
    updater/                  #   update check + banner
  lib/        ipc.ts          # typed invoke wrapper (single IPC surface)
  styles/     global.css

src-tauri/src/               # Rust backend
  lib.rs                      # thin: registers plugins + command handlers only
  error.rs                    # AppError / AppResult
  catalog/                    # model, loader, commands  (library.json)
  launch/                     # runner, commands         (spawn games)
```

Each file is small and single-responsibility — features compose via their `mod`
/ feature folder, so growth means new files, not bigger ones.

## Develop

```sh
npm install
npm run tauri dev      # run the app
npm run build          # frontend typecheck + build
cd src-tauri && cargo test
```

### Linux build deps

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Arch Linux — build from source

Arch (and derivatives: Manjaro, EndeavourOS) doesn't get a prebuilt package, so
build it from source. The steps below take a clean Arch box to a running app.

### 1. System dependencies

```sh
# Toolchains + Tauri v2 system libraries (one command)
sudo pacman -S --needed \
  base-devel \
  rust \
  nodejs npm \
  webkit2gtk-4.1 \
  curl wget file \
  openssl \
  gtk3 \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

- `base-devel` — gcc, make, pkg-config (the C toolchain Tauri/`cargo` need).
- `rust` — the Rust core. (Prefer [`rustup`](https://archlinux.org/packages/extra/x86_64/rustup/)
  if you want to manage toolchains: `sudo pacman -S rustup && rustup default stable`.)
- `nodejs npm` — frontend build (React + Vite).
- `webkit2gtk-4.1` — the webview Tauri v2 renders into (the key dep).
- `libappindicator-gtk3` — system-tray support; `xdotool` provides `libxdo`
  (global hotkeys); `librsvg` renders the SVG app icon.

### 2. Clone and build

```sh
git clone https://github.com/TheStonedGamer/ArcadeLauncher-Unified-Client.git
cd ArcadeLauncher-Unified-Client

npm install              # JS deps
npm run tauri dev        # run the app (dev)

# …or produce installable bundles:
npm run tauri build      # outputs to src-tauri/target/release/bundle/
```

`npm run tauri build` on Arch yields an **AppImage** and an **RPM** under
`src-tauri/target/release/bundle/`. For a plain native binary, use
`src-tauri/target/release/arcade-launcher-unified-client` directly.

> **Tip:** if `cargo`/`rustc` aren't on `PATH` after installing `rustup`, run
> `source "$HOME/.cargo/env"` (or open a new shell).

## Updater signing

The updater requires a signing keypair. The **public** key lives in
`src-tauri/tauri.conf.json`; the **private** key must never be committed. For
releases, set these CI secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (empty if none)
