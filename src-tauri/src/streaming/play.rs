//! Pure core for engine-driven playback (`client.start` over the stream-engine IPC).
//!
//! IO-free, KAT-tested half of the live-stream path, mirroring the rest of the
//! streaming subsystem (`engine` owns the wire protocol; `moonlight` owns the
//! external-client argv). This module owns two small, drift-prone decisions:
//!
//!   * **the `client.start` params shape** — the engine's settings object
//!     (`{width,height,fps,bitrateKbps,displayMode,hdr}`) must match the engine's
//!     `validate_stream_settings` contract exactly; a KAT pins the field names so
//!     a rename on either side is caught at test time, not in a dead stream; and
//!   * **which `stream.state` phases are terminal** — the transport tears the
//!     session down (and the UI returns to idle) on `ended`/`error`.
//!
//! The thin transport that spawns the engine, holds the live connection, and
//! forwards events to the webview lives in [`engine_session`](super::engine_session).

use crate::streaming::moonlight::StreamSettings;
use serde_json::{json, Value};

/// Tauri event carrying one raw `stream.state` payload (`{phase, reason?,
/// nativeWindow?}`) to the webview. The frontend parses it with its own tested
/// core, matching the social subsystem's raw-frame-forwarding pattern.
pub const STREAM_STATE_EVENT: &str = "stream://state";
/// Tauri event carrying one raw `stream.stats` payload (fps/bitrate/rtt/…).
pub const STREAM_STATS_EVENT: &str = "stream://stats";

/// Build the engine `client.start` params for `app` on `host` with `settings`.
///
/// `settings` is sanitized first (same clamp the external-Moonlight path uses) so
/// an out-of-range config can't trip the engine's `bad_params` validation. The
/// serialized [`StreamSettings`] already matches the engine's settings schema
/// field-for-field (camelCase: `width,height,fps,bitrateKbps,displayMode,hdr`),
/// so it passes straight through. `embed` selects the engine's reparent path
/// (`true` → hidden child window for the launcher to host; `false` → the engine
/// shows its own borderless window).
pub fn client_start_params(host: &str, app: &str, settings: &StreamSettings, embed: bool) -> Value {
    json!({
        "host": host.trim(),
        "app": app.trim(),
        "settings": settings.sanitized(),
        "embedWindow": embed,
    })
}

/// Whether a `stream.state` phase means the session is over (the transport stops
/// reaping the engine and the UI returns to idle). Unknown phases are treated as
/// non-terminal so a future intermediate phase doesn't end a live stream early.
pub fn is_terminal_phase(phase: &str) -> bool {
    matches!(phase, "ended" | "error")
}

/// The `phase` field of a `stream.state` payload, or `""` if absent/non-string.
pub fn state_phase(data: &Value) -> &str {
    data.get("phase").and_then(Value::as_str).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::moonlight::DisplayMode;

    #[test]
    fn start_params_match_engine_settings_schema() {
        let settings = StreamSettings {
            width: 2560,
            height: 1440,
            fps: 120,
            bitrate_kbps: 50000,
            display_mode: DisplayMode::Borderless,
            hdr: true,
        };
        let p = client_start_params("  10.0.0.5 ", "  Halo Infinite ", &settings, false);

        assert_eq!(p["host"], "10.0.0.5"); // trimmed
        assert_eq!(p["app"], "Halo Infinite"); // trimmed
        assert_eq!(p["embedWindow"], false);
        // The settings object's field names are the engine contract — pin them.
        let s = &p["settings"];
        assert_eq!(s["width"], 2560);
        assert_eq!(s["height"], 1440);
        assert_eq!(s["fps"], 120);
        assert_eq!(s["bitrateKbps"], 50000);
        assert_eq!(s["displayMode"], "borderless");
        assert_eq!(s["hdr"], true);
    }

    #[test]
    fn start_params_sanitize_out_of_range() {
        // A 0-width / absurd config is clamped to the engine's accepted bounds.
        let bad = StreamSettings {
            width: 0,
            height: 99999,
            fps: 5,
            bitrate_kbps: 10,
            display_mode: DisplayMode::Fullscreen,
            hdr: false,
        };
        let p = client_start_params("host", "Doom", &bad, true);
        assert_eq!(p["settings"]["width"], 640);
        assert_eq!(p["settings"]["height"], 4320);
        assert_eq!(p["settings"]["fps"], 30);
        assert_eq!(p["settings"]["bitrateKbps"], 500);
        assert_eq!(p["embedWindow"], true);
    }

    #[test]
    fn start_params_default_settings() {
        let p = client_start_params("h", "1", &StreamSettings::default(), false);
        assert_eq!(p["settings"]["displayMode"], "fullscreen");
        assert_eq!(p["app"], "1"); // numeric appid passes through untouched
    }

    #[test]
    fn terminal_phases() {
        assert!(is_terminal_phase("ended"));
        assert!(is_terminal_phase("error"));
        assert!(!is_terminal_phase("connecting"));
        assert!(!is_terminal_phase("streaming"));
        assert!(!is_terminal_phase("window"));
        assert!(!is_terminal_phase("paused"));
        // A phase we don't model must not be treated as terminal.
        assert!(!is_terminal_phase("buffering"));
    }

    #[test]
    fn phase_extraction() {
        assert_eq!(state_phase(&json!({ "phase": "streaming" })), "streaming");
        assert_eq!(state_phase(&json!({ "reason": "x" })), "");
        assert_eq!(state_phase(&json!({ "phase": 7 })), "");
        assert_eq!(state_phase(&Value::Null), "");
    }
}
