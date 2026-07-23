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
    /// A friend invited us to join their game (T12d). `invite_id` identifies the
    /// invite for accept/decline; `game_id`/`game_title` say what to launch/join.
    #[serde(rename = "game_invite", rename_all = "camelCase")]
    GameInvite {
        #[serde(default)]
        invite_id: u64,
        #[serde(default)]
        from_id: u64,
        #[serde(default)]
        game_id: String,
        #[serde(default)]
        game_title: String,
        #[serde(default)]
        timestamp: i64,
    },
    /// A previously-sent game invite was cancelled or expired server-side.
    #[serde(rename = "game_invite_cancel", rename_all = "camelCase")]
    GameInviteCancel {
        #[serde(default)]
        invite_id: u64,
    },
    /// A group room/channel we belong to now exists or its full roster was
    /// (re)sent (T12f). `members` is the complete membership snapshot.
    #[serde(rename = "room_created", rename_all = "camelCase")]
    RoomCreated {
        #[serde(default)]
        room_id: u64,
        #[serde(default)]
        name: String,
        #[serde(default)]
        owner_id: u64,
        #[serde(default)]
        members: Vec<u64>,
    },
    /// A room was renamed.
    #[serde(rename = "room_renamed", rename_all = "camelCase")]
    RoomRenamed {
        #[serde(default)]
        room_id: u64,
        #[serde(default)]
        name: String,
    },
    /// Someone joined a room we're in (or we were added to it).
    #[serde(rename = "room_member_added", rename_all = "camelCase")]
    RoomMemberAdded {
        #[serde(default)]
        room_id: u64,
        #[serde(default)]
        user_id: u64,
    },
    /// Someone left/was removed from a room (if `user_id` is us, we left it).
    #[serde(rename = "room_member_removed", rename_all = "camelCase")]
    RoomMemberRemoved {
        #[serde(default)]
        room_id: u64,
        #[serde(default)]
        user_id: u64,
    },
    /// A room was deleted server-side.
    #[serde(rename = "room_deleted", rename_all = "camelCase")]
    RoomDeleted {
        #[serde(default)]
        room_id: u64,
    },
    /// A chat message posted to a room we're in (T12f-2).
    #[serde(rename = "room_message", rename_all = "camelCase")]
    RoomMessage {
        #[serde(default)]
        room_id: u64,
        #[serde(default)]
        message_id: u64,
        #[serde(default)]
        sender_id: u64,
        #[serde(default)]
        text: String,
        #[serde(default)]
        timestamp: u64,
    },
    /// The phone asked this PC to install a game (0.14). `from_device_id` is
    /// the phone that sent it, kept so the result can name who asked.
    #[serde(rename = "remote_install", rename_all = "camelCase")]
    RemoteInstall {
        #[serde(default)]
        game_id: String,
        #[serde(default)]
        game_title: String,
        #[serde(default)]
        from_device_id: String,
    },
    /// The devices currently signed in on this account. The desktop mostly
    /// ignores this (it is the phone's picker), but parsing it keeps the frame
    /// out of `Unknown` and makes the list available for a future settings pane.
    #[serde(rename = "devices")]
    Devices {
        #[serde(default)]
        devices: Vec<DeviceEntry>,
    },
    /// A sign-in on some machine is waiting on approval. Delivered only to
    /// phones by the server, so a desktop seeing one is a server-side change:
    /// it is parsed rather than dropped so the UI can decide what to do.
    #[serde(rename = "guard_request", rename_all = "camelCase")]
    GuardRequest {
        #[serde(default)]
        request_id: String,
        #[serde(default)]
        prompt: String,
        #[serde(default)]
        device_name: String,
        #[serde(default)]
        ip: String,
        #[serde(default)]
        expires_in: u64,
    },
    /// Any frame type we don't model yet (e.g. voice_signal — that's T4).
    #[serde(other)]
    Unknown,
}

/// One machine signed in on this account, as the gateway reports it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DeviceEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub version: String,
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

    pub fn chat(to: u64, text: &str, reply_to: u64, attachment_id: u64) -> String {
        let mut v = json!({ "type": "chat", "to": to, "text": text });
        if reply_to > 0 {
            v["replyTo"] = json!(reply_to);
        }
        if attachment_id > 0 {
            v["attachmentId"] = json!(attachment_id);
        }
        v.to_string()
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

    /// Invite a friend to join the game we're playing (T12d).
    pub fn game_invite(to: u64, game_id: &str) -> String {
        json!({ "type": "game_invite", "to": to, "gameId": game_id }).to_string()
    }

    /// Accept or decline a received game invite.
    pub fn game_invite_respond(invite_id: u64, accept: bool) -> String {
        json!({ "type": "game_invite_respond", "inviteId": invite_id, "accept": accept }).to_string()
    }

    /// Create a group room/channel with an initial member set (T12f).
    pub fn room_create(name: &str, members: &[u64]) -> String {
        json!({ "type": "room_create", "name": name, "members": members }).to_string()
    }

    /// Rename a room we own.
    pub fn room_rename(room_id: u64, name: &str) -> String {
        json!({ "type": "room_rename", "roomId": room_id, "name": name }).to_string()
    }

    /// Add a friend to a room.
    pub fn room_add_member(room_id: u64, user_id: u64) -> String {
        json!({ "type": "room_add_member", "roomId": room_id, "userId": user_id }).to_string()
    }

    /// Leave a room we're in.
    pub fn room_leave(room_id: u64) -> String {
        json!({ "type": "room_leave", "roomId": room_id }).to_string()
    }

    /// Ask the gateway for the account's currently signed-in devices (0.14).
    pub fn devices() -> String {
        json!({ "type": "devices" }).to_string()
    }

    /// Ask another of our own machines to install a game.
    pub fn remote_install(device_id: &str, game_id: &str, game_title: &str) -> String {
        json!({
            "type": "remote_install",
            "deviceId": device_id,
            "gameId": game_id,
            "gameTitle": game_title,
        })
        .to_string()
    }

    /// Report back what happened to a remote install we were asked to run.
    /// `status` is one of started / done / failed; `message` is shown verbatim
    /// on the phone, so it carries the real error rather than a code.
    pub fn remote_install_result(game_id: &str, status: &str, message: &str) -> String {
        json!({
            "type": "remote_install_result",
            "gameId": game_id,
            "status": status,
            "message": message,
        })
        .to_string()
    }

    /// Answer a sign-in approval push: "approve" or "deny".
    pub fn guard_decision(request_id: &str, action: &str) -> String {
        json!({ "type": "guard_decision", "requestId": request_id, "action": action }).to_string()
    }

    /// Post a chat message to a room (T12f-2).
    pub fn room_chat(room_id: u64, text: &str) -> String {
        json!({ "type": "room_chat", "roomId": room_id, "text": text }).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_remote_install_command() {
        assert_eq!(
            Inbound::parse(
                r#"{"type":"remote_install","gameId":"g-7","gameTitle":"Doom","fromDeviceId":"phone-1"}"#
            ),
            Some(Inbound::RemoteInstall {
                game_id: "g-7".into(),
                game_title: "Doom".into(),
                from_device_id: "phone-1".into(),
            })
        );
    }

    #[test]
    fn a_remote_install_without_a_title_still_parses() {
        // The gateway relays whatever the phone sent; a title is cosmetic and a
        // missing one must not cost us the install.
        assert_eq!(
            Inbound::parse(r#"{"type":"remote_install","gameId":"g-7"}"#),
            Some(Inbound::RemoteInstall {
                game_id: "g-7".into(),
                game_title: String::new(),
                from_device_id: String::new(),
            })
        );
    }

    #[test]
    fn parses_the_device_list() {
        let f = r#"{"type":"devices","devices":[{"id":"pc-1","name":"Living Room PC","kind":"desktop","version":"0.14.0"}]}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::Devices {
                devices: vec![DeviceEntry {
                    id: "pc-1".into(),
                    name: "Living Room PC".into(),
                    kind: "desktop".into(),
                    version: "0.14.0".into(),
                }]
            })
        );
    }

    #[test]
    fn an_empty_device_list_is_not_an_error() {
        assert_eq!(
            Inbound::parse(r#"{"type":"devices","devices":[]}"#),
            Some(Inbound::Devices { devices: vec![] })
        );
    }

    #[test]
    fn parses_a_sign_in_approval_push() {
        let f = r#"{"type":"guard_request","requestId":"r1","prompt":"PC is trying to sign in from 10.0.0.5.","deviceName":"PC","ip":"10.0.0.5","expiresIn":120}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::GuardRequest {
                request_id: "r1".into(),
                prompt: "PC is trying to sign in from 10.0.0.5.".into(),
                device_name: "PC".into(),
                ip: "10.0.0.5".into(),
                expires_in: 120,
            })
        );
    }

    #[test]
    fn builds_the_new_outbound_frames() {
        assert_eq!(outbound::devices(), r#"{"type":"devices"}"#);
        assert_eq!(
            outbound::remote_install("pc-1", "g-7", "Doom"),
            r#"{"deviceId":"pc-1","gameId":"g-7","gameTitle":"Doom","type":"remote_install"}"#
        );
        assert_eq!(
            outbound::remote_install_result("g-7", "failed", "no disk space"),
            r#"{"gameId":"g-7","message":"no disk space","status":"failed","type":"remote_install_result"}"#
        );
        assert_eq!(
            outbound::guard_decision("r1", "approve"),
            r#"{"action":"approve","requestId":"r1","type":"guard_decision"}"#
        );
    }

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
    fn parses_game_invite() {
        let f = r#"{"type":"game_invite","inviteId":7,"fromId":3,"gameId":"g1","gameTitle":"Crystalis","timestamp":1700000000}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::GameInvite {
                invite_id: 7,
                from_id: 3,
                game_id: "g1".into(),
                game_title: "Crystalis".into(),
                timestamp: 1700000000,
            })
        );
    }

    #[test]
    fn parses_game_invite_cancel() {
        assert_eq!(
            Inbound::parse(r#"{"type":"game_invite_cancel","inviteId":7}"#),
            Some(Inbound::GameInviteCancel { invite_id: 7 })
        );
    }

    #[test]
    fn game_invite_outbound_shapes() {
        assert_eq!(
            outbound::game_invite(42, "g1"),
            r#"{"gameId":"g1","to":42,"type":"game_invite"}"#
        );
        assert_eq!(
            outbound::game_invite_respond(7, true),
            r#"{"accept":true,"inviteId":7,"type":"game_invite_respond"}"#
        );
    }

    #[test]
    fn parses_room_created_with_roster() {
        let f = r#"{"type":"room_created","roomId":5,"name":"Squad","ownerId":2,"members":[2,3,7]}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::RoomCreated {
                room_id: 5,
                name: "Squad".into(),
                owner_id: 2,
                members: vec![2, 3, 7],
            })
        );
    }

    #[test]
    fn parses_room_membership_events() {
        assert_eq!(
            Inbound::parse(r#"{"type":"room_member_added","roomId":5,"userId":9}"#),
            Some(Inbound::RoomMemberAdded { room_id: 5, user_id: 9 })
        );
        assert_eq!(
            Inbound::parse(r#"{"type":"room_member_removed","roomId":5,"userId":9}"#),
            Some(Inbound::RoomMemberRemoved { room_id: 5, user_id: 9 })
        );
        // Missing members default to empty rather than failing the parse.
        assert_eq!(
            Inbound::parse(r#"{"type":"room_renamed","roomId":5,"name":"Crew"}"#),
            Some(Inbound::RoomRenamed { room_id: 5, name: "Crew".into() })
        );
        assert_eq!(
            Inbound::parse(r#"{"type":"room_deleted","roomId":5}"#),
            Some(Inbound::RoomDeleted { room_id: 5 })
        );
    }

    #[test]
    fn room_outbound_shapes() {
        assert_eq!(
            outbound::room_create("Squad", &[2, 3]),
            r#"{"members":[2,3],"name":"Squad","type":"room_create"}"#
        );
        assert_eq!(
            outbound::room_rename(5, "Crew"),
            r#"{"name":"Crew","roomId":5,"type":"room_rename"}"#
        );
        assert_eq!(
            outbound::room_add_member(5, 9),
            r#"{"roomId":5,"type":"room_add_member","userId":9}"#
        );
        assert_eq!(outbound::room_leave(5), r#"{"roomId":5,"type":"room_leave"}"#);
    }

    #[test]
    fn parses_room_message() {
        let f = r#"{"type":"room_message","roomId":5,"messageId":42,"senderId":3,"text":"gg","timestamp":1700000000}"#;
        assert_eq!(
            Inbound::parse(f),
            Some(Inbound::RoomMessage {
                room_id: 5,
                message_id: 42,
                sender_id: 3,
                text: "gg".into(),
                timestamp: 1700000000,
            })
        );
    }

    #[test]
    fn room_chat_outbound_shape() {
        assert_eq!(
            outbound::room_chat(5, "gg"),
            r#"{"roomId":5,"text":"gg","type":"room_chat"}"#
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
        assert_eq!(outbound::chat(42, "hi", 0, 0), r#"{"text":"hi","to":42,"type":"chat"}"#);
        assert_eq!(outbound::chat(42, "hi", 3, 0), r#"{"replyTo":3,"text":"hi","to":42,"type":"chat"}"#);
        assert_eq!(
            outbound::chat(42, "", 0, 9),
            r#"{"attachmentId":9,"text":"","to":42,"type":"chat"}"#
        );
        assert_eq!(outbound::typing(42), r#"{"to":42,"type":"typing"}"#);
        assert_eq!(outbound::read(42), r#"{"to":42,"type":"read"}"#);
        assert_eq!(outbound::react(7, "👍", true), r#"{"emoji":"👍","msgId":7,"on":true,"type":"react"}"#);
        assert_eq!(outbound::presence("away"), r#"{"state":"away","type":"presence"}"#);
    }
}
