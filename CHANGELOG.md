# Changelog

All notable user-facing changes to the ArcadeLauncher Unified Client are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

**Release rule:** before cutting a `vX.Y.Z` tag, rename the `[Unreleased]`
heading below to `[X.Y.Z] - YYYY-MM-DD` (and start a fresh empty `[Unreleased]`).
When the GitHub Release for that tag is published, `.github/workflows/discord-changelog.yml`
extracts this version's section verbatim and posts it to Discord — so this file
*is* the announcement. Keep entries short, user-facing, and grouped under
Added / Changed / Fixed / Removed.

## [Unreleased]

## [0.10.8] - 2026-06-20

### Added
- Groundwork for **group chats / channels**: the launcher can now understand
  multi-party rooms over the social gateway — being added to a room, members
  joining or leaving, renames, and a room being deleted — and keeps its room list
  in sync (if you're removed, the room disappears for you). No visible UI yet; the
  room list and group composer land next.

## [0.10.7] - 2026-06-20

### Fixed
- **The updater no longer reinstalls the launcher on every start.** It was
  comparing the available release against its own internal version instead of the
  installed app's version, so it treated every launch as out of date and silently
  re-ran the installer each time. It now checks the version you actually have and
  only updates when there's genuinely a newer release.

## [0.10.6] - 2026-06-20

### Added
- Groundwork for **save version history**: the launcher can now keep a series of
  restorable snapshots of a game's save folder and automatically prune to the
  newest N, so last-write-wins can no longer quietly destroy an old save. A
  restore is itself undoable — the current save is snapshotted before it's
  replaced. No visible UI yet; the restore picker and automatic snapshot on
  game exit land next.
- Groundwork for **game invites**: the client can now understand a friend's
  "join my game" invite (and its cancellation) over the social gateway and track
  the pending invites you've received, expiring stale ones automatically. No
  visible UI yet — the invite toast and one-click **Join** land next.

### Fixed
- **Only one launcher window opens per computer now.** Launching ArcadeLauncher
  again while it's already running (including from the tray or a second shortcut)
  brings the existing window to the front instead of starting a duplicate copy.
  This also covers the updater: re-running ArcadeLauncher while it's already open
  now just surfaces the running window instead of trying to reinstall on top of
  it.

## [0.10.5] - 2026-06-19

### Added
- **Remote game streaming (Sunshine/Moonlight)** is now usable end to end. A new
  **Settings → Streaming** section lets you pair with a Sunshine host PC by its
  4-digit PIN, see your paired hosts (and forget them), tell at a glance whether
  Moonlight is installed, and set your stream-quality defaults — resolution,
  frame rate, bitrate, window mode, and HDR. Once a host is paired, a **▶ Stream
  from host** button appears on a game's detail panel to launch it over Moonlight
  at those settings. The host's certificate is pinned on first pairing, so the
  connection is refused if it ever changes; your Sunshine username/password are
  used only to pair and are never saved.
- Groundwork for **remote game streaming** (Sunshine/Moonlight): the launcher
  can now model a streaming host, read a Sunshine host's app list, and tell
  whether a given game is streamable from it. No visible UI yet — this is the
  foundation for the upcoming "Stream from host" feature.
- More streaming groundwork: the client can now construct the requests needed to
  pair with a Sunshine host (PIN), add a game to it, and pin the host's
  certificate so the connection stays secure. Still no visible UI — wiring
  continues.
- The client can now actually talk to a Sunshine streaming host: pair with a PIN,
  list the games it offers, and add a game to it — over a secure connection that
  pins the host's certificate on first pairing and refuses to connect if it ever
  changes. Your Sunshine username/password are used only for the request and are
  never saved to disk. The "Stream from host" UI that drives this is next.
- Streaming can now launch the **Moonlight** client: the launcher detects whether
  Moonlight is installed and can start a stream of a chosen game from a paired
  host at your configured resolution / frame rate / bitrate / HDR. Still wired up
  behind the scenes — the "Stream from host" button arrives next.

## [0.10.4] - 2026-06-19

### Added
- In-client Game Requests board (pure core): browse/upvote/request games, a
  client-side platform filter, platform-scoped search, and community 1–5 star
  game ratings (averaged). UI to follow.
- Game Requests board transport: the launcher now talks to the Requests service
  using your existing sign-in (bearer token) — no separate board login — to list
  the board, search, request, upvote, rate, and (for admins) triage statuses.
- **Requests tab**: browse and vote on game requests without leaving the
  launcher. Search for a game and request it (dupes fold into an upvote), rate
  games 1–5 stars, filter by status or platform, and — if you're an admin — set
  each request's status inline.

### Changed
- The bootstrap updater (`updater.exe`) now ships with the launcher's icon
  instead of the generic executable icon.
- CI and release builds now run on the self-hosted Proxmox runners
  (`prox-win` / `prox-pve`) for identical build environments.

### Fixed
- Release workflow no longer leaves an orphan draft release: a single draft is
  created up front, both OS legs upload to it, and it's published only once both
  succeed.

## [0.10.3] - 2026-06-19

### Fixed
- Corrected the self-hosted runner topology so the desktop PC can no longer grab
  release jobs; Windows (NSIS + MSI + updater) and Linux (.deb/.rpm/AppImage)
  artifacts build on their dedicated Proxmox runners, signed, with `latest.json`.
