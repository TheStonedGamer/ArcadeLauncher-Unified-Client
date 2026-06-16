//! Thin global-shortcut glue. All parsing/decisions live in the tested
//! `shortcut` core; this file only talks to the plugin and the window. Called
//! once at startup with the user's configured accelerator: when enabled and
//! valid, it registers the hotkey that summons/hides the main window. Failures
//! are logged, never fatal — a bad accelerator must not stop the app booting.

use crate::hotkey::shortcut::{self, ToggleAction};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Apply the window toggle decision for the "main" window. Best-effort.
fn toggle_main(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);
    match shortcut::toggle_action(visible, focused) {
        ToggleAction::ShowAndFocus => {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        ToggleAction::Hide => {
            let _ = win.hide();
        }
    }
}

/// Register the summon/hide hotkey from the user's settings. `accelerator` is
/// the raw string from config; `enabled` gates the whole feature. Returns an
/// error string only for surfacing/logging — the caller treats it as non-fatal.
pub fn install(app: &AppHandle, enabled: bool, accelerator: &str) -> Result<(), String> {
    // Clear any previously-registered shortcut so re-applying from settings
    // doesn't stack handlers or leave a stale accelerator bound.
    let _ = app.global_shortcut().unregister_all();
    if !enabled || accelerator.trim().is_empty() {
        return Ok(());
    }
    let canonical = shortcut::canonicalize(accelerator)?;
    let app2 = app.clone();
    app.global_shortcut()
        .on_shortcut(canonical.as_str(), move |_app, _shortcut, event| {
            // Fire on key-down only, so one press is one toggle.
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle_main(&app2);
            }
        })
        .map_err(|e| format!("failed to register hotkey '{canonical}': {e}"))
}
