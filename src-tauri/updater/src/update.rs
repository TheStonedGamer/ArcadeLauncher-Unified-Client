//! The update flow, decoupled from the UI. `run` drives the whole sequence —
//! check → download → verify → install → launch — pushing human-readable status
//! into the shared `Status` as it goes. Every failure mode is non-fatal: on any
//! error we log it into the status and fall straight through to launching the
//! installed app, because an updater must never block startup.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::Deserialize;

use crate::Status;

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
/// we drive; the bare key resolves to the `.msi`, which we don't. Linux: the
/// AppImage variant is what we replace in place.
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
    // If the launcher is already open, never reinstall over a running app — just
    // surface its window. Spawning the app triggers the launcher's
    // single-instance guard, which brings the existing window to the front; the
    // duplicate we spawned then exits on its own.
    if crate::instance::launcher_is_running() {
        set(status, "ArcadeLauncher is already running — bringing it to the front…");
        launch_app();
        return;
    }

    set(status, "Checking for updates…");
    match check_and_apply(status) {
        Ok(true) => set(status, "Update complete — starting ArcadeLauncher…"),
        Ok(false) => set(status, "Up to date — starting ArcadeLauncher…"),
        Err(e) => set(status, format!("Skipping update ({e}) — starting…")),
    }
    launch_app();
}

/// Returns Ok(true) when an update was downloaded + installed, Ok(false) when
/// already current, Err on any recoverable problem (offline, bad manifest, …).
fn check_and_apply(status: &Arc<Mutex<Status>>) -> Result<bool, String> {
    let manifest = fetch_manifest()?;
    if !is_newer(&manifest.version, env!("CARGO_PKG_VERSION")) {
        return Ok(false);
    }
    // Prefer the platform's preferred installer variant, falling back to the
    // bare key. On Windows the NSIS `setup.exe` is the per-user, admin-free
    // installer we want — the bare `windows-x86_64` key resolves to the `.msi`,
    // which we don't drive.
    let entry = platform_keys()
        .iter()
        .find_map(|k| manifest.platforms.get(*k))
        .ok_or_else(|| format!("no artifact for {}", platform_keys()[0]))?;

    set(status, format!("Downloading update {}…", manifest.version));
    let bytes = download(&entry.url)?;

    set(status, "Verifying update…");
    verify(&bytes, &entry.signature)?;

    set(status, format!("Installing update {}…", manifest.version));
    install(&bytes, &entry.url)?;
    Ok(true)
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
fn install(bytes: &[u8], url: &str) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        install_windows(bytes)
    } else {
        install_linux(bytes, url)
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
fn install_windows(_bytes: &[u8]) -> Result<(), String> {
    Err("unsupported platform".into())
}

#[cfg(target_os = "windows")]
fn install_windows(bytes: &[u8]) -> Result<(), String> {
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

    let status = Command::new(&setup)
        .arg("/S") // NSIS silent install
        .status()
        .map_err(|e| format!("run setup: {e}"))?;
    if !status.success() {
        return Err(format!("setup exited with {status}"));
    }
    Ok(())
}

/// The directory the updater executable lives in (where the app is installed).
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Launch the installed main app sitting beside the updater, then return so the
/// caller can exit. Best-effort: a missing launcher just leaves nothing running.
fn launch_app() {
    let dir = exe_dir();
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
    fn parse_is_lenient() {
        assert_eq!(parse("0.9.4"), (0, 9, 4));
        assert_eq!(parse("1.2"), (1, 2, 0));
        assert_eq!(parse("garbage"), (0, 0, 0));
    }
}
