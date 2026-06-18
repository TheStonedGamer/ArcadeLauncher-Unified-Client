//! Tauri commands backing the Steam and Epic tabs: scan each storefront's local
//! install manifests. Launching is done from the frontend via the opener plugin
//! (the protocol URIs in each `StoreGame`), so no launch command is needed here.

use super::{epic, steam, StoreGame};
use crate::error::{AppError, AppResult};

/// Installed Steam games discovered from local library manifests.
#[tauri::command]
pub fn scan_steam() -> Vec<StoreGame> {
    steam::scan()
}

/// Installed Epic games discovered from local install manifests.
#[tauri::command]
pub fn scan_epic() -> Vec<StoreGame> {
    epic::scan()
}

/// Launch a storefront protocol URI through the OS default handler. Guarded to
/// the two schemes we emit so the webview can't ask us to run arbitrary
/// programs. Steam/Epic register these handlers when installed.
#[tauri::command]
pub fn launch_store_uri(uri: String) -> AppResult<()> {
    if !(uri.starts_with("steam://") || uri.starts_with("com.epicgames.launcher://")) {
        return Err(AppError::msg("unsupported launch uri"));
    }
    #[cfg(windows)]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &uri])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&uri).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&uri).spawn();
    result
        .map(|_| ())
        .map_err(|e| AppError::msg(format!("failed to launch '{uri}': {e}")))
}
