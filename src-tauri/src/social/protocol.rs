//! Social gateway wire protocol. Inbound frames are parsed into the `Inbound`
//! enum (tagged by the `type` field); outbound frames are built by the helpers
//! below. The shapes mirror the C++ `SocialManager::HandleGatewayFrame` and its
//! `SendGatewayJson` callers exactly so both clients speak to the same gateway.
//!
//! Unknown frame types deserialize to `Inbound::Unknown` rather than failing, so
//! a newer server can add frames without breaking older clients.

use serde::Deserialize;
use serde_json::json;

/// A parsed inbound gateway frame. Fields default when absent so partial frames
/// from a future server still parse.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Inbound {
    /// Handshake: the server tells us our own account id.
    #[serde(rename_all = "camelCase")]
    Hello { self_id: u64 },
    /// Heartbeat reply to our `{"type":"ping"}`.
    Pong,
    /// A friend's presence changed.
    #[serde(rename_all = "camelCase")]
    Presence {
        user_id: u64,
        #[serde(default)]
        state: String,
        #[serde(default)]
        game_id: String,
        #[serde(default)]
        game_title: String,
    },
    /// Peer is typing toward us.
    #[serde(rename_all = "camelCase")]
    Typing {
        #[serde(rename = "fromId")]
        from_id: u64,
    },
    /// A direct message (live or our own echoed back acked).
    #[serde(rename_all = "camelCase")]
    Chat {
        message_id: u64,
        sender_id: u64,
        receiver_id: u64,
        #[serde(default)]
        text: String,
        #[serde(default)]
        attachment_id: u64,
        #[serde(default)]
        reply_to: u64,
        #[serde(default)]
        timestamp: i64,
    },
    /// Peer read my outgoing messages up to `up_to_id`.
    #[serde(rename_all = "camelCase")]
    Read { reader_id: u64, up_to_id: u64 },
    /// A message's text was edited.
    #[serde(rename_all = "camelCase")]
    ChatEdit {
        message_id: u64,
        #[serde(default)]
        text: String,
        #[serde(default)]
        edited_at: i64,
    },
    /// A message was deleted (tombstone).
    #[serde(rename_all = "camelCase")]
    ChatDelete { message_id: u64 },
    /// A reaction was toggled on a message.
    #[serde(rename_all = "camelCase")]
    Reaction {
        message_id: u64,
        user_id: u64,
        #[serde(default)]
        emoji: String,
        #[serde(default)]
        on: bool,
    },
    /// A relationship changed; the client should re-pull `/api/social/friends`.
    /// Covers `friend_request`, `friend_accepted`, `friend_removed`.
    #[serde(rename = "friend_request")]
    FriendRequest {
        #[serde(default, rename = "userId")]
        user_id: u64,
    },
    #[serde(rename = "friend_accepted")]
    FriendAccepted {
        #[serde(default, rename = "userId")]
        user_id: u64,
    },
    #[serde(rename = "friend_removed")]
    FriendRemoved {
        #[serde(default, rename = "userId")]
        user_id: u64,
    },
    /// Any frame type we don't model yet (e.g. voice_signal — that's T4).
    #[serde(other)]
    Unknown,
}

impl Inbound {
    /// Parse one UTF-8 text frame. Returns `None` for malformed JSON.
    pub fn parse(utf8: &str) -> Option<Inbound> {
        serde_json::from_str(utf8).ok()
    }
}

/// Helpers that build the exact outbound frames the gateway expects. Each
/// returns a compact JSON string ready for the socket. Mirrors the C++
/// `os << "{\"type\":...}"` builders.
pub mod outbound {
    use super::*;

    pub fn ping() -> String {
        json!({ "type": "ping" }).to_string()
    }

    /// Resume after reconnect: ask for messages after the last id we saw.
    pub fn resume(after_msg_id: u64) -> String {
        json!({ "type": "resume", "afterMsgId": after_msg_id }).to_string()
    }

    pub fn presence(state: &str) -> String {
        json!({ "type": "presence", "state": state }).to_string()
    }

    pub fn presence_ingame(game_id: &str) -> String {
        json!({ "type": "presence", "state": "ingame", "gameId": game_id }).to_string()
    }

    pub fn chat(to: u64, text: &str, reply_to: u64) -> String {
        if reply_to > 0 {
            json!({ "type": "chat", "to": to, "text": text, "replyTo": reply_to }).to_string()
        } else {
            json!({ "type": "chat", "to": to, "text": text }).to_string()
        }
    }

    pub fn typing(to: u64) -> String {
        json!({ "type": "typing", "to": to }).to_string()
    }

    pub fn read(to: u64) -> String {
        json!({ "type": "read", "to": to }).to_string()
    }

    pub fn edit(msg_id: u64, text: &str) -> String {
        json!({ "type": "edit", "msgId": msg_id, "text": text }).to_string()
    }

    pub fn delete(msg_id: u64) -> String {
        json!({ "type": "delete", "msgId": msg_id }).to_string()
    }

    pub fn react(msg_id: u64, emoji: &str, on: bool) -> String {
        json!({ "type": "react", "msgId": msg_id, "emoji": emoji, "on": on }).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hello() {
        assert_eq!(
            Inbound::parse(r#"{"type":"hello","selfId":42}"#),
            Some(Inbound::Hello { self_id: 42 })
        );
    }

    #[test]
    fn parses_chat_frame() {
        let f = r#"{"type":"chat","messageId":7,"senderId":2,"receiverId":42,"text":"hi","attachmentId":0,"replyTo":3,"timestamp":1700000000}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::Chat {
                message_id: 7,
                sender_id: 2,
                receiver_id: 42,
                text: "hi".into(),
                attachment_id: 0,
                reply_to: 3,
                timestamp: 1700000000,
            })
        );
    }

    #[test]
    fn parses_presence_with_game() {
        let f = r#"{"type":"presence","userId":3,"state":"ingame","gameId":"g1","gameTitle":"Crystalis"}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::Presence {
                user_id: 3,
                state: "ingame".into(),
                game_id: "g1".into(),
                game_title: "Crystalis".into(),
            })
        );
    }

    #[test]
    fn parses_typing_from_id() {
        assert_eq!(
            Inbound::parse(r#"{"type":"typing","fromId":9}"#),
            Some(Inbound::Typing { from_id: 9 })
        );
    }

    #[test]
    fn parses_read_receipt() {
        assert_eq!(
            Inbound::parse(r#"{"type":"read","readerId":2,"upToId":11}"#),
            Some(Inbound::Read { reader_id: 2, up_to_id: 11 })
        );
    }

    #[test]
    fn parses_reaction() {
        assert_eq!(
            Inbound::parse(r#"{"type":"reaction","messageId":7,"userId":2,"emoji":"👍","on":true}"#),
            Some(Inbound::Reaction {
                message_id: 7,
                user_id: 2,
                emoji: "👍".into(),
                on: true,
            })
        );
    }

    #[test]
    fn friend_events_map_to_refresh_variants() {
        assert_eq!(
            Inbound::parse(r#"{"type":"friend_request","userId":5}"#),
            Some(Inbound::FriendRequest { user_id: 5 })
        );
        assert_eq!(
            Inbound::parse(r#"{"type":"friend_removed"}"#),
            Some(Inbound::FriendRemoved { user_id: 0 })
        );
    }

    #[test]
    fn unknown_type_is_tolerated() {
        assert_eq!(
            Inbound::parse(r#"{"type":"voice_signal","to":1,"sdp":"…"}"#),
            Some(Inbound::Unknown)
        );
    }

    #[test]
    fn malformed_json_is_none() {
        assert!(Inbound::parse("{not json").is_none());
    }

    #[test]
    fn outbound_shapes_match_cpp() {
        assert_eq!(outbound::ping(), r#"{"type":"ping"}"#);
        assert_eq!(outbound::chat(42, "hi", 0), r#"{"text":"hi","to":42,"type":"chat"}"#);
        assert_eq!(outbound::chat(42, "hi", 3), r#"{"replyTo":3,"text":"hi","to":42,"type":"chat"}"#);
        assert_eq!(outbound::typing(42), r#"{"to":42,"type":"typing"}"#);
        assert_eq!(outbound::read(42), r#"{"to":42,"type":"read"}"#);
        assert_eq!(outbound::react(7, "👍", true), r#"{"emoji":"👍","msgId":7,"on":true,"type":"react"}"#);
        assert_eq!(outbound::presence("away"), r#"{"state":"away","type":"presence"}"#);
    }
}
