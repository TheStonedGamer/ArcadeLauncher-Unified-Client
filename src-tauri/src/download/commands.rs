//! Download commands exposed to the webview. They are a thin shell over the
//! engine in `engine.rs`: the frontend supplies the game id, install directory,
//! host/token (from the user's session), the parsed install manifest, and the
//! bandwidth cap it read from settings. Progress and lifecycle come back as
//! `download://progress` / `download://status` events.

use crate::download::engine::{DownloadManager, InstallContext};
use crate::download::manifest::Manifest;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::{Manager, State};

/// Begin installing `game_id` into `install_dir` from `manifest`. A no-op if an
/// install for this id is already active.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn download_start(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    game_id: String,
    install_dir: String,
    host: String,
    token: String,
    manifest: Manifest,
    cap_kbps: u64,
    records_path: String,
    version: String,
    archive: Option<String>,
) {
    manager.start(InstallContext {
        app,
        game_id,
        install_dir: PathBuf::from(install_dir),
        host,
        token,
        manifest,
        cap_kbps,
        records_path: PathBuf::from(records_path),
        version,
        archive,
    });
}

/// Strip any scheme/trailing slash so we control the transport scheme.
fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

/// High-level install trigger used by the detail panel: fetch the game's
/// manifest from the server (Bearer-authed with the session token), resolve the
/// per-user install dir + records path, read the bandwidth cap from settings,
/// and hand the whole thing to the download engine. Progress/status then arrive
/// as `download://progress` / `download://status` events like any other install.
#[tauri::command]
pub async fn download_install(
    app: tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
) -> AppResult<()> {
    let host = normalize_host(&host);

    // 1) Fetch + parse the manifest (GET /api/games/:id/manifest, Bearer token).
    let url = format!("https://{host}/api/games/{game_id}/manifest");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("manifest request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "manifest fetch failed (HTTP {})",
            resp.status()
        )));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::msg(format!("manifest read failed: {e}")))?;
    let manifest = Manifest::parse(&body).map_err(|e| AppError::msg(format!("bad manifest: {e}")))?;

    // 2) Resolve per-user paths: install under app-data, records in app-config.
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    let install_dir = data_dir.join("games").join(&game_id);
    let records_path = config_dir.join("install_records.json");

    // 3) Bandwidth cap from General settings (0 = unlimited).
    let cap_kbps = crate::settings::store::load(&config_dir.join("config.json"))
        .map(|cfg| cfg.download_limit_kbps as u64)
        .unwrap_or(0);

    // 4) Hand off to the engine.
    let version = manifest.version.clone();
    let archive = manifest.archive_path();
    let manager = app.state::<DownloadManager>();
    manager.start(InstallContext {
        app: app.clone(),
        game_id,
        install_dir,
        host,
        token,
        manifest,
        cap_kbps,
        records_path,
        version,
        archive,
    });
    Ok(())
}

/// Pause an active install (its `.part` files are kept for resume).
#[tauri::command]
pub fn download_pause(manager: State<'_, DownloadManager>, game_id: String) {
    manager.pause(&game_id);
}

/// Resume a paused install.
#[tauri::command]
pub fn download_resume(manager: State<'_, DownloadManager>, game_id: String) {
    manager.resume(&game_id);
}

/// Cancel an active install (its `.part` files are discarded).
#[tauri::command]
pub fn download_cancel(manager: State<'_, DownloadManager>, game_id: String) {
    manager.cancel(&game_id);
}
