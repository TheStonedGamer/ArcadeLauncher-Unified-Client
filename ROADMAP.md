# ArcadeLauncher Unified Client — Roadmap

The plan to bring the Tauri (Rust + React) unified client to **full parity with
the native Windows C++ client**, then make it the single cross-platform client.
This file lives in **this** repo and is distinct from the C++ repo's
`ROADMAP-V2.md`.

## Working rules (non-negotiable)

- **Step by step.** One shippable, self-contained increment at a time. Every
  increment ends with a commit that is **green on BOTH Windows and Linux CI**.
- **Never ship unverified.** The launcher auto-updates on launch, so nothing
  lands that isn't compiled clean and tested green on both OSes.
- **Pure core, tested.** OS/IO-free logic (parsers, reducers, query/sort,
  protocol) is split out and exhaustively unit-tested (KATs), the way the C++
  portable-core is. Transport/UI glue sits on top.
- **Non-destructive to user data.** The user's `library.json` is read as the
  source of truth; client-local state (favorites, hidden, prefs) lives in
  separate per-user files, never by rewriting `library.json`.
- The C++ client stays the live product until the cutover phase; do not disturb
  its auto-update channel during the rewrite.

## Status legend

`[x]` done & CI-green · `[~]` in progress · `[ ]` not started

---

## Phase T0–T3 — Foundation (DONE)

- [x] **T0** Scaffold modular Tauri v2 + React + TS; per-user install + updater;
  read real `library.json` grid; launch a game; green both OSes.
- [x] **T1** Catalog query (search/sort/filter/collections); game detail panel;
  file-backed General settings (Rust + React).
- [x] **T2** ROM-variant grouping + picker; pre/post-launch hooks; playtime.
- [x] **T3a** Social core: wire protocol + state reducer + selectors + friends/
  chat UI (KAT-tested, stubbed transport).
- [x] **T3b** Live social transport: tokio-tungstenite WS + reqwest REST
  (rustls), 20s heartbeat, reconnect/backoff, resume, double-connect guard.
- [x] **T3c-1** Real ArcadeLauncher brand icon across all platforms.
- [x] **T3c-2** Linux packaging: `.deb`/`.rpm`/AppImage metadata, Arch
  `PKGBUILD` + desktop entry, tag-triggered release pipeline.

---

## Phase T4 — Game install & downloads (THE core gap)

Mirror the native client's installer: resumable ranged downloads, integrity
verification, extraction, and a Steam-style queue. Server contract is the
existing `/files/<id>/<rel>` ranged GET with `Authorization: Bearer` (+ `Range`),
full-file SHA-256 verify, `..` path-traversal rejection.

- [x] **T4a** Pure download/manifest core (Rust KATs): manifest model,
  per-file target path resolution, path-traversal rejection, SHA-256 verify
  helper, progress/percent math, queue state machine (queued→downloading→
  verifying→extracting→done/failed/paused). No IO. (18 KATs)
- [x] **T4b** Rust transport: single resumable ranged GET per file → `.part` →
  verify → finalize; concurrency cap (semaphore); bandwidth cap (KB/s from
  settings); pause/resume/cancel; emits `download://progress`+`download://status`
  events. Pure tested core: file-URL endpoint + throttle math (9 new KATs);
  thin async engine glue on top.
- [x] **T4c** Extraction phase for `pc_archive` installs; install-state
  transitions written back to client-local install records (not `library.json`).
  - [x] **T4c-1** Install-records core: `InstallState` + `InstallRecord` +
    `InstallRecords` collection (get/state_of/upsert/set_state/remove/
    installed_ids) + non-destructive atomic load/save to a separate per-user
    `install_records.json`. (6 KATs)
  - [x] **T4c-2** Zip-slip-guarded extraction (`extract_zip`, reuses the
    `resolve_target` path guard; pure-Rust deflate, no system deps; 3 KATs) +
    engine writes Installing→Extracting→Installed / Failed / cleared-on-cancel
    into the records (serialized load-modify-save), and the install command
    takes `records_path`/`version`/`archive`.
- [~] **T4d** Download UI: install button on detail panel + queue/status panel
  (speed graph, queue list, pause/resume/cancel, active-count badge).
  - [x] **T4d-1** Pure download-queue reducer (`applyProgress`/`applyStatus`/
    `removeItem`/`clearCompleted`) consuming the `download://progress`+`status`
    events into a per-game item map with an EMA speed estimate, plus selectors
    (percent/activeCount/queueList/hasPending/formatSpeed/formatBytes). 13
    vitest KATs.
  - [x] **T4d-2** `useDownloads` hook (listens to the two events, exposes
    pause/resume/cancel/dismiss/clearDone; `?downloads-demo` seeds rows) +
    `DownloadQueue` panel (per-install progress bar, status, speed, state-aware
    controls) + Downloads tab with active-count badge in the shell. Verified in
    the browser preview (badge + all six row states render).
  - [ ] **T4d-3** Install trigger: `Install` button on the detail panel +
    `download_fetch_manifest` command, wiring `download_start` with install
    dir / records path / session host+token. Gated on the session/auth layer
    (same deferral as the social NullGateway), so it lands when that exists.
- [ ] **T4e** Verify both-OS green; manual smoke against a real server file.

## Phase T5 — Art & metadata pipeline

- [x] **T5a** IGDB cover art fetch + on-disk cache. Pure `catalog::art`
  (cover_url, apicalypse search_query, twitch token_body, cache_file_name; 5
  KATs) + `fetch_cover_art` command (twitch client-credentials auth → IGDB
  search → cover download into the per-user cache dir; creds-gated no-op when
  unset; cached covers reused). Creds (Twitch client id/secret) added to General
  settings + Settings UI. Mirrors the C++ `IgdbClient` so both clients pull
  identical art. (Note: `library.json` carries no screenshot/hero field — the
  contract is cover-only, so "screenshots/hero" below is dropped, not deferred.)
- [x] **T5c** Re-arm: `needs_art` predicate (Rust + TS `needsArt`) drives a
  "Fetch cover from IGDB" button on the detail panel, shown only for games
  missing both a local cover path and a cover URL.
- [n/a] **T5b** Screenshots/hero on the detail panel — not in the `library.json`
  contract (cover-only); folded away rather than shipped as dead fields.

## Phase T6 — Library personalization

- [x] **T6a** Favorites + hidden games: detail-panel toggles, client-local
  persistence in a separate `catalog_prefs.json` (Rust `CatalogPrefs` model +
  non-destructive atomic store + load/save commands; never rewrites
  `library.json`), pure TS overlay (`applyPrefs` + `toggleFavorite`/
  `toggleHidden`) that merges overrides onto the catalog before query, and a
  "Hidden" sidebar scope (shows only hidden games). 3 Rust KATs + vitest for
  overlay + the hidden-scope query.
- [x] **T6b** Collections management: add/remove a game to/from a collection via
  chips + an add field on the detail panel, persisted in the same prefs file
  (`addToCollection`/`removeFromCollection`, seeded from the catalog's existing
  collections). Sidebar collection scopes reflect the merged result.

## Phase T7 — Platform polish & desktop integration

- [x] **T7a** Discord Rich Presence (now-playing). Pure `presence::activity`
  (build details/state/timestamp/asset from a now-playing state; 5 KATs) +
  settings-gated IPC connector over the pure-Rust `discord-rich-presence`
  crate. Catalog hook announces playing on launch, idle on exit; best-effort.
- [x] **T7b** Global hotkey to summon/hide the launcher. Pure
  `hotkey::shortcut` (canonicalise accelerator + window-toggle decision; 8
  KATs) + `tauri-plugin-global-shortcut` glue; registered at startup and
  re-applied live via `hotkey_apply` on Save.
- [x] **T7c** Gamepad navigation + Big Picture mode. Pure `gamepad/input`
  (snapshot diff → intents; 7 vitest) + `gamepad/navigate` (grid index math;
  8 vitest); `useGamepad` polls the webview Gamepad API; CatalogView drives a
  focus index + Big Picture fullscreen (Rust `set_fullscreen`/`is_fullscreen`).
- [x] **T7d** Close-to-tray / launch-minimized wired to the real window/tray.
  Pure `tray::behavior` (close/start-hidden decisions; 2 KATs) + `tray::setup`
  builds the system tray (Show/Quit, left-click toggle), intercepts close to
  hide when close-to-tray is on, and hides at startup when launch-minimized.

## Phase TS — Session & auth (unblocks T4d-3, social-live, T8)

The recurring prerequisite: a login that yields a `{host, token}` session for
the social/download features. Mirrors the server's `auth.rs`.

- [x] **TSa** Pure challenge-response crypto core (`session::crypto`, 6 KATs):
  `derive_auth_key` (SHA-256(lower(user)‖0x1f‖pass)), `challenge_proof`
  (hex HMAC-SHA256 of the nonce), `hmac_ctr_xor` + `decrypt_token`
  (HMAC-CTR, round-trips the server's encrypt). Plus the `session_login`
  command: GET `/api/auth/challenge` → proof → POST `/api/auth/verify` →
  decrypt token natively, with a `/api/login` password fallback; password
  never persisted/logged. Frontend `SessionProvider` holds the session in
  memory (host+username remembered, token in-memory only) + a `LoginPanel`
  sign-in modal and header account chip.
- [x] **TSb** Token storage (per-user) + auto-restore on launch + expiry.
  Pure `session::storage` (6 KATs): `StoredSession` model, `encode`/`decode`
  obfuscating the token at rest with the existing HMAC-CTR keystream (no
  plaintext token on disk; no OS-keychain dep, so Win/Linux stay identical),
  and an `is_expired` decision. Thin `session::store` glue: atomic
  `session_save`/`session_restore` (drops stale/expired/corrupt files)/
  `session_clear`, keyed by a stable per-install seed (the app-config dir).
  `SessionProvider` auto-restores a non-expired session on launch, saves on
  login, clears on sign-out; token never touches localStorage.
- [ ] **TSc** Wire the session host+token into the social live connection
  (unblocks social-live) and the download install trigger (unblocks T4d-3).

## Phase T8 — Cloud saves

- [ ] **T8a** Cloud-save sync v1 against the existing server endpoints
  (upload/download save sets, conflict handling).

## Phase T9 — Social depth (match native + server features 1.1b–1.6)

- [ ] **T9a** Edit / delete / read receipts in the chat UI (reducer already
  models read receipts; wire edit/delete actions).
- [ ] **T9b** Reactions + replies.
- [ ] **T9c** DM attachments (MinIO-backed upload + chips), paperclip control.
- [ ] **T9d** User profiles (banner, bio, level/XP).
- [ ] **T9e** Friend organization (groups, notes, search).
- [ ] **T9f** Presence depth (custom status, DND, idle); DM privacy + ignore.

## Phase T10 — Cutover

- [ ] **T10a** Feature-parity audit against the native client checklist.
- [ ] **T10b** First signed release on both OSes (user adds signing secrets);
  publish `.deb`/AppImage/NSIS + `latest.json`.
- [ ] **T10c** Switch users from the C++ client to the unified client; retire
  the C++ auto-update channel.

---

## Execution order

Top-down by foundational value: **T4 (downloads) → T5 → T6 → T7 → T8 → T9 →
T10**. Small self-contained wins (e.g. T6a favorites, T7b global hotkey) may be
pulled forward to land quick visible parity when a larger phase is mid-flight,
but the core installer (T4) comes first because it's what makes this a launcher
rather than a viewer.
