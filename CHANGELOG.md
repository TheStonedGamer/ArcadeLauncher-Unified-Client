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

## [0.11.0] - 2026-06-22

### Added
- **A "My PCs" tab.** Your other PCs that you've paired for streaming now live in
  one place — each one expands to the games it has, with a Play button that streams
  it to this machine. Your personal remote-play list, Steam-style.
- **Host this PC for streaming.** A new **Settings → Stream from this PC** section
  lets this machine be streamed to your other devices and publish your installed
  library as playable games — powered by a streaming engine bundled right in the
  installer, so there's no separate Sunshine setup. (Hosting support rolls out as
  the engine's host mode lands; the section tells you when it's ready on your PC.)

### Changed
- **Pairing a streaming host is simpler and safer.** Pair with just the host's
  4-digit PIN — no Sunshine username or password needed anymore. Pairing now runs
  through the bundled streaming engine (the real GameStream handshake), and the
  host's certificate is still pinned on first pair so the connection stays secure.

## [0.10.22] - 2026-06-21

### Added
- **A Chats tab in Social.** It's the first tab and opens by default, listing your
  active conversations newest-first with the latest message and unread counts — so
  you land on who's been talking to you instead of scrolling the friends roster.
- **Sort your friends list.** A new control lets you order friends by Status, Name,
  or Recent activity. Favorites stay pinned to the top whichever mode you pick.

## [0.10.21] - 2026-06-21

### Fixed
- **The Activity feed no longer flickers.** It was refetching in a tight loop on
  every render, making the list and its spinner flash constantly. It now loads
  once per sign-in (and on manual refresh) and sits still.

## [0.10.20] - 2026-06-21

### Fixed
- **The updater now updates itself.** Because the Steam-style bootstrapper is what
  your shortcut launches, it was running from `updater.exe` while it installed an
  update — and Windows won't let an installer overwrite a running program, so the
  app updated but the updater never did. It now hands the install off to a short-
  lived copy of itself so the real `updater.exe` gets replaced like everything else.
- **Friends roster tabs scroll** instead of clipping. Adding the Rooms tab could
  push the Activity tab off the edge of the row; the tab strip now scrolls
  sideways so every tab stays reachable.
- **The Activity feed fails gracefully.** A failed activity load now shows a short
  message with a one-click **Retry** (full detail on hover) instead of dumping a
  raw network error.

## [0.10.19] - 2026-06-21

### Added
- **Group rooms / channels.** A new **Rooms** tab in Friends lets you create a
  named room, invite friends into it, and chat with everyone at once. Owners can
  rename a room, add members, and anyone can leave.
- **Group voice calls.** Start a voice call from inside a room and everyone joins
  a single call — see who's connected, mute yourself, and leave from the in-call
  bar.
- **Save version history.** Each game's cloud-saves panel can now show a list of
  restorable save snapshots (with timestamp and size), take a snapshot on demand,
  and restore an older one — your current save is snapshotted first, so a restore
  is itself undoable.

## [0.10.18] - 2026-06-21

### Added
- **Cloud-save auto-sync.** Saves now sync automatically around play: the latest
  cloud save is pulled before a game launches and your save is snapshotted (a
  restorable version) and pushed back up when it exits. Toggle each direction and
  set how many versions to keep under **Settings → Cloud saves**. Applies to
  server-backed games while signed in.

### Changed
- **The welcome tour now shows once per account, not once per device.** Whether
  you've completed onboarding is remembered on your account (server-side), so it
  no longer reappears after reinstalling or signing in on another PC.

## [0.10.17] - 2026-06-21

### Changed
- **Docs:** refreshed the platform architecture reference (`ARCHITECTURE.md` and
  `docs/architecture.html`) to reflect the Game Requests service being folded into
  the server — it now runs in-process under `/requests` on the main server instead
  of as a separate companion service. No app behaviour changes.

## [0.10.16] - 2026-06-21

### Added
- **Friends activity feed.** The social panel now has an **Activity** tab showing
  what your friends have been up to — recent sessions and game activity — so you
  can see what everyone's playing at a glance.

## [0.10.15] - 2026-06-21

### Changed
- **Game request status is now managed by admins on the server.** The Requests
  board no longer shows an inline status dropdown for administrators — request
  triage (approve / fulfil / decline) moved to the server's admin panel. The
  status badge on each request still shows where it stands.

## [0.10.14] - 2026-06-21

### Added
- **Forgot your password?** The sign-in screen now has a **Forgot password?**
  link. Enter your username or email and we'll email you a single-use link
  (valid for 1 hour) to choose a new password — no admin needed. For your
  security, the response is always the same whether or not the account exists.

## [0.10.13] - 2026-06-21

### Added
- **Create an account from the launcher.** The sign-in screen now has a
  **Create one** link to request a new account (username, email, password). New
  accounts require a quick administrator approval before you can sign in.

## [0.10.12] - 2026-06-20

### Added
- The Windows **`.msi` installer** is published again, alongside the `.exe` (NSIS)
  installer and portable build, for anyone who prefers MSI deployment. The in-app
  updater still uses the `.exe`, so auto-updates are unchanged either way.

### Changed
- The first-run **welcome tour** now appears on your **first sign-in** instead of
  the first time the app opens, and is tracked **per account** — so you see it
  once when you log in, and a second person signing in on the same machine gets
  their own walkthrough. (If you've already seen it, it stays dismissed.)
- Internal build infrastructure only: Windows releases are now produced on a
  native Windows build machine. No user-facing change beyond the `.msi` returning.

## [0.10.11] - 2026-06-20

### Added
- **Game invites, everywhere** (T12d follow-up): invite toasts now appear on any
  tab — not just Friends — because the social connection is held once at the app
  root. Clicking **Join** now also launches the game: it accepts the invite and
  starts the matching title from your library automatically.

### Changed
- The launcher keeps a single live social connection for the whole app, so
  presence, chat, and invites stay current no matter which screen you're on.

## [0.10.10] - 2026-06-20

### Added
- **Game invites** (T12d): when a friend invites you to join the game they're
  playing, a toast now pops up on the Friends screen with **Join** and **Dismiss**.
  Invites refresh rather than stack if re-sent, clear when the friend is removed,
  and expire automatically after 5 minutes. (Auto-launching the game on Join and
  showing the toast from any tab land in a follow-up.)

## [0.10.9] - 2026-06-20

### Added
- Groundwork for **group voice calls (3+ people)**: the launcher can now model a
  voice "mesh" where each participant connects directly to every other, tracking
  who's in the call and each connection's state. Includes the coordination-free
  rule that decides which side places the call for every pair, so a group call
  sets itself up without duplicate connections. (Pure, fully unit-tested core; the
  in-call UI and live audio wiring land in a follow-up.)

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
