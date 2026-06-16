//! Hotkey command: re-apply the global summon/hide accelerator live, so a
//! change in Settings takes effect immediately instead of after a restart.
//! Validation/decisions live in the tested `shortcut` core; this just forwards
//! to the registration glue and surfaces any error string to the UI.

use crate::hotkey::register;

#[cfg(desktop)]
#[tauri::command]
pub fn hotkey_apply(app: tauri::AppHandle, enabled: bool, accelerator: String) -> Result<(), String> {
    register::install(&app, enabled, &accelerator)
}

// On mobile there is no global shortcut; accept the call and no-op so the
// frontend doesn't need a platform branch.
#[cfg(not(desktop))]
#[tauri::command]
pub fn hotkey_apply(_enabled: bool, _accelerator: String) -> Result<(), String> {
    Ok(())
}
