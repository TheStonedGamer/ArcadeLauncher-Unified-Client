# Handoff — ArcadeLauncher Unified Client

Cold-start entry point. **Current release: `v0.13.22`** (commit `540e7fd`, docs
`d451b32`), branch `main`, working tree clean.

> This file is the short "where are we right now" note. The long-form documents
> are the real sources of truth:
> - [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's left (the `[ ]` items)
> - [`docs/HANDOFF.md`](docs/HANDOFF.md) — full state + hard rules + release process
> - [`CHANGELOG.md`](CHANGELOG.md) — user-facing history (it *is* the Discord announcement)
> - [`memory/AGENT_MEMORY.md`](memory/AGENT_MEMORY.md) — durable non-obvious facts
>   (edit via `npm run memory -- set …`, never by hand)

---

## Current state

The launcher does not stream games. Settings has a **Remote Play** tab that links
out to **Moonlight** (client) and **Sunshine** (host) via the opener plugin, and
that is the whole of it — there is no stream engine, host mode, device mesh, or
sidecar download anywhere in the client, the server, or CI.

### Recent releases

| Version | What |
|---|---|
| `0.13.23` | Download queue shows game titles instead of raw ids |
| `0.13.22` | Removed built-in streaming; Settings → Remote Play links to Moonlight/Sunshine |
| `0.13.21` | Settings reorganized into tabs, pinned Save bar, tighter spacing |
| `0.13.20` | Multi-drive library support + move installed games between drives |
| `0.13.19` | Card context menu: "Open local folder" + clearer Verify entry |
| `0.13.18` | Install games into clean-title folders + migrate existing installs |

---

## Open work (from `docs/ROADMAP.md`)

- **T12e — Screen share / video calls.** `useVoice.ts` already owns the WebRTC
  offer/answer/ICE/TURN flow; adding a video / `getDisplayMedia` track is
  incremental. Best-fit next feature.
- **T12l — Mobile companion app.** Remote library browse, "install to my PC",
  chat/presence, download-queue control. Big.
- **T4e** — verify both-OS green + a manual smoke against a real server file.
- **TSc** — wire the session host+token into the social live connection.
- **BI1 follow-up** — Authenticode signing for the Windows `.exe` is still not
  wired; only the Tauri updater `.sig` is produced today.
- **T12j deferred** — weekly recap (needs per-session history; we only track
  cumulative playtime + `lastPlayed`) and HowLongToBeat (external API).

---

## Non-negotiable rules (full text in `docs/HANDOFF.md`)

1. **Never ship unverified.** The launcher auto-updates on launch and the owner
   does not read diffs. Nothing lands that isn't green on **both** Windows and
   Linux CI.
2. **One shippable increment at a time** = pure tested core (exhaustive KATs) +
   thin transport/UI glue.
3. **Non-destructive to user data.** `library.json` is a read-only source of
   truth; client-local state lives in separate per-user files.
4. **No new system deps that diverge Win/Linux** — pure-Rust crates, rustls, no
   OpenSSL, no OS keychain.
5. **Changelog is mandatory and user-facing.** Every shipped change gets an entry
   under `[Unreleased]` in `CHANGELOG.md`, written for users. It's posted to
   Discord verbatim on release.

### Local verification (before every commit)

```sh
npm test                                          # vitest
npm run build                                     # tsc + vite
cd src-tauri && cargo test --locked               # Rust KATs
cd src-tauri && cargo check --release --locked    # must be warning-clean
```

### Cutting a release — version lives in FOUR files

`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock` (the `arcade_launcher` stanza). Bump all four, update
`CHANGELOG.md` (rename `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`, open a fresh
`[Unreleased]`), commit, push `main`, confirm CI green, then
`git tag vX.Y.Z && git push origin vX.Y.Z` to fire `release.yml`.

---

## Build infra

- **Windows** builds **natively** on Proxmox VM 111 `arcade-win10-runner`
  (label `arcade-win10`); MSI + NSIS both bundle.
- **Linux** builds on CT 130 `arcade-pve-client-runner` (label `prox-pve`).
- The `cargo-xwin` cross-compile and the old `prox-win` VM 131 are **abandoned** —
  do not resurrect.

## Security / ops constraints

- Do **not** read production `*.env` files or dump MariaDB / systemd `Environment`
  for credentials. Find paths on disk instead.
- Prod SSH/deploy to `10.0.0.210` requires explicit per-turn authorization.
- Distribute only legally self-dumped console firmware/BIOS.
- Do not use `-ExecutionPolicy Bypass`. WiX/NSIS `UpgradeCode` is **permanent**.
- `[minor]` commit keyword is **only** for client↔server compat-breaking changes.

## Repo facts

- Client: `TheStonedGamer/ArcadeLauncher-Unified-Client`, branch `main`.
- Server: `TheStonedGamer/ArcadeLauncher-Server`, branch `main`; `VERSION` is the
  source of truth and pushing to `main` auto-bumps it (bot commit → `git pull
  --rebase` before pushing). systemd `arcadelauncher-server` on CT
  `10.0.0.210:8721`, library root `/srv/arcade-library`, nginx on `10.0.0.203`.
- App id `com.thestonedgamer.arcadelauncher`. Updater reads the signed
  `releases/latest/download/latest.json`.
