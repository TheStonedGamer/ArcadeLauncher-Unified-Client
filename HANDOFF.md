# ArcadeLauncher Unified Client — Session Handoff

Working handoff for the next session. The single source of truth for *what's
left* is [`ROADMAP.md`](ROADMAP.md); this file captures *current state*, the
*hard rules*, and the *next concrete step* so a cold start can resume safely.
Durable, non-obvious facts live in [`AGENT_MEMORY.md`](AGENT_MEMORY.md) (edit via
`npm run memory -- set …`, never by hand).

Last updated: 2026-06-21. Client + server share a `0.10` `major.minor` lockstep
line. PS2 BIOS hosted on prod and wired end-to-end.

**RELEASED: v0.10.15 — admin moves server-side (2026-06-21).** Tagged from `main`;
Release run `27906012877` built both legs green (Windows native VM 111 + Linux),
GitHub Release **published** (not draft, 11 signed assets + `latest.json`
advertising `0.10.15` → auto-update on next launch), and the Discord changelog
announce fired successfully (the `actions: write` fix from v0.10.13 is now live).
Change: the **Requests board no longer shows the admin-only inline status
dropdown** — game-request triage (approve/fulfil/decline) moved to the **server
admin UI** (`/admin/requests`, prod server 0.10.9). The read-only status badge
stays; `RequestsView.tsx` lost the triage `<select>`, its `isAdmin`/`onStatus`
props, and the `RequestStatus` import (`useRequests.setStatus` is now unused but
left in place). Server also gained `/admin/accounts` (full account management +
pending self-service signup approve/deny). Earlier this session: **v0.10.14**
added the "Forgot password?" self-service reset UI.

**RELEASED: v0.10.13 — self-service registration is LIVE end-to-end (2026-06-21).**
Tagged from `main` (version-bump `713076e`, feature `5b410dd`); Release run
`27889786185` built both legs green (Windows native VM 111 + Linux) and the
GitHub Release is **published** (not draft) with all 7-platform signed assets +
`latest.json` advertising `0.10.13` → installed launchers auto-update on next
launch. Server `/api/auth/register` independently verified live on
`arcade.orlandoaio.net` (`/api/health` → 0.10.2; empty form → `400 "username
must be 3–32 characters"`; `ARCADE_REGISTRATION_OPEN=true`). End-to-end: user
updates → "Create one" → submit → account pending admin approval → approve/deny
via emailed links. _Known non-fatal CI nit (FIXED in workflow, not yet released):_
the publish-release "Announce changelog to Discord" step 403'd
("Resource not accessible by integration") because the job lacked
`actions: write` to `workflow_dispatch` `discord-changelog.yml` — the release
itself was unaffected (it had already published). Fix: added `actions: write` to
the `publish-release` job `permissions` in `release.yml` (takes effect next
release; the v0.10.13 Discord ping did not fire).

---

## CURRENT STATE (2026-06-21) — read this first; older sections below are history

**TSd self-service registration — SHIPPED + DEPLOYED end-to-end.** A "Create one"
link on the sign-in modal opens a `RegisterPanel` (host/username/email/password +
confirm) with client-side validation (username 3–32, password ≥10, match), calling
a new `session_register` Tauri command that POSTs form data to
`POST /api/auth/register`. Accounts are created **pending admin approval**; on
success the panel shows a submitted-confirmation.
- **Client** (`5b410dd` on `main`): `RegisterPanel.tsx` (new), `LoginPanel.tsx`
  ("Create one" footer), `session/commands.rs` (`session_register`), `lib.rs`
  (invoke handler), `api.ts` (`sessionRegister`/`RegisterOutcome`), `global.css`.
  `npm run build` + `cargo check --release` green locally; **verified in browser
  preview** (modal opens, validation: short-pw + mismatch → error & disabled,
  valid → enabled, submit wires to invoke). CI run `27889295007`: Linux ✅,
  **Windows leg was still in flight at handoff — confirm green before relying on it.**
- **Server** (`059ed20` on `ArcadeLauncher-Server` `main`): `registration.rs`
  (`api_auth_register` + `api_auth_approve`/`api_auth_deny` GET link handlers,
  `pending_registrations` table, argon2 hash + single-use token, admin email).
  **DEPLOYED to prod CT `10.0.0.210`** — rebuilt natively (`/root/.cargo/bin/cargo`,
  ~3m18s), binary swapped, service restarted. `/api/health` now reports **0.10.2**;
  `/api/auth/register` is **live and OPEN** (invalid POST → 400 validation, proving
  `ARCADE_REGISTRATION_OPEN=true` took). Pre-deploy backups:
  binary `…/arcadelauncher-server.bak.<epoch>`, env
  `/root/arcadelauncher-server.env.pre-reg.<epoch>`.
- **Registration is gated by `ARCADE_REGISTRATION_OPEN`** (must equal the string
  `true`) in `/etc/arcadelauncher-server.env` — set this turn. Approval emails use
  `ARCADE_ADMIN_EMAIL`/`ARCADE_REGISTRATION_NOTIFY_EMAIL` (both + SMTP confirmed
  set); if SMTP ever fails, the approve/deny links are logged to journald so an
  admin can still act. To CLOSE signup again: flip the var to `false` + restart.
- Adding a route is patch-compatible (no `[minor]`), so 0.10.x lockstep holds.

**BUILD-INFRA — native Windows builds on VM 111 (supersedes the BI1 cross-compile
section below).** The BI1 `cargo-xwin` cross-compile was abandoned; the Windows
CI/release leg now builds **natively** on Proxmox **VM 111 `arcade-win10-runner`**
(label `arcade-win10`), with MSI back in the bundle. Three gotchas codified in the
workflows: (1) put cargo on `$GITHUB_PATH` via `rustup which cargo` (dtolnay action
skips it when rustup pre-exists); (2) WiX `light.exe` ICE validation needs the
runner service as **LocalSystem**; (3) the runner runs as LocalSystem so tauri's
32-bit `makensis` hits **WOW64 file-system redirection** — release.yml junctions
`SysWOW64\…\systemprofile\AppData\Local\tauri` → the real `System32\…` dir. The old
BI1/prox-xwin text below is OBSOLETE — ignore it.

---

**BUILD-INFRA (2026-06-20, ROADMAP "BI1") — OBSOLETE, see CURRENT STATE above.** Windows artifacts now build with
**`cargo-xwin` + the `x86_64-pc-windows-msvc` target** (MSVC ABI, clang-cl + lld,
CRT/SDK auto-downloaded — no Windows host). **MSI is DROPPED**; Windows ships the
**NSIS `.exe`** (+ portable) only (`makensis` runs on Linux). `tauri.conf.json`
`bundle.targets` no longer lists `msi` and the `windows.wix` block is removed
(`wix/main.wxs` left on disk — permanent UpgradeCode, do not delete in case MSI
is ever revived).

**Runner topology (LIVE) — two pinned Linux CTs on PVE host `10.0.0.98`, each on
its own disjoint 8 host cores so the two legs build in true parallel:**
- **CT 130 `arcade-gh-runner`** → cpuset **cores 0-7**. Hosts the Server runner
  (`arcade-pve-runner`) AND a new client runner **`arcade-pve-client-runner`**
  (label **`prox-pve`**, dir `~/actions-runner-client`) — the Linux client leg.
- **CT 132 `arcade-xwin-build`** (full clone of 130) → cpuset **cores 8-15**.
  Runs **`arcade-xwin-runner`** (label **`prox-xwin`**) — the Windows cross leg.
  PRE-PROVISIONED with: clang/clang-cl, lld/lld-link, llvm-lib + llvm-rc symlinked
  into `/usr/bin`, nsis, Rust stable + `x86_64-pc-windows-msvc` target, cargo-xwin.
  The cpusets are raw `lxc.cgroup2.cpuset.cpus` lines in `/etc/pve/lxc/<id>.conf`.
- The desktop **`pc-wsl-runner` was DEREGISTERED** (it used to serve `prox-pve`);
  client Linux jobs now land deterministically on CT 130. The old Proxmox Windows
  **VM 131 / `prox-win` / `arcade-win-runner` are ABANDONED** (offline) — do not
  resurrect. `pc-win-runner` remains online but has no `prox-*` label so it can't
  grab CI/release jobs.

Both `ci.yml` and `release.yml` Windows legs now `runs-on: [self-hosted, prox-xwin]`
(provisioning steps dropped — CT is pre-provisioned). CI's Windows leg is a
**compile check** (`cargo xwin check`) since cross-built test `.exe`s can't run on
Linux; the KATs run natively on the `prox-pve` Linux leg. **Verified:** a manual
`cargo xwin check` of the full app on CT 132 compiles clean (webview2-com/tao/
single-instance all OK). **Not yet exercised:** the `makensis` NSIS bundling step
(only runs under `tauri build`) — the first CI/release run validates it.
**Code-signing the `.exe`** (e.g. `osslsigncode` on Linux) is NOT wired yet — a
follow-up; only the Tauri updater `.sig` is produced today.

**IN FLIGHT (2026-06-20) — read before pushing.** `v0.10.11` (T12d follow-up) is
committed and PUSHED (`52a6e58`); its CI run was verifying under the OLD staggered
config and it has NOT been tagged yet. Several infra commits are HELD LOCAL (not
pushed) at the owner's request ("no more builds right now") pending host-side core
pinning:
- `3ef3f9c` (PUSHED) — CI speedups: `paths-ignore **/*.md`, concurrency
  `cancel-in-progress: true`, `CARGO_PROFILE_DEV_DEBUG=line-tables-only`.
- `efca5d5` (HELD) — release.yml concurrency guard (`cancel-in-progress: FALSE`,
  so a re-dispatched tag queues rather than aborting a signing build).
- `861a964` (HELD) — **parallelize** the Windows+Linux legs in BOTH ci.yml and
  release.yml (dropped `needs: windows` / `needs: release-windows` + the
  `!cancelled()` gates; publish-release still waits on both legs). **Re-evaluate
  against CURRENT STATE (native VM 111 Windows runner):** the Windows leg now
  runs on its own native runner (`arcade-win10`) separate from the Linux runner,
  so parallelizing the legs is sound — just confirm the workflow `runs-on`
  labels match the live topology before pushing.
- ~~**Owner action pending on PVE host `10.0.0.98`:** pin VM 131 (prox-win) and
  CT 130 to disjoint cores so parallel runners don't contend.~~ **OBSOLETE — see
  CURRENT STATE.** VM 131/`prox-win` is abandoned; the live Windows runner is the
  separate native **VM 111 `arcade-win10-runner`**, so the original same-host
  contention premise no longer applies as written. Do not perform the
  `qm set 131 --affinity` / `pct set 130` pinning.

**`v0.10.10` is RELEASED** —
the GitHub Release is published (not draft) with all artifacts (Windows NSIS +
MSI, Linux deb/rpm/AppImage), each `.sig`-signed, plus `latest.json` (advertises
`0.10.10`, 7 platform targets), so every installed launcher auto-updates on next
launch. **v0.10.10** adds the **T12d game-invite UI** (first half): `useSocial`
drives the pure invite reducer from live `game_invite`/`game_invite_cancel`/
`friend_removed` frames (30s TTL prune) and exposes `gameInvites` +
`sendGameInvite`/`acceptGameInvite`/`declineGameInvite` (accept/decline send
`game_invite_respond`); a new `GameInviteToasts` stack on the Friends screen
offers Join/Dismiss (`?invites-demo` seeds it). **Verified in the browser preview**
(toasts render, Dismiss removes, no console errors). _Deferred follow-up:_
cross-tab toast placement (lift `useSocial` to an app-shell SocialContext) and the
launch-on-Join handoff (resolve gameId → catalog `Game` → `launch_game`); live
end-to-end still needs the server invite frame + a second peer. No server-side
deploy required. **v0.10.9** (prior) added **T12g groundwork** (group voice 3+, CI-only, no UI):
pure `features/social/voiceMesh.ts` — `MeshState` (selfId + per-peer
`{phase,muted}` map + local mute) with a `meshReducer` (authoritative `roster`
snapshot that preserves surviving peers' phase; peerJoin/Leave/peerPhase/
peerMuted/toggleMute/reset; unknown peers ignored), the coordination-free
`isInitiator` offer-role rule (lower id offers), and selectors
(`peersToOffer`/`meshPeers`/`connectedCount`/`participantCount`/`isMeshActive`);
13 vitest KATs (316 vitest + 261 cargo green). Reuses the existing per-peer
`voice_signal` relay. The `useGroupVoice` RTCPeerConnection-per-peer engine +
in-call roster UI + group-call start over a room are deferred (need T12f room UI
live + a multi-peer smoke test). No server-side deploy was required. There is no
new user-observable surface in v0.10.9 (pure groundwork), so no computer-use
smoke test applies. **v0.10.8** (prior) added **T12f groundwork** (group DMs /
channels, CI-only, no UI): room protocol
frames `room_created`/`room_renamed`/`room_member_added`/`room_member_removed`/
`room_deleted` + `room_create`/`room_rename`/`room_add_member`/`room_leave`
builders mirrored in `social::protocol` (Rust, 4 KATs) and
`features/social/protocol.ts`, plus a pure `features/social/rooms.ts` reducer
(authoritative upsert-snapshot, member add/remove, self-removal drops the room;
sort/count/membership selectors; 17 vitest). Message threading + room-list/composer
UI + gateway wiring deferred (T12f-2: needs live server room frames + a smoke
test). No server-side deploy was required. **v0.10.7** (prior) fixed a
bug where the bootstrap updater compared the release against its own
`CARGO_PKG_VERSION` (the updater's independent 0.9.x version) instead of the
installed app version, so it reinstalled on every launch; `updater/build.rs` now
embeds the app version from `tauri.conf.json` as `APP_VERSION` and the check
compares against that (guard test added). **v0.10.6** (prior release) shipped the
**single-instance guard** (`tauri-plugin-single-instance`: a second launch brings
the existing window to the front instead of opening a duplicate) plus the
**updater bring-to-front** behaviour (re-running the bootstrap updater while the
launcher is already running surfaces the live window instead of reinstalling over
it — process detection in `src-tauri/updater/src/instance.rs`, pure + unit-tested),
and carried the T12i save-history + T12d game-invite groundwork. No server-side
deploy was required for either. Separately, the
**Requests 503 fix** is DEPLOYED on prod CT `10.0.0.210` — the
`arcadelauncher-requests` binary now reads the catalog DB's real `server_settings`
columns (`setting_key`/`setting_value`); search works again. The `v0.10.4` Game
Requests board remains DEPLOYED on the same CT (systemd `arcadelauncher-requests`,
User=arcade, `0.0.0.0:8723`) behind nginx `10.0.0.203` at `/requests`.

**Interactive smoke test (2026-06-20, computer-use):** the installed launcher was
driven end-to-end and PASSED — boots straight to the library (2049 games synced,
signed in; confirms the v0.10.7 updater no longer reinstalls on launch);
**single-instance guard** holds (2nd launch spawns no duplicate process) and
**brings the existing window to front** (minimized window restored + focused on
relaunch); **Requests search works live** ("zelda" returns results — the 503 fix is
good in prod); Settings renders fully (themes/accents, controller map, global
hotkey, SteamGridDB key, RetroAchievements, all emulators + BIOS "Ready"/
"Deployed", **Streaming** UI with correct "Moonlight not on PATH" detection); and
the **social gateway shows "Connected"** (live WS, presence Online). Not tested
(need a second peer / live host PIN): real Sunshine pairing, voice calls, and the
not-yet-built T12d/T12f group UIs.

**Next:** ROADMAP Phase T12 — the remaining items (T12d Join UI, T12e/f/g social
UI + wiring, T12i auto-sync lifecycle + restore UI) are blocked on interactive
computer-use smoke tests and live server frames, deferred while the user is away.
T12d + T12f now both have pure-core protocol + reducer groundwork landed & released
(CI-only); the UI/wiring halves remain. Land pure-core / CI-only increments where
possible.

**In progress: T12k (remote streaming).** `T12k-1` landed (CI-only, no UI):
`src-tauri/src/streaming/host.rs` is the pure host core — `StreamHost`/`HostState`,
`config_base_url` (`https://<addr>:47990`), `is_ready`, Sunshine `apps.json`
parsing (`parse_apps`/`SunshineApp`), and `is_streamable(host, apps, game)`. 12
Rust KATs. **`T12k-2` DONE** (CI-only): `streaming::control` (pure shaping +
cert-pin decision, 10 KATs), `streaming::store` (`StreamHosts` registry +
atomic `streaming_hosts.json`, 4 KATs), and `streaming::commands` (live seam):
a `reqwest` client built with `tls_info(true)` + `danger_accept_invalid_certs/
hostnames` that captures the host's self-signed leaf cert and enforces a SHA-256
**pin** (TOFU on first pair via `fingerprint_matches`, reject-on-change after) —
so no custom rustls verifier and **no new dep**. Commands `sunshine_pair`,
`sunshine_apps`, `sunshine_add_app`, `streaming_hosts`, `streaming_forget_host`;
Basic-auth creds passed per-call, never persisted. **Live-host verification is
deferred to T12k-4** (no Sunshine host available to drive these headless; the UI
will exercise them). **`T12k-3` DONE** (CI-only): `streaming::moonlight` is the
pure argv core — `DisplayMode`, `StreamSettings` (`Default` 1080p60 @ 20 Mbps +
`sanitized()` clamps), `executable_candidates()` (per-OS), `stream_args` /
`pair_args` — 7 Rust KATs (33 streaming KATs total). Thin seam in
`streaming::commands`: `moonlight_available` (probe PATH for the client) and
`stream_launch(address, app, settings?)` (resolve exe, spawn Moonlight, GPL —
separate process, never linked). Real-Moonlight flag correctness rides on the
T12k-4 smoke test. **`T12k-4` DONE** (shipped in v0.10.5): the streaming UI.
Frontend feature `src/features/streaming/` — pure `streaming.ts` core
(sanitize/clamp mirroring the Rust bounds, `isValidPin`, `parseStoredSettings`;
11 vitest KATs), typed IPC `api.ts`, `useStreaming` hook (hosts +
Moonlight-availability + localStorage-persisted quality defaults), a
**Settings → Streaming** `StreamingSection` (pair/forget hosts, Moonlight-
installed indicator, quality defaults), and a **▶ Stream from host**
`StreamFromHost` button wired into `GameDetail` (auto-picks a lone host, else a
picker). Verified: tsc + `vite build` + 260 unit tests + a full `tauri dev`
compile & launch (all 7 streaming commands register, webview loads). **Live
visual/pairing smoke test deferred** — needs a real Sunshine host + Moonlight and
interactive computer-use approval (unavailable on this autonomous run); the seam
is exercised by exactly this UI when a host is present. **T12k-5 deferred** —
it's a cross-project doc/wiring task in the separate `debian-autoinstall` repo,
not this client.

**In progress: T12i (auto-sync + save version history).** Version-history
groundwork shipped (CI-only, no UI): pure `saves::versions` — `SaveVersion`,
sortable `format_version_id`/`parse_version_time`, collision-free
`next_version_id`, `plan_retention` (keep newest N, clamp [1,100]),
`latest_version`; **12 Rust KATs**. Thin IO glue in `saves::commands`:
`saves_snapshot` (copy the managed save folder into `app_data/saves_versions/
<id>/<vid>/`, prune to newest N), `saves_versions` (list newest-first), and
`saves_restore_version` (safety-snapshots the live folder, then replaces it —
restore is itself undoable). Frontend `features/saves/saves.ts` pure core
(auto-sync prefs parse/clamp, `shouldAutoSync`, `formatBytes`/`versionLabel`/
`sortVersions`; **10 vitest KATs**) + typed IPC in `features/saves/api.ts`.
**Remaining:** wire auto-sync into the launch/exit lifecycle and build the
Settings + per-game version-history restore UI (deferred — needs the launch-flow
seam and a computer-use smoke test while the user is interactive).

---

## Non-negotiable rules (read first)

1. **Never ship unverified.** The launcher auto-updates on launch and the owner
   does not read diffs. Nothing lands that isn't compiled clean and **green on
   BOTH Windows and Linux CI**. Verify locally, push, then confirm the GitHub
   Actions run is green on both jobs before stacking the next change.
2. **One shippable increment at a time** = pure tested core + thin transport/UI
   glue. OS/IO-free logic gets exhaustive KATs (Rust `cargo test`, TS `vitest`);
   network/UI/IPC glue sits on top, kept thin.
3. **Non-destructive to user data.** `library.json` is read-only source of
   truth; all client-local state lives in separate per-user files
   (`catalog_prefs.json`, `install_records.json`, `controller_profiles.json`).
4. **No new system dependencies** that diverge Win/Linux (no OpenSSL → rustls;
   no OS keychain → obfuscate-at-rest; pure-Rust crates only).
5. **Releases:** bump version in all four files (below), **update `CHANGELOG.md`**
   (rename `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`, open a fresh `[Unreleased]`),
   commit, push `main`, confirm CI green, then push a `vX.Y.Z` tag. Signing
   secrets are configured.
6. **Changelog is mandatory + user-facing.** Every shipped change lands an entry
   under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) (Added/Changed/Fixed/
   Removed), written for users, not commit-speak. On release-publish,
   `.github/workflows/discord-changelog.yml` posts that version's section to
   Discord verbatim — the changelog *is* the announcement, so keep it clean.

## Local verification (run before every commit)

```sh
npm test                                  # vitest
npm run build                             # tsc + vite
cd src-tauri && cargo test --locked       # Rust KATs
cd src-tauri && cargo check --release --locked   # must be warning-clean
```

CI mirror: `.github/workflows/ci.yml` on the self-hosted Proxmox runners
(`prox-win` + `prox-pve`). Legs run in PARALLEL once commit `861a964` is pushed
AND the runners are pinned to disjoint host cores (VM 0-7 / CT 8-15); until then
the live workflow still staggers Linux after Windows.

## Cutting a release (version lives in FOUR places)

`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock` (the `arcade_launcher` package stanza). Bump all four,
commit, push `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z` to fire
`release.yml`. Keep the stray `# ArcadeLauncher – Comprehensive CI.txt` (an
architect-prompt doc, not source) OUT of commits — `git reset -- "# Arcade…"`.

---

## What's done

- **Full feature parity** with the native C++/Linux clients — see [`PARITY.md`](PARITY.md).
- **Phases T0–T10 complete** — unified client is the sole shipping product.
- **v0.9.19** — PS2 BIOS auto-deploy into PCSX2, Steam-style Validate & Repair
  (`download_verify`), per-card context menu.
- **v0.9.20** — Social: pending **Requests** tab (incoming Accept/Decline/Ignore,
  outgoing Cancel) over `POST /api/social/friends/respond`; roster auto-refreshes
  on `friend_request`/`friend_accepted`/`friend_removed` gateway events. Client +
  server `FEATURES.md` written.
- **v0.9.21** — **Firmware deployment status in Settings**: read-only
  `firmware_status` command + `status_all()` reporting per-console
  (PS1/PS2/Xbox/PS3) whether each BIOS is *staged* vs actually *deployed* into its
  emulator; surfaced as the "Firmware deployment" panel (`FirmwareStatusGroup`).
  Plus: firmware-status load respects the reload seq guard; friend-request
  response falls back to a direct REST roster fetch (`fetchFriendsDirect`) when the
  gateway socket is momentarily down so accepted/declined rows always clear.

- **v0.10.0** — unified version line: client + server now share `major.minor`
  (server bot landed exactly on `0.10.0`). **T12j (part 1) — "Continue Playing"
  row**: commit `25f777e`, a recently-played horizontal strip atop the catalog
  (All Games, no search) with click-to-launch, backed by a pure
  `catalog/stats.ts` core (`recentlyPlayed`/`mostPlayed`/`libraryStats`/
  `formatDuration`/`formatLastPlayed`, 10 KATs) + `ContinuePlayingRow.tsx` +
  `.continue-*` CSS + `?catalog-demo` preview seed. Pure TS/React/CSS (no Rust);
  194 tests + build green; CI-only push (no tag/release).
- **T12j (part 2 — DONE)**: library stats dashboard — a collapsible panel atop
  the catalog with headline numbers (games / played / total time) + a "Most
  Played" bar chart. Pure `playtimeBars` added to `stats.ts` (3 KATs) +
  `LibraryStatsPanel.tsx` + `.stats-*` CSS. 197 tests + build green; verified in
  browser preview (figures + proportional bars, no console errors). **T12j
  complete** except deferred weekly-recap (needs per-session history) and
  HowLongToBeat (external API).

- **v0.10.1 (T12m — DONE)**: personalization + first-run polish, all pure-core +
  thin-UI, no server contract change. (1) **Themes** — Dark/Midnight/Light modes +
  6 accent presets, applied live via CSS vars on `:root` + persisted to
  localStorage (`theme.prefs`); pure `theme/theme.ts` (7 KATs); `applyStoredTheme()`
  runs in `main.tsx` pre-render; Appearance section in Settings. (2) **Onboarding**
  — 5-step first-run overlay, pure `onboarding/onboarding.ts` (6 KATs), `onboarding.done`
  flag. (3) **Shortcuts help** — `?` (or header button) opens a cheat-sheet, pure
  `help/shortcuts.ts` (isHelpHotkey/isEditableTag). 216 tests + build green; verified
  in preview (onboarding steps, live theme swap, `?`/Esc). **This is the first
  PATCH release of the unified line** — keeps `major.minor = 0.10` matching the live
  server (a minor bump would trip version-lockstep). Tagged `v0.10.1` to fire
  release.yml.

- **v0.10.2 (bugfix)**: tray-click double-fire. The window "wouldn't stay in
  front / kept minimizing" because `on_tray_icon_event` matched
  `TrayIconEvent::Click { button: Left, .. }` — which on Windows fires TWICE per
  physical click (button_state Down then Up), so a tray click toggled the window
  show→hide. Fixed by matching `button_state: MouseButtonState::Up` only
  (`tray/setup.rs`), so one click = one toggle. cargo check green.

- **v0.10.3 (T12a/T12b/T12c — features DONE, release BLOCKED)**: three Phase-T12
  features, each a separate commit on `main`, all green on CI (228 vitest, 197
  cargo, tsc clean, no build warnings):
  - **T12a — RetroAchievements** (`344a114`): RA Web API slice
    (`retroachievements/api.rs` + `commands.rs`, 6 KATs) — score/rank/recent
    unlocks; RA points mapped onto the shared level curve. Settings panel. Deferred:
    in-game toasts, social activity, server XP write-back.
  - **T12b — SteamGridDB cover-art picker** (`9ad29bd`): pure `catalog/art.rs`
    (search/grids parsing, 6 KATs) + `steamgriddb_search`/`apply_cover`; "🎨 Find
    cover art" thumbnail picker in the detail panel, stored as a non-destructive
    `cover_overrides` prefs entry. API key in Settings.
  - **T12c — Delta/patch updates** (`cb853e8`): version-compare core
    (`update_available`/`mark_updates`, Rust KATs) + `check_updates` command; the
    overlay flags **⬆ Update available** on sign-in and re-pulls only changed files
    via the verify engine.
  - ROADMAP/FEATURES updated. Version bumped to 0.10.3 in all four files
    (`54b8cbf`), `v0.10.3` tag pushed.

## Runner topology FIXED — release ready to re-tag (2026-06-19)

The label collision is resolved. The Proxmox runners now carry **distinct**
labels and the release workflows are pinned to them:
- Proxmox Win VM `arcade-win-runner` → added label **`prox-win`**.
- Proxmox Linux CT `pc-wsl-runner` (client) + `arcade-pve-runner` (server) →
  added label **`prox-pve`**.
- Desktop `pc-win-runner` → **`arcade-win` removed** (can no longer grab release
  jobs; left with `self-hosted,X64,Windows`).
- `release.yml`: `release-windows` → `prox-win`, `release-linux` → `prox-pve`
  (commit `0250474`, pushed `main`). Server `server-release.yml` → `prox-pve`
  (commit `71aa32f`, pushed `main`) — verified the server release run picked up
  the CT (status in_progress, not stuck queued).

**Remaining: re-tag `v0.10.3`** to fire the Windows release on the Proxmox VM
(which has the working toolchain + WiX), then confirm BOTH legs green. The old
tag still points at the pre-fix commit — delete & re-push it:
`git tag -d v0.10.3 && git push origin :refs/tags/v0.10.3 && git tag v0.10.3 && git push origin v0.10.3`.

### Original blocker (for reference) — Windows runner env on the desktop PC

The features are done; the **Release workflow is not green**. `release-linux`
succeeds; **`release-windows` fails**. Root cause is the runner topology, not our
code. What the debugging found, in order (each fixed in `release.yml`, commits on
`main`):

1. `dtolnay/rust-toolchain@stable`'s internal "parse toolchain version" step runs
   under `bash`; on the Windows runner `bash` resolves to **System32 WSL bash**
   (no distro) → exit 1. Replaced with a PowerShell rustup step.
2. `shell: pwsh` → **pwsh (PowerShell Core) is not installed** on the runner. Use
   `shell: powershell` (Windows PowerShell 5.1).
3. `rustup` **not on PATH** in that PowerShell. The step now locates/installs
   rustup in `%USERPROFILE%\.cargo\bin`, installs via `rustup-init` if missing, and
   appends that dir to `GITHUB_PATH` for later steps. Toolchain step now passes.
4. Now **WiX `light.exe` "failed to run"** during MSI bundling (NSIS + updater
   artifacts build fine; only the `msi` target fails). Fresh bundler-tools cache
   (`-v1`→`-v2`) did NOT fix it, so it's not a corrupt cache. v0.10.2 built the MSI
   fine 50 min earlier on the same workflow → environment regression on the runner.
   Owner chose to **keep the MSI and debug** (not drop the `msi` target). Last
   release run was building with `args: --verbose` to surface light.exe's real
   error when the owner redirected to the runner fix below.

**The real fix the owner wants — pin builds to the Proxmox runners.** There are
**two online Windows runners sharing the `arcade-win` label**, so release jobs land
nondeterministically:
- `arcade-win-runner` — the **Proxmox** Windows VM (intended Windows builder).
- `pc-win-runner` — the owner's **desktop PC** (has the WSL-bash / no-pwsh /
  rustup-not-on-PATH / WiX env that produced all the failures above).
- `pc-wsl-runner` — labelled `arcade-pve` (Linux); the Proxmox Linux CT builder.

Owner's directive: **"move the runners back to Proxmox — prox Windows builds the
Windows client, prox-pve builds the Linux client and the server."** Action for next
session: give the Proxmox runners **distinct labels** (e.g. `prox-win` /
`prox-pve`) so they no longer collide with the desktop PC, and point
`release.yml`'s `runs-on` at those labels (and the Server repo's release workflow at
`prox-pve`). Either relabel `pc-win-runner` off `arcade-win` or take it offline so
Windows release jobs only land on the Proxmox VM. Once builds run on the Proxmox VM
(which has a working toolchain + WiX), re-tag `v0.10.3` and confirm both legs green.

## PS2 BIOS — now hosted on prod (2026-06-19)

- `ps2-bios.bin` = **NTSC-U `scph39001`** (4 MiB, sha256 `f4c948e6…910c9d`) copied
  to `root@10.0.0.210:/srv/arcade-library/emulators/`, `root:root 0644`, hash added
  to `SHA256SUMS` (`sha256sum -c` OK).
- Server `/api/emulators` is a **live dir scan** → already lists it as firmware and
  serves it at `/emulators/ps2-bios.bin` (no restart needed). Client stages it and
  `deploy_pcsx2_bios` wires it into PCSX2 automatically.
- Server commit `0fe7f3a` adds the friendly label `("ps2-bios", "PlayStation 2 BIOS
  (PCSX2)", "firmware")` to `emulator_meta` (`ArcadeLauncher-Server/src/manifest.rs`).
  Pushed to `main`; Server Release workflow auto-bumped VERSION.

## NEXT STEP

- **Resume the v0.10.11 ship (BLOCKED on owner host work).** 1) On PVE
  `10.0.0.98` pin VM 131 + CT 130 to 8 disjoint cores each (commands in the
  IN FLIGHT block at the top). 2) Push the held commits `efca5d5` + `861a964`.
  3) Confirm the now-parallel CI is green on BOTH OSes. 4) Tag `v0.10.11`
  (`git tag v0.10.11 && git push origin v0.10.11`) to fire the parallel
  release.yml. 5) Verify the published release + `latest.json` advertises
  `0.10.11`. Live end-to-end invite pairing still needs the server invite frame +
  a second peer (prod smoke test).
- ~~**re-tag `v0.10.3`**~~ **DONE 2026-06-19** — re-tagged onto `fddcbc5`,
  release.yml ran both legs green on the Proxmox runners; signed installers +
  `latest.json` published to the v0.10.3 release. The desktop-runner WiX/MSI
  failure did not recur on the Proxmox VM, confirming it was the label collision.
- No release work pending. Next: ROADMAP Phase T12 net-new backlog.
- ~~OPTIONAL — deploy the new server binary to CT `10.0.0.210`~~ **DONE
  2026-06-19**: rebuilt server `1.2.27` (commit `3b043f2`) on the CT and swapped
  the binary; `/api/health` now reports `1.2.27` so the "PlayStation 2 BIOS
  (PCSX2)" label is live. Pre-deploy backup at
  `/opt/arcadelauncher-server/arcadelauncher-server.bak.predeploy-1.2.27`.
- Region swap: to ship PAL instead, overwrite `/srv/arcade-library/emulators/
  ps2-bios.bin` with the PAL dump (same filename) + update `SHA256SUMS`; clients
  re-verify by size and re-pull.

No roadmap blockers remain. Net-new feature backlog now lives in
[`ROADMAP.md`](ROADMAP.md) **Phase T12 — Beyond parity**.

---

## Security / ops constraints (still in force)

- Do **not** read production `*.env` files or query MariaDB / systemd `Environment`
  for credentials/tokens (classifier-blocked). Find paths on disk instead of
  dumping env.
- Prod SSH/deploy to `10.0.0.210` (root) and the server CT requires explicit
  per-turn authorization.
- Distribute only **legally self-dumped** console firmware/BIOS — never
  redistribute vendor firmware beyond the owner's own machines.
- Do not use `-ExecutionPolicy Bypass`. WiX/NSIS `UpgradeCode` is **permanent**.
- `[minor]` commit keyword is **only** for client↔server compat-breaking changes.

## Repo facts

- Client: `TheStonedGamer/ArcadeLauncher-Unified-Client`, branch `main`, **v0.10.3
  tagged** (release pending — Windows runner fix). Self-hosted runners:
  `arcade-win-runner` (Proxmox Win VM) + `pc-win-runner` (desktop) both on label
  `arcade-win`; `pc-wsl-runner` on `arcade-pve` (Linux). The label collision is the
  release blocker — see above.
- Server: `TheStonedGamer/ArcadeLauncher-Server`, branch `main`; `VERSION` file is
  source of truth, push to `main` auto-bumps (bot commit → `git pull --rebase`
  before pushing). Runs as systemd `arcadelauncher-server` on CT `10.0.0.210:8721`,
  library root `/srv/arcade-library`. nginx reverse proxy on `10.0.0.203`.
- App id `com.thestonedgamer.arcadelauncher`. Updater: signed
  `releases/latest/download/latest.json`.
