//! Social data model — a UTF-8 mirror of the C++ client's `social::` value
//! types (SocialTypes.h). Identifiers are server account ids (`u64`); all
//! user-facing text is plain `String`. Field names/casing match the gateway
//! wire format and the existing REST payloads so the same backend serves both
//! clients during the migration.

use serde::{Deserialize, Serialize};

/// A friend's live presence, mirroring `social::PresenceState`. The wire form
/// is the lowercase token the server uses; unknown tokens fall back to
/// `Offline` so future server states still parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Offline,
    Online,
    Away,
    Busy,
    Invisible,
    #[serde(rename = "ingame")]
    InGame,
}

impl Default for Presence {
    fn default() -> Self {
        Presence::Offline
    }
}

impl Presence {
    /// Parse a wire token (`"online"`, `"ingame"`, …); unknown → `Offline`.
    pub fn from_wire(s: &str) -> Self {
        match s {
            "online" => Presence::Online,
            "away" => Presence::Away,
            "busy" => Presence::Busy,
            "invisible" => Presence::Invisible,
            "ingame" => Presence::InGame,
            _ => Presence::Offline,
        }
    }

    /// The token the server expects in an outbound `presence` frame. Mirrors
    /// `PresenceWire`: `Offline`/`Invisible` callers normally send `online`,
    /// but we preserve the literal here and let callers decide.
    pub fn to_wire(self) -> &'static str {
        match self {
            Presence::Online => "online",
            Presence::Away => "away",
            Presence::Busy => "busy",
            Presence::Invisible => "invisible",
            Presence::InGame => "ingame",
            Presence::Offline => "offline",
        }
    }
}

/// Relationship state toward a given account, mirroring the server's `relation`
/// string on `/api/social/friends`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Relation {
    None,
    RequestSent,
    RequestReceived,
    Accepted,
    Blocked,
}

impl Default for Relation {
    fn default() -> Self {
        Relation::None
    }
}

impl Relation {
    pub fn from_wire(s: &str) -> Self {
        match s {
            "accepted" => Relation::Accepted,
            "request_sent" => Relation::RequestSent,
            "request_received" => Relation::RequestReceived,
            "blocked" => Relation::Blocked,
            _ => Relation::None,
        }
    }
}

/// One friend / relationship row. Mirrors `social::FriendInfo` minus the
/// client-local prefs (favorite/nickname), which the frontend owns.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Friend {
    pub account_id: u64,
    pub username: String,
    pub presence: Presence,
    pub relation: Relation,
    pub current_game_id: String,
    pub current_game_title: String,
    pub last_online: i64,
}

/// A direct message, mirroring `social::ChatMessage`. `pending` marks a locally
/// echoed message not yet acked by the gateway; the inbound `chat` frame
/// resolves it (see the reducer).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessage {
    pub message_id: u64,
    pub sender_id: u64,
    pub receiver_id: u64,
    pub text: String,
    pub timestamp: i64,
    pub is_read: bool,
    pub pending: bool,
    pub edited_at: i64,
    pub deleted: bool,
    pub attachment_id: u64,
    pub attachment_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_round_trips_known_tokens() {
        for tok in ["online", "away", "busy", "invisible", "ingame"] {
            assert_eq!(Presence::from_wire(tok).to_wire(), tok);
        }
    }

    #[test]
    fn presence_unknown_is_offline() {
        assert_eq!(Presence::from_wire("nonsense"), Presence::Offline);
    }

    #[test]
    fn relation_parses_server_tokens() {
        assert_eq!(Relation::from_wire("accepted"), Relation::Accepted);
        assert_eq!(Relation::from_wire("request_received"), Relation::RequestReceived);
        assert_eq!(Relation::from_wire("blocked"), Relation::Blocked);
        assert_eq!(Relation::from_wire("???"), Relation::None);
    }
}
