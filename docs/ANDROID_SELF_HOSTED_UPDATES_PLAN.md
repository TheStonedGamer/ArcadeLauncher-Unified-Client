# Self-hosted Android updates

Status: in progress (2026-07-26)

Goal: let the ArcadeLauncher Companion discover updates from
`arcade.orlandoaio.net`, download the matching signed APK in the background,
verify it, and launch Android's system installer for the final user approval.
Regular Android devices cannot silently install a sideloaded app; that is
reserved for device-owner/profile-owner deployments.

## 1. Release feed

- [x] Decide on the self-hosted APK flow and preserve the existing Android
  signing key/package identity.
- [x] Stage both architecture APKs on the download server with every tagged
  release.
- [x] Publish `downloads/android-latest.json` containing version, versionCode,
  SHA-256, byte size, and self-hosted URL for each architecture.
- [x] Keep the GitHub APK assets as release/archive fallbacks.

Checkpoint: fetch the public manifest and range-read both APK URLs.

## 2. Android client

- [ ] Add the native Android install-request permission and an Expo-compatible
  intent bridge.
- [ ] Check the self-hosted feed on launch, app resume, and a bounded periodic
  background schedule.
- [ ] Compare both semantic version and Android versionCode; select the device
  architecture.
- [ ] Download the APK into app cache, verify SHA-256 and signer continuity,
  then expose an update-ready notification/UI action.
- [ ] Open the system package installer via a content URI. If unknown-source
  installation is disabled, direct the user to that Android setting.

Checkpoint: a debug build consumes a fixture manifest, rejects a bad hash, and
opens Android's installer only for a verified newer APK.

## 3. Release and live verification

- [ ] Run mobile type-check/tests and a signed Android release build.
- [ ] Tag a release, confirm the stage job copies APKs and writes the manifest.
- [ ] Verify public manifest data, APK range delivery, and on-device update
  prompt/install handoff.

## Notes

- Android APK deltas are deliberately out of scope for the first release. The
  platform installer needs a complete APK; download-and-reconstruct can be
  evaluated later only if it saves meaningful bandwidth.
- The companion must retain its package id and signing certificate or Android
  will reject the update.
