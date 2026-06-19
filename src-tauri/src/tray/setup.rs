//! Tray + window-lifecycle glue (desktop only). Builds a system-tray icon with
//! a Show/Quit menu and, on left-click, toggles the main window. The decisions
//! themselves (close-to-tray vs quit, start hidden) live in the tested
//! `behavior` core; this file only wires them to Tauri's tray/window APIs and
//! reads the current settings from disk.

use crate::settings::store;
use crate::tray::behavior::{self, CloseAction};
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

/// Read `close_to_tray` from the current config (defaults to true on any error).
fn close_to_tray(app: &AppHandle) -> bool {
    config_path(app)
        .and_then(|p| store::load(&p).ok())
        .map(|c| c.close_to_tray)
        .unwrap_or_else(|| crate::settings::model::General::default().close_to_tray)
}

/// Bring the main window to the foreground.
fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Toggle the main window's visibility (used by a left-click on the tray icon).
fn toggle_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show_main(app);
        }
    }
}

/// Build the system-tray icon + menu. Call once during setup.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ArcadeLauncher", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("ArcadeLauncher")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A single physical left-click emits two Click events on Windows
            // (button_state Down then Up). Act on the release edge only, or the
            // window toggles twice and never comes to the front.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Handle a window event: when the user closes the window and close-to-tray is
/// on, hide it instead of quitting.
pub fn on_window_event(app: &AppHandle, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if behavior::close_action(close_to_tray(app)) == CloseAction::HideToTray {
            api.prevent_close();
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }
        }
    }
}

/// On startup, hide the window if launch-minimized is set.
pub fn apply_launch_minimized(app: &AppHandle, launch_minimized: bool) {
    if behavior::start_hidden(launch_minimized) {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
        }
    }
}
