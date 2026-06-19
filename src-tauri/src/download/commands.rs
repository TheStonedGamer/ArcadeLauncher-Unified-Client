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
        verify: false,
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

/// Shared setup for the high-level install/verify triggers: fetch the game's
/// manifest from the server (Bearer-authed with the session token), resolve the
/// per-user install dir + records path, read the bandwidth cap from settings,
/// and build the `InstallContext`. `verify` selects normal-install behavior
/// (skip existing files on presence) vs. validate-and-repair (re-hash existing
/// files against the manifest's SHA-256 and re-download mismatches).
async fn build_install_context(
    app: &tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
    verify: bool,
) -> AppResult<InstallContext> {
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

    let version = manifest.version.clone();
    let archive = manifest.archive_path();
    Ok(InstallContext {
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
        verify,
    })
}

/// High-level install trigger used by the detail panel: resolves everything via
/// `build_install_context` and hands off to the download engine. Progress/status
/// then arrive as `download://progress` / `download://status` events like any
/// other install.
#[tauri::command]
pub async fn download_install(
    app: tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
) -> AppResult<()> {
    let ctx = build_install_context(&app, host, token, game_id, false).await?;
    app.state::<DownloadManager>().start(ctx);
    Ok(())
}

/// Validate & repair an installed game (the card right-click "Verify files"
/// action), mirroring the native launcher: every manifest file already on disk
/// is re-checked by size + SHA-256, and only missing/corrupt files are
/// re-downloaded. Same progress/status events as a normal install.
#[tauri::command]
pub async fn download_verify(
    app: tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
) -> AppResult<()> {
    let ctx = build_install_context(&app, host, token, game_id, true).await?;
    app.state::<DownloadManager>().start(ctx);
    Ok(())
}

/// Load the client-local install records as a `game_id → catalog state string`
/// map. The catalog UI overlays this onto the read-only library so the Install
/// button reflects what's actually on disk without a catalog reload. A missing
/// records file yields an empty map (first run, nothing installed yet).
#[tauri::command]
pub fn load_install_records(
    app: tauri::AppHandle,
) -> AppResult<std::collections::BTreeMap<String, String>> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    let records = crate::download::records::load(&config_dir.join("install_records.json"))?;
    Ok(records.state_map())
}

/// Check installed games for available updates: for each on-disk record, fetch
/// the server's current manifest version and compare it to the installed one,
/// flipping `installed` ↔ `updateAvailable` accordingly. Returns the refreshed
/// `game_id → catalog state string` overlay (same shape as `load_install_records`),
/// so the catalog reflects updates without a reload. Best-effort per game: a
/// failed manifest fetch leaves that record's state unchanged.
#[tauri::command]
pub async fn check_updates(
    app: tauri::AppHandle,
    host: String,
    token: String,
) -> AppResult<std::collections::BTreeMap<String, String>> {
    use crate::download::records;

    let host = normalize_host(&host);
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    let records_path = config_dir.join("install_records.json");

    let recs = records::load(&records_path)?;
    let installed: Vec<String> = recs.installed_ids().iter().map(|s| s.to_string()).collect();
    if installed.is_empty() {
        return Ok(recs.state_map());
    }

    // Fetch each installed game's current manifest version (Bearer-authed).
    let client = reqwest::Client::new();
    let mut server_versions = std::collections::BTreeMap::new();
    for id in installed {
        let url = format!("https://{host}/api/games/{id}/manifest");
        let resp = match client.get(&url).bearer_auth(&token).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue, // best-effort: skip games we can't reach
        };
        let body = match resp.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };
        if let Ok(manifest) = Manifest::parse(&body) {
            server_versions.insert(id, manifest.version);
        }
    }

    // Apply under the same load-modify-save discipline the engine uses, so a
    // concurrent install can't clobber the records.
    let mut recs = records::load(&records_path)?;
    let changed = recs.mark_updates(&server_versions);
    if !changed.is_empty() {
        records::save(&records_path, &recs)?;
    }
    Ok(recs.state_map())
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
