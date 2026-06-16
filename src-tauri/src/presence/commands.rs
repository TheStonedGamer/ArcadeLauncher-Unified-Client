//! Presence commands. The frontend calls `presence_set_playing` when a game
//! launches and `presence_set_idle` when it exits (driven by the existing
//! `game-exited` event). Both read the General settings to decide whether
//! presence is enabled and which Discord app id to use — so the toggle in
//! Settings takes effect without any extra plumbing.

use crate::error::{AppError, AppResult};
use crate::presence::activity::PresenceState;
use crate::presence::client::PresenceManager;
use crate::settings::store;
use std::path::PathBuf;
use tauri::{Manager, State};

fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("config.json"))
}

/// Push the desired state through the manager using the current settings.
fn apply(app: &tauri::AppHandle, mgr: &PresenceManager, state: &PresenceState) -> AppResult<()> {
    let cfg = store::load(&config_path(app)?)?;
    mgr.apply(cfg.discord_rich_presence, &cfg.discord_app_id, state)
}

#[tauri::command]
pub fn presence_set_playing(
    app: tauri::AppHandle,
    presence: State<'_, PresenceManager>,
    title: String,
    started_unix: i64,
) -> AppResult<()> {
    apply(&app, &presence, &PresenceState::Playing { title, started_unix })
}

#[tauri::command]
pub fn presence_set_idle(
    app: tauri::AppHandle,
    presence: State<'_, PresenceManager>,
) -> AppResult<()> {
    apply(&app, &presence, &PresenceState::Idle)
}
