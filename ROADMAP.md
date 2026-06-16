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
- [~] **T4c** Extraction phase for `pc_archive` installs; install-state
  transitions written back to client-local install records (not `library.json`).
  - [x] **T4c-1** Install-records core: `InstallState` + `InstallRecord` +
    `InstallRecords` collection (get/state_of/upsert/set_state/remove/
    installed_ids) + non-destructive atomic load/save to a separate per-user
    `install_records.json`. (6 KATs)
  - [ ] **T4c-2** Extraction glue (safe unzip for `pc_archive`) + engine writes
    install-state transitions into the records on start/done/fail.
- [ ] **T4d** Download UI: install button on detail panel + queue/status panel
  (speed graph, queue list, pause/resume/cancel, active-count badge).
- [ ] **T4e** Verify both-OS green; manual smoke against a real server file.

## Phase T5 — Art & metadata pipeline

- [ ] **T5a** IGDB cover/hero art fetch + on-disk cache (client-local cache
  dir); fall back to catalog-provided paths/URLs.
- [ ] **T5b** Screenshots / hero art on the detail panel.
- [ ] **T5c** Re-arm art fetch for games missing both cover URL and local path
  (the native client's missing-cover mitigation).

## Phase T6 — Library personalization

- [ ] **T6a** Favorites + hidden games: toggle UI (detail panel + grid context),
  client-local persistence (`catalog_prefs.json`), "Hidden" sidebar scope.
  (Query layer already filters favorites/hidden; this adds toggle + persist.)
- [ ] **T6b** Collections management: add/remove a game to/from a collection.

## Phase T7 — Platform polish & desktop integration

- [ ] **T7a** Discord Rich Presence (now-playing).
- [ ] **T7b** Global hotkey to summon/hide the launcher.
- [ ] **T7c** Gamepad navigation + Big Picture mode.
- [ ] **T7d** Close-to-tray / launch-minimized wired to the real window/tray.

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
