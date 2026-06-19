//! Application entry point. Intentionally thin: it only registers plugins and
//! wires up the command handlers each feature module owns. Feature logic lives
//! in `catalog/` and `launch/` so this file never grows.

mod catalog;
mod controller;
mod download;
mod emulators;
mod error;
mod hotkey;
mod launch;
mod presence;
mod requests;
mod retroachievements;
mod saves;
mod session;
mod settings;
mod social;
mod stores;
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // Updates are handled by the standalone bootstrap updater before launch, so
    // no in-app updater/process plugins. The global-shortcut plugin is desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

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

                    // System tray (Show/Quit) + launch-minimized.
                    if let Err(e) = tray::setup::build(handle) {
                        eprintln!("tray not built: {e}");
                    }
                    tray::setup::apply_launch_minimized(handle, cfg.launch_minimized);
                }

                // Self-heal server-staged BIOS/firmware into each installed
                // emulator (PS1 BIOS, OG Xbox firmware, PS3 firmware), mirroring
                // the native client's on-launch deploy. Best-effort on a
                // background thread so a slow firmware install never blocks boot;
                // no-op for emulators that aren't installed yet.
                let fw_handle = handle.clone();
                std::thread::spawn(move || {
                    for line in emulators::firmware::ensure_all(&fw_handle) {
                        eprintln!("firmware: {line}");
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: hide instead of quitting when enabled.
            #[cfg(desktop)]
            {
                use tauri::Manager;
                tray::setup::on_window_event(window.app_handle(), event);
            }
            #[cfg(not(desktop))]
            {
                let _ = (window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            catalog::commands::load_catalog,
            catalog::commands::fetch_catalog,
            catalog::prefs_commands::load_catalog_prefs,
            catalog::prefs_commands::save_catalog_prefs,
            catalog::art_commands::steamgriddb_search,
            catalog::art_commands::apply_cover,
            retroachievements::commands::retroachievements_summary,
            requests::commands::requests_board,
            requests::commands::requests_me,
            requests::commands::requests_search,
            requests::commands::requests_create,
            requests::commands::requests_vote,
            requests::commands::requests_rate,
            requests::commands::requests_status,
            launch::commands::launch_game,
            launch::commands::check_runnable,
            settings::commands::load_settings,
            settings::commands::save_settings,
            social::commands::social_connect,
            social::commands::social_send,
            social::commands::social_disconnect,
            social::commands::social_fetch_friends,
            social::commands::social_attachment_upload,
            social::commands::social_attachment_url,
            social::commands::social_profile_get,
            social::commands::social_profile_update,
            social::commands::social_friendmeta_get,
            social::commands::social_friendmeta_set,
            social::commands::social_user_search,
            social::commands::social_friend_request,
            social::commands::social_friend_respond,
            social::commands::social_privacy_get,
            social::commands::social_privacy_set,
            social::commands::social_ignores_get,
            social::commands::social_ignore_set,
            social::commands::social_turn_servers,
            download::commands::download_start,
            download::commands::download_install,
            download::commands::download_verify,
            download::commands::download_pause,
            download::commands::download_resume,
            download::commands::download_cancel,
            download::commands::load_install_records,
            download::commands::check_updates,
            emulators::commands::list_emulators,
            emulators::commands::download_emulator,
            emulators::commands::download_all_emulators,
            emulators::commands::firmware_status,
            stores::commands::scan_steam,
            stores::commands::scan_epic,
            stores::commands::launch_store_uri,
            presence::commands::presence_set_playing,
            presence::commands::presence_set_idle,
            presence::commands::presence_configure,
            hotkey::commands::hotkey_apply,
            window::commands::set_fullscreen,
            window::commands::is_fullscreen,
            session::commands::session_login,
            session::store::session_save,
            session::store::session_restore,
            session::store::session_clear,
            saves::commands::saves_plan,
            saves::commands::saves_sync,
            controller::commands::controller_host_buttons,
            controller::commands::controller_sdl_tokens,
            controller::commands::controller_targets,
            controller::commands::controller_load_profiles,
            controller::commands::controller_save_profile,
            controller::commands::controller_apply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
