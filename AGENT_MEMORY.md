# Agent Memory

> Shared, durable memory for AI agents working on this repository. Read this
> before starting work; record non-obvious, lasting facts here as you learn them.
> **Do not edit entries by hand** — use the tool so the Index stays in sync:
> `node scripts/memory.mjs set --id <slug> --title "..." --type project --desc "..." --body "..."`
> (`npm run memory -- ...`). See `node scripts/memory.mjs --help`.

## Index

- [Admin triage & account mgmt are server-side](#admin-pages-server-side) — _project_ — Game-request triage and account management live in the server admin UI, not the client.
- [Controller remap editor](#controller-config) — _project_ — Per-emulator host-button to SDL-token rebinding, saved+applied to native configs.
- [BIOS/firmware auto-deploy](#firmware-deploy) — _project_ — On-launch self-heal of server-staged BIOS/firmware into installed emulators; read-only deployment status in Settings.
- [Release process](#release-process) — _reference_ — Releases are tag-triggered; normal pushes only run CI.

---

<!-- am:start id=admin-pages-server-side type=project -->
### Admin triage & account mgmt are server-side
_Updated 2026-06-21_
> Game-request triage and account management live in the server admin UI, not the client.

Game-request triage (status) and full account management live in the SERVER admin UI: /admin/requests and /admin/accounts (server >=0.10.9, code in admin_extra.rs; pages share admin_post via a return_to form field). The client Requests board shows a read-only status badge only — the admin status dropdown was removed in v0.10.15. Pending self-service signups are approved/denied at /admin/accounts.
<!-- am:end -->

<!-- am:start id=controller-config type=project -->
### Controller remap editor
_Updated 2026-06-19_
> Per-emulator host-button to SDL-token rebinding, saved+applied to native configs.

Rust: src-tauri/src/controller/{model,commands,serializers,ini,bios}.rs. Host buttons map to SDL tokens (device prefix SDL-0/, SDL3 Face* tokens for face buttons, +LeftTrigger/+RightTrigger). Profiles persist to <app_config>/controller_profiles.json (atomic temp+rename). Commands: controller_host_buttons/sdl_tokens/targets/load_profiles/save_profile/apply, registered in lib.rs. Apply resolves the emulator exe under <app_data>/emulators/_runtimes, enables portable mode, backs up config to .ini.bak, writes atomically, and best-effort places BIOS. Targets: pcsx2 (PS2), duckstation (PS1). Frontend: src/features/controller/ (api.ts, profile.ts, EmulatorControllerEditor.tsx) rendered in SettingsView.
<!-- am:end -->

<!-- am:start id=firmware-deploy type=project -->
### BIOS/firmware auto-deploy
_Updated 2026-06-19_
> On-launch self-heal of server-staged BIOS/firmware into installed emulators; read-only deployment status in Settings.

src-tauri/src/emulators/firmware.rs, ensure_all() spawned on a background thread in lib.rs setup(). Mirrors the C++ AssetEnsure worker. Deploys: scph1001.bin (PS1 BIOS) -> DuckStation bios/ + settings.ini [BIOS]; ps2-bios.bin -> PCSX2 bios/ + PCSX2.ini [Folders]Bios/[Filenames]BIOS (deploy_pcsx2_bios); xemu-firmware/ (bios.bin/mcpx.bin/hdd.qcow2) -> xemu.toml [sys.files] in place; PS3UPDAT.PUP -> rpcs3 --installfw headless (guarded by dev_flash marker). Firmware staged loose at <app_data>/emulators/ (app id com.thestonedgamer.arcadelauncher). status_all() is a read-only sibling (firmware_status command) that reports per-console installed/staged/deployed without writing; surfaced as the "Firmware deployment" panel in SettingsView (FirmwareStatusGroup, useEmulators.firmware). PS2 BIOS is now HOSTED ON PROD: ps2-bios.bin (NTSC-U scph39001, sha256 f4c948e6...910c9d) lives at root@10.0.0.210:/srv/arcade-library/emulators/ and is auto-listed by /api/emulators as firmware "PlayStation 2 BIOS (PCSX2)" (server emulator_meta in manifest.rs). Clients stage it via /emulators/ps2-bios.bin then deploy into PCSX2 automatically. Still: provide only legally self-dumped Sony firmware; swap the dump (same filename) to change region — clients re-verify by size and re-pull.
<!-- am:end -->

<!-- am:start id=release-process type=reference -->
### Release process
_Updated 2026-06-19_
> Releases are tag-triggered; normal pushes only run CI.

release.yml runs only on push of v* tags (or manual workflow_dispatch). Pushes to main run ci.yml only. Self-hosted runners: Windows VM 131 (arcade-win) builds first, Linux CT 130 (arcade-pve) needs Windows. Requires secrets TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Version lives in package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml (+ Cargo.lock). To cut a release: bump all three, commit, push main, then push tag vX.Y.Z.
<!-- am:end -->
