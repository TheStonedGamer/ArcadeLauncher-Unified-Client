# ArcadeLauncher Unified Client — Session Handoff

Working handoff for the next session. The single source of truth for *what's
left* is [`ROADMAP.md`](ROADMAP.md); this file captures *current state*, the
*hard rules*, and the *next concrete step* so a cold start can resume safely.
Durable, non-obvious facts live in [`AGENT_MEMORY.md`](AGENT_MEMORY.md) (edit via
`npm run memory -- set …`, never by hand).

Last updated: 2026-06-19. **Unifying client + server onto a shared 0.10.0 version
line** (client was 0.9.21, server 1.2.27) so the `major.minor` client↔server
lockstep lines up at `0.10`. PS2 BIOS hosted on prod and wired end-to-end.

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
5. **Releases:** bump version in all four files (below), commit, push `main`,
   confirm CI green, then push a `vX.Y.Z` tag. Signing secrets are configured.

## Local verification (run before every commit)

```sh
npm test                                  # vitest
npm run build                             # tsc + vite
cd src-tauri && cargo test --locked       # Rust KATs
cd src-tauri && cargo check --release --locked   # must be warning-clean
```

CI mirror: `.github/workflows/ci.yml` on windows-latest + ubuntu-22.04.

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

- Client: `TheStonedGamer/ArcadeLauncher-Unified-Client`, branch `main`, **v0.9.21**.
- Server: `TheStonedGamer/ArcadeLauncher-Server`, branch `main`; `VERSION` file is
  source of truth, push to `main` auto-bumps (bot commit → `git pull --rebase`
  before pushing). Runs as systemd `arcadelauncher-server` on CT `10.0.0.210:8721`,
  library root `/srv/arcade-library`. nginx reverse proxy on `10.0.0.203`.
- App id `com.thestonedgamer.arcadelauncher`. Updater: signed
  `releases/latest/download/latest.json`.
