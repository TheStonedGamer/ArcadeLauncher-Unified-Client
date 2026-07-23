//! Play-history commands + the path helper the post-exit thread uses. The log
//! lives next to `catalog_prefs.json` in Tauri's app-config dir. Writes happen in
//! Rust (see `launch/session.rs`) so a session is recorded even if the webview
//! isn't listening; the UI only reads.

use crate::catalog::sessions::{self, PlaySession};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::Manager;

pub fn sessions_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("play_sessions.json"))
}

/// The full retained history, oldest first. The UI slices/aggregates it.
#[tauri::command]
pub fn load_play_sessions(app: tauri::AppHandle) -> AppResult<Vec<PlaySession>> {
    Ok(sessions::load(&sessions_path(&app)?)?.sessions)
}
