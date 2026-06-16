//! Application entry point. Intentionally thin: it only registers plugins and
//! wires up the command handlers each feature module owns. Feature logic lives
//! in `catalog/` and `launch/` so this file never grows.

mod catalog;
mod download;
mod error;
mod launch;
mod settings;
mod social;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // Updater + process plugins are desktop-only (Steam-style admin-free updates).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        // Live social gateway connection state (one per app instance).
        .manage(social::transport::SocialTransport::default())
        .invoke_handler(tauri::generate_handler![
            catalog::commands::load_catalog,
            launch::commands::launch_game,
            settings::commands::load_settings,
            settings::commands::save_settings,
            social::commands::social_connect,
            social::commands::social_send,
            social::commands::social_disconnect,
            social::commands::social_fetch_friends,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
