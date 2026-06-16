# Feature-parity audit — Unified Client vs native C++/Linux clients (T10a)

Audited 2026-06-16 against the native ArcadeLauncher clients (Windows C++/Direct2D
+ Linux C++/nanovg) that the unified Tauri client is replacing. "At parity" means
the unified client implements the user-visible behavior, is wired to the live
server/contract, and is covered by the same one-green-on-both-OSes CI gate.

## At parity ✅

| Area | Native | Unified | Notes |
|---|---|---|---|
| Catalog grid + detail | ✅ | ✅ | `catalog/` — read `library.json`, launch, detail panel |
| Search / sort / filter / collections | ✅ | ✅ | `catalog/query.ts` (16 vitest) |
| Favorites / hidden | ✅ | ✅ | `catalog/prefs.ts`, separate `catalog_prefs.json` |
| ROM-variant grouping + picker | ✅ | ✅ | `catalog/variants.ts` |
| IGDB cover art | ✅ | ✅ | Rust `fetch_cover_art`, creds-gated |
| Game install / download | ✅ | ✅ | resumable ranged GET, sha256, atomic, zip-slip guard |
| Download controls (pause/resume/cancel/limit) | ✅ | ✅ | `download/` |
| Pre/post-launch hooks + playtime | ✅ | ✅ | reported to `game_stats` |
| Cloud saves | ✅ | ✅ | `saves/` managed folder + per-game save path |
| Settings (file-backed) | ✅ | ✅ | atomic non-destructive write |
| Login / TOTP / token persistence | ✅ | ✅ | `session/`, challenge-response, obfuscated at rest |
| Discord Rich Presence | ✅ | ✅ | settings-gated |
| Global hotkey + close-to-tray + Big Picture | ✅ | ✅ | Rust core + `gamepad/` |
| Auto-update | ✅ | ✅ | Tauri updater (signing now configured) |
| Social: friends + presence | ✅ | ✅ | live WS gateway |
| Social: DM chat | ✅ | ✅ | edit/delete/read/typing |
| Social: reactions + replies | ✅ | ✅ | |
| Social: attachments | ✅ | ✅ | presign → MinIO, bytes never touch webview |
| Social: profiles (banner/bio/level/XP) | ✅ | ✅ | |
| Social: friend org (groups/notes/pin/search/add) | ✅ | ✅ | T9e |
| Social: presence depth (custom status / DND) | ✅ | ✅ | T9f |
| Social: DM privacy + persistent ignore | ✅ | ✅ | T9f |

| Social: voice chat | ✅ | ✅ | T9g — P2P WebRTC (see note) |

## NOT yet at parity ❌

_None._ Voice chat (the prior gap) shipped in T9g as peer-to-peer WebRTC, signaling
over the server's existing `voice_signal` relay.

> **Voice note:** the unified client uses **P2P WebRTC** rather than the native
> client's server binary-audio relay, so a unified↔C++ cross-client call won't
> interoperate — acceptable since the C++ client is retired at T10c. Unified↔unified
> works. ICE currently uses public STUN only; symmetric-NAT users will need a TURN
> server (pending infra/nginx step) added to `useVoice` `ICE_SERVERS`.

## Verdict

The unified client is at **full feature parity** with the native C++/Linux clients.
Everything is implemented, wired to the live contracts, and green on both OSes.

**Next:** T10b — tag the first signed release (signing secrets + pubkey already
configured), then T10c to flip users off the C++ auto-update channel. The TURN
server is the one live-infra task remaining before voice is robust across all NATs.
