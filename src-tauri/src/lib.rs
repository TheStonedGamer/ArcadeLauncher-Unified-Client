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
mod proc;
mod requests;
mod retroachievements;
mod saves;
mod session;
mod settings;
mod social;
mod stores;
mod streaming;
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single-instance guard MUST be the FIRST plugin registered (Tauri
    // requirement). Only one launcher may run per machine: a second launch
    // hands its argv/cwd to the already-running instance (which surfaces its
    // window) and then exits, instead of spawning a duplicate. Desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        tray::setup::show_main(app);
    }));

    let builder = builder
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
        // The live engine-driven stream session (one at a time; `client.start`).
        .manage(streaming::engine_session::StreamSession::default())
        // The persistent host engine (one `engine host` process owning the
        // Sunshine child across all `host.*` calls — see `host_session`).
        .manage(streaming::host_session::HostSession::default())
        .setup(|app| {
            // Resolve the app log dir once so spawn helpers can tee the engine's
            // stdout/stderr to per-component log files (Moonlight = `stream`, the
            // Sunshine host driver = `host`) without an AppHandle threaded down to
            // the handle-free engine spawn sites. Best-effort; falls back to the
            // null device if it can't be resolved.
            {
                use tauri::Manager;
                if let Ok(dir) = app.handle().path().app_log_dir() {
                    proc::set_log_dir(dir);
                }
            }

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

                // If the Sunshine host sidecar was fetched in a prior session,
                // point the stream engine at it now so host mode works without a
                // re-download. Best-effort; no-op when it isn't installed yet.
                streaming::host_fetch_commands::wire_existing(handle);

                // Auto-restore "Let this PC be streamed": if the user had hosting
                // on when they last quit, re-enable it now so the toggle truly
                // persists across restarts (host mode otherwise lives only for the
                // launcher process). `wire_existing` set `ARCADE_SUNSHINE` iff the
                // sidecar is installed, so we gate on that — no point spawning an
                // engine that can't host. Done off the boot path so a slow Sunshine
                // start never blocks launch; the toggle reflects it via `host.status`
                // once it's up.
                if let Ok(dir) = handle.path().app_config_dir() {
                    if streaming::host_pref::load(&dir)
                        && std::env::var_os("ARCADE_SUNSHINE").is_some()
                    {
                        let host_handle = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let session =
                                host_handle.state::<streaming::host_session::HostSession>();
                            if let Err(e) = session
                                .call("host.enable", serde_json::json!({ "on": true }))
                                .await
                            {
                                eprintln!("host autostart failed: {e}");
                            }
                        });
                    }
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

                // One-time install-folder migration: rename legacy id-named game
                // folders (`games/pc-fdc100f88077`) to clean catalog titles
                // (`games/Food Delivery Simulator`) and update the records so
                // launches follow. Best-effort on a background thread so a slow
                // disk never blocks boot; skips anything locked, missing, already
                // migrated, or colliding. Idempotent — a second run is a no-op.
                let mig_handle = handle.clone();
                std::thread::spawn(move || {
                    let (data_dir, config_dir) =
                        match (mig_handle.path().app_data_dir(), mig_handle.path().app_config_dir()) {
                            (Ok(d), Ok(c)) => (d, c),
                            _ => return,
                        };
                    let games_root = data_dir.join("games");
                    let records_path = config_dir.join("install_records.json");
                    let catalog = catalog::loader::load_file(&config_dir.join("library.json"))
                        .unwrap_or_default();
                    for line in
                        download::migrate::migrate_install_dirs(&games_root, &records_path, &catalog)
                    {
                        eprintln!("install-dir migration: {line}");
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
            streaming::commands::host_pair,
            streaming::commands::streaming_hosts,
            streaming::commands::streaming_forget_host,
            streaming::engine_session::engine_stream_available,
            streaming::engine_session::stream_start,
            streaming::engine_session::stream_stop,
            streaming::engine_conn::engine_pair,
            streaming::engine_conn::engine_hosts,
            streaming::engine_conn::engine_apps,
            streaming::engine_conn::engine_stop,
            streaming::engine_conn::engine_identity,
            streaming::engine_conn::engine_trust_host,
            streaming::engine_conn::engine_host_status,
            streaming::engine_conn::engine_host_enable,
            streaming::engine_conn::engine_host_sync_apps,
            streaming::engine_conn::engine_host_list_apps,
            streaming::engine_conn::engine_host_device_info,
            streaming::engine_conn::engine_host_trust_client,
            streaming::host_fetch_commands::host_install_status,
            streaming::host_fetch_commands::host_install,
            streaming::mesh::conn::mesh_is_available,
            streaming::mesh::conn::mesh_status,
            streaming::mesh::conn::mesh_join,
            streaming::mesh::conn::mesh_resolve_host,
            streaming::mesh::preauth::mesh_preauth,
            streaming::mypcs_commands::mypcs_self,
            streaming::mypcs_commands::mypcs_announce_frame,
            streaming::mypcs_commands::mypcs_register,
            streaming::mypcs_commands::mypcs_list,
            streaming::mypcs_commands::mypcs_forget,
            streaming::mypcs_commands::mypcs_apps,
            streaming::mypcs_commands::mypcs_publish,
            streaming::mypcs_commands::client_cert_register,
            streaming::mypcs_commands::client_cert_list,
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
            social::commands::social_activity_fetch,
            social::commands::onboarding_get,
            social::commands::onboarding_complete,
            download::commands::download_start,
            download::commands::download_install,
            download::commands::download_verify,
            download::commands::download_pause,
            download::commands::download_resume,
            download::commands::download_cancel,
            download::commands::load_install_records,
            download::commands::check_updates,
            download::commands::open_install_dir,
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
            session::commands::session_register,
            session::commands::session_forgot,
            session::store::session_save,
            session::store::session_restore,
            session::store::session_clear,
            saves::commands::saves_plan,
            saves::commands::saves_sync,
            saves::commands::saves_versions,
            saves::commands::saves_snapshot,
            saves::commands::saves_restore_version,
            controller::commands::controller_host_buttons,
            controller::commands::controller_sdl_tokens,
            controller::commands::controller_targets,
            controller::commands::controller_load_profiles,
            controller::commands::controller_save_profile,
            controller::commands::controller_apply,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // On shutdown, gracefully stop hosting so the bundled Sunshine (a
            // child of the persistent host engine) doesn't leak past the launcher.
            // `Exit` is the terminal event — fired for tray Quit / `app.exit()`,
            // not the hide-to-tray window close.
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = &event {
                use tauri::Manager;
                let session = app_handle.state::<streaming::host_session::HostSession>();
                tauri::async_runtime::block_on(session.shutdown());
            }
            #[cfg(not(desktop))]
            {
                let _ = (app_handle, event);
            }
        });
}
