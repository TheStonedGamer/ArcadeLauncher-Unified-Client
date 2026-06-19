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

### Added
- In-client Game Requests board (pure core): browse/upvote/request games, a
  client-side platform filter, platform-scoped search, and community 1–5 star
  game ratings (averaged). Transport + UI to follow.

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
