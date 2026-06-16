//! Window commands for Big Picture mode. Toggling fullscreen is pure window
//! glue (no logic worth unit-testing), so it lives here as a thin command the
//! frontend calls from the Big Picture button or the gamepad's Y intent.

use crate::error::{AppError, AppResult};
use tauri::Manager;

/// Set the main window's fullscreen state and return the value that took effect.
#[tauri::command]
pub fn set_fullscreen(app: tauri::AppHandle, fullscreen: bool) -> AppResult<bool> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::msg("no main window"))?;
    win.set_fullscreen(fullscreen)
        .map_err(|e| AppError::msg(format!("set_fullscreen: {e}")))?;
    Ok(fullscreen)
}

/// Report whether the main window is currently fullscreen.
#[tauri::command]
pub fn is_fullscreen(app: tauri::AppHandle) -> AppResult<bool> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::msg("no main window"))?;
    win.is_fullscreen()
        .map_err(|e| AppError::msg(format!("is_fullscreen: {e}")))
}
