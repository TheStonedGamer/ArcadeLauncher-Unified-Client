//! Application entry point. Intentionally thin: it only registers plugins and
//! wires up the command handlers each feature module owns. Feature logic lives
//! in `catalog/` and `launch/` so this file never grows.

mod catalog;
mod download;
mod error;
mod hotkey;
mod launch;
mod presence;
mod settings;
mod social;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // Updater + process plugins are desktop-only (Steam-style admin-free updates).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        // Live social gateway connection state (one per app instance).
        .manage(social::transport::SocialTransport::default())
        // Active game-install downloads (one manager per app instance).
        .manage(download::engine::DownloadManager::default())
        // Discord Rich Presence connection (best-effort, settings-gated).
        .manage(presence::client::PresenceManager::default())
        .setup(|app| {
            // Register the global summon/hide hotkey from saved settings.
            // Best-effort: a missing config or bad accelerator is logged, not
            // fatal — the launcher must always boot.
            #[cfg(desktop)]
            {
                use tauri::Manager;
                let handle = app.handle();
                if let Ok(dir) = handle.path().app_config_dir() {
                    let cfg = settings::store::load(&dir.join("config.json")).unwrap_or_default();
                    if let Err(e) = hotkey::register::install(
                        handle,
                        cfg.global_hotkey_enabled,
                        &cfg.global_hotkey,
                    ) {
                        eprintln!("global hotkey not registered: {e}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog::commands::load_catalog,
            catalog::art_commands::fetch_cover_art,
            catalog::prefs_commands::load_catalog_prefs,
            catalog::prefs_commands::save_catalog_prefs,
            launch::commands::launch_game,
            settings::commands::load_settings,
            settings::commands::save_settings,
            social::commands::social_connect,
            social::commands::social_send,
            social::commands::social_disconnect,
            social::commands::social_fetch_friends,
            download::commands::download_start,
            download::commands::download_pause,
            download::commands::download_resume,
            download::commands::download_cancel,
            presence::commands::presence_set_playing,
            presence::commands::presence_set_idle,
            hotkey::commands::hotkey_apply,
            window::commands::set_fullscreen,
            window::commands::is_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
