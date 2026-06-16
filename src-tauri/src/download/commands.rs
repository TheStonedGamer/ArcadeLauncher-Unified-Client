//! Download commands exposed to the webview. They are a thin shell over the
//! engine in `engine.rs`: the frontend supplies the game id, install directory,
//! host/token (from the user's session), the parsed install manifest, and the
//! bandwidth cap it read from settings. Progress and lifecycle come back as
//! `download://progress` / `download://status` events.

use crate::download::engine::{DownloadManager, InstallContext};
use crate::download::manifest::Manifest;
use std::path::PathBuf;
use tauri::State;

/// Begin installing `game_id` into `install_dir` from `manifest`. A no-op if an
/// install for this id is already active.
#[tauri::command]
pub fn download_start(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    game_id: String,
    install_dir: String,
    host: String,
    token: String,
    manifest: Manifest,
    cap_kbps: u64,
) {
    manager.start(InstallContext {
        app,
        game_id,
        install_dir: PathBuf::from(install_dir),
        host,
        token,
        manifest,
        cap_kbps,
    });
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
