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
    /// Show the current game in Discord via Rich Presence. The Discord
    /// application id itself comes from the server (/api/client-config).
    pub discord_rich_presence: bool,
    /// Register a global hotkey that summons/hides the launcher window.
    pub global_hotkey_enabled: bool,
    /// The accelerator for that hotkey (e.g. "Ctrl+Shift+G").
    pub global_hotkey: String,
    /// Enable controller/gamepad navigation of the UI.
    pub controller_enabled: bool,
    /// Left-stick dead zone in [0,1]; deflection past this counts as a
    /// directional press. Mirrors the JS `STICK_THRESHOLD` default (0.6).
    pub controller_dead_zone: f32,
    /// SteamGridDB API key for the cover-art picker (user-supplied; empty
    /// disables the feature). https://www.steamgriddb.com/profile/preferences/api
    pub steamgriddb_api_key: String,
    /// RetroAchievements username for the RA progress panel (empty disables it).
    pub retroachievements_username: String,
    /// RetroAchievements Web API key (user-supplied). https://retroachievements.org/settings
    pub retroachievements_api_key: String,
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
            discord_rich_presence: false,
            global_hotkey_enabled: false,
            global_hotkey: crate::hotkey::shortcut::DEFAULT_SHORTCUT.to_string(),
            controller_enabled: true,
            controller_dead_zone: 0.6,
            steamgriddb_api_key: String::new(),
            retroachievements_username: String::new(),
            retroachievements_api_key: String::new(),
        }
    }
}
