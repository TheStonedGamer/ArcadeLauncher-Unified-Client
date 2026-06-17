# ArcadeLauncher Unified Client — Session Handoff

Working handoff for the next session. The single source of truth for *what's
left* is [`ROADMAP.md`](ROADMAP.md); this file captures *current state*, the
*hard rules*, and the *next concrete step* so a cold start can resume safely.

Last updated: 2026-06-17. **T10 complete** — v0.9.2 published; native C++ client
retired (EOL release via `ArcadeLauncher-Client` workflow dispatch).

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
   truth; all client-local state lives in separate per-user files.
4. **No new system dependencies** that diverge Win/Linux (no OpenSSL → use
   rustls; no OS keychain → obfuscate-at-rest; pure-Rust crates only).
5. **Releases:** push a `vX.Y.Z` tag only after CI on `main` is green. Signing
   secrets are configured. `release.yml` creates a **draft** release — publish
   with `gh release edit --draft=false --latest` once both matrix jobs succeed.

## Local verification (run before every commit)

```sh
npm test                                  # vitest
npm run build                             # tsc + vite
cd src-tauri && cargo test --locked       # Rust KATs
cd src-tauri && cargo check --release --locked   # must be warning-clean
```

CI mirror: `.github/workflows/ci.yml` on windows-latest + ubuntu-22.04.

---

## What's done

- **Full feature parity** with the native C++/Linux clients — see [`PARITY.md`](PARITY.md).
- **Phases T0–T10 complete** — unified client is the sole shipping product.
- **T10b:** v0.9.2 signed release on GitHub (NSIS + `.deb`/`.rpm`/AppImage + `latest.json`).
- **T10c:** Native C++ auto-update retired; migration notice points users to unified releases.

---

## NEXT STEP — maintenance / optional infra

No roadmap blockers remain. Optional:

- **TURN deploy** — coturn on `10.0.0.180` + server env for symmetric-NAT voice.
- **Install-records catalog overlay** — Install button reflects `install_records.json` without catalog reload.
- **7z/rar extraction** — if non-zip `pc_archive` titles matter.

---

## Security / ops constraints (still in force)

- Do **not** read production `*.env` files or query MariaDB for credentials/tokens.
- Prod SSH/deploy to `10.0.0.210` requires explicit per-turn authorization.
- Do not use `-ExecutionPolicy Bypass`.
- WiX/NSIS `UpgradeCode` is **permanent** — never change it.
- `[minor]` commit keyword is **only** for client↔server compat-breaking changes.

## Repo facts

- Repo: `TheStonedGamer/ArcadeLauncher-Unified-Client`, branch `main`.
- App id `com.thestonedgamer.arcadelauncher`, version **0.9.2**.
- Updater: `releases/latest/download/latest.json` (signed).
