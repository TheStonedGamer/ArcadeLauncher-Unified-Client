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

## [0.14.2] - 2026-07-23

### Fixed
- **The phone now shows who's signed in.** The companion's DMs tab was coming up
  empty even when friends were online, because it never loaded your friend list —
  it only noticed people whose status *changed* after the app opened. It now
  loads the list on sign-in, so your friends and their online status appear right
  away.

### Changed
- **The phone's "Friends" tab is now "DMs"** — same friends and chat, clearer name.

## [0.14.1] - 2026-07-23

### Fixed
- **Phone app sign-in.** The Android companion now signs in the same secure way
  the desktop launcher does — your password is proven to the server without ever
  leaving your phone — instead of failing at the login screen.
- **The library and request board now load on the phone.** The companion was
  asking the server for these at the wrong address and getting nothing back;
  it now reaches the right place, so your games and the request board appear.

## [0.14.0] - 2026-07-23

### Added
- **The phone app grew up.** The ArcadeLauncher companion for Android now does
  everything the launcher does socially: **friends and presence**, **chat with
  photo attachments**, and **voice and video calls** with your friends on their
  PCs. Calls ring on whatever screen you're on.
- **Install to your PC from your phone.** Open a game on the phone, pick which
  of your signed-in PCs should get it, and the download starts there. The PC
  reports back — started, already installed, already downloading — so you know
  it landed without walking over to look.
- **Sign-in approval, Steam Guard style.** When something signs into your
  account, your phone asks you to approve or deny it and shows the device name
  and the IP it came from. If your phone is offline, the app also shows a
  rolling six-digit code you can type instead.

### Changed
- Your PC now tells the server its name when it connects, so the phone's
  install picker can list your machines by name instead of by number.
- **The phone app is now downloadable straight from the release page.** Every
  release from this one on carries a signed `ArcadeLauncher-Companion-vX.Y.Z.apk`
  alongside the Windows and Linux installers — no more digging through build
  logs. Install it once and future versions update in place.

## [0.13.24] - 2026-07-22

### Added
- **Video calls and screen sharing.** While you're in a voice call with a friend,
  the call bar now has **📷 Camera** and **🖥 Share screen** buttons. Whatever's
  being shared appears in a floating window above the bar, with your own picture
  tucked into the corner. Switch straight from camera to screen (or back) without
  dropping the call, and stopping a share from your browser/OS bar is picked up
  automatically. Group calls stay voice-only for now.
- **Your week — a weekly recap of what you played.** The launcher now remembers
  each play session, not just a running total, and a new **Your week** panel above
  your library shows total time, how many sessions, your busiest day, your longest
  sitting, a bar per day, your top games of the week, whether you played more or
  less than last week, and anything you picked up for the first time. It starts
  filling in from your next game — earlier playtime totals are untouched.
- **Mobile companion app.** A phone app (React Native / Expo, source under
  `mobile/`) for browsing the library and the request board when you're away from
  the PC: sign in with your usual account, search and filter the catalogue, open a
  game for its cover, summary and size, and upvote on the request board. Installing
  and launching still happen on the desktop launcher.

## [0.13.23] - 2026-07-22

### Fixed
- **Downloads now show game names instead of internal IDs.** The queue could fall
  back to showing raw ids like `pc-fdc100f88077` — most often on a fresh install,
  where it would keep doing so until you restarted the launcher. It now picks up
  the proper titles as soon as your library syncs.

### Removed
- The last leftovers of built-in game streaming are gone from both the launcher
  and the server, finishing the removal that started in 0.13.22. Nothing changes
  in day-to-day use — Settings → Remote Play still points you at **Moonlight**
  and **Sunshine**. Voice chat is unaffected.

## [0.13.22] - 2026-06-29

### Removed
- **Built-in game streaming has been removed.** The bundled stream engine, the
  "My PCs" tab, host mode ("let this PC be streamed"), play-from-anywhere, and the
  Streaming settings are gone, along with the extra sidecar that shipped with them
  — so the installer is smaller and updates are quicker. If you want to stream your
  games, Settings → Remote Play now links you to **Moonlight** (the client) and
  **Sunshine** (the host), which are free, open-source, and work with any game.

### Changed
- Settings: the **Streaming** tab is replaced by a **Remote Play** tab with links
  to Moonlight and Sunshine.

## [0.13.21] - 2026-06-29

### Changed
- **Settings is now organized into tabs.** Instead of one long scroll, settings
  are grouped into General, Appearance, Library, Cloud Saves, Controller,
  Streaming, and Integrations tabs, with the section you were last on remembered
  between launches. Spacing was tightened up for a cleaner, more consistent
  layout, and the Save button now sits in a pinned bar at the bottom so it's
  always within reach.

## [0.13.20] - 2026-06-29

### Added
- **Multiple library folders, Steam-style.** Settings → Storage lets you add an
  install folder on any drive, see each one's free/used space and how many games
  ArcadeLauncher keeps there, and pick which folder new installs go to by
  default. When you have more than one library, installing a game now asks which
  drive to put it on.
- **Move installed games between drives.** Right-click a game → "Move install
  folder…", choose a target library, and watch a live progress bar as the files
  are relocated. The move is safe across drives (copy-then-verify with rollback
  if anything goes wrong) and the game launches from its new home with no further
  setup.

## [0.13.15] - 2026-06-24

### Fixed
- **Streaming to a PC on another network now actually completes the one-time
  setup.** The previous release's auto-join could leave the background mesh
  service installed but not running, so the host still never got a reachable
  address and off-network play kept failing with "serverinfo over HTTPS failed /
  host unreachable". The service is now explicitly started right after it's
  installed, and the join no longer passes an option this Tailscale build
  rejects — so turning on "Let this PC be streamed" brings the host onto the
  mesh on the first try. Local-network streaming is unaffected.

## [0.13.14] - 2026-06-24

### Fixed
- **Streaming to a PC on another network now works without any manual setup.**
  When you turn on "Let this PC be streamed", it automatically joins your private
  play-from-anywhere mesh and publishes a reachable address, so devices on a
  different network can connect instead of failing with "serverinfo over HTTPS
  failed / host unreachable". Previously a host never joined the mesh on its own,
  so off-network play could not find it.

### Changed
- **Mesh networking sets itself up once and stays on.** The first time a PC needs
  it, the bundled Tailscale is installed as a background Windows service with a
  single approval prompt; after that it starts automatically every time with no
  further prompts (and survives reboots). Local-network streaming is unaffected.

## [0.13.12] - 2026-06-23

### Added
- **Host engine controls in Settings → Stream from this PC.** A new "Host engine"
  section shows whether the streaming host components are installed and which
  version, with buttons to **Download**, **Reinstall / repair** (re-pull a stale
  or partial copy), and **Refresh status**. The components still download
  automatically the first time you enable hosting — this is the manual fix-it
  surface when a host won't come up.

### Changed
- **Streaming always runs through the built-in stream engine.** The old external
  Moonlight fallback path was removed; every stream (from the library, from a
  host, or from "My PCs") now plays in-app with live status and an in-app Stop.
- Bundles stream engine **v0.3.9**.

### Fixed
- **Hosting no longer silently uses a leftover Sunshine.** The host now always
  runs its own bundled Sunshine instead of adopting an unrelated Sunshine service
  already running on the PC — which previously left "Stream from this PC" unable
  to pair (`not_paired`) because the wrong certificate was published.

## [0.13.10] - 2026-06-23

### Changed
- **Streaming host setup is now bundled with updates instead of downloaded on
  first use.** The host streaming component is fetched and kept in lockstep by the
  updater when the app starts, so "Stream from this PC" works reliably the first
  time — no separate download that could lag behind or fail when you enable it.

## [0.13.9] - 2026-06-23

### Fixed
- **Zero-PIN streaming now works after a PC restarts.** A PC that came back online
  with hosting already on wasn't publishing the info other devices need to pair
  without a PIN, so you'd get asked for a PIN even for an already-known PC. Hosting
  PCs now re-establish PIN-free pairing automatically once signed in.

## [0.13.8] - 2026-06-23

### Fixed
- **ArcadeLauncher now reopens itself after a Windows update.** A self-update
  finished installing but left the app closed; you had to start it manually.
  It now relaunches automatically once the update is applied.

## [0.13.7] - 2026-06-23

### Added
- **Stream a "My PCs" game with no PIN.** PCs signed into the same account now
  pair automatically the first time you hit Play — no more typing a PIN into
  Sunshine on the other machine. (If a host hasn't been set up for auto-pair
  yet, the one-time PIN prompt below still appears as a fallback.)

### Changed
- When a remote PC needs pairing, Play now shows an inline **PIN prompt** and
  retries automatically once you enter it — instead of a window that flashed
  open and closed with a misleading "Streaming ✓" message.
- Bundles stream engine **v0.3.7** (cert pre-authorization for zero-PIN pairing).

### Fixed
- **The Pause and Cancel buttons on downloads work again.**
- Remote-play host (Sunshine) and client (Moonlight) now write **log files**,
  making streaming problems diagnosable.
- The streaming engine no longer **flashes a console window** into the
  foreground when you start or host a stream.

## [0.13.6] - 2026-06-23

### Fixed
- **The "Let this PC be streamed" switch now stays on after you restart
  ArcadeLauncher.** If you turn hosting on, this PC starts hosting again
  automatically the next time the app launches — so it's ready to stream to
  without re-flipping the switch every session.

## [0.13.5] - 2026-06-23

### Fixed
- **A PC you stream to no longer shows "offline" while it's sitting ready.**
  Your PCs now stay shown as online to your other devices the whole time
  ArcadeLauncher is running — not only while that PC has the *My PCs* tab open —
  so the machine you want to play from is reachable when you go to start a stream.

### Added
- The Settings page now shows the Unified Client version at the bottom.

## [0.13.4] - 2026-06-23

### Added
- **Play your PCs from anywhere.** When a PC in *My PCs* has no address on your
  local network, ArcadeLauncher now reaches it over the internet through a private
  encrypted mesh — no port forwarding, no VPN to install, nothing to type. The
  needed networking ships inside the installer, and each play session joins the
  mesh on its own and leaves when you're done. PCs on your LAN keep streaming
  directly as before.

## [0.13.3] - 2026-06-23

### Added
- **Stream your Steam and Epic games from this PC.** Auto-detected Steam and Epic
  titles now publish alongside your ArcadeLauncher library when you use
  **Settings → Stream from this PC → Publish my library**, so you can launch and
  play them from your other devices.

### Changed
- **Hosting uses the Sunshine you already have.** When you turn on "Let this PC be
  streamed", the launcher now uses a Sunshine that's already installed — or already
  running — instead of downloading its own copy. If you started Sunshine yourself,
  the launcher leaves it running when you turn hosting off or quit; it only stops a
  Sunshine it started.

## [0.13.2] - 2026-06-23

### Fixed
- **"Let this PC be streamed" now stays on.** The toggle in Settings used to flip
  straight back off — turning it on never actually kept this PC hosting. It now
  latches on and keeps hosting until you turn it off, and stops cleanly when you
  quit the launcher.

## [0.13.0] - 2026-06-22

### Added
- **Your PCs now find each other automatically.** Every PC signed into your
  ArcadeLauncher account shows up under **My PCs** on your other devices — no IP
  address or PIN to type. Sign in on another machine and it just appears.
- **Browse a PC's games even when it's asleep.** Each PC publishes the games
  installed on it, so an offline PC stays listed (greyed out) with its last-known
  library still browsable. Online PCs show a live status dot and a **Play** button
  per game.
- Turning on **Settings → Stream from this PC** now publishes that machine's
  library to your account, so its games appear under My PCs everywhere you're
  signed in.

## [0.12.1] - 2026-06-22

### Fixed
- **Streaming now actually starts.** The bundled streaming engine was missing the
  video/audio runtime libraries (SDL2, FFmpeg, Opus), so pressing Play connected and
  then failed instantly. All of the engine's runtime libraries now ship with the app,
  so in-engine streaming works end to end.

## [0.12.0] - 2026-06-22

### Added
- **Stream your PCs without a separate Moonlight install.** "Stream from host" now
  plays straight through the streaming engine bundled in the app — you get a live
  status as it connects and a **Stop** button right in the panel. If the engine
  isn't on your PC (or you prefer it), it still falls back to an external Moonlight
  client automatically.

### Changed
- **The bundled streaming engine now actually streams.** Updated to its first
  streaming-capable build — previously it only handled host pairing.

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
