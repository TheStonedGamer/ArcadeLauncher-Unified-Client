//! General settings model. `#[serde(default)]` makes every field optional on
//! disk, so loading an old/partial config.json fills the rest from defaults
//! instead of failing — the non-destructive contract the C++ client also keeps.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct General {
    /// Path to the user's library.json (so the app loads it on launch).
    pub library_path: String,
    /// Minimize to the system tray instead of quitting on window close.
    pub close_to_tray: bool,
    /// Start minimized on launch.
    pub launch_minimized: bool,
    /// Ask before quitting.
    pub confirm_on_exit: bool,
    /// Download bandwidth cap in KB/s (0 = unlimited).
    pub download_limit_kbps: u32,
    /// Max simultaneous downloads.
    pub concurrent_downloads: u32,
    /// UI theme id.
    pub theme: String,
    /// Twitch/IGDB API client id (empty = cover-art fetch disabled).
    pub igdb_client_id: String,
    /// Twitch/IGDB API client secret (empty = cover-art fetch disabled).
    pub igdb_client_secret: String,
    /// Show the current game in Discord via Rich Presence.
    pub discord_rich_presence: bool,
    /// Discord application id for Rich Presence (empty = disabled even if the
    /// toggle is on). The app's art assets live under this application.
    pub discord_app_id: String,
}

impl Default for General {
    fn default() -> Self {
        General {
            library_path: String::new(),
            close_to_tray: true,
            launch_minimized: false,
            confirm_on_exit: false,
            download_limit_kbps: 0,
            concurrent_downloads: 3,
            theme: "dark".to_string(),
            igdb_client_id: String::new(),
            igdb_client_secret: String::new(),
            discord_rich_presence: false,
            discord_app_id: String::new(),
        }
    }
}
