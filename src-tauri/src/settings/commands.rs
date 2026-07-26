//! Settings commands. The per-user config path is resolved from Tauri's
//! app-config dir (`%AppData%/<id>` on Windows, `~/.config/<id>` on Linux), so
//! it lives in user-writable space — consistent with the admin-free model.

use crate::error::{AppError, AppResult};
use crate::settings::{model::General, store};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const UPDATE_MANIFEST_URL: &str =
    "https://github.com/TheStonedGamer/ArcadeLauncher-Unified-Client/releases/latest/download/latest.json";

#[derive(Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    platforms: std::collections::HashMap<String, UpdatePlatform>,
}

#[derive(Deserialize)]
struct UpdatePlatform {
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    url: String,
}

fn parse_version(value: &str) -> (u64, u64, u64) {
    let mut parts = value
        .trim()
        .trim_start_matches('v')
        .split(['.', '-', '+']);
    let number =
        |part: Option<&str>| part.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    (
        number(parts.next()),
        number(parts.next()),
        number(parts.next()),
    )
}

/// Check the signed-release manifest without interrupting the running app.
/// Download/install still uses the bootstrap updater on the next launch; the
/// returned URL lets the attention indicator offer the signed installer now.
#[tauri::command]
pub async fn app_update_check() -> AppResult<Option<AvailableUpdate>> {
    let manifest: UpdateManifest = reqwest::Client::new()
        .get(UPDATE_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("update check failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::msg(format!("update check failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid update manifest: {e}")))?;
    if parse_version(&manifest.version) <= parse_version(env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let keys = if cfg!(target_os = "windows") {
        ["windows-x86_64-nsis", "windows-x86_64"]
    } else {
        ["linux-x86_64-appimage", "linux-x86_64"]
    };
    let url = keys
        .iter()
        .find_map(|key| manifest.platforms.get(*key))
        .map(|platform| platform.url.clone())
        .ok_or_else(|| AppError::msg("update manifest has no installer for this platform"))?;
    Ok(Some(AvailableUpdate {
        version: manifest.version,
        url,
    }))
}

/// Get the server version from Cargo.toml.
#[tauri::command]
pub fn get_server_version() -> AppResult<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

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

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn dotted_versions_compare_numerically() {
        assert!(parse_version("0.15.10") > parse_version("0.15.9"));
        assert_eq!(parse_version("v1.2"), (1, 2, 0));
    }
}
