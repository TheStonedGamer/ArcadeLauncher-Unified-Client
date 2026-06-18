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

/// Strip any scheme/trailing slash so we control the transport scheme (mirrors
/// the download command's host normalization).
fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

/// Sync the catalog from the server (`GET /api/catalog`, Bearer-authed with the
/// session token), cache it to the per-user `library.json` behind the scenes,
/// and return the games. This is the unified client's equivalent of the native
/// client's `ServerClient::FetchCatalog`: the catalog is server-owned, so the
/// UI never asks the user where `library.json` lives — we fetch it, write it,
/// and `load_catalog` reads the same file offline on the next launch.
#[tauri::command]
pub async fn fetch_catalog(
    app: tauri::AppHandle,
    host: String,
    token: String,
) -> AppResult<Vec<Game>> {
    let host = normalize_host(&host);
    let url = format!("https://{host}/api/catalog");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("catalog request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "catalog fetch failed (HTTP {})",
            resp.status()
        )));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::msg(format!("catalog read failed: {e}")))?;
    let mut games = loader::parse_catalog_response(&body)?;

    // Everything from `/api/catalog` is server-owned and installable on demand.
    // The server doesn't emit `serverBacked`, so flag it here — the UI gates the
    // Install button (and cloud-save sync) on it.
    for g in &mut games {
        g.server_backed = true;
    }

    // Cache to the per-user library.json (bare array, the on-disk format) with an
    // atomic temp-write + rename so a crash mid-write never corrupts the cache.
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("library.json");
    let json = serde_json::to_string_pretty(&games)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;

    Ok(games)
}
