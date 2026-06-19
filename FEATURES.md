# ArcadeLauncher Unified Client — Features

The **Unified Client** is the cross-platform (Windows + Linux) rewrite of the two
native ArcadeLauncher launchers (Windows C++/Direct2D and Linux C++/nanovg),
collapsing them into a single **Tauri v2 (Rust core) + React + TypeScript**
application. It is at **full feature parity** with the native clients (see
[`PARITY.md`](PARITY.md)) and is the shipping client going forward.

Architecture: a thin React/TypeScript UI over a Rust core. Pure, unit-tested logic
(catalog queries, download/queue state, social reducers, sync planning) lives in
TypeScript and Rust modules; the Rust core (`src-tauri/`) owns the privileged work
— filesystem, networking, archive extraction, the tray/hotkey/pickers, and the
WebSocket/HTTP transports. Install/update is **Steam-style**: per-user install
(`%LocalAppData%` / `~/.local`), admin needed at most once, and updates never
elevate (Tauri updater).

---

## 1. Game library

- A single cover-art grid spanning **local emulator ROMs**, **PC storefront
  installs**, and **server-backed games** from the private ArcadeLauncher Server
  catalog (downloaded and installed on demand).
- Per-game install states (*missing / downloading / installed / update available*);
  launch always runs the local installed copy through the right emulator or exe.
- **Rich search & filtering** — by title, genre, platform, year, developer
  (`catalog/query.ts`).
- **Sort modes & user collections**; **favorites** and **hidden** games, stored in
  a separate `catalog_prefs.json` that never rewrites `library.json`.
- **"Continue Playing" row** *(new)* — a Steam-style horizontal strip of
  recently-played games atop the grid (shown on All Games with no active search);
  click a tile to launch directly. Backed by a pure `catalog/stats.ts` core
  (`recentlyPlayed` / `mostPlayed` / `libraryStats` / `formatDuration` /
  `formatLastPlayed`) over the playtime + last-played data the launcher tracks.
- **Library stats dashboard** *(new)* — a collapsible panel atop the catalog with
  headline numbers (games / played / total playtime) and a **"Most Played" bar
  chart**, backed by the same pure `stats.ts` core (`playtimeBars` /
  `libraryStats`).
- **ROM-variant grouping** with a picker for multi-region/-revision dumps.
- **Detail panel** with cover/hero art and developer/publisher/franchise metadata;
  **IGDB cover-art fetch** (Twitch OAuth, creds-gated) per game.
- **Installed tab** scoping the grid to what's on disk.
- **Controller-friendly** — full gamepad navigation and a **Big Picture**
  fullscreen mode; a **global hotkey** summons the launcher from anywhere.

### 1.1 Card context menu *(new)*
- **Right-click any game tile** for Steam-style per-game actions — Play, Install /
  Reinstall, **Verify files**, Add/Remove favorite, Hide/Unhide — anchored at the
  cursor and edge-clamped to the viewport. The menu adapts to the game's install
  state (e.g. Play/Verify only appear for installed, server-backed games).

## 2. Downloads & installation

- **Manifest-driven installs** — each server game is a manifest of files with byte
  sizes, **SHA-256 hashes**, and download URLs.
- **Resumable downloads** — each file is a resumable ranged HTTP GET streamed to a
  `.part` file, verified by full-file SHA-256, then atomically renamed. Path
  traversal (`..`) is rejected; archive installs are extracted with a zip-slip
  guard.
- **Download controls** — pause, resume, cancel, a configurable **bandwidth limit**,
  and a concurrency cap; a **Downloads tab** with an active-count badge shows
  live speed and the queue.

### 2.1 Validate & Repair *(new)*
- A Steam-style **"Verify files"** pass (`download_verify`) re-checks every manifest
  file already on disk by **size + SHA-256** (streamed via `sha256_file`, so
  multi-GB files hash without buffering), and **re-downloads only the missing or
  corrupt files** — mirroring the native launcher's Validate & Repair. It reuses
  the normal install engine, so progress/status arrive on the same
  `download://progress` / `download://status` events. Triggered from the card
  context menu's "Verify files".

## 3. Emulators & launch

- **Pre/post-launch hooks** per game and **playtime tracking** reported to the
  server.
- **Process monitoring** with optional minimize-on-launch / restore-on-exit.
- **Discord Rich Presence** (settings-gated) and **close-to-tray /
  launch-minimized**.

### 3.1 Controller remap editor *(new)*
- An in-app **controller remap editor** plus **firmware auto-deploy**: required
  emulator firmware/BIOS blobs are staged into the right per-emulator location and
  the emulator's config is pointed at them automatically — including
  **PS2 BIOS auto-deploy into PCSX2** (and the equivalent DuckStation / xemu
  paths), so server-backed console games are runnable without manual BIOS setup.
- **Runnable diagnostics** surface emulator/firmware status from the client.
- **Firmware deployment status in Settings** *(new)* — the Settings ▸ Emulators
  page shows a read-only **per-console** panel (PlayStation / PS2 / Original Xbox /
  PS3) reporting whether each console's BIOS is merely *staged* on disk or actually
  **deployed into its emulator** (e.g. PS2 BIOS into PCSX2), so you can confirm a
  console will boot without launching a game. Backed by a read-only `firmware_status`
  command that inspects the same paths the on-launch auto-deploy writes.

## 4. Accounts & cloud saves

- Challenge-response login with the server, **TOTP two-factor**, and token
  persistence obfuscated at rest (no plaintext token, no OS-keychain dependency,
  so Windows/Linux behave identically); the session auto-restores on launch.
- **Cloud saves** — per-game sync between client and server (managed save folder or
  a per-game absolute save path), last-write-wins with conflict resolution.

## 5. Social

A Steam/Discord-style social layer over a single persistent WebSocket gateway,
authenticated by the session token, with automatic reconnect + on-reconnect
reconciliation of the friend list and open conversations.

- **Friends & presence** — live roster with presence (online / away / busy /
  in-game, surfacing the current game), custom status text, and DND.
- **Friend organization** — groups, private notes, pinning, username search, and
  add-by-username.
- **Pending friend requests tab** *(new)* — a dedicated **Requests** tab on the
  roster (with a count badge) listing **incoming** requests with
  **Accept / Decline / Ignore** and **outgoing** ("Sent") requests with **Cancel**.
  Backed by `POST /api/social/friends/respond`; the roster auto-refreshes on every
  `friend_request` / `friend_accepted` / `friend_removed` gateway event so the tab
  stays live.
- **Direct messages** — live chat with typing indicators, read markers, history,
  message **edit/delete**, emoji **reactions**, **replies**, and **file
  attachments** (presigned upload to object storage; bytes never transit the
  webview).
- **Profiles** — banner, bio, and a level/XP bar.
- **Privacy** — who-can-friend-me and who-can-DM-me policies plus a persistent
  per-user ignore list.
- **Voice calls** — peer-to-peer **WebRTC** voice (mute, busy auto-decline),
  signaled over the server's `voice_signal` relay. ICE uses public STUN **plus a
  deployed coturn TURN server** for symmetric-NAT / off-LAN traversal, with
  short-lived TURN credentials minted on demand from `GET /api/social/turn`.

## 6. Platform & packaging

- **One codebase, both OSes** — Windows and Linux (deb / rpm / AppImage + Arch
  PKGBUILD), CI green on both before release.
- **Auto-update** via the signed Tauri updater; **version lockstep** with the
  server (client refuses to connect unless `major.minor` matches). Client and
  server are released on a **shared version line** (currently **0.10.0**) so a
  coordinated `x.x.0` bump keeps both sides in lockstep.

---

## Tech stack at a glance

| Layer | Tech |
|-------|------|
| UI | React + TypeScript (webview) |
| Core | Tauri v2 / Rust (filesystem, net, tray, hotkey, pickers) |
| Transport | Native WebSocket (social) + HTTP (catalog/downloads/saves), bearer tokens |
| Voice | P2P WebRTC, signaled over the gateway's `voice_signal` relay |
| Auth | Challenge-response login, TOTP 2FA, obfuscated token at rest |
| Metadata | IGDB (Twitch OAuth) |
| Packaging | Tauri updater (minisign-signed), GitHub Actions, deb/rpm/AppImage/PKGBUILD |
