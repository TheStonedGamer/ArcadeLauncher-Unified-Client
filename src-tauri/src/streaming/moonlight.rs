//! Moonlight client launch (T12k-3, pure half). Builds the `moonlight-qt`
//! command line to start streaming an app from a paired Sunshine host, and lists
//! the executable names to probe per platform. We **shell out** to the upstream
//! Moonlight client (GPL, invoked as a separate process — never linked) rather
//! than reimplement the stream protocol; this module owns only the IO-free
//! argv/exe shaping so it can be KAT-tested. The thin spawn lives in
//! `commands.rs`.
//!
//! Flag choice: the builder uses Moonlight's stable, long-standing CLI flags
//! (`stream <host> <app>`, `--resolution WxH`, `--fps`, `--bitrate`, the
//! `--fullscreen|--windowed|--borderless` window-mode flags, and `--hdr|--no-hdr`).
//! Resolution/fps/bitrate carry the user's Streaming-settings defaults.

use serde::{Deserialize, Serialize};

/// How Moonlight presents the stream window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DisplayMode {
    #[default]
    Fullscreen,
    Borderless,
    Windowed,
}

impl DisplayMode {
    /// The Moonlight CLI flag for this mode.
    pub fn flag(self) -> &'static str {
        match self {
            DisplayMode::Fullscreen => "--fullscreen",
            DisplayMode::Borderless => "--borderless",
            DisplayMode::Windowed => "--windowed",
        }
    }
}

/// Stream quality/presentation settings, passed through to Moonlight. Mirrors
/// the Settings → Streaming fields. Defaults are a safe 1080p60 @ 20 Mbps.
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
    /// Clamp nonsensical values to sane bounds so a bad config can't produce a
    /// broken command line (Moonlight would reject e.g. a 0 resolution). Pure.
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

/// Executable names to probe for the Moonlight client, in preference order, for
/// the current platform. Windows installs `Moonlight.exe`; Linux/macOS builds
/// expose `moonlight-qt` and/or the `moonlight` shim.
pub fn executable_candidates() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["Moonlight.exe", "moonlight.exe"]
    }
    #[cfg(not(windows))]
    {
        &["moonlight-qt", "moonlight"]
    }
}

/// Build the `moonlight stream …` argument vector for `app` on `host` with
/// `settings`. `host` is the bare address (Moonlight resolves the ports itself).
/// Values are sanitized first so the argv is always well-formed.
pub fn stream_args(host: &str, app: &str, settings: &StreamSettings) -> Vec<String> {
    let s = settings.sanitized();
    let mut args = vec![
        "stream".to_string(),
        host.trim().to_string(),
        app.trim().to_string(),
        "--resolution".to_string(),
        format!("{}x{}", s.width, s.height),
        "--fps".to_string(),
        s.fps.to_string(),
        "--bitrate".to_string(),
        s.bitrate_kbps.to_string(),
        s.display_mode.flag().to_string(),
    ];
    args.push(if s.hdr { "--hdr" } else { "--no-hdr" }.to_string());
    args
}

/// Build the `moonlight pair <host>` argument vector (used when Moonlight, not
/// Sunshine's config API, drives pairing).
pub fn pair_args(host: &str) -> Vec<String> {
    vec!["pair".to_string(), host.trim().to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_mode_flags_and_default() {
        assert_eq!(DisplayMode::default(), DisplayMode::Fullscreen);
        assert_eq!(DisplayMode::Fullscreen.flag(), "--fullscreen");
        assert_eq!(DisplayMode::Borderless.flag(), "--borderless");
        assert_eq!(DisplayMode::Windowed.flag(), "--windowed");
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

    #[test]
    fn stream_args_builds_expected_argv() {
        let args = stream_args("  10.0.0.5 ", "  Halo Infinite ", &StreamSettings::default());
        assert_eq!(
            args,
            vec![
                "stream",
                "10.0.0.5",
                "Halo Infinite",
                "--resolution",
                "1920x1080",
                "--fps",
                "60",
                "--bitrate",
                "20000",
                "--fullscreen",
                "--no-hdr",
            ]
        );
    }

    #[test]
    fn stream_args_reflects_settings_and_hdr() {
        let settings = StreamSettings {
            width: 2560,
            height: 1440,
            fps: 120,
            bitrate_kbps: 50000,
            display_mode: DisplayMode::Borderless,
            hdr: true,
        };
        let args = stream_args("host", "Doom", &settings);
        assert!(args.contains(&"2560x1440".to_string()));
        assert!(args.contains(&"120".to_string()));
        assert!(args.contains(&"50000".to_string()));
        assert!(args.contains(&"--borderless".to_string()));
        assert!(args.contains(&"--hdr".to_string()));
        assert!(!args.contains(&"--no-hdr".to_string()));
    }

    #[test]
    fn pair_args_shape() {
        assert_eq!(pair_args("  box.local "), vec!["pair", "box.local"]);
    }

    #[test]
    fn executable_candidates_nonempty() {
        assert!(!executable_candidates().is_empty());
    }
}
