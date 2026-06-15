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

    /// The REST URL for the authoritative friend list.
    pub fn friends_url(&self) -> String {
        format!("https://{}/api/social/friends", self.host)
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
