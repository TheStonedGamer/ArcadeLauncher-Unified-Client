//! Stream quality/presentation settings (the IO-free, KAT-tested core).
//!
//! These types are the launcher-side mirror of the Settings → Streaming fields and
//! are passed straight through to the stream engine's `client.start`
//! (`{width,height,fps,bitrateKbps,displayMode,hdr}` — camelCase matches the
//! engine's `validate_stream_settings` contract). Playback runs entirely through
//! the bundled engine; there is no external client to shape an argv for, so this
//! module owns only the settings shape + its clamps.

use serde::{Deserialize, Serialize};

/// How the engine presents the stream window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DisplayMode {
    #[default]
    Fullscreen,
    Borderless,
    Windowed,
}

/// Stream quality/presentation settings. Mirrors the Settings → Streaming fields.
/// Defaults are a safe 1080p60 @ 20 Mbps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub display_mode: DisplayMode,
    pub hdr: bool,
}

impl Default for StreamSettings {
    fn default() -> Self {
        StreamSettings {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20000,
            display_mode: DisplayMode::Fullscreen,
            hdr: false,
        }
    }
}

impl StreamSettings {
    /// Clamp nonsensical values to sane bounds so a bad config can't reach the
    /// engine's `bad_params` validation (it would reject e.g. a 0 resolution). Pure.
    pub fn sanitized(&self) -> StreamSettings {
        StreamSettings {
            width: self.width.clamp(640, 7680),
            height: self.height.clamp(480, 4320),
            fps: self.fps.clamp(30, 240),
            bitrate_kbps: self.bitrate_kbps.clamp(500, 150_000),
            display_mode: self.display_mode,
            hdr: self.hdr,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_mode_default_is_fullscreen() {
        assert_eq!(DisplayMode::default(), DisplayMode::Fullscreen);
    }

    #[test]
    fn default_settings_are_1080p60() {
        let d = StreamSettings::default();
        assert_eq!((d.width, d.height, d.fps, d.bitrate_kbps), (1920, 1080, 60, 20000));
        assert_eq!(d.display_mode, DisplayMode::Fullscreen);
        assert!(!d.hdr);
    }

    #[test]
    fn sanitized_clamps_out_of_range() {
        let s = StreamSettings {
            width: 0,
            height: 99999,
            fps: 5,
            bitrate_kbps: 10,
            display_mode: DisplayMode::Windowed,
            hdr: true,
        }
        .sanitized();
        assert_eq!(s.width, 640);
        assert_eq!(s.height, 4320);
        assert_eq!(s.fps, 30);
        assert_eq!(s.bitrate_kbps, 500);
        // Non-numeric fields pass through.
        assert_eq!(s.display_mode, DisplayMode::Windowed);
        assert!(s.hdr);
    }
}
