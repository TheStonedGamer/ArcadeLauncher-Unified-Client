//! Pure Discord Rich Presence activity model. OS/IO-free so it is exhaustively
//! unit-tested: given a now-playing state it produces exactly the strings and
//! timestamps Discord shows ("Playing X", "for 12:34", large-image key). The
//! thin `client` glue maps these onto the `discord-rich-presence` IPC payload.
//!
//! Mirrors the C++ client's Discord presence so both launchers look identical in
//! a user's Discord status.

/// What the launcher is currently doing, from the launch session's point of view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresenceState {
    /// No game running — show the idle "Browsing the library" line.
    Idle,
    /// A game is running, started at `started_unix` (seconds since epoch).
    Playing { title: String, started_unix: i64 },
}

/// A fully-resolved activity ready to hand to the IPC layer. Every field is the
/// final user-visible value; the glue does no further formatting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activity {
    /// Top line in Discord (e.g. "Playing Crystalis" or "Browsing the library").
    pub details: String,
    /// Second line (e.g. "In the launcher").
    pub state: String,
    /// Unix start timestamp for the elapsed-time counter, or `None` when idle.
    pub start_timestamp: Option<i64>,
    /// Large-image asset key uploaded to the Discord app's art assets.
    pub large_image: &'static str,
    /// Hover text for the large image.
    pub large_text: String,
}

/// Asset key for the launcher logo uploaded to the Discord application.
pub const LOGO_ASSET: &str = "arcade_logo";
/// Shown while idle.
pub const IDLE_DETAILS: &str = "Browsing the library";
/// Second line while idle.
pub const IDLE_STATE: &str = "In the launcher";

/// Collapse internal whitespace and trim, so a noisy title can't break layout.
fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Build the resolved [`Activity`] for a presence state. Pure — no clock, no IO.
pub fn build(state: &PresenceState) -> Activity {
    match state {
        PresenceState::Idle => Activity {
            details: IDLE_DETAILS.to_string(),
            state: IDLE_STATE.to_string(),
            start_timestamp: None,
            large_image: LOGO_ASSET,
            large_text: "ArcadeLauncher".to_string(),
        },
        PresenceState::Playing { title, started_unix } => {
            let title = clean(title);
            let shown = if title.is_empty() { "a game".to_string() } else { title.clone() };
            Activity {
                details: format!("Playing {shown}"),
                state: "In the launcher".to_string(),
                // A non-positive timestamp would make Discord show a bogus
                // counter, so drop it rather than send garbage.
                start_timestamp: (*started_unix > 0).then_some(*started_unix),
                large_image: LOGO_ASSET,
                large_text: if title.is_empty() {
                    "ArcadeLauncher".to_string()
                } else {
                    title
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_shows_browsing_line_with_no_timestamp() {
        let a = build(&PresenceState::Idle);
        assert_eq!(a.details, "Browsing the library");
        assert_eq!(a.state, "In the launcher");
        assert_eq!(a.start_timestamp, None);
        assert_eq!(a.large_image, LOGO_ASSET);
        assert_eq!(a.large_text, "ArcadeLauncher");
    }

    #[test]
    fn playing_formats_title_and_keeps_timestamp() {
        let a = build(&PresenceState::Playing {
            title: "Crystalis".to_string(),
            started_unix: 1_700_000_000,
        });
        assert_eq!(a.details, "Playing Crystalis");
        assert_eq!(a.start_timestamp, Some(1_700_000_000));
        assert_eq!(a.large_text, "Crystalis");
    }

    #[test]
    fn title_whitespace_is_collapsed() {
        let a = build(&PresenceState::Playing {
            title: "  Halo   Combat  Evolved  ".to_string(),
            started_unix: 1,
        });
        assert_eq!(a.details, "Playing Halo Combat Evolved");
        assert_eq!(a.large_text, "Halo Combat Evolved");
    }

    #[test]
    fn empty_title_falls_back_to_generic() {
        let a = build(&PresenceState::Playing { title: "   ".to_string(), started_unix: 5 });
        assert_eq!(a.details, "Playing a game");
        assert_eq!(a.large_text, "ArcadeLauncher");
        assert_eq!(a.start_timestamp, Some(5));
    }

    #[test]
    fn non_positive_timestamp_is_dropped() {
        let a = build(&PresenceState::Playing { title: "X".to_string(), started_unix: 0 });
        assert_eq!(a.start_timestamp, None);
        let b = build(&PresenceState::Playing { title: "X".to_string(), started_unix: -10 });
        assert_eq!(b.start_timestamp, None);
    }
}
