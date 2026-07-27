//! General settings model. `#[serde(default)]` makes every field optional on
//! disk, so loading an old/partial config.json fills the rest from defaults
//! instead of failing — the non-destructive contract the C++ client also keeps.

use serde::{Deserialize, Serialize};

/// Per-device cloud-save auto-sync preferences (T12i). Pulled before launch,
/// snapshotted + pushed on exit. Mirrors the TS `AutoSyncSettings` in
/// `src/features/saves/saves.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutoSync {
    /// Pull the latest cloud save before a game launches.
    pub sync_on_launch: bool,
    /// Snapshot + push the local save when a game exits.
    pub sync_on_exit: bool,
    /// How many restorable versions to keep per game (clamped [1,100] by Rust).
    pub keep_versions: u32,
}

impl Default for AutoSync {
    fn default() -> Self {
        AutoSync { sync_on_launch: true, sync_on_exit: true, keep_versions: 10 }
    }
}

/// Microphone processing for voice/video calls. The browser applies these
/// inside the capture pipeline, before encoding. Mirrors the TS
/// `VoiceAudioSettings` in `src/features/social/audio.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceAudio {
    /// Remove the far end's voice leaking back through the speakers.
    pub echo_cancellation: bool,
    /// Suppress steady background noise — fans, keyboards, hum.
    pub noise_suppression: bool,
    /// Even out the input level.
    pub auto_gain_control: bool,
}

impl Default for VoiceAudio {
    /// All on, matching what browsers do by default for a call.
    fn default() -> Self {
        VoiceAudio { echo_cancellation: true, noise_suppression: true, auto_gain_control: true }
    }
}

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
    /// Tenor v2 API key for the chat GIF picker (user-supplied; empty disables
    /// GIF search). https://developers.google.com/tenor/guides/quickstart
    #[serde(default)]
    pub tenor_api_key: String,
    /// RetroAchievements username for the RA progress panel (empty disables it).
    pub retroachievements_username: String,
    /// RetroAchievements Web API key (user-supplied). https://retroachievements.org/settings
    pub retroachievements_api_key: String,
    /// Cloud-save auto-sync preferences (pull-on-launch / push-on-exit).
    pub auto_sync: AutoSync,
    /// Microphone processing for voice/video calls.
    pub voice_audio: VoiceAudio,
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
            tenor_api_key: String::new(),
            retroachievements_username: String::new(),
            retroachievements_api_key: String::new(),
            auto_sync: AutoSync::default(),
            voice_audio: VoiceAudio::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_predating_voice_audio_loads_with_processing_on() {
        // The non-destructive contract: an older config.json has no voiceAudio
        // key at all, and must come back with the defaults rather than failing
        // to parse or silently disabling noise suppression.
        let g: General = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(g.voice_audio, VoiceAudio::default());
        assert!(g.voice_audio.noise_suppression);
    }

    #[test]
    fn a_disabled_flag_survives_a_round_trip() {
        let mut g = General::default();
        g.voice_audio.noise_suppression = false;
        let back: General = serde_json::from_str(&serde_json::to_string(&g).unwrap()).unwrap();
        assert!(!back.voice_audio.noise_suppression);
        assert!(back.voice_audio.echo_cancellation);
    }

    #[test]
    fn voice_audio_is_camel_case_on_the_wire() {
        // The TS mirror reads these keys verbatim.
        let json = serde_json::to_string(&VoiceAudio::default()).unwrap();
        assert!(json.contains("noiseSuppression"), "{json}");
        assert!(json.contains("echoCancellation"), "{json}");
        assert!(json.contains("autoGainControl"), "{json}");
    }
}
