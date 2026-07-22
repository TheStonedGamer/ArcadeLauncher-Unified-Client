# ArcadeLauncher — Platform Architecture

> A complete tour of what the ArcadeLauncher platform does, how the pieces fit
> together, and how the server and client work — end to end. This document lives
> in the **Unified Client** repo but describes the whole product (server, client,
> companion services, and infrastructure). For per-feature change history see
> [`CHANGELOG.md`](../CHANGELOG.md), [`FEATURES.md`](FEATURES.md), and
> [`ROADMAP.md`](ROADMAP.md). For cold-start operational state see
> [`HANDOFF.md`](HANDOFF.md).

---

## 1. What the platform is

ArcadeLauncher is a **self-hosted, Steam-style game launcher and social
platform** for a personal/home game library. It catalogs a collection of games
(emulated and PC), lets users install/launch/track them, and adds a full social
layer — friends, chat, voice, presence, profiles, game invites — on top.

It is built as **three repositories** under the `TheStonedGamer` GitHub org, all
of which talk through one central server. (A fourth, the Game Requests service,
was **folded into the server** in 2026-06 — see the note below the table.)

| Component | Repo | Stack | Role |
|---|---|---|---|
| **Server** | `ArcadeLauncher-Server` (public) | Rust / axum 0.7 + tokio + MariaDB (`mysql_async`) | The hub. REST API, WebSocket social gateway, catalog/scan, auth, admin UI, **and the Game Requests board** (folded in). Everything talks to it. |
| **Unified Client** | `ArcadeLauncher-Unified-Client` (public, **this repo**) | Tauri v2 (Rust core) + React + TypeScript | The active cross-platform desktop client (Windows + Linux). |
| **Legacy Client** | `ArcadeLauncher-Client` | C++17 Win32 / Direct2D | Retired native client; kept only as a parity reference ([`PARITY.md`](PARITY.md)). Superseded by the Unified Client. |

> **Requests is no longer a separate service.** The former `ArcadeLauncher-Requests`
> binary (once its own process on `:8723`) was folded into the server as a
> namespaced module (`mod requests_app`) mounted under `/requests` on the public
> app (`:8721`). It reuses the server's MariaDB pool and only writes its own
> `game_requests` / `request_*` tables. The standalone repo is dormant (kept as
> origin history); the `:8723` systemd unit is retired. Externally the board URL
> is unchanged (`/requests/…`).

### How they interconnect

```
                      ┌─────────────────────────────────────────────┐
                      │            ArcadeLauncher-Server  :8721      │
   Unified Client ───►│  REST  /api/*        (reqwest + Bearer)      │
   (Tauri+React)  ◄──►│  WS    /ws/social    (live social gateway)  │
                      │  /requests/*         (folded-in Requests)    │
                      │  Admin web UI :8722  (TOTP-gated)            │
                      └──────────────┬──────────────────┬───────────┘
                                     │ MariaDB           │ S3 (MinIO)
                              ┌──────▼─────────┐  ┌──────▼──────────┐
                              │  game_requests │  │  Attachments /  │
                              │  request_* etc │  │  screenshots    │
                              └────────────────┘  └─────────────────┘
```

- **Client ↔ Server:** REST under `/api/*` plus the `/ws/social` WebSocket
  gateway. **Version lockstep** — the client refuses to connect unless its
  `major.minor` matches the server's (patch floats). Both lines are currently
  `0.10.x`. Additive REST/WS changes are a **patch** (safe); anything that breaks
  client↔server compatibility is a **minor** bump and the **server deploys first**
  so older clients aren't locked out mid-window.
- **Requests (folded in):** served by the server process itself under `/requests`
  on `:8721` (no longer a separate binary). It shares the server's MariaDB pool
  and writes only its own `game_requests` / `request_*` tables.
- **Server ↔ object store:** attachments and screenshots use a presign → PUT →
  presigned-GET flow against MinIO (S3-compatible); bytes never transit the
  database.

---

## 2. The server

**Repo:** `ArcadeLauncher-Server` · **Binary:** `arcadelauncher-server` ·
**Port:** `8721` (REST + WS), admin UI on `8722`.

A single Rust/axum service backed by MariaDB. It is the source of truth for the
catalog, users, social graph, and live session state.

### Source map (`src/`)

| Module | Responsibility |
|---|---|
| `main.rs` | Boot, router wiring, schema setup, filesystem watcher, bind `:8721`. |
| `handlers.rs` | Core REST handlers (catalog, games, health, metrics). |
| `auth.rs`, `crypto.rs` | Challenge-response login, token mint/verify, password hashing. |
| `password_reset.rs` | Forgot-password single-use email links (1h TTL). |
| `registration.rs` | Account creation + admin-notify. |
| `users_api.rs` | User CRUD / admin user management. |
| `social_api.rs` | **The social subsystem** — REST `/api/social/*` + the `/ws/social` gateway (axum `ws`). Friends, chat, reactions, replies, presence, profiles, voice signaling relay, rooms. |
| `fanout.rs` | Server-side message fan-out to connected social peers. |
| `manifest.rs` | Per-game install manifests (paths, sha256, archive type). |
| `scan.rs`, `scan_jobs.rs` | Library scanning / background scan jobs. |
| `igdb.rs` | IGDB cover-art lookup (Twitch client-creds → IGDB v4). |
| `files.rs`, `s3.rs` | File serving + S3/MinIO presign for attachments & screenshots. |
| `db.rs`, `db_setup.rs`, `models.rs` | MariaDB pool, schema setup, row models. |
| `admin_html.rs`, `admin_extra.rs` | Server-rendered admin web UI (`:8722`). |
| `discord.rs` | Discord changelog/announce hooks. |
| `requests_app.rs` | **Folded-in Game Requests board.** The one `mod` (not `include!`) — namespaced so its same-named helpers don't collide. `router()` is mounted via `nest_service("/requests", …)`; page is `requests_index.html`. |

### What the server exposes

- **Catalog & games** — `library.json`-style catalog, per-game metadata, install
  manifests (`GET /api/games/:id/manifest`, Bearer), cover-art.
- **Auth** — challenge-response: `GET /api/auth/challenge` → client proves
  `derive_auth_key = SHA-256(lower(user) ‖ 0x1f ‖ pass)`, server returns an
  encrypted native token; `/api/login` is a fallback. TOTP supported. Forgot
  password emails a single-use link (response is identical whether or not the
  account exists, to avoid account enumeration).
- **Social REST + WS** — friends/requests, DM & group chat with edits/deletes/
  reactions/replies/attachments, presence + custom status (Online/Away/DND/
  Invisible), profiles (XP/level = `floor(sqrt(xp/100))`), privacy & ignore
  lists, game invites, group rooms, and a **voice signaling relay**
  (`voice_signal` frames) used for P2P WebRTC.
- **Cloud saves** — `GET /api/saves/:id` → `{files:[…]}`, `GET/PUT …/file?path=&mtime=`,
  with traversal rejection (`valid_save_path`) and a 50 MB/file cap.
- **Attachments/screenshots** — presign → PUT-to-MinIO → presigned-GET.
- **TURN credential vending** (`/api/social/turn`) — short-lived coturn REST
  credentials for WebRTC voice. _(The streaming endpoints that used to sit
  alongside it — `/api/social/hosts*`, `/api/social/client-certs`,
  `/api/social/mesh/preauth` — were removed with the streaming subsystem.)_
- **Admin UI** (`:8722`) — server-rendered, TOTP-gated; manages users, game
  request triage, server settings. Reachable remotely via a Cloudflare Tunnel +
  Access (external) and internal nginx2 (LAN) at `arcade-admin.orlandoaio.net`.
- **Health/metrics** — `/api/health` reports the live `VERSION` (baked in at
  compile time via `include_str!`); `/api/metrics` is scraped by Prometheus
  (job `arcadelauncher`).

### Versioning & deploy

- `VERSION` file is the source of truth. **Pushing to `main` auto-bumps `VERSION`
  (a bot commit) and builds a release** — `git pull --rebase` before the next push.
  Patch by default; `[minor]` for client↔server compat breaks.
- **Prod deploy** (git-pull based, no scp): commit+push → on CT `10.0.0.210`
  `cd /root/build-arcade && git pull --ff-only origin main` → `cargo build --release`
  → `install` binary into `/opt/arcadelauncher-server/` → `systemctl restart`.
- **Startup bind delay:** after restart the process runs schema setup + spawns the
  fs watcher before binding `:8721` (~25s) — `/api/health` returns
  connection-refused during that window even though systemd says `active`. Poll
  ~30s; the log line `API listening on http://0.0.0.0:8721` confirms it's up.
- Always verify `/api/health` shows the bumped version after deploy.

---

## 3. The client (this repo)

**Repo:** `ArcadeLauncher-Unified-Client` · **Stack:** Tauri v2 (Rust core) +
React + TypeScript. One cross-platform client replacing the two retired native
codebases (Windows C++/Direct2D + Linux C++/nanovg).

### Why this architecture

A webview gets rendering, WebRTC, and WebSockets "for free," collapsing what used
to be two native UI/voice/network stacks into one. React was chosen for ecosystem
maturity and reliability. The cost of the old approach was maintaining UI/voice/
net twice; the unified client pays that once.

### Two halves: Rust core + React UI

The client is split down the middle by a strict pattern:

```
┌──────────────────────────────┐     IPC (Tauri invoke)     ┌───────────────────────────┐
│   src-tauri/  (Rust core)    │ ◄────────────────────────► │   src/  (React + TS UI)   │
│                              │                            │                           │
│  <feature>/commands.rs       │   src/features/<x>/api.ts  │  features/<x>/ hooks+UI    │
│  reqwest + Bearer token      │   thin IPC wrappers        │  pure tested cores (*.ts)  │
│  token lives Rust-side only  │   download://, ws events   │  vitest unit tests         │
└──────────────────────────────┘                            └───────────────────────────┘
```

**Golden rule:** authed REST never uses `fetch` from the webview. The bearer
token lives **Rust-side only**. The UI calls a TS wrapper in
`src/features/<x>/api.ts`, which `invoke`s a Tauri command in
`src-tauri/src/<x>/commands.rs`, which makes the reqwest call with the token.
Wiring a new server endpoint into the client is the **five-file recipe**:
Rust command → IPC registration → TS api wrapper → React hook → UI, plus tests.

### Rust core modules (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `catalog` | Library catalog, cover-art fetch (IGDB), per-game prefs (favorites/hidden/collections/save-paths) in `catalog_prefs.json`, library stats. |
| `session` | Challenge-response login crypto, token persistence (obfuscated at rest via HMAC-CTR — no plaintext, no OS keychain so Win/Linux are identical), auto-restore on launch. |
| `social` | WebSocket gateway client, chat/reactions/replies, attachments (presign+PUT, bytes never touch the webview, 25 MiB cap), profiles, friend meta, presence, privacy, voice signaling. |
| `download` | Resumable ranged-GET installer (`.part` → sha256 → atomic rename), KB/s throttle, tokio-semaphore concurrency cap, pause/resume/cancel, `download://` progress+status events, zip-slip-guarded extraction, `install_records.json`. |
| `saves` | Cloud-save sync (`plan_sync` last-write-wins by mtime, conflict policies), managed folder or mapped real save path. |
| `launch` | Game launch (emulator/PC), playtime tracking. |
| `emulators` | Emulator + BIOS configuration. |
| `presence` | Discord Rich Presence (settings-gated). |
| `hotkey` | Global shortcut (tauri-plugin-global-shortcut). |
| `controller` | Gamepad / Big-Picture input. |
| `tray`, `window` | System tray (close-to-tray, launch-minimized), single-instance guard, fullscreen. |
| ~~`streaming`~~ | **Removed in v0.13.22.** Built-in game streaming (host pair, in-engine playback, mesh) is gone; Settings → Remote Play links out to Moonlight + Sunshine. |
| `retroachievements` | RetroAchievements integration. |
| `requests` | In-client Game Requests board (talks to the server's folded-in `/requests` routes). |
| `stores` | Atomic per-user state files. |
| `settings` | Settings persistence. |

### React feature modules (`src/features/`)

Each feature is a **pure, unit-tested TypeScript core** (reducers, selectors,
FSMs — tested with vitest) plus a thin React hook + UI that talks to the Rust
core over IPC. Features: `catalog`, `social`, `download`, `saves`, `session`,
`settings`, `presence`, `controller`, `gamepad`, `emulators`,
`retroachievements`, `requests`, `theme`, `help`, `onboarding`, `stores`.
(The `streaming` feature was removed in v0.13.22 — Settings → Remote Play now
links out to Moonlight + Sunshine.)

State that is purely client-local (theme, prefs, onboarding flags) lives in
separate per-user files and **never rewrites `library.json`**.

### Install / update model

Steam-style: per-user install (`%LocalAppData%` / `~/.local`), admin needed at
most once, and **updates never elevate** (the Tauri updater consumes a signed
NSIS `setup.exe`). A single-instance guard surfaces the existing window on a
second launch; re-running the updater while the launcher is open just brings it
to front (no reinstall).

---

## 4. Notable subsystems end-to-end

- **Social/live** — client `useSocial` hook ↔ Rust `social` WS gateway client ↔
  server `/ws/social` (`social_api.rs` + `fanout.rs`). The gateway carries chat,
  presence, reactions, replies, attachments, profiles, game invites, rooms, and
  voice signaling. Heartbeat is application-level: client sends `{"type":"ping"}`
  every 20s and the server answers with a **data-frame** `{"type":"pong"}` that
  actually wakes the receive loop (a WS control-ping does not).
- **Voice** — **P2P WebRTC**, chosen over a server binary relay. The server only
  relays `voice_signal` frames (offer/answer/ICE) — no media passes through it.
  ICE uses public STUN plus a coturn TURN server (`turn.orlandoaio.net`, deployed
  on the Docker host) for symmetric-NAT peers. Because it's P2P it doesn't interop
  with the legacy C++ binary-relay client (fine post-cutover; unified↔unified
  works).
- **Installer/downloads** — pure FSM core (manifest/paths/sha256/queue) + live
  HTTP transport (resumable ranged GET) + zip-slip-guarded extract. The Install
  button GETs the server manifest (Bearer), resolves `app_data/games/<id>`, and
  hands off to the engine.
- **Cloud saves** — pure `plan_sync` core decides Upload/Download/InSync/Conflict
  by mtime; execution does atomic temp+rename and stamps downloads with the server
  mtime.
- **Remote play** — built-in game streaming was **removed in v0.13.22**. The
  `streaming` module (engine/host sessions, mesh, My PCs, runtime sidecar fetch)
  and its CI bundling are gone. Settings → **Remote Play** is now a static panel
  that opens Moonlight (`moonlight-stream.org`) and Sunshine
  (`app.lizardbyte.dev/Sunshine`) in the browser via `tauri-plugin-opener`.

---

## 5. Infrastructure (where it all runs)

All hosts are on the `10.0.0.0/24` homelab LAN; public access is via nginx +
Cloudflare.

| Host | Address | Role |
|---|---|---|
| Proxmox PVE host | `10.0.0.98` (`pve3`) | Hypervisor for the CTs/VMs below. |
| App server CT | `10.0.0.210:8721` | `arcadelauncher-server` (systemd), library root `/srv/arcade-library`, admin UI `:8722`, folded-in Requests board at `/requests`, and `cloudflared`. (The old `:8723` Requests unit is retired.) |
| nginx (public) | `10.0.0.203` | `arcade.orlandoaio.net` → `10.0.0.210:8721`. WSS for `/ws/` (scoped Upgrade headers — never on `location /`). |
| nginx2 (internal) | `10.0.0.163` | Wildcard `*.orlandoaio.net` LAN vhosts incl. `arcade-admin`, `grafana`. One file `sites-available/orlandoaio.net`. |
| MinIO CT | `10.0.0.220` (`:9000/:9001`) | S3 object store for attachments/screenshots (bucket `arcade-attachments`). |
| coturn | `10.0.0.180` (Docker) | TURN/STUN for WebRTC voice (`turn.orlandoaio.net`). |
| Monitoring | `10.0.0.235` | Prometheus + Grafana (Docker); Prometheus scrapes the server's `/api/metrics`. |
| Domain Controller | `10.0.0.3` (`master-ad`) | AD + internal DNS (zone `orlandoaio.net`), Kerberos SSO. |

### CI / release infrastructure

- **CI (`ci.yml`)** runs on every push: vitest + vite build + `cargo test` +
  `cargo check --release`. It does **not** do a full Tauri bundle, so
  bundler/flag breaks surface only in release.
- **Release (`release.yml`)** is **tag-triggered** (`vX.Y.Z`) only. A three-phase
  flow avoids a duplicate-release race: (1) create one draft up front, (2) Windows
  and Linux legs upload artifacts into that draft by `releaseId`, (3) publish +
  announce to Discord once both legs succeed.
  - **Windows leg** builds **natively** on Proxmox VM 111 (`arcade-win10-runner`,
    label `arcade-win10`) — MSVC build → NSIS + MSI. The updater prefers the NSIS
    `setup.exe`.
  - **Linux leg** builds natively on CT 130 (label `prox-pve`) → `.deb` / `.rpm` /
    AppImage (+ an AUR `arcadelauncher-git` PKGBUILD that builds `main`).
  - Artifacts are signed with a minisign updater keypair (repo secrets
    `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD`).

### How to cut a client release

1. Land the feature (CI green on both OSes).
2. Add a `CHANGELOG.md` entry under a new `[X.Y.Z]` heading (the Discord
   announcer extracts this section verbatim).
3. Bump the version in **all four files**: `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `arcade_launcher`
   stanza in `src-tauri/Cargo.lock`.
4. Commit `Release vX.Y.Z`, then **push the `vX.Y.Z` tag** — that fires
   `release.yml`. Client-only feature releases are **patch** bumps to keep
   `major.minor` matching the live server (a minor bump trips version-lockstep).
```

