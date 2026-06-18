//! Presence commands. The frontend calls `presence_set_playing` when a game
//! launches and `presence_set_idle` when it exits (driven by the existing
//! `game-exited` event). Both read the `discord_rich_presence` toggle from the
//! General settings, but the Discord application id comes from the server
//! (`/api/client-config`) — the frontend pushes it via `presence_configure`
//! after login, and it's held in `PresenceManager` state.

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

/// Push the desired state through the manager: the on/off toggle comes from the
/// user's settings, the app id from the server (stored in the manager).
fn apply(app: &tauri::AppHandle, mgr: &PresenceManager, state: &PresenceState) -> AppResult<()> {
    let cfg = store::load(&config_path(app)?)?;
    mgr.apply(cfg.discord_rich_presence, &mgr.app_id(), state)
}

/// Store the server-provided Discord application id. The frontend fetches
/// `/api/client-config` after login and calls this once.
#[tauri::command]
pub fn presence_configure(presence: State<'_, PresenceManager>, app_id: String) -> AppResult<()> {
    presence.set_app_id(&app_id);
    Ok(())
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
