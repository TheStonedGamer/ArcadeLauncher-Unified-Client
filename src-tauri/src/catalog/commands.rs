//! Tauri commands exposed to the webview for the catalog feature.

use crate::catalog::{loader, model::Game};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::Manager;

/// Resolve which `library.json` to load. The UI no longer asks the user for a
/// path — it's handled here behind the scenes:
///   1. an explicit non-empty `path` argument (rarely used now), else
///   2. a legacy `libraryPath` still configured in `config.json` (migration),
///      else
///   3. the default per-user location `app_config_dir/library.json` (alongside
///      `config.json`, `install_records.json`, `catalog_prefs.json`).
/// A missing file yields an empty catalog (see `loader::load_file`), so a fresh
/// install simply shows no games until the catalog is synced down.
fn resolve_library_path(app: &tauri::AppHandle, explicit: Option<String>) -> AppResult<PathBuf> {
    if let Some(p) = explicit {
        if !p.trim().is_empty() {
            return Ok(PathBuf::from(p.trim()));
        }
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    let cfg = crate::settings::store::load(&dir.join("config.json")).unwrap_or_default();
    let legacy = cfg.library_path.trim();
    if !legacy.is_empty() {
        return Ok(PathBuf::from(legacy));
    }
    Ok(dir.join("library.json"))
}

/// Load the catalog. The path is resolved behind the scenes; callers normally
/// pass `None` and let `resolve_library_path` pick the per-user location.
#[tauri::command]
pub fn load_catalog(app: tauri::AppHandle, path: Option<String>) -> AppResult<Vec<Game>> {
    let resolved = resolve_library_path(&app, path)?;
    loader::load_file(&resolved)
}
