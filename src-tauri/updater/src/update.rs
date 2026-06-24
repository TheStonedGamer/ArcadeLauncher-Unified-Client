//! The update flow, decoupled from the UI. `run` drives the whole sequence —
//! check → download → verify → install → launch — pushing human-readable status
//! into the shared `Status` as it goes. Every failure mode is non-fatal: on any
//! error we log it into the status and fall straight through to launching the
//! installed app, because an updater must never block startup.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;

use crate::Status;

/// What a check resolved to. Distinguishes "installed inline, go launch the app"
/// from "handed off to a staged copy" — in the staged case the original updater
/// must NOT launch the app or do anything else; it must exit promptly so its own
/// `$INSTDIR\updater.exe` file unlocks and the staged copy can overwrite it.
enum Outcome {
    UpToDate,
    Installed,
    // Only the Windows path stages a self-update; on Linux this variant is read in
    // `run`'s match but never constructed, so silence dead-code there.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Staged,
}

/// A request, parsed from CLI args, for the second (staged) phase of a Windows
/// self-update: run the already-downloaded+verified installer, then launch.
struct StagedJob {
    setup: PathBuf,
    /// PID of the original in-`$INSTDIR` updater to wait for before running the
    /// installer, so `updater.exe` is unlocked when NSIS tries to overwrite it.
    wait_pid: Option<u32>,
    /// The install directory (`$INSTDIR`) of the original updater. The staged copy
    /// runs from a temp dir, so its own `exe_dir()` is NOT the install dir — it must
    /// be told where the app lives to relaunch it after installing.
    install_dir: Option<PathBuf>,
}

/// The release manifest the app's bundler publishes (Tauri `latest.json`).
const ENDPOINT: &str =
    "https://github.com/TheStonedGamer/ArcadeLauncher-Unified-Client/releases/latest/download/latest.json";

/// The same minisign public key baked into `tauri.conf.json` (base64 of the
/// minisign `.pub` file). The signed update artifact is verified against it.
const PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IERDQ0IyRDc1MkEzRUI2QkYKUldTL3RqNHFkUzNMM09jS24za1h1YTlxYklTblVjQ1hYdUR0ZnZ1b2x5dWREbzBydGpVYnNEQzkK";

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    platforms: std::collections::HashMap<String, PlatformEntry>,
}

#[derive(Deserialize)]
struct PlatformEntry {
    signature: String,
    url: String,
}

/// The Tauri platform keys for the host we're running on, in preference order.
/// Windows: the NSIS `setup.exe` (`-nsis`) is the per-user, admin-free installer
/// we drive. The release ships an MSI too, so the bare `windows-x86_64` key
/// resolves to the `.msi` — which we do NOT want to drive (it's admin-oriented).
/// So we try the explicit `-nsis` key FIRST and only fall back to the bare key.
/// Linux: the AppImage variant is what we replace in place.
fn platform_keys() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &["windows-x86_64-nsis", "windows-x86_64"]
    } else {
        &["linux-x86_64-appimage", "linux-x86_64"]
    }
}

fn set(status: &Arc<Mutex<Status>>, msg: impl Into<String>) {
    status.lock().unwrap().message = msg.into();
}

/// Drive the whole update sequence. Always returns; the caller launches the app
/// and exits afterwards. Errors are surfaced into the status, never propagated.
pub fn run(status: &Arc<Mutex<Status>>) {
    // Staged second phase: a copy of us, running from a temp dir, was handed an
    // already-downloaded + verified installer. We wait for the original
    // in-`$INSTDIR` updater (which spawned us) to exit so `updater.exe` unlocks,
    // then run the installer — which can now replace the updater too — and launch.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(job) = parse_staged_args(&args) {
        if let Some(pid) = job.wait_pid {
            set(status, "Finishing update…");
            wait_for_exit(pid);
        }
        set(status, "Installing update…");
        match run_setup(&job.setup) {
            Ok(()) => set(status, "Update complete — starting ArcadeLauncher…"),
            Err(e) => set(status, format!("Skipping update ({e}) — starting…")),
        }
        // We're running from the temp staging dir, so launch the app from the
        // original install dir the parent handed us — not our own exe_dir().
        launch_app(job.install_dir.as_deref());
        return;
    }

    // If the launcher is already open, never reinstall over a running app — just
    // surface its window. Spawning the app triggers the launcher's
    // single-instance guard, which brings the existing window to the front; the
    // duplicate we spawned then exits on its own.
    if crate::instance::launcher_is_running() {
        set(status, "ArcadeLauncher is already running — bringing it to the front…");
        launch_app(None);
        return;
    }

    // Phase 1 — update the app itself. Shown to the user as
    // "Updating Arcade Launcher <version>…" (set inside check_and_apply, which
    // knows the target version).
    set(status, "Checking for updates…");
    match check_and_apply(status) {
        // A staged copy is now applying the update and will launch the app once
        // it finishes. We must NOT launch here — exiting promptly is what unlocks
        // `$INSTDIR\updater.exe` so the staged copy can overwrite it. The engine
        // phase is skipped on this run: the freshly installed app carries its own
        // runtime engine fetch as a fallback, and the next launch's (now updated)
        // bootstrapper ensures the new pinned engine eagerly. Leave the
        // "Updating Arcade Launcher <version>…" message in place as we exit.
        Ok(Outcome::Staged) => return,
        // Inline install already left the "Updating Arcade Launcher <version>…"
        // message; keep it through the engine phase below.
        Ok(Outcome::Installed) => {}
        Ok(Outcome::UpToDate) => {}
        Err(e) => set(status, format!("Skipping update ({e})…")),
    }

    // Phase 2 — update the host engine, shown separately as "Updating engine…".
    // The host engine (Sunshine sidecar) is delivered by the bootstrapper, not
    // lazily fetched when the user first enables hosting — that runtime fetch was
    // fragile (a separate network call that could lag or fail, leaving the engine
    // out of lockstep with the app). Ensure the pinned version is unpacked before
    // the app starts. Idempotent (skips when present) and best-effort.
    ensure_host_engine(status);

    // Inline install / up-to-date: we're still running from `$INSTDIR`, so the
    // default exe_dir() resolution is correct here.
    set(status, "Starting ArcadeLauncher…");
    launch_app(None);
}

/// Resolves to `Installed`/`Staged` when an update was applied, `UpToDate` when
/// already current, Err on any recoverable problem (offline, bad manifest, …).
fn check_and_apply(status: &Arc<Mutex<Status>>) -> Result<Outcome, String> {
    let manifest = fetch_manifest()?;
    // Compare against the installed *app* version (embedded by build.rs from
    // tauri.conf.json), not the updater's own CARGO_PKG_VERSION — the latter
    // tracks the bootstrapper separately and would make every launch reinstall.
    if !is_newer(&manifest.version, env!("APP_VERSION")) {
        return Ok(Outcome::UpToDate);
    }
    // Prefer the platform's explicit installer variant, falling back to the bare
    // key. On Windows that's the NSIS `setup.exe` (`windows-x86_64-nsis`) — the
    // per-user, admin-free installer we drive. The bare `windows-x86_64` key maps
    // to the `.msi`, so the explicit `-nsis` preference is load-bearing: it keeps
    // the updater on the exe even though an MSI is published alongside it.
    let entry = platform_keys()
        .iter()
        .find_map(|k| manifest.platforms.get(*k))
        .ok_or_else(|| format!("no artifact for {}", platform_keys()[0]))?;

    set(status, format!("Downloading update {}…", manifest.version));
    let bytes = download(&entry.url)?;

    set(status, "Verifying update…");
    verify(&bytes, &entry.signature)?;

    set(status, format!("Updating Arcade Launcher {}…", manifest.version));
    install(&bytes, &entry.url)
}

/// GitHub owner/repo that publishes the engine + the Sunshine host asset (same
/// as the app's `host_fetch.rs`).
const ENGINE_REPO: &str = "TheStonedGamer/ArcadeLauncher-StreamEngine";

/// The app's bundle identifier — the leaf of its data dir. Must match
/// `tauri.conf.json`'s `identifier`, since the host engine is unpacked under the
/// same `app_data_dir()` the app's `host_fetch` reads.
const APP_IDENTIFIER: &str = "com.thestonedgamer.arcadelauncher";

/// The app's data dir, matching Tauri's `app_data_dir()`: `%APPDATA%\<id>` on
/// Windows, `$XDG_DATA_HOME` (or `~/.local/share`) `/<id>` elsewhere. The host
/// engine lands in `host-engine/<ver>` here — exactly where `host_fetch` looks.
fn app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join(APP_IDENTIFIER))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|p| p.join(APP_IDENTIFIER))
    }
}

/// OS slug in the published Sunshine asset filename (mirrors `host_fetch.rs`).
fn host_engine_os_slug() -> &'static str {
    if cfg!(windows) {
        "win"
    } else {
        "linux"
    }
}

/// The Sunshine host binary's filename for this platform (mirrors `host_fetch.rs`).
fn sunshine_bin_name() -> &'static str {
    if cfg!(windows) {
        "sunshine.exe"
    } else {
        "sunshine"
    }
}

/// The engine release download URL for the Sunshine host asset (mirrors
/// `host_fetch::host_asset_url`).
fn host_asset_url(version: &str) -> String {
    format!(
        "https://github.com/{ENGINE_REPO}/releases/download/v{version}/ArcadeLauncher-Sunshine-{version}-{}-x64.zip",
        host_engine_os_slug()
    )
}

/// Ensure the host Sunshine sidecar for the pinned engine version is unpacked in
/// the app data dir, downloading it from the engine release if missing.
/// Idempotent — returns immediately when the binary is already present — and
/// best-effort: any failure is surfaced into the status and otherwise swallowed.
/// A missing host engine must never block app startup, and the app still carries
/// its own runtime fetch (`host_fetch_commands`) as a fallback.
fn ensure_host_engine(status: &Arc<Mutex<Status>>) {
    let version = env!("SUNSHINE_HOST_VERSION");
    let Some(data_dir) = app_data_dir() else {
        return;
    };
    let root = data_dir.join("host-engine");
    let install_dir = root.join(version);
    let bin = install_dir.join(sunshine_bin_name());
    if !bin.is_file() {
        set(status, format!("Updating engine {version}…"));
        if let Err(e) = fetch_host_engine(version, &install_dir, &bin) {
            // Leave a breadcrumb; the app's runtime fetch still covers hosting.
            set(status, format!("Engine update skipped ({e}) — continuing…"));
        }
    }
    // Reclaim disk from superseded engine versions left under `host-engine/`.
    // Guarded on the pinned binary actually being present, so a failed fetch can
    // never delete a working older engine — we only prune once we're certain the
    // version we keep is in place. Best-effort: a dir locked by a running engine
    // is simply retried on the next launch.
    if bin.is_file() {
        prune_old_host_engines(&root, version, status);
    }
}

/// Remove every `host-engine/<ver>` subdir except `keep`. Only the directories
/// this code creates live here (one per engine version), so any other version
/// dir is a stale prior install. Skips non-directory and non-version-looking
/// entries defensively, and tolerates per-dir removal failures (e.g. a file
/// still held by a live engine) by leaving them for a later run.
fn prune_old_host_engines(root: &Path, keep: &str, status: &Arc<Mutex<Status>>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return; // root absent or unreadable → nothing to prune
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue }; // not one of ours
        if name == keep || !looks_like_version(name) {
            continue;
        }
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            set(status, format!("Removed old engine {name}…"));
        }
    }
}

/// A conservative guard so prune only ever touches `host-engine/<semver>` dirs:
/// the name must start with a digit and contain only digits, dots, and the usual
/// pre-release/build punctuation. Keeps an unexpected sibling dir from being
/// deleted if the layout ever changes.
fn looks_like_version(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

/// Download + unpack the Sunshine host sidecar for `version` into `install_dir`,
/// verifying the expected binary materialized at `bin`.
fn fetch_host_engine(version: &str, install_dir: &Path, bin: &Path) -> Result<(), String> {
    std::fs::create_dir_all(install_dir).map_err(|e| format!("create host dir: {e}"))?;
    let bytes = download(&host_asset_url(version))?;
    extract_zip_into(&bytes, install_dir)?;
    if !bin.is_file() {
        return Err("archive missing sunshine binary".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(bin)
            .map_err(|e| format!("stat sunshine: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(bin, perms).map_err(|e| format!("chmod sunshine: {e}"))?;
    }
    Ok(())
}

/// Extract every entry of an in-memory zip under `dest`, rejecting zip-slip
/// (entries that would escape `dest` via `..`/absolute paths). Mirrors the
/// zip-slip-safe extractor the app uses for the same asset.
fn extract_zip_into(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("open host zip: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| format!("unsafe zip entry: {}", entry.name()))?;
        let out = dest.join(&rel);
        if !out.starts_with(dest) {
            return Err(format!("zip slip rejected: {}", entry.name()));
        }
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("mkdir {}: {e}", out.display()))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("read {}: {e}", entry.name()))?;
        std::fs::write(&out, &buf).map_err(|e| format!("write {}: {e}", out.display()))?;
    }
    Ok(())
}

fn fetch_manifest() -> Result<Manifest, String> {
    let body = ureq::get(ENDPOINT)
        .call()
        .map_err(|e| format!("manifest fetch failed: {e}"))?
        .into_string()
        .map_err(|e| format!("manifest read failed: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("bad manifest: {e}"))
}

fn download(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| format!("download read failed: {e}"))?;
    Ok(buf)
}

/// Verify `data` against the base64-encoded minisign signature using the baked
/// public key. Both the pubkey and signature fields are base64 of the full
/// minisign `.pub` / `.sig` file text (Tauri's encoding).
fn verify(data: &[u8], signature_b64: &str) -> Result<(), String> {
    let pub_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(PUBKEY_B64)
            .map_err(|e| format!("pubkey decode: {e}"))?,
    )
    .map_err(|e| format!("pubkey utf8: {e}"))?;
    // The .pub file is two lines: a comment then the key; take the key line.
    let key_line = pub_text
        .lines()
        .find(|l| !l.trim().is_empty() && !l.starts_with("untrusted comment"))
        .ok_or("pubkey missing key line")?;
    let pk = minisign_verify::PublicKey::from_base64(key_line.trim())
        .map_err(|e| format!("pubkey parse: {e}"))?;

    let sig_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(signature_b64)
            .map_err(|e| format!("signature decode: {e}"))?,
    )
    .map_err(|e| format!("signature utf8: {e}"))?;
    let sig = minisign_verify::Signature::decode(&sig_text)
        .map_err(|e| format!("signature parse: {e}"))?;

    pk.verify(data, &sig, false)
        .map_err(|e| format!("signature verification failed: {e}"))
}

/// Apply the verified payload. On Windows the artifact is the NSIS `setup.exe`
/// delivered directly (Tauri v2); we run it `/S` (silent, per-user, no admin —
/// the app isn't running so nothing is locked). A legacy zipped form
/// (`*.nsis.zip`) is still handled for safety. On Linux it's the AppImage (or a
/// `.tar.gz` of it): drop it in place of the running AppImage.
fn install(bytes: &[u8], url: &str) -> Result<Outcome, String> {
    if cfg!(target_os = "windows") {
        install_windows(bytes)
    } else {
        install_linux(bytes, url).map(|()| Outcome::Installed)
    }
}

#[cfg(not(target_os = "linux"))]
fn install_linux(_bytes: &[u8], _url: &str) -> Result<(), String> {
    Err("unsupported platform".into())
}

#[cfg(target_os = "linux")]
fn install_linux(bytes: &[u8], url: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    // Replace the AppImage we were launched from (APPIMAGE env when running as
    // one), else write next to the updater. The new image is run on launch.
    let target = std::env::var("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| exe_dir().join("ArcadeLauncher.AppImage"));
    let payload = if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
        extract_single_from_targz(bytes)?
    } else {
        bytes.to_vec()
    };
    std::fs::write(&target, &payload).map_err(|e| format!("write AppImage: {e}"))?;
    let mut perms = std::fs::metadata(&target)
        .map_err(|e| format!("stat AppImage: {e}"))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&target, perms).map_err(|e| format!("chmod AppImage: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn extract_single_from_targz(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    // The release publishes the raw AppImage for the updater path; .tar.gz isn't
    // expected here. Kept explicit so the failure is legible if that changes.
    Err("tar.gz AppImage payloads are not supported by the bootstrap updater".into())
}

#[cfg(not(target_os = "windows"))]
fn install_windows(_bytes: &[u8]) -> Result<Outcome, String> {
    Err("unsupported platform".into())
}

#[cfg(target_os = "windows")]
fn install_windows(bytes: &[u8]) -> Result<Outcome, String> {
    let tmp = std::env::temp_dir().join("arcadelauncher-update");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("temp dir: {e}"))?;

    // Tauri v2 delivers the NSIS installer directly (a raw `setup.exe`, PE magic
    // "MZ"). A legacy zip form ("PK") is still unwrapped for safety.
    let setup: PathBuf = if bytes.starts_with(b"PK") {
        let mut zip =
            zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("open zip: {e}"))?;
        let mut found: Option<PathBuf> = None;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
            let name = f.name().to_string();
            if !name.to_lowercase().ends_with(".exe") {
                continue;
            }
            let out = tmp.join(Path::new(&name).file_name().unwrap_or(name.as_ref()));
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| format!("zip read: {e}"))?;
            std::fs::write(&out, &buf).map_err(|e| format!("write setup: {e}"))?;
            found = Some(out);
            break;
        }
        found.ok_or("no setup .exe in update zip")?
    } else {
        let out = tmp.join("ArcadeLauncher-setup.exe");
        std::fs::write(&out, bytes).map_err(|e| format!("write setup: {e}"))?;
        out
    };

    // The updater is the entry point, so it is *running from* `$INSTDIR\updater.exe`
    // right now. If we ran the NSIS installer directly, Windows would let it
    // replace `ArcadeLauncher.exe` (not running) but NOT `updater.exe` (locked as
    // the running image) — so the bootstrapper would never update itself. Instead
    // copy ourselves out to the temp dir and re-exec that copy to do the install:
    // once this in-`$INSTDIR` process exits, the file unlocks and NSIS overwrites
    // it too. If staging can't be set up for any reason, fall back to an inline
    // install so at least the app still updates.
    match stage_and_handoff(&tmp, &setup) {
        Ok(()) => Ok(Outcome::Staged),
        Err(_) => {
            run_setup(&setup)?;
            Ok(Outcome::Installed)
        }
    }
}

/// Copy the running updater into `tmp` and spawn that copy to apply `setup` once
/// we (the original) exit. Returns as soon as the staged process is launched.
#[cfg(target_os = "windows")]
fn stage_and_handoff(tmp: &Path, setup: &Path) -> Result<(), String> {
    let me = std::env::current_exe().map_err(|e| format!("locate self: {e}"))?;
    let staged = tmp.join("updater-stage.exe");
    // A leftover stage exe from a prior run may linger; overwrite it. If it is
    // somehow still locked, this fails and we fall back to an inline install.
    std::fs::copy(&me, &staged).map_err(|e| format!("stage copy: {e}"))?;

    Command::new(&staged)
        .arg("--apply")
        .arg(setup)
        .arg("--wait-pid")
        .arg(std::process::id().to_string())
        // The staged copy runs from `tmp`, so it can't recover `$INSTDIR` from its
        // own path. Hand it our install dir so it can relaunch the app post-install.
        .arg("--install-dir")
        .arg(exe_dir())
        .spawn()
        .map_err(|e| format!("spawn staged updater: {e}"))?;
    Ok(())
}

/// Run the NSIS installer silently (per-user, no admin — nothing is locked once
/// the original updater has exited).
fn run_setup(setup: &Path) -> Result<(), String> {
    let status = Command::new(setup)
        .arg("/S") // NSIS silent install
        .status()
        .map_err(|e| format!("run setup: {e}"))?;
    if !status.success() {
        return Err(format!("setup exited with {status}"));
    }
    Ok(())
}

/// Parse the staged-apply CLI contract: `--apply <setup> [--wait-pid <pid>]`.
/// Pure so the handoff contract stays unit-tested; returns None for a normal
/// (non-staged) launch.
fn parse_staged_args(args: &[String]) -> Option<StagedJob> {
    let mut setup: Option<PathBuf> = None;
    let mut wait_pid: Option<u32> = None;
    let mut install_dir: Option<PathBuf> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--apply" => setup = it.next().map(PathBuf::from),
            "--wait-pid" => wait_pid = it.next().and_then(|s| s.parse::<u32>().ok()),
            "--install-dir" => install_dir = it.next().map(PathBuf::from),
            _ => {}
        }
    }
    setup.map(|setup| StagedJob {
        setup,
        wait_pid,
        install_dir,
    })
}

/// Block (bounded) until process `pid` is gone, so the installer can overwrite the
/// now-unlocked `updater.exe`. Best-effort: caps the wait so a stuck parent can
/// never hang the update — the installer's own retry/queue still applies.
fn wait_for_exit(pid: u32) {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let pid = Pid::from_u32(pid);
    let mut sys = System::new();
    // ~10s ceiling at 100ms granularity; the parent normally exits within a frame.
    for _ in 0..100 {
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        if sys.process(pid).is_none() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The directory the updater executable lives in (where the app is installed).
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Launch the installed main app, then return so the caller can exit. Looks in
/// `install_dir` when given (the staged self-update runs from a temp dir, so its
/// own `exe_dir()` is NOT where the app lives), otherwise beside the updater.
/// Best-effort: a missing launcher just leaves nothing running.
fn launch_app(install_dir: Option<&Path>) {
    let dir = install_dir.map(Path::to_path_buf).unwrap_or_else(exe_dir);
    let me = std::env::current_exe().ok();
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["ArcadeLauncher.exe", "arcade_launcher.exe"]
    } else {
        &["arcade-launcher", "arcade_launcher", "ArcadeLauncher"]
    };
    for name in candidates {
        let path = dir.join(name);
        if Some(&path) == me.as_ref() {
            continue; // never relaunch ourselves
        }
        if path.exists() {
            let _ = Command::new(&path).spawn();
            return;
        }
    }
    // Linux AppImage fallback: run the image we (maybe) just refreshed.
    #[cfg(target_os = "linux")]
    {
        if let Ok(appimage) = std::env::var("APPIMAGE") {
            let _ = Command::new(appimage).spawn();
        }
    }
}

/// Compare dotted numeric versions; true when `candidate` is strictly newer than
/// `current`. Non-numeric/short components are treated as 0.
fn is_newer(candidate: &str, current: &str) -> bool {
    parse(candidate) > parse(current)
}

fn parse(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(['.', '-', '+']);
    let n = |o: Option<&str>| o.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    (n(it.next()), n(it.next()), n(it.next()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_detection() {
        assert!(is_newer("0.9.4", "0.9.2"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.9.2", "0.9.2"));
        assert!(!is_newer("0.9.1", "0.9.2"));
        assert!(is_newer("v0.10.0", "0.9.9"));
    }

    #[test]
    fn app_version_is_embedded_and_sane() {
        // build.rs must embed a real dotted app version from tauri.conf.json; a
        // (0,0,0) parse means the embed broke and every release would be seen as
        // "newer", reinstalling on every launch.
        assert_ne!(parse(env!("APP_VERSION")), (0, 0, 0), "APP_VERSION not embedded");
    }

    #[test]
    fn parse_is_lenient() {
        assert_eq!(parse("0.9.4"), (0, 9, 4));
        assert_eq!(parse("1.2"), (1, 2, 0));
        assert_eq!(parse("garbage"), (0, 0, 0));
    }

    #[test]
    fn host_engine_version_embedded() {
        // build.rs must parse SUNSHINE_HOST_VERSION out of host_fetch.rs and embed
        // it; an empty or non-numeric value means the parse broke and the
        // bootstrapper would build a bogus asset URL.
        let v = env!("SUNSHINE_HOST_VERSION");
        assert!(!v.is_empty(), "SUNSHINE_HOST_VERSION not embedded");
        assert!(
            v.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())),
            "version not dotted-numeric: {v}"
        );
    }

    #[test]
    fn host_asset_url_targets_engine_release() {
        let url = host_asset_url("0.3.7");
        assert!(url.starts_with(
            "https://github.com/TheStonedGamer/ArcadeLauncher-StreamEngine/releases/download/v0.3.7/"
        ));
        assert!(url.ends_with("-x64.zip"));
        assert!(url.contains(if cfg!(windows) { "-win-" } else { "-linux-" }));
        assert!(url.contains("ArcadeLauncher-Sunshine-0.3.7-"));
    }

    #[test]
    fn extract_zip_into_writes_files_and_blocks_slip() {
        use std::io::Write;
        // Build a tiny in-memory zip with one nested file.
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            w.start_file("dir/hello.txt", opts).unwrap();
            w.write_all(b"hi").unwrap();
            w.finish().unwrap();
        }
        let dest = std::env::temp_dir().join(format!("ualc_extract_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        extract_zip_into(&buf, &dest).expect("extract ok");
        assert_eq!(
            std::fs::read_to_string(dest.join("dir/hello.txt")).unwrap(),
            "hi"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn looks_like_version_guards_prune_target() {
        // Real engine version dir names prune is allowed to touch.
        assert!(looks_like_version("0.3.5"));
        assert!(looks_like_version("0.3.7"));
        assert!(looks_like_version("1.2.3-rc.1"));
        assert!(looks_like_version("0.10.0+build7"));
        // Anything that isn't an obvious version dir is left alone.
        assert!(!looks_like_version("downloads"));
        assert!(!looks_like_version(".tmp"));
        assert!(!looks_like_version(""));
        assert!(!looks_like_version("v0.3.5")); // dirs are unprefixed; a 'v' name isn't ours
        assert!(!looks_like_version("0.3.5 copy")); // space → not a version
    }

    #[test]
    fn prune_keeps_pinned_and_removes_the_rest() {
        let root = std::env::temp_dir().join(format!("ualc_prune_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // Two stale engine versions, the pinned one, and an unrelated sibling dir.
        for v in ["0.3.5", "0.3.7", "0.3.4"] {
            std::fs::create_dir_all(root.join(v)).unwrap();
            std::fs::write(root.join(v).join("sunshine.exe"), b"x").unwrap();
        }
        std::fs::create_dir_all(root.join("downloads")).unwrap();

        let status = Arc::new(Mutex::new(Status {
            message: String::new(),
            done: false,
        }));
        prune_old_host_engines(&root, "0.3.7", &status);

        assert!(root.join("0.3.7").is_dir(), "pinned version must survive");
        assert!(!root.join("0.3.5").exists(), "stale 0.3.5 pruned");
        assert!(!root.join("0.3.4").exists(), "stale 0.3.4 pruned");
        assert!(
            root.join("downloads").is_dir(),
            "non-version sibling left untouched"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn staged_args_round_trip() {
        // A normal launch has no --apply marker → not a staged job.
        assert!(parse_staged_args(&[]).is_none());
        assert!(parse_staged_args(&["--wait-pid".into(), "42".into()]).is_none());

        // The handoff form the parent spawns: --apply <setup> --wait-pid <pid>
        // --install-dir <dir>.
        let job = parse_staged_args(&[
            "--apply".into(),
            r"C:\Temp\arcadelauncher-update\ArcadeLauncher-setup.exe".into(),
            "--wait-pid".into(),
            "1234".into(),
            "--install-dir".into(),
            r"C:\Program Files\ArcadeLauncher".into(),
        ])
        .expect("staged job parsed");
        assert_eq!(
            job.setup,
            PathBuf::from(r"C:\Temp\arcadelauncher-update\ArcadeLauncher-setup.exe")
        );
        assert_eq!(job.wait_pid, Some(1234));
        assert_eq!(
            job.install_dir,
            Some(PathBuf::from(r"C:\Program Files\ArcadeLauncher"))
        );

        // --apply with no pid still applies (pid is optional); bad pid is ignored.
        let job = parse_staged_args(&["--apply".into(), "setup.exe".into()]).unwrap();
        assert_eq!(job.wait_pid, None);
        assert_eq!(job.install_dir, None);
        let job =
            parse_staged_args(&["--apply".into(), "s.exe".into(), "--wait-pid".into(), "x".into()])
                .unwrap();
        assert_eq!(job.wait_pid, None);
    }
}
