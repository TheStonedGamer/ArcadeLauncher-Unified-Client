//! Endpoint URL construction for the social transport. Pure and deterministic so
//! it can be unit-tested without a network: given a host and auth token, it
//! produces the exact WebSocket and REST URLs the C++ client uses
//! (`wss://host/ws/social?token=...` and `https://host/api/social/friends`).

/// A resolved social backend: the bare host (optionally with scheme/port) and
/// the per-user auth token. Construct via [`Endpoint::new`] so the host is
/// normalized once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// Host authority without scheme or trailing slash, e.g. `arcade.example.com`
    /// or `10.0.0.210:8090`.
    host: String,
    /// Per-user bearer/query token. Never logged.
    token: String,
}

impl Endpoint {
    /// Build from a user-supplied host (which may include a scheme and/or a
    /// trailing slash) and a token. The scheme is stripped — transport schemes
    /// are chosen per URL (`wss`/`https`) — and any trailing slash removed.
    pub fn new(host: impl Into<String>, token: impl Into<String>) -> Self {
        let raw = host.into();
        let stripped = raw
            .strip_prefix("https://")
            .or_else(|| raw.strip_prefix("http://"))
            .or_else(|| raw.strip_prefix("wss://"))
            .or_else(|| raw.strip_prefix("ws://"))
            .unwrap_or(&raw);
        let host = stripped.trim_end_matches('/').to_string();
        Endpoint { host, token: token.into() }
    }

    /// The WebSocket URL the social gateway connects to, token in the query
    /// string exactly as the C++ `WebSocketClient` builds it.
    pub fn ws_url(&self) -> String {
        format!("wss://{}/ws/social?token={}", self.host, encode_query(&self.token))
    }

    /// The WebSocket URL with this machine's device identity attached, so the
    /// server can address it individually for remote install (0.14).
    ///
    /// Empty fields are omitted rather than sent blank: the server treats an
    /// unusable id as "no device identity", and sending `deviceId=` would be a
    /// noisier way of saying the same thing. A connection with no identity still
    /// gets chat and presence — it just never appears as an install target.
    pub fn ws_url_with_device(&self, id: &str, name: &str, kind: &str, version: &str) -> String {
        let mut url = self.ws_url();
        for (key, value) in [
            ("deviceId", id),
            ("deviceName", name),
            ("deviceKind", kind),
            ("appVersion", version),
        ] {
            if !value.trim().is_empty() {
                url.push('&');
                url.push_str(key);
                url.push('=');
                url.push_str(&encode_query(value.trim()));
            }
        }
        url
    }

    /// The REST URL for the authoritative friend list.
    pub fn friends_url(&self) -> String {
        format!("https://{}/api/social/friends", self.host)
    }

    /// REST URL to register a pending attachment and get a presigned PUT URL.
    pub fn attachment_presign_url(&self) -> String {
        format!("https://{}/api/social/attachments/presign", self.host)
    }

    /// REST URL for one attachment's presigned download (by attachment id).
    pub fn attachment_url(&self, id: u64) -> String {
        format!("https://{}/api/social/attachments/{}", self.host, id)
    }

    /// REST URL for another account's public profile (by id).
    pub fn profile_url(&self, id: u64) -> String {
        format!("https://{}/api/social/profile/{}", self.host, id)
    }

    /// REST URL to update the caller's own profile (banner/bio).
    pub fn profile_self_url(&self) -> String {
        format!("https://{}/api/social/profile", self.host)
    }

    /// REST URL for the caller's friend-meta rows (GET) / upsert (PUT).
    pub fn friendmeta_url(&self) -> String {
        format!("https://{}/api/social/friendmeta", self.host)
    }

    /// REST URL for a username search; `q` is percent-encoded into the query.
    pub fn search_url(&self, q: &str) -> String {
        format!("https://{}/api/social/search?q={}", self.host, encode_query(q))
    }

    /// REST URL to send a friend request (POST, body carries the username).
    pub fn friend_request_url(&self) -> String {
        format!("https://{}/api/social/friends/request", self.host)
    }

    /// REST URL to respond to / unwind a friendship (POST, body carries
    /// `{userId, action}` where action ∈ accept|decline|cancel|remove|ignore).
    pub fn friend_respond_url(&self) -> String {
        format!("https://{}/api/social/friends/respond", self.host)
    }

    /// REST URL for the caller's privacy policies (GET) / update (PUT).
    pub fn privacy_url(&self) -> String {
        format!("https://{}/api/social/privacy", self.host)
    }

    /// REST URL for the caller's ignore list (GET) / add-remove (POST).
    pub fn ignores_url(&self) -> String {
        format!("https://{}/api/social/ignores", self.host)
    }

    /// REST URL for per-call WebRTC ICE servers (STUN + short-lived TURN creds).
    pub fn turn_url(&self) -> String {
        format!("https://{}/api/social/turn", self.host)
    }

    /// REST URL for the caller's friends activity feed (GET; self + accepted
    /// friends, newest first, server-derived).
    pub fn activity_url(&self) -> String {
        format!("https://{}/api/social/activity", self.host)
    }

    /// REST URL for the caller's server-synced prefs blob (GET) / upsert (PUT) —
    /// an opaque per-account JSON map (last-write-wins across devices). The
    /// account-level onboarding-seen flag lives here so the first-run tour shows
    /// once per account, not once per device.
    pub fn prefs_url(&self) -> String {
        format!("https://{}/api/social/prefs", self.host)
    }

    /// The bearer token, for the `Authorization` header on REST calls.
    pub fn token(&self) -> &str {
        &self.token
    }
}

/// Minimal percent-encoding for a token placed in a query string. Tokens are
/// base64url/JWT-shaped in practice, but `+`, `/`, `=` and whitespace must be
/// escaped so they survive as a query value.
fn encode_query(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ws_and_rest_urls() {
        let e = Endpoint::new("arcade.example.com", "abc123");
        assert_eq!(e.ws_url(), "wss://arcade.example.com/ws/social?token=abc123");
        assert_eq!(e.friends_url(), "https://arcade.example.com/api/social/friends");
        assert_eq!(e.token(), "abc123");
    }

    #[test]
    fn appends_device_identity_to_the_ws_url() {
        let e = Endpoint::new("h.test", "t");
        assert_eq!(
            e.ws_url_with_device("pc-1", "Living Room PC", "desktop", "0.14.0"),
            "wss://h.test/ws/social?token=t&deviceId=pc-1&deviceName=Living%20Room%20PC\
             &deviceKind=desktop&appVersion=0.14.0"
        );
    }

    #[test]
    fn omits_device_fields_it_has_no_value_for() {
        let e = Endpoint::new("h.test", "t");
        assert_eq!(
            e.ws_url_with_device("pc-1", "  ", "desktop", ""),
            "wss://h.test/ws/social?token=t&deviceId=pc-1&deviceKind=desktop"
        );
        // No identity at all is the same URL the pre-0.14 client sent.
        assert_eq!(e.ws_url_with_device("", "", "", ""), e.ws_url());
    }

    #[test]
    fn builds_attachment_urls() {
        let e = Endpoint::new("arcade.example.com", "t");
        assert_eq!(
            e.attachment_presign_url(),
            "https://arcade.example.com/api/social/attachments/presign"
        );
        assert_eq!(e.attachment_url(42), "https://arcade.example.com/api/social/attachments/42");
    }

    #[test]
    fn builds_profile_urls() {
        let e = Endpoint::new("arcade.example.com", "t");
        assert_eq!(e.profile_url(7), "https://arcade.example.com/api/social/profile/7");
        assert_eq!(e.profile_self_url(), "https://arcade.example.com/api/social/profile");
    }

    #[test]
    fn builds_friendmeta_and_search_urls() {
        let e = Endpoint::new("arcade.example.com", "t");
        assert_eq!(e.friendmeta_url(), "https://arcade.example.com/api/social/friendmeta");
        assert_eq!(e.search_url("a b"), "https://arcade.example.com/api/social/search?q=a%20b");
        assert_eq!(e.search_url("plain"), "https://arcade.example.com/api/social/search?q=plain");
        assert_eq!(e.friend_request_url(), "https://arcade.example.com/api/social/friends/request");
        assert_eq!(e.friend_respond_url(), "https://arcade.example.com/api/social/friends/respond");
        assert_eq!(e.privacy_url(), "https://arcade.example.com/api/social/privacy");
        assert_eq!(e.ignores_url(), "https://arcade.example.com/api/social/ignores");
        assert_eq!(e.turn_url(), "https://arcade.example.com/api/social/turn");
        assert_eq!(e.activity_url(), "https://arcade.example.com/api/social/activity");
    }

    #[test]
    fn strips_scheme_and_trailing_slash() {
        for host in ["https://h.test/", "http://h.test", "wss://h.test/", "h.test/"] {
            let e = Endpoint::new(host, "t");
            assert_eq!(e.ws_url(), "wss://h.test/ws/social?token=t", "host={host}");
        }
    }

    #[test]
    fn preserves_port() {
        let e = Endpoint::new("10.0.0.210:8090", "t");
        assert_eq!(e.ws_url(), "wss://10.0.0.210:8090/ws/social?token=t");
        assert_eq!(e.friends_url(), "https://10.0.0.210:8090/api/social/friends");
    }

    #[test]
    fn percent_encodes_token_special_chars() {
        let e = Endpoint::new("h.test", "a+b/c=d e");
        assert_eq!(e.ws_url(), "wss://h.test/ws/social?token=a%2Bb%2Fc%3Dd%20e");
    }

    #[test]
    fn leaves_token_safe_chars_untouched() {
        // JWT-shaped tokens use base64url (-, _) plus dots — all query-safe.
        let e = Endpoint::new("h.test", "eyJhbGc.iOiJI-Uz_I1.NiIsInR");
        assert_eq!(e.ws_url(), "wss://h.test/ws/social?token=eyJhbGc.iOiJI-Uz_I1.NiIsInR");
    }
}
