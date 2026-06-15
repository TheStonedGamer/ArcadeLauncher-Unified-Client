//! Tauri commands exposed to the webview for the catalog feature.

use crate::catalog::{loader, model::Game};
use crate::error::AppResult;
use std::path::PathBuf;

/// Load the catalog from a `library.json` path.
///
/// The frontend passes an explicit path for now (T0). A later phase resolves
/// the default per-user library location in Rust instead of the UI.
#[tauri::command]
pub fn load_catalog(path: String) -> AppResult<Vec<Game>> {
    loader::load_file(&PathBuf::from(path))
}
