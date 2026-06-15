//! Settings commands. The per-user config path is resolved from Tauri's
//! app-config dir (`%AppData%/<id>` on Windows, `~/.config/<id>` on Linux), so
//! it lives in user-writable space — consistent with the admin-free model.

use crate::error::{AppError, AppResult};
use crate::settings::{model::General, store};
use std::path::PathBuf;
use tauri::Manager;

fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> AppResult<General> {
    store::load(&config_path(&app)?)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: General) -> AppResult<()> {
    store::save(&config_path(&app)?, &settings)
}
