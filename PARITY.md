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

## NOT yet at parity ❌

| Area | Native | Unified | Impact |
|---|---|---|---|
| **Voice chat (WebRTC)** | ✅ (SDL2/miniaudio + WS voice relay) | ❌ stubs only | The server's `voice_signal` relay + audio gating exist and the protocol carries voice frames, but **no capture/playback/peer-connection is implemented in the webview.** This is the single outstanding native feature. |

## Verdict

The unified client is at **full parity except voice chat.** Everything that makes
it a working launcher + text-social client is done, verified, and green on both
OSes. Voice is the only gap and is self-contained (a new `voice/` feature using
`getUserMedia` + `RTCPeerConnection` over the existing `voice_signal` relay).

**Recommendation:** voice does not block a first *signed* release (T10b) of the
unified client, since the C++ client stays the live product until T10c flips the
auto-update channel. Two viable paths:

1. **Ship T10b now** (text-complete), build voice as T9g before T10c flips users.
2. **Build voice first** (T9g), then T10b ships full parity in one cut.
