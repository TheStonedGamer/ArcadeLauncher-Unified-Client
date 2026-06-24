//! Transport for fetch-on-first-enable of the Sunshine host sidecar.
//!
//! Downloads the engine's Sunshine host asset (see [`host_fetch`](super::host_fetch)
//! for *what* and *where*) into the app data dir, unpacks it with the same
//! zip-slip-safe extractor the game installer uses, makes the binary executable
//! on Unix, and points the engine at it via the `ARCADE_SUNSHINE` env var so the
//! engine's `host` subprocess (spawned in [`engine_conn`](super::engine_conn))
//! finds it. The IO-free model lives in `host_fetch`.

use crate::download::extract::extract_zip;
use crate::error::{AppError, AppResult};
use crate::streaming::host_fetch::{
    host_asset_url, host_install_dir, is_installed, sunshine_bin_path, SUNSHINE_HOST_VERSION,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use tokio::io::AsyncWriteExt;

/// Reported state of the host sidecar on this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInstallStatus {
    /// Whether the Sunshine host binary is present locally.
    pub installed: bool,
    /// The engine version the sidecar is fetched for.
    pub version: String,
    /// Absolute path to the (expected) Sunshine binary.
    pub path: String,
}

/// The app data dir, where the host sidecar is unpacked.
fn data_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))
}

/// Point the engine at a present Sunshine binary for the rest of this process's
/// life. The engine's `host` subprocess inherits our environment
/// ([`engine_conn::spawn_engine`](super::engine_conn)), so this is how the
/// fetched (out-of-install-tree) binary becomes discoverable. No-op if the path
/// isn't a real file.
pub fn point_engine_at(path: &Path) {
    if is_installed(path) {
        std::env::set_var("ARCADE_SUNSHINE", path);
    }
}

/// On boot, wire the engine to an already-fetched host sidecar (if any) so host
/// mode works across restarts without re-downloading. Best-effort.
pub fn wire_existing(app: &tauri::AppHandle) {
    if let Ok(dir) = data_dir(app) {
        point_engine_at(&sunshine_bin_path(&dir, SUNSHINE_HOST_VERSION));
    }
}

/// Whether the Sunshine host sidecar is installed locally (and wire the engine to
/// it if so). Cheap; safe to call before showing the host UI.
#[tauri::command]
pub async fn host_install_status(app: tauri::AppHandle) -> AppResult<HostInstallStatus> {
    let bin = sunshine_bin_path(&data_dir(&app)?, SUNSHINE_HOST_VERSION);
    let installed = is_installed(&bin);
    if installed {
        point_engine_at(&bin);
    }
    Ok(HostInstallStatus {
        installed,
        version: SUNSHINE_HOST_VERSION.to_string(),
        path: bin.to_string_lossy().into_owned(),
    })
}

/// Stream `url` to `dest`, returning the number of bytes written. Bounded
/// connect timeout (the body can take as long as it needs for a ~tens-of-MB
/// asset, so no overall timeout here).
async fn download_to(url: &str, dest: &Path) -> AppResult<u64> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::msg(format!("http client: {e}")))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "host sidecar not available (HTTP {}) — the engine release may not publish it yet",
            resp.status().as_u16()
        )));
    }
    let mut stream = resp.bytes_stream();
    let mut out = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::msg(format!("create temp file: {e}")))?;
    let mut total: u64 = 0;
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::msg(format!("download read: {e}")))?;
        out.write_all(&chunk)
            .await
            .map_err(|e| AppError::msg(format!("write temp file: {e}")))?;
        total += chunk.len() as u64;
    }
    out.flush()
        .await
        .map_err(|e| AppError::msg(format!("flush temp file: {e}")))?;
    Ok(total)
}

/// Make the extracted Sunshine binary executable on Unix (zip drops the mode
/// bits). No-op on Windows.
#[cfg(unix)]
fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)
        .map_err(|e| AppError::msg(format!("stat sunshine: {e}")))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
        .map_err(|e| AppError::msg(format!("chmod sunshine: {e}")))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

/// Fetch + unpack the Sunshine host sidecar, then point the engine at it.
/// Returns the resulting install status. No-op if already installed, **unless**
/// `force` is set — then the existing copy of this version is wiped and
/// re-downloaded, which is how the Settings "reinstall / repair" button recovers
/// a corrupt or partial sidecar (or re-pulls on demand).
#[tauri::command]
pub async fn host_install(app: tauri::AppHandle, force: bool) -> AppResult<HostInstallStatus> {
    let data = data_dir(&app)?;
    let bin = sunshine_bin_path(&data, SUNSHINE_HOST_VERSION);
    let install_dir = host_install_dir(&data, SUNSHINE_HOST_VERSION);
    if is_installed(&bin) && !force {
        point_engine_at(&bin);
        return host_install_status(app).await;
    }
    // Forced re-download: clear any existing install of this version so the fetch
    // below lands a clean copy rather than extracting over a half-broken one.
    if force {
        let _ = std::fs::remove_dir_all(&install_dir);
    }

    std::fs::create_dir_all(&install_dir)
        .map_err(|e| AppError::msg(format!("create install dir: {e}")))?;

    // Download to a temp file beside the install dir, then extract.
    let archive = install_dir.join(".sunshine-download.zip");
    let _ = std::fs::remove_file(&archive); // clear any partial prior attempt
    download_to(&host_asset_url(SUNSHINE_HOST_VERSION), &archive).await?;

    extract_zip(&archive, &install_dir)?;
    let _ = std::fs::remove_file(&archive);

    if !is_installed(&bin) {
        return Err(AppError::msg(
            "host sidecar archive did not contain the expected Sunshine binary",
        ));
    }
    make_executable(&bin)?;
    point_engine_at(&bin);

    // A persistent host engine may already be running (spawned by an earlier
    // `host.status` poll) from *before* this download, so it didn't inherit the
    // `ARCADE_SUNSHINE` we just set and still believes Sunshine isn't installed.
    // Reap it so the next host.* call re-spawns an engine that sees the sidecar.
    // Only on this genuine fresh-install path — never on a status poll, which
    // would needlessly kill an engine that's actively hosting.
    app.state::<crate::streaming::host_session::HostSession>()
        .restart()
        .await;

    host_install_status(app).await
}
