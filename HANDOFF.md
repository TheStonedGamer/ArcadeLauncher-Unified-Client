# ArcadeLauncher Unified Client — Session Handoff

Working handoff for the next session. The single source of truth for *what's
left* is [`ROADMAP.md`](ROADMAP.md); this file captures *current state*, the
*hard rules*, and the *next concrete step* so a cold start can resume safely.

Last updated: 2026-06-16. HEAD of `main`: T4d-3 (install trigger), all CI green.

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
5. **First real release is blocked on the owner** adding repo secrets
   `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Do **not**
   push a `v*` tag until then — it triggers `release.yml`, which would fail
   signing. (A draft release is created, but the run goes red.)

## Local verification (run before every commit)

```sh
npm test                                  # vitest (currently 85 passing)
npm run build                             # tsc + vite
cd src-tauri && cargo test --locked       # Rust KATs
cd src-tauri && cargo check --release --locked   # must be warning-clean
```

CI mirror: `.github/workflows/ci.yml` on windows-latest + ubuntu-22.04. Watch a
run with `gh run watch <id> --exit-status` then
`gh run view <id> --json conclusion,jobs`.

Note: Windows `LF will be replaced by CRLF` warnings on `git add` are benign.

---

## What's done (recent sessions)

- **Phase T0–T7 complete** — foundation, catalog, social core+live transport,
  downloads core/transport/extraction/queue-UI, art pipeline, personalization,
  and platform polish (Discord RPC, global hotkey, gamepad + Big Picture,
  close-to-tray). See ROADMAP for the per-item detail.
- **TSa — session/auth foundation** (`8aaf20e`). Pure `session::crypto` (6 KATs)
  mirrors the server's challenge-response (`derive_auth_key` = SHA-256(lower(
  trim(user))‖0x1f‖pass); `challenge_proof` = hex HMAC-SHA256(nonce);
  `hmac_ctr_xor`/`decrypt_token` = HMAC-CTR). `session_login` command does
  GET `/api/auth/challenge` → proof → POST `/api/auth/verify` → native token
  decrypt, with a `/api/login` password fallback. Frontend `SessionProvider` +
  `LoginPanel` modal + header account chip. Password never persisted/logged.
- **TSc (first half) — social-live wiring** (`da5ae0e`). `useSocial(auth)` builds
  the live `WsGateway` when a session is present (else `?ws`/`?demo`/Null);
  `SocialView` sources auth from `useSession()`. Sign in → social connects;
  sign out → gateway torn down.
- **AUR `-git` package** (`27b1da0`). `packaging/arch/` is now `arcadelauncher-git`:
  builds from current `main` (no tag), `pkgver()` derived from git, committed
  `.SRCINFO`. **Publishing to the AUR is the owner's step** (needs their AUR SSH
  key) — exact commands are in [`packaging/README.md`](packaging/README.md).
- **TSb — session persistence** (`06952f0`). Pure `session::storage` (6 KATs):
  `StoredSession`, `encode`/`decode` obfuscate the token at rest with the
  existing HMAC-CTR keystream (no plaintext on disk, no keychain dep), and
  `is_expired`. Thin `session::store`: atomic `session_save`/`session_restore`
  (drops stale/expired/corrupt)/`session_clear`, keyed by a per-install seed
  (the app-config dir). `SessionProvider` auto-restores on launch, saves on
  login, clears on logout. Token never touches localStorage.
- **T4d-3 — install trigger (DONE).** Manifest core grew `version`/`installType`
  + `archive_path()` (mirrors the server's `is_pc_primary_archive`; 4 KATs).
  `download_install` command — [`src-tauri/src/download/commands.rs`](src-tauri/src/download/commands.rs) —
  fetches `GET /api/games/:id/manifest` (Bearer = session token), resolves the
  per-user install dir (`app_data/games/<id>`) + records
  (`app_config/install_records.json`), reads the cap from settings, hands off to
  the engine. `GameDetail` shows an Install button for server-backed,
  not-yet-installed games (disabled → "Sign in to install" signed out), host+
  token from `useSession()`; progress flows to the existing Downloads tab.

---

## NEXT STEP — T4e (finish the installer phase), then T8

**T4e — verify + smoke.** Both-OS CI is already green for T4d-3. What's left is
a **manual smoke against a real server file** that only the owner can do on a
real machine: sign in (`LoginPanel`) against the live server
(`arcade.orlandoaio.net`), click **Install** on a server-backed PC game, and
confirm the Downloads tab shows progress → verify → (extract) → Installed, and
that `app_data/games/<id>` is populated. Things to watch:
- Non-`.zip` `pc_archive` titles (.7z/.rar): the manifest's `archive_path()`
  detects them, but the client only extracts `.zip` natively, so extraction will
  report a clear failure. If those titles matter, add 7z/rar extraction (new
  task) or have the server pre-zip. Plain file-set installs are unaffected.
- The install button reads `game.installState` from `library.json`; a freshly
  installed game won't flip to "installed" in the catalog until a catalog
  reload (install state is tracked in `install_records.json`). Reconciling the
  two (e.g. overlay install-records onto the catalog) is a reasonable follow-up.

After T4e, the installer phase (T4) is complete. Next major area is **T8 — cloud
saves v1** (server endpoints already exist; build the pure sync-decision core +
thin upload/download glue, same pattern as everything above).

**For reference — the old T4d-3 task is now done. Key files added/changed:**
- `download_install` + `Manifest::archive_path` (`src-tauri/src/download/`).
- `installGame` wrapper — [`src/features/download/api.ts`](src/features/download/api.ts).
- Install button — [`GameDetail.tsx`](src/features/catalog/components/GameDetail.tsx)
  + wiring in [`CatalogView.tsx`](src/features/catalog/CatalogView.tsx).

<!-- Historical detail from when T4d-3 was the next step (kept for context):
4. **`Install` button** in `GameDetail.tsx`: on click, read session from
   `useSession()` (disabled/"sign in to install" when `!session`), fetch
   manifest, resolve install dir + `records_path` + `version` + `cap_kbps` from
   General settings, call `download_start`. Reflect install-state from the
   records (Installed/Installing) so the button shows the right label.
5. Mark **T4d-3** `[x]` in ROADMAP, then **T4e** (verify both-OS green + a
   manual smoke against a real server file).

**Server contract already known:** ranged GET `/files/<id>/<rel>` with
`Authorization: Bearer` (+ `Range`), full-file SHA-256 verify, `..` traversal
rejected. Server on CT `10.0.0.210:8721`, nginx `10.0.0.203` →
`arcade.orlandoaio.net`. Manifest route: `GET /api/games/:id/manifest`.
-->

---

## Remaining roadmap

- **T4e** Verify both-OS green (done for T4d-3) + manual smoke (see Next Step).
- **T8** Cloud saves v1 (server endpoints already exist; client sync).
- **T9** Social depth: edit/delete/read receipts, reactions/replies,
  attachments (MinIO `10.0.0.220`), profiles, friend groups, presence depth.
- **T10** Cutover: parity audit → first signed release (owner adds signing
  secrets) → switch users off the C++ client.

## Security / ops constraints (still in force)

- Do **not** read production `*.env` files or query MariaDB for
  credentials/tokens.
- Prod SSH/deploy to `10.0.0.210` requires explicit per-turn authorization.
- Do not use `-ExecutionPolicy Bypass`.
- The owner runs catalog scans **manually**.
- WiX/NSIS `UpgradeCode` is **permanent** — never change it.
- `[minor]` commit keyword is **only** for client↔server compat-breaking changes.
- Do not handle the owner's password; `totpCode` is not persisted.
- `ROADMAP-V2.md` (the C++ repo) is local-only — never push it.

## Repo facts

- Repo: `TheStonedGamer/ArcadeLauncher-Unified-Client`, branch `main`.
- Tauri v2 (Rust core + React/TS webview). Crate binary: `arcade_launcher`.
- App id `com.thestonedgamer.arcadelauncher`, version `0.1.0`.
- reqwest uses **rustls**; Discord RPC via `discord-rich-presence`; global
  shortcut via `tauri-plugin-global-shortcut`; tray via Tauri `tray-icon`.
