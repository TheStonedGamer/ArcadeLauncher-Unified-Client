//! Catalog-prefs commands. The per-user file lives in Tauri's app-config dir
//! (user-writable, admin-free), alongside `config.json`. The whole prefs object
//! is loaded once by the UI and saved back wholesale on each toggle — the
//! mutation/merge logic lives in the tested TS overlay, not here.

use crate::catalog::prefs::{self, CatalogPrefs};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::Manager;

fn prefs_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("catalog_prefs.json"))
}

#[tauri::command]
pub fn load_catalog_prefs(app: tauri::AppHandle) -> AppResult<CatalogPrefs> {
    prefs::load(&prefs_path(&app)?)
}

#[tauri::command]
pub fn save_catalog_prefs(app: tauri::AppHandle, prefs: CatalogPrefs) -> AppResult<()> {
    prefs::save(&prefs_path(&app)?, &prefs)
}
