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
  - [x] **T4d-3** Install trigger. Pure manifest core grows `version`/
    `installType` fields + `archive_path()` (mirrors the server's
    `is_pc_primary_archive`; 4 new KATs). `download_install` command fetches
    `GET /api/games/:id/manifest` (Bearer = session token), resolves the
    per-user install dir (`app_data/games/<id>`) + records path
    (`app_config/install_records.json`), reads the bandwidth cap from settings,
    and hands off to the engine. Detail panel shows an `Install` button for
    server-backed, not-yet-installed games (disabled → "Sign in to install"
    when signed out); progress flows to the existing Downloads tab.
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

Server contract (already live): a save file is `{path, mtime, size}` (path
relative, `/`-separated; mtime Unix secs; size bytes, ≤50 MB). Endpoints, all
Bearer-authed: `GET /api/saves/:id` → `{files:[…]}`, `GET
/api/saves/:id/file?path=` → raw bytes, `PUT /api/saves/:id/file?path=&mtime=`
→ upsert. Server rejects traversal paths (`valid_save_path`).

- [ ] **T8a** Cloud-save sync v1 against the existing server endpoints
  (upload/download save sets, conflict handling).
  - [x] **T8a-1** Pure sync-decision core (`saves::sync`, 11 KATs): `SaveFile`
    `{path,mtime,size}` mirrors the server contract; `plan_sync(local, remote)`
    → sorted per-file `SyncItem` with `Upload`/`Download`/`InSync`/`Conflict`
    by mtime last-write-wins (equal mtime + different size = conflict);
    `SyncSummary` tallies a plan. No IO.
  - [x] **T8a-2** Local save-folder scan + transport glue. `saves::paths` (5
    KATs): `valid_save_path` mirrors the server; `to_rel_save_path` turns an
    on-disk file under a base into a safe `/`-joined wire path. `saves::scan`
    (2 KATs): walk `app_data/saves/<id>` into `Vec<SaveFile>`.
    `sync::apply_conflict_policy` (3 KATs): skip/preferLocal/preferRemote.
    `saves::commands`: `saves_plan` (preview summary) + `saves_sync` (list →
    scan → `plan_sync` → GET-download / PUT-upload with the Bearer token; atomic
    temp+rename writes; downloaded files stamped with the server mtime via
    `filetime` so they don't re-upload; reuses the install traversal guard).
  - [x] **T8a-3** Sync UI: `saves/api.ts` wrappers + a "☁ Sync saves" detail-
    panel affordance for server-backed games (disabled → "Sign in to sync" when
    signed out). Reports N uploaded / N downloaded / conflicts; on a conflict,
    offers "Keep my saves" / "Keep server saves". host+token from `useSession()`.
- [x] **T8b** Per-game save-folder mapping. `CatalogPrefs.save_paths` (game id →
  absolute local save dir), client-local in `catalog_prefs.json` (never rewrites
  `library.json`). `saves_plan`/`saves_sync` take an optional `save_path` (used
  when set + absolute, else the managed `app_data/saves/<id>`). Pure TS
  `effectiveSavePath`/`setSavePath` (2 vitest) + a "Save folder" input on the
  detail panel (blank = managed folder).

## Phase T9 — Social depth (match native + server features 1.1b–1.6)

- [x] **T9a** Edit / delete / read receipts in the chat UI. The protocol
  (`chat_edit`/`chat_delete`/`read`) and reducer already modeled these; this
  wired the **actions**: pure `optimisticEdit`/`optimisticDelete` (4 vitest) so
  the bubble updates before the server echo, exposed as `editMessage`/
  `deleteMessage` on `useSocial`, and hover ✎/🗑 controls on my own messages in
  `MessageRow` (Edit swaps the bubble for an inline input; Enter saves, Esc
  cancels). Read receipts + "(edited)"/tombstone display already shipped in T3a.
- [x] **T9b** Reactions + replies. Server already supported both (react WS
  handler + `reply_to` column); this wired the client against that contract.
  **T9b-1** (8c16e31, CI 27642125642): pure `applyReaction` toggle (6 vitest),
  `reactions: Reaction[]` on ChatMessage, `toggleReaction` on `useSocial`,
  reaction picker + chips in `MessageRow`. Fixed a latent bug where
  `outbound.react` never sent `on`. **T9b-2** (21c42e2, CI 27642555502):
  `replyTo` on messages/localEcho, `replyTo` reply bar + quoted-parent preview
  in ChatPane/MessageRow. Both green on windows-latest + ubuntu-22.04.
- [x] **T9c** DM attachments (MinIO-backed upload + chips), paperclip control.
  Built against the server's presign → PUT-to-MinIO → presigned-GET contract.
  **T9c-1** (f08ffc7): `outbound.chat` carries an `attachmentId`; `localEcho`
  stamps attachment id/name so a sent file echoes optimistically (TS + Rust
  KATs). **T9c-2** (6dd4d32): Rust `social_attachment_upload` (presign + PUT,
  bytes never touch the webview, 25 MiB cap) and `social_attachment_url`
  (presigned download); pure `social::attach` + Endpoint URL KATs. **T9c-3**
  (a3f76b3): `tauri-plugin-dialog` file picker, Composer paperclip, clickable
  attachment chips in `MessageRow`, hook `sendAttachment`/`openAttachment`.
  Green both OSes (CI 27653114962).
- [x] **T9d** User profiles (banner, bio, level/XP). **T9d-1** (7f368f6) pure
  `profile.ts` mirroring the server's `level_for_xp = floor(sqrt(xp/100))`
  (levelForXp/xpForLevel/levelProgress; 7 vitest). **T9d-2** (25c5424) Rust
  `social_profile_get`/`social_profile_update` + Endpoint profile URLs. **T9d-3**
  (59c3983) profile overlay: banner, initial avatar, level badge + XP bar, bio;
  own profile editable (banner/bio Save). Opened from a clickable peer name or a
  "My profile" button. No public per-user avatar endpoint, so initials are used.
  Green both OSes.
- [x] **T9e** Friend organization (groups, notes, search). **T9e-3** (024e0d0,
  CI 27654956625, both green) pure `friendMeta.ts` (parse/serialize groups,
  add/remove/toggle, `organizeFriends` Pinned/group/Ungrouped sectioning; 14
  vitest) + Rust `social_friendmeta_get`/`_set` + `social_user_search` (vs
  GET/PUT `/api/social/friendmeta`, GET `/api/social/search`) + Endpoint
  `friendmeta_url`/`search_url` KATs; `useFriendMeta` hook (optimistic note/pin/
  group edits) → sectioned `FriendList` with group-filter chips + per-row inline
  editor. **T9e-4** (596f479) Rust `social_friend_request` (POST
  `/api/social/friends/request` by username, surfaces server reason) + Endpoint
  `friend_request_url` KAT; `useUserSearch` (300ms-debounced) + `AddFriend`
  search box atop the roster (marks existing friends, Add otherwise).
- [x] **T9f** Presence depth (custom status, DND) + DM privacy/ignore UI.
  **T9f-1/2** (a25fb94) pure `statusMenu.ts` (Online/Away/DND/Invisible options,
  clampStatusText, presenceFrameInput; 11 vitest); threaded `statusText` through
  protocol in/out (presence frame + dnd), Friend type/reducer/REST mapping + Rust
  Friend model; `useSocial.setStatus` (re-asserted on reconnect) + StatusPicker
  popover; friend sublines show custom status. **T9f-3** pure `privacy.ts`
  (friend/DM policy option lists + fromWire coercion + labels; 8 vitest) + Rust
  `social_privacy_get`/`_set` + `social_ignores_get`/`social_ignore_set` +
  Endpoint privacy/ignores URL KATs; `usePrivacy` hook → PrivacyPanel overlay
  (friend-request + DM policy radios) and a per-friend Ignore toggle in the
  roster editor.

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
