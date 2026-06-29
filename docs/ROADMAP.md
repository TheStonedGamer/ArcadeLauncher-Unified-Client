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
- The unified client is the **sole shipping product** (T10c). The native C++
  auto-update channel is retired; do not publish new `client-v*` releases except
  a one-time EOL build pointing users here.

## Status legend

`[x]` done & CI-green · `[~]` in progress · `[ ]` not started

---

## Build & release infrastructure

- [x] **BI1 — Windows build infra (SUPERSEDED → native Windows runner, 2026-06-20).**
  _Final state:_ the cargo-xwin cross-compile was **abandoned** — `$GITHUB_PATH`
  never propagated `cargo` onto the `prox-xwin` runner's step PATH and even an
  explicit PATH export failed to resolve it. The Windows leg now builds **natively**
  on **VM 111 `arcade-win10-runner`** (Windows 10, Proxmox host `10.0.0.98`), pinned
  via the unique **`arcade-win10`** runner label (the bare `self-hosted/Windows/X64`
  set also matches other Windows runners). Provisioned 2026-06-20: Rust stable MSVC
  (rustup machine-wide under `C:\rust`, `CARGO_HOME`/`RUSTUP_HOME` machine env), Node
  20 LTS, Git, and pre-existing VS Build Tools 2022 (VC.Tools 14.44 `link.exe`/
  `cl.exe` + Windows SDK 10.0.22621/26100). Runner installed as a service (NETWORK
  SERVICE). **MSI is back** (native Windows builds WiX fine): `tauri.conf.json`
  targets `nsis,msi`; the updater still prefers the NSIS `setup.exe` via its
  `-nsis` platform key. Linux leg unchanged (CT 130 `arcade-pve-client-runner`).
  Open follow-up: Authenticode `.exe` signing not yet wired.
  _Historical (cargo-xwin attempt, abandoned):_ The Windows side was to be
  built on the **same runner as the Linux build** by cross-compiling the
  **MSVC-ABI** target — **`cargo-xwin` + `x86_64-pc-windows-msvc`**, the modern
  way to produce MSVC-ABI Windows binaries on Linux. `cargo-xwin`
  auto-downloads the MSVC CRT/SDK headers and links with **clang-cl + lld**, so
  no native Windows host and no MSVC install are needed. This **retires the
  prox-win build-VM effort entirely** — the Proxmox Windows VM (VM 131 on
  `10.0.0.98`) and its GitHub Actions service runner are abandoned; no native
  Windows runner is provisioned or maintained.
  - **MSVC ABI, not GNU.** Use `x86_64-pc-windows-msvc` (via `cargo-xwin`), not
    `x86_64-pc-windows-gnu` — it matches what Windows users expect and avoids
    the mingw `windows`-rs / WebView2 link quirks.
  - **Drop the MSI.** The WiX/MSI installer is dropped from the Windows release
    artifacts. Windows ships via the existing **NSIS `.exe`** (and the portable
    binary) only. This lines up perfectly with cross-compiling: **NSIS runs on
    Linux** (`makensis`), whereas **MSI/WiX would need wine** — so dropping MSI
    removes the one bundler that can't cross-compile cleanly.
  - _Rationale:_ a single Linux runner builds **both** OSes, removing the
    fragile native-Windows-VM provisioning (the source of repeated unattended/
    virtio install failures) and simplifying CI to one host.
  - _Caveat:_ **Tauri v2 + xwin works but the bundler glue is finicky — expect
    some fiddling** wiring `cargo-xwin` into Tauri's build/bundle step and
    getting `makensis` invoked with the cross-built binary.
  - _Follow-ups when implemented:_ switch the Windows job in the release
    workflow to a cross job on `ubuntu-*` (install `cargo-xwin` + the
    `x86_64-pc-windows-msvc` Rust target + `clang`/`lld` + `nsis`/`makensis`;
    Tauri bundler set to `nsis` only, MSI removed); re-run a release to confirm
    the `.exe` + `.sig` + `latest.json` still publish green. Code-signing for
    the Windows `.exe` happens in/after the cross job (e.g. `osslsigncode` on
    Linux), not on a Windows host.

- [x] **BI2 — Updater self-update (Windows in-use-file fix).** The bootstrap
  `updater.exe` is the shortcut target, so it was the *running* process while it
  drove the NSIS `setup.exe /S` install — and Windows locks a running image
  against overwrite, so NSIS replaced `ArcadeLauncher.exe` but never `updater.exe`
  (the bootstrapper could never update itself). Fixed by self-staging: on a
  Windows update the running updater copies itself to `%TEMP%\arcadelauncher-update\
  updater-stage.exe` and re-execs that copy with `--apply <setup> --wait-pid <pid>`;
  the original exits (unlocking `$INSTDIR\updater.exe`), the staged copy waits for
  that PID to vanish, then runs the installer — which now overwrites the updater
  too — and launches the app. Falls back to the old inline install if staging
  can't be set up. Pure arg-parser unit-tested; Linux AppImage path unchanged.
  Shipped in v0.10.20. _Note:_ inherent to any updater self-fix, an install whose
  updater predates this change still can't replace its own `updater.exe` on that
  one update — a fresh installer download lands the staging-capable updater.

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
- [x] **TSd** Account creation / self-registration with admin email approval.
  **DONE & LIVE (v0.10.13, server 0.10.2+).** Plus follow-ups this session:
  **TSd-2** self-service password reset (`ForgotPanel` + server `/api/auth/forgot|reset`,
  v0.10.14); **TSd-3** new-signup emails now go to **every enabled admin** as a
  multipart HTML message with **Accept/Deny buttons** (the single notify-address
  config was removed); **TSd-4** an in-app admin path to approve/deny pending
  signups now lives in the **server admin UI** at `/admin/accounts` (alongside full
  account management), and game-request triage moved to `/admin/requests` — the
  client Requests board's inline admin status dropdown was **removed** (v0.10.15).
  A new-user signup flow (client `RegisterPanel` → server `POST /api/auth/register`)
  that creates the account in a **pending** state and sends the admin
  (`orlandb204567@outlook.com`) an email with **Approve / Deny** links (signed,
  single-use tokens) so I can confirm or reject each new account before it can
  sign in. Pending accounts can't authenticate until approved; denied accounts are
  purged. Pure-core-first as always: registration validation (username/email/
  password rules, normalization), the approval-token mint/verify, and the email
  body/subject builders are IO-free + KAT-tested; SMTP send + DB writes are the
  thin server seam. Server owns the mail transport (env-configured SMTP) and the
  `pending`/`approved`/`denied` account-state column; client just shows "request
  submitted — awaiting approval" and surfaces the eventual approve/deny outcome at
  next sign-in. _Server-repo work, mirrored by a client registration UI._

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

- [x] **T10a** Feature-parity audit against the native client checklist — see
  `PARITY.md`. Result: full parity **except voice chat** (only `voice_signal`
  protocol stubs exist; no webview capture/playback/RTCPeerConnection). Voice is
  the single gap → tracked as **T9g** below; does not block T10b since the C++
  client stays live until T10c.
- [x] **T9g** Voice chat — **P2P WebRTC** (decided over the server binary relay),
  signaling over the existing `voice_signal` frame. **T9g-1** (e125dc9) pure
  `voice.ts` (call-state FSM + `parseSignal` codec; 24 vitest) + voice_signal in
  protocol in/out. **T9g-2/3/4** `useSocial` voice transport seam (voiceSend +
  setVoiceHandler routing voice_signal frames) → `useVoice` RTCPeerConnection
  engine (getUserMedia, offer/answer, trickle ICE, remote `<audio>`, mute) →
  📞 call button in ChatPane + CallBar overlay (Accept/Decline, Mute, Hang up).
  **TURN (deployed):** client fetches per-call ICE servers from
  `GET /api/social/turn` (`social_turn_servers` → `useVoice` iceProvider, STUN
  fallback). Server endpoint mints short-lived coturn REST creds; coturn deploy
  artifacts live in the server repo `deploy/turn/`. **Live as of 2026-06-19:**
  `arcade-coturn` (coturn/coturn:4.6) runs on the Docker host `10.0.0.180`,
  `turnserver` listening on `:3478` (verified reachable); server env
  `ARCADE_TURN_SECRET`/`ARCADE_TURN_URLS` wired. Optional follow-up: TURN-over-443
  via nginx-stream (not required for LAN/most-NAT traversal).
- [x] **T10b** First signed release on both OSes. Repo secrets configured
  2026-06-16; **v0.9.2** published 2026-06-17 (CI run 27692555393, both OSes
  green). Assets: NSIS `.exe`, `.deb`, `.rpm`, AppImage + `.sig` sidecars and
  signed `latest.json` on
  [GitHub Releases](https://github.com/TheStonedGamer/ArcadeLauncher-Unified-Client/releases/tag/v0.9.2).
  v0.9.0 was the initial publish; v0.9.2 is current Latest.
- [x] **T10c** Switch users from the C++ client to the unified client; retire
  the C++ auto-update channel. Native `AppUpdater` now shows a one-time migration
  notice (and manual Check for Updates) linking to the unified GitHub release;
  `server-client-release.yml` no longer runs on every `main` push (tag/dispatch
  only). Final EOL native release shipped via workflow dispatch.

---

## Phase T11 — Post-cutover polish (in progress)

The client is the sole shipping product; this phase is incremental UX/quality
work on top of parity. Each item still ships green on both OSes.

- [x] **T11a** Catalog auto-loads behind the scenes. Removed the `library.json`
  path bar from the catalog screen **and** the "Library file" field from
  Settings — the path is no longer something the user manages. `load_catalog`
  now resolves the location in Rust: an explicit arg (rare) → a legacy
  `libraryPath` still in `config.json` (migration) → the default per-user
  `app_config_dir/library.json` (alongside `config.json`,
  `install_records.json`, `catalog_prefs.json`). A missing file yields an empty
  catalog, so a fresh install simply shows no games until the catalog syncs.
  The `libraryPath` field stays in the settings model for back-compat but is
  hidden. Targeted for **v0.9.3**.
- [x] **T11b** Single-instance guard. The launcher auto-updates and lives in the
  tray, so a second launch (extra shortcut, tray re-open) must surface the
  running window, not spawn a duplicate. Wired the official, pure-Rust
  `tauri-plugin-single-instance` (no system deps, identical Win/Linux) as the
  first-registered plugin; its callback calls `tray::setup::show_main`
  (show + unminimize + focus). Desktop-only.

---

## Phase T12 — Beyond parity (planned)

Net-new capability on top of full parity. No roadmap blockers remain, so these
are value-driven, independently shippable, and each still lands green on both
OSes. Roughly ordered by impact-for-effort; pull forward whatever fits. Each
reuses plumbing the client already has rather than introducing a new subsystem
from scratch.

**High impact, strong fit**

- [x] **T12a — RetroAchievements integration (Web API slice).** Standalone
  emulators (PCSX2/DuckStation/RetroArch) ship their own rcheevos clients, so
  rather than inject achievements into the launch path, this integrates the **RA
  Web API**: pure `retroachievements/api.rs` (authed URL builders + `parse_rank_score`/
  `parse_recent`, flexible-hardcore coercion, unknown-user handling; 6 Rust KATs)
  + a `retroachievements_summary` command (score/rank + recent unlocks, creds from
  Settings). Pure TS `ra.ts` maps RA points onto the **shared level curve**
  (`levelForXp` from `social/profile.ts`) so RA mastery previews as a launcher
  level — the seam for a future server XP sync (`pointsToLevel`/`topUnlocks`/
  `unlockLabel`/`summaryHeadline`, 5 vitest). A **RetroAchievements** section in
  Settings holds the creds and shows a live panel (headline, level, recent
  unlocks). 228 vitest + 197 cargo green. *Deferred (need rcheevos in-process or
  a server hook): live unlock toasts during play, social-activity events, and
  writing RA points back into server XP.*
- [x] **T12b — SteamGridDB artwork in the unified client.** Pure request/parse
  core `catalog/art.rs` (autocomplete + grids URL builders, `parse_search`/
  `parse_assets`, term encoding, extension sniffing; 6 Rust KATs) + two commands
  in `art_commands.rs`: `steamgriddb_search` (name → game id → grid candidates,
  Bearer-authed with the user's key) and `apply_cover` (download a chosen cover
  into `<app_data>/art/`, return the local path). The cover is recorded as a
  per-game override in `catalog_prefs.json` (`cover_overrides`, overlaid in
  `applyPrefs` onto `coverArtPath` — never rewrites `library.json`; pure
  `setCoverOverride`/`effectiveCover` + KATs). Detail panel adds a **🎨 Find cover
  art** picker (thumbnail grid → click to apply). API key lives in Settings →
  General. *Scoped to covers (grids) — the only artwork slot the catalog renders;
  hero/logo/icon need new model fields, deferred.* 223 vitest + 191 cargo green.
- [x] **T12c — Delta / patch updates.** Pure update-detection core in
  `download/records.rs` (`update_available` + `InstallRecords::mark_updates`, 2
  Rust KATs) + a `check_updates` command that compares each installed game's
  recorded version against the server's current manifest version and flips
  records `installed`↔`updateAvailable`. `useInstallOverlay(session)` runs a
  one-shot check on sign-in and merges via pure `mergeUpdateCheck` (preserves
  in-flight states; TS KATs in `installState.test.ts`). The detail panel shows an
  **⬆ Update available** button that calls `updateGame` → `download_verify`,
  which re-pulls **only the changed files** and finalizes at the new version. 222
  vitest + 184 cargo green.

**Social & multiplayer** (extends the existing WebRTC / gateway stack)

- [~] **T12d — Game invites + "Joinable" presence / party launch.** Add an invite
  frame over the gateway and a "Join" action on top of the in-game presence we
  already broadcast.
  - [x] Protocol + pure invite-state core (groundwork): `game_invite` /
    `game_invite_cancel` inbound frames and `game_invite` /
    `game_invite_respond` outbound builders mirrored in both `social::protocol`
    (Rust, 3 KATs) and `features/social/protocol.ts`; pure
    `features/social/invites.ts` reducer (received/remove/clearFrom/prune-TTL,
    dedup by sender+game, frame→action mapping, sort/count/joinTarget
    selectors; 15 vitest KATs).
  - [x] Toast + Join button UI and the gateway send/receive wiring. **Shipped in
    v0.10.10:** `useSocial` now drives the invite reducer from the live
    `game_invite`/`game_invite_cancel`/`friend_removed` frames (with a 30s TTL
    prune), exposes `gameInvites`/`sendGameInvite`/`acceptGameInvite`/
    `declineGameInvite` (accept/decline send `game_invite_respond`), and a
    `GameInviteToasts` stack offers Join/Dismiss (`?invites-demo` seeds it).
  - [x] Cross-tab toasts + launch handoff. **Shipped in v0.10.11:** `useSocial`
    is lifted to an app-root `SocialProvider`/`useSocialContext` (one live
    gateway for the whole app), `GlobalGameInviteToasts` mounts the stack in
    `AppShell` so invites surface on **every** tab, and Join now resolves the
    gameId against the cached catalog and calls `launch_game`. SocialView reads
    the same context instance. Verified in the browser preview (cross-tab render,
    Dismiss removes, no console errors). _Remaining:_ live end-to-end pairing
    still needs the server invite frame + a second peer (prod smoke test).
- [ ] **T12e — Screen share / video calls.** `useVoice.ts` already owns the full
  WebRTC offer/answer/ICE/TURN flow; adding a video / `getDisplayMedia` track is
  incremental, not a new subsystem.
- [x] **T12f — Group DMs / channels.** Multi-party rooms over the same gateway +
  reducer (DMs are strictly 1:1 today).
  - [x] Protocol + pure room-state core (groundwork): `room_created` /
    `room_renamed` / `room_member_added` / `room_member_removed` / `room_deleted`
    inbound frames and `room_create` / `room_rename` / `room_add_member` /
    `room_leave` outbound builders mirrored in both `social::protocol` (Rust,
    4 KATs) and `features/social/protocol.ts`; pure `features/social/rooms.ts`
    reducer (upsert-snapshot/rename/member add+remove/remove-room, self-removal →
    drop room, frame→action mapping, sort/count/membership selectors; 17 vitest).
  - [x] Room list + multi-party composer UI and the gateway send/receive wiring
    (v0.10.19). `useSocial` drives the rooms reducer from the room_* membership
    frames + a new room-chat layer (room_chat/room_message frames mirrored in
    Rust+TS; pure roomChat log reducer keyed by roomId, 10 vitest). UI: a Rooms
    roster tab + create-from-friends picker (RoomsPanel) and a room thread +
    composer with owner controls (RoomChatPane). Live end-to-end still needs the
    server to honor the room_create/room_chat frames (deferred).
- [x] **T12g — Group voice (3+).** Small mesh now (SFU later) on top of the current
  P2P 1:1 voice.
  - [x] Pure mesh peer-set core (groundwork): `features/social/voiceMesh.ts` —
    `MeshState` (selfId + per-peer `{phase,muted}` map + local mute) with a
    `meshReducer` (authoritative `roster` snapshot that preserves the phase of
    surviving peers; peerJoin/Leave/peerPhase/peerMuted/toggleMute/reset; unknown
    peers ignored), the coordination-free `isInitiator` offer-role rule
    (lower id offers) and selectors (`peersToOffer`/`meshPeers`/`connectedCount`/
    `participantCount`/`isMeshActive`). 13 vitest KATs. Reuses the existing
    per-peer `voice_signal` relay addressed to each member.
  - [x] `useGroupVoice` engine (one RTCPeerConnection per peer driven by the mesh
    reducer) + in-call roster UI + group-call start over a room (v0.10.19).
    Signaling reuses the per-peer voice_signal relay with payloads tagged
    group:true + roomId (routed to a dedicated group handler so 1:1 + group voice
    coexist); pure groupSignal/parseGroupSignal codec (5 vitest). UI: 📞 Start
    call in RoomChatPane + a GroupCallBar roster (per-peer phase/mute, my mute/
    leave). Engine is browser-API glue (untestable under jsdom, like useVoice);
    live multi-peer e2e still needs the server room-call relay + a smoke test.

**Library & launch quality**

- [x] **T12h — In-client Game Requests board.** Surface the Game Requests board
  inside the client (browse / upvote / request) instead of a separate web app.
  Shipped in **v0.10.4**. _Backend note (2026-06): the `ArcadeLauncher-Requests`
  companion service was **folded into the main server** as `mod requests_app`
  under `/requests` — same `https://{host}/requests` contract the client already
  uses, so no client change; the standalone `:8723` binary is retired._
  - [x] **T12h-5** (v0.10.15) Admin status triage **removed from the client** and
    relocated to the server admin UI (`/admin/requests`). The board now shows a
    read-only status badge only. Also fixed the companion service's **502 on board
    load** — a NULL `AVG(stars)` panicked into `f64`; read via `Option<f64>` +
    `CAST(... AS DOUBLE)`.
  - [x] **T12h-1** Pure core (`requests/api.rs`): Endpoint URL builders
    (login/logout/me/search+platform/requests/vote/rating/status), `GameRequest`/
    `Board`/`SearchHit`/`Me`/`CreateBody`/`RateResult` models + `parse_*`,
    `STATUSES`/`is_valid_status`. TS side: platform filter + 1–5 star ratings
    helpers (`applyRating`/`formatRating`/`boardPlatforms`/`filterByPlatform`).
  - [x] **T12h-2** Rust transport (`requests/commands.rs`): seven bearer-authed
    commands (board/me/search/create/vote/rate/status) over `https://{host}/requests`,
    reusing the launcher's per-user token (validated against the shared
    `launcher_tokens` table — the Requests service grew `Authorization: Bearer`
    support). `parse_create`/`parse_vote` (+ KATs); CI green both OSes (6d947c0).
  - [x] **T12h-3** React UI: Requests tab + `useRequests` hook (board with star
    ratings, platform/status filter chips, upvote, rate, search-and-request
    composer, admin triage). Shipped in v0.10.4.
  - [x] **T12h-4** Deployed the bearer-aware `ArcadeLauncher-Requests` binary to
    CT `10.0.0.210` as systemd unit `arcadelauncher-requests` (User=arcade,
    binds `0.0.0.0:8723`), behind nginx at `/requests` (prefix-strip proxy on
    `10.0.0.203`); shares the main server's DB via a composed `EnvironmentFile`.
    Verified end-to-end over public HTTPS: `/requests/health` → ok,
    `/requests/api/me` → `{"signedIn":false}`, bad bearer → 401.
- [x] **T12i — Auto-sync cloud saves on launch/exit + version history.** Saves are
  manual + last-write-wins today; auto-sync on game exit and keep N restorable
  save versions to retire the conflict problem.
  - [x] Version-history core + thin store (shipped groundwork): pure
    `saves::versions` (id format/parse, collision-free `next_version_id`,
    `plan_retention` keep-newest-N, `latest_version`; 12 KATs) + IO glue
    `saves_snapshot` / `saves_versions` / `saves_restore_version` commands
    (snapshot copies the managed save folder into a timestamped version dir and
    prunes to the newest N; restore snapshots-then-replaces, so a restore is
    itself undoable). Frontend `features/saves/saves.ts` pure core (auto-sync
    prefs parse/clamp, `shouldAutoSync`, byte/version formatting; 10 vitest KATs)
    + typed IPC wrappers.
  - [x] Auto-sync triggers wired into the launch/exit lifecycle (v0.10.18) and
    the per-game version-history restore UI (v0.10.19): GameDetail's cloud-saves
    panel lists restorable snapshots (UTC timestamp + file/size), snapshots on
    demand, and restores an older version (the live save is snapshotted first, so
    a restore is itself undoable). Pure formatVersionTime helper (3 vitest).
- [x] **T12j — "Continue playing" row + stats dashboard.** Use the playtime we
  already track to surface most-played and headline library numbers.
  - [x] "Continue Playing" row atop the catalog (recently-played, click-to-launch)
        backed by a pure `stats.ts` core (`recentlyPlayed`/`mostPlayed`/
        `libraryStats`/`formatDuration`/`formatLastPlayed`).
  - [x] Library stats dashboard: collapsible panel with headline numbers
        (games / played / total time) + a "Most Played" bar chart, backed by
        pure `playtimeBars` + `libraryStats`.
  - [ ] _Deferred:_ weekly recap (needs per-session history; we only track
        cumulative playtime + lastPlayed) and HowLongToBeat (external API).

**Bigger bets** (tie into adjacent projects)

- [x] ~~**T12k — Remote game streaming (Sunshine/Moonlight).**~~ **DROPPED — the
  entire built-in streaming subsystem was removed in v0.13.22 (2026-06-29):** stream
  engine, My PCs tab, host mode, play-from-anywhere (Tailscale mesh), runtime
  Sunshine sidecar, and Streaming settings are gone. Settings → **Remote Play** now
  just links out to Moonlight + Sunshine. The full T12k history below is retained as
  a record only — none of it ships anymore.
- [~] ~~**T12k — Remote game streaming (Sunshine/Moonlight).** Wire the launcher to
  stream an installed game from a host PC to a thin client — leverages the existing~~
  Moonlight/Debian-ISO work; effectively a personal GeForce-Now. Approach: **drive
  the existing open-source binaries** (Sunshine as the host server, Moonlight as
  the client) rather than reimplement the NVIDIA GameStream / Moonlight protocol —
  the launcher orchestrates pairing + launch, the heavy lifting (NVENC/AV1 encode,
  ENet/RTSP transport, input) stays in the upstream projects. Pure-core-first as
  always: protocol/URL/parse logic is IO-free and KAT-tested; process + network
  glue is the thin seam.
  - [x] **T12k-1** Host detection + presence (pure core): `streaming::host`
    models `StreamHost {name, address, paired, state}` + `HostState`
    (unknown/offline/online), `config_base_url` (`https://<addr>:47990`),
    `is_ready` (paired+online); parses Sunshine `apps.json` (`parse_apps`,
    tolerant, drops blank-named apps) into `SunshineApp`; and decides
    `is_streamable(host, apps, game)` (ready host + case/space-insensitive app
    match). No IO. 12 Rust KATs. Shipped CI-only (no UI yet).
  - [x] **T12k-2** Sunshine host control (Rust seam): talk to Sunshine's HTTPS
    config API (default `:47990`) to **pair** (PIN flow), list/add a launcher game
    as a Sunshine "app" (so launching it on the host runs our game), and read
    pairing state. Creds/host stored client-local (never in `library.json`).
    Self-signed cert handling via TOFU fingerprint pin (pinned, not disabled).
    - **Pure core** (`streaming::control`, 10 KATs): `ControlEndpoint`
      (`normalize_address` → `https://<addr>:47990`; `apps_url`/`pin_url`),
      `is_valid_pin` (4 digits), `pin_body`/`new_app_body` (`image-path` rename),
      `parse_pin_result` (bool-or-string `status`), dependency-free RFC-4648
      `b64encode`/`basic_auth_value` for Sunshine's Basic auth, and the cert-pin
      decision (`cert_fingerprint_hex` SHA-256 + `fingerprint_matches`).
    - **Registry** (`streaming::store`, 4 KATs): `StreamHosts` get/upsert/remove/
      `pinned_fingerprint` + atomic load/save to per-user `streaming_hosts.json`
      (host + pin only — **no creds on disk**).
    - **Live seam** (`streaming::commands`): a `tls_info` reqwest client that
      captures the host's self-signed leaf cert and enforces the SHA-256 pin
      (TOFU on first pair, reject-on-change after — no custom rustls verifier, no
      new dep). Commands `sunshine_pair`/`sunshine_apps`/`sunshine_add_app`/
      `streaming_hosts`/`streaming_forget_host`; Basic-auth creds passed per-call,
      never persisted. Shipped in v0.10.x (CI-only; live-host verification rides
      on the T12k-4 streaming UI that drives these).
  - [x] **T12k-3** Moonlight client launch: **shell out to the Moonlight client**
    (GPL — separate process we invoke, never linked), as decided. Pure core
    `streaming::moonlight` shapes the argv IO-free: `DisplayMode`
    (fullscreen/borderless/windowed → CLI flag), `StreamSettings`
    {width,height,fps,bitrate_kbps,display_mode,hdr} with `Default` (1080p60 @
    20 Mbps) + `sanitized()` clamps, `executable_candidates()` (per-OS exe names),
    `stream_args(host,app,settings)` (`stream <host> <app> --resolution WxH --fps
    --bitrate <mode> --hdr|--no-hdr`), `pair_args(host)`. 7 Rust KATs. Thin seam in
    `commands.rs`: `moonlight_available` (probes PATH for the client) and
    `stream_launch(address,app,settings?)` (resolves the exe, spawns Moonlight with
    the built argv). Shipped in v0.10.x (CI-only; real-Moonlight flag correctness
    rides on the T12k-4 streaming UI smoke test).
  - [x] **T12k-4** Streaming UI: a **▶ Stream from host** affordance on the detail
    panel (shown once a host is paired; auto-picks a lone host, else a picker) and
    a **Settings → Streaming** section — pair/forget Sunshine hosts (PIN entry,
    Moonlight-installed indicator) and stream-quality defaults
    (resolution/fps/bitrate/window-mode/HDR) persisted locally and passed through
    to Moonlight. Pure core `streaming.ts` (sanitize/clamp, PIN validation,
    stored-settings parse — 11 vitest KATs), typed IPC `api.ts`, `useStreaming`
    hook, `StreamingSection` + `StreamFromHost` components. Shipped in v0.10.5.
    Verified by tsc + production build + 260 unit tests + a full Tauri dev compile
    & launch (all 7 streaming commands register, webview loads). **Interactive
    smoke test PASSED (2026-06-20, computer-use):** the Settings → Streaming section
    renders with the pair-a-host form (address/user/pass/PIN) and correctly detects
    "Moonlight client: not found on PATH". *Live pairing not tested — needs a real
    Sunshine host PIN + Moonlight installed.*
  - [~] **T12k-5** Reuse the Debian-ISO Moonlight thin-client work: document/wire
    the autoinstall image as a ready-made set-top client that pairs to the same
    host, so a TV box and the desktop launcher share one streaming setup.
    _Deferred — lives in the separate `debian-autoinstall` repo, not in this
    client; revisit as a cross-project doc task rather than an in-client change._

  **GOAL (2026-06-21): reach "Steam Remote Play" parity.** T12k-1..5 give a working
  streaming *client* + *remote* Sunshine admin, but using it still means manually
  installing/running Sunshine on the host, pairing by IP+PIN, and port-forwarding to
  play over the internet. The target is Steam's "it just works": any of your PCs can
  host with no manual setup, your devices appear automatically under your account, and
  it streams from anywhere. We keep the Sunshine/Moonlight core (it *is* GameStream —
  right tech, game-grade latency + controller input) and add three orchestration
  layers on top. Do NOT pivot to the WebRTC/`getDisplayMedia` path (T12e) — that's for
  casual screen-share, not game streaming.

  **ARCHITECTURE (decided 2026-06-21): GPL streaming-engine sidecar.** Reuse
  Sunshine/Moonlight code AND keep the launcher proprietary via aggregation: a
  standalone **open-source GPL-3.0 streaming engine** (separate process, embeds +
  modifies `moonlight-common-c` / Sunshine, controllers handled inside it) that the
  proprietary launcher drives over an **arm's-length IPC boundary** (local socket /
  stdio / defined protocol). Separate programs at arm's length = aggregation → the
  launcher stays closed-source. **Do NOT link the engine into the launcher process**
  (static / dynamic / FFI / dlopen = one combined work = the whole app becomes GPL).
  The engine likely lives in its own GPL repo and ships in the client installer;
  in-app rendering via a borderless child window reparented into the launcher window
  (`SetParent` / XEmbed). The three layers below thus become "drive the GPL engine over
  IPC" rather than "shell out to stock binaries." Full design in
  [[uc-streaming-remoteplay-plan]].

  - [ ] **T12k-6 — Local host mode (zero-setup hosting).** The launcher manages
    Sunshine *on this machine*: detect/install/run it, and auto-register the user's
    library games as Sunshine apps so "let this PC be streamed" is one toggle, not a
    manual Sunshine setup. (Today T12k-2 only controls a *remote* Sunshine; nothing
    runs/installs it locally.) Biggest win toward Steam parity.
  - [x] **T12k-7 — Account/gateway-brokered discovery.** _Shipped v0.13.0 / server
    0.11.0._ Every PC signed into the account auto-appears under My PCs with no IP/PIN:
    a device registers to the server (`stream_hosts`, online derived from last-seen
    freshness) and the `/ws/social` gateway pushes `stream_host_update` to the account's
    own other sockets. REST `/api/social/hosts*`. (Brokered zero-PIN cert exchange for
    auto-pin is a later layer — `certFp` is plumbed but unused.)
  - [ ] **T12k-8 — Play-from-anywhere (NAT traversal).** Make internet streaming work
    without manual port-forwarding. **DECIDED: self-hosted Headscale + headscale-ui**
    (Tailscale control server on the homelab; devices run official Tailscale clients).
    Host+client join one WireGuard overlay that *looks like LAN* so Sunshine/Moonlight
    just work; the launcher joins via an ArcadeLauncher-server-minted pre-auth key (no
    separate IdP). Self-host a DERP relay for fallback. (Chosen over Tailscale-SaaS and
    Netbird. The existing coturn/TURN is WebRTC-only — Moonlight's ENet/RTSP won't use it.)
    Deploy Headscale+UI on the homelab: preferred Docker on the Docker host 10.0.0.180,
    alternative its own Proxmox CT; public via headscale.orlandoaio.net (decision open).
    - **Decided/built (2026-06-22): bundle Tailscale, no separate install.** The
      launcher ships `tailscaled`/`tailscale` as sidecar binaries (BSD-3, located
      next to the exe like the engine) and drives them; no user-facing Tailscale
      install, no tray. In-process tsnet was rejected — userspace networking can't
      give the *separate* engine process a route to `100.64.x.x`; a real WinTun/TUN
      interface is required, so a bundled managed `tailscaled` it is.
    - **Infra DONE:** Headscale live on CT 136 (10.0.0.222), reachable public (CF)
      + internal (AD-DNS `headscale → 10.0.0.203`); pre-auth-key + userspace-join
      validated end-to-end on the LAN.
    - **Code spine DONE (compiles + unit-tested, branch `feat/t12k-8-mesh`):**
      `streaming/mesh/control.rs` pure core (CGNAT validation, status parse,
      LAN-vs-mesh selection; 13 KATs) + `mesh/conn.rs` transport (drive bundled
      CLI) + Tauri cmds `mesh_is_available/status/join/resolve_host`. Server
      (branch `feat/t12k-8-mesh-preauth`): `POST /api/social/mesh/preauth` mints a
      short-lived single-use Headscale key (`HeadscaleConfig`, 5 KATs). `[minor]`.
    - **GATES before release:** (1) ~~**engine real streaming**~~ **DONE** — engine
      `client.start` landed; engine **v0.2.0** (first streaming-capable build) is
      released + bundled, and the client drives it (see T12k-10). The mesh path's
      remaining gates below still stand; (2) bundle real `tailscaled`+`wintun.dll` (Win) /
      `tailscaled` (Linux) in CI + tauri.conf; (3) privileged daemon/service +
      WinTun bring-up validated on the runner + a two-machine test (`ensure_daemon`
      is flagged UNVERIFIED); (4) React UI (fetch key → `mesh_join` → resolve →
      feed existing stream-launch); (5) version lockstep — server VERSION/repo were
      0.10.17 local vs client 0.11.0; reconcile + matching `[minor]` on both; deploy
      server first; (6) set `ARCADE_HEADSCALE_API_URL/API_KEY` on the prod server +
      mint a Headscale `apikeys create` token.
  - _Licensing note:_ Sunshine (GPL-3.0) and Moonlight (GPL-3.0) are invoked as
    separate processes / bundled binaries, **not** statically linked into the
    (proprietary) launcher — keeps the launcher's licensing clean. Revisit if we
    ever embed Moonlight's renderer in-process.
  - [x] **T12k-9 — Per-host game library + "My PCs" tab.** _Shipped v0.13.0 / server
    0.11.0._ The My PCs tab now lists your account's devices (online/offline dots, offline
    = greyed) sourced from `useMyPcs()`; each expands to its published games (box art via
    relative `cover_ref`) and a per-game Play → existing `play(lan||mesh, app)`. A PC's
    library survives sleep (last-known rows in `stream_host_apps`). Publishing happens from
    **Settings → Stream from this PC** (independent of engine host support, so games show
    up even before that PC is a working stream host). Manual pair-by-IP kept as a fallback.
  - [x] **T12k-10 — In-engine playback (client drives `client.start`).** Shipped in
    **launcher v0.12.0** (2026-06-22). Replaced the always-spawn-Moonlight path with
    the bundled engine: **engine v0.2.0** (first streaming-capable release) is
    published and bundled in the installer (`release.yml` stages `0.2.0` both OSes).
    Launcher side: pure `streaming/play.rs` (`client_start_params` settings schema,
    `is_terminal_phase`, `stream://state` + `stream://stats` events; 5 KATs) +
    `streaming/engine_session.rs` persistent-session transport (spawn engine `stream`
    mode → `client.start` handshake with synchronous in-band engine errors → reader
    task forwarding `stream.state`/`stream.stats`, `AtomicU64` generation for
    supersession, stop-channel close = graceful `client.stop`; commands
    `engine_stream_available`/`stream_start`/`stream_stop`). Frontend `streaming.ts`
    (`parseStreamState`/`isStreamTerminal`/`streamPhaseLabel`, +11 KATs),
    `useStreaming.play()` (engine-preferred, returns `"engine"|"moonlight"`) +
    `stop()`, `StreamFromHost.tsx` (live phase label + in-app **■ Stop**).
    **External Moonlight kept as automatic fallback.** Green: cargo 293 / vitest 362
    / tsc / clippy. **Live end-to-end A/V still unvalidated** — no GameStream host +
    GPU client in CI; needs a real host on the LAN + this PC as client.
  - [x] **T12k-11 — Engine-only streaming + manual host-engine install.** Shipped in
    **launcher v0.13.12 / engine v0.3.9** (2026-06-23). The release engine links the
    renderer, so the external-Moonlight fallback from T12k-10 was **removed**:
    `streaming/moonlight.rs` → `settings.rs` (kept only `DisplayMode`/`StreamSettings`);
    dropped the `moonlight_available`/`stream_launch` commands + JS bindings; UI gates on
    `engine` only and `play()` returns `Promise<void>`. Added a **Host engine** section in
    Settings → Stream from this PC (`HostEngineInstall.tsx` + `host_install`/
    `host_install_status`) — status/version readout + Download / Reinstall(force) / Refresh.
    Engine v0.3.9 also **stops adopting a system Sunshine** (deleted `sunshine_detect`;
    `start()` always spawns its own bundled child — the `not_paired` Bug 2 fix). Green:
    371 vitest / `tsc` / `cargo check`. **Live end-to-end A/V still unvalidated.**
- [ ] **T12l — Mobile companion app.** Remote library browse, "install to my PC",
  chat / presence, and download-queue control from a phone.

**Polish**

- [x] **T12m — Custom themes / accent color + first-launch onboarding wizard.**
  - [x] Theme system: Dark / Midnight / Light modes + 6 accent presets, applied
        live via CSS vars on `:root` and persisted (pure `theme.ts`). Appearance
        section in Settings.
  - [x] First-run onboarding overlay (5 steps, pure `onboarding.ts`).
  - [x] Keyboard-shortcut help overlay (`?`), pure `help/shortcuts.ts`.

---

## Execution order

Top-down by foundational value: **T4 (downloads) → T5 → T6 → T7 → T8 → T9 →
T10**. Small self-contained wins (e.g. T6a favorites, T7b global hotkey) may be
pulled forward to land quick visible parity when a larger phase is mid-flight,
but the core installer (T4) comes first because it's what makes this a launcher
rather than a viewer.
