//! Sunshine host-control wire core (T12k-2, pure half). Everything needed to
//! talk to a Sunshine host's HTTPS config API (`https://<addr>:47990`) *except*
//! the IO: endpoint URLs, request bodies (PIN pairing, add-app), HTTP Basic
//! auth header construction, response parsing, and the **certificate-pinning
//! decision**. The live reqwest/TLS seam (`commands.rs`) builds on top.
//!
//! Pinning model (TOFU): Sunshine serves its config API over a **self-signed**
//! cert. Rather than disable verification, the transport records the cert's
//! SHA-256 fingerprint the first time the user pairs (trust-on-first-use) and
//! thereafter requires the presented cert to match the pinned fingerprint —
//! `fingerprint_matches` is that pure decision. Creds + pin live client-local
//! (never in `library.json`).

use crate::streaming::host::SUNSHINE_CONFIG_PORT;
use serde::Serialize;

/// Endpoint builder rooted at a host's Sunshine config API
/// (`https://<address>:47990`). Mirrors the `requests::api::Endpoint` shape so
/// the URL builders stay testable and the transport never hand-rolls a path.
#[derive(Debug, Clone)]
pub struct ControlEndpoint {
    base: String,
}

impl ControlEndpoint {
    /// Build from a bare host address (IP or DNS name, no scheme/port). Any
    /// stray scheme/port/whitespace the caller passes is normalised away so the
    /// joined URLs are always `https://<addr>:47990/...`.
    pub fn new(address: &str) -> Self {
        let a = address.trim();
        let a = a
            .strip_prefix("https://")
            .or_else(|| a.strip_prefix("http://"))
            .unwrap_or(a);
        // Drop any caller-supplied port and trailing slashes — we always use the
        // Sunshine config port.
        let a = a.trim_end_matches('/');
        let host = a.split(':').next().unwrap_or(a);
        ControlEndpoint {
            base: format!("https://{host}:{SUNSHINE_CONFIG_PORT}"),
        }
    }

    /// The normalised base URL (`https://<addr>:47990`), no trailing slash.
    pub fn base(&self) -> &str {
        &self.base
    }

    fn join(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    /// `GET`/`POST /api/apps` — list the host's apps / add one.
    pub fn apps_url(&self) -> String {
        self.join("api/apps")
    }

    /// `POST /api/pin` — submit a pairing PIN.
    pub fn pin_url(&self) -> String {
        self.join("api/pin")
    }
}

/// A Sunshine pairing PIN is exactly four ASCII digits. Reject anything else
/// before we bother the host with it.
pub fn is_valid_pin(pin: &str) -> bool {
    let p = pin.trim();
    p.len() == 4 && p.bytes().all(|b| b.is_ascii_digit())
}

/// Body for `POST /api/pin`: `{"pin":"1234","name":"ArcadeLauncher"}`. The
/// `name` is the device label Sunshine records for this pairing.
pub fn pin_body(pin: &str, name: &str) -> serde_json::Value {
    serde_json::json!({ "pin": pin.trim(), "name": name.trim() })
}

/// A new Sunshine app entry for `POST /api/apps`, so launching it on the host
/// runs our game. Only the fields we set are serialized; Sunshine fills the
/// rest with its defaults. `image-path` is optional (box art on the host's
/// app grid).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewApp {
    pub name: String,
    pub cmd: String,
    #[serde(rename = "image-path", skip_serializing_if = "String::is_empty")]
    pub image_path: String,
}

/// Build a `NewApp` body for adding `game_name` (launched via `cmd`) to the
/// host, with an optional `image_path` for box art.
pub fn new_app_body(game_name: &str, cmd: &str, image_path: &str) -> NewApp {
    NewApp {
        name: game_name.trim().to_string(),
        cmd: cmd.trim().to_string(),
        image_path: image_path.trim().to_string(),
    }
}

/// Parse Sunshine's `POST /api/pin` response into an accepted/rejected bool.
/// Sunshine has historically returned `{"status":"true"}` (the bool as a
/// **string**) and in newer builds `{"status":true}`; accept either, and treat
/// a missing/garbage field as a rejection rather than erroring.
pub fn parse_pin_result(json: &str) -> bool {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return false,
    };
    match v.get("status") {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

// ---- HTTP Basic auth (no base64 crate; tiny pure encoder) --------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard Base64 (RFC 4648, with `=` padding) of arbitrary bytes. Small,
/// pure, dependency-free — only used to build the Basic auth header, so it
/// needs no decoder.
pub fn b64encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18 & 0x3f) as usize] as char);
        out.push(B64[(n >> 12 & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6 & 0x3f) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 0x3f) as usize] as char } else { '=' });
    }
    out
}

/// The full `Authorization` header value for HTTP Basic auth:
/// `Basic base64(user:pass)`. Sunshine's config API is Basic-auth protected
/// with the credentials the user set in its web UI.
pub fn basic_auth_value(user: &str, pass: &str) -> String {
    format!("Basic {}", b64encode(format!("{user}:{pass}").as_bytes()))
}

// ---- Certificate pinning (TOFU) ---------------------------------------------

/// Lowercase hex SHA-256 fingerprint of a DER-encoded certificate, the form we
/// pin and store client-local. No separators — `fingerprint_matches`
/// normalises on compare so a colon-formatted pin still matches.
pub fn cert_fingerprint_hex(cert_der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(cert_der);
    hex::encode(h.finalize())
}

/// Whether a presented cert fingerprint matches the pinned one. Comparison is
/// case-insensitive and ignores `:`/whitespace separators, so a pin stored as
/// `AA:BB:…` still matches a bare-hex presentation. An empty pin never matches
/// (we have nothing to trust yet → caller must run the TOFU pair flow).
pub fn fingerprint_matches(pinned: &str, presented: &str) -> bool {
    fn norm(s: &str) -> String {
        s.chars()
            .filter(|c| !c.is_whitespace() && *c != ':')
            .flat_map(|c| c.to_lowercase())
            .collect()
    }
    let p = norm(pinned);
    !p.is_empty() && p == norm(presented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_normalises_to_https_47990() {
        for input in ["10.0.0.5", "https://10.0.0.5", "http://10.0.0.5/", "10.0.0.5:1234"] {
            let e = ControlEndpoint::new(input);
            assert_eq!(e.base(), "https://10.0.0.5:47990", "input={input}");
        }
        let e = ControlEndpoint::new("  host.local  ");
        assert_eq!(e.apps_url(), "https://host.local:47990/api/apps");
        assert_eq!(e.pin_url(), "https://host.local:47990/api/pin");
    }

    #[test]
    fn pin_validation() {
        assert!(is_valid_pin("1234"));
        assert!(is_valid_pin("  0000 "));
        assert!(!is_valid_pin("123"));
        assert!(!is_valid_pin("12345"));
        assert!(!is_valid_pin("12a4"));
        assert!(!is_valid_pin(""));
    }

    #[test]
    fn pin_body_shape() {
        let b = pin_body("  1234 ", "  My PC ");
        assert_eq!(b["pin"], "1234");
        assert_eq!(b["name"], "My PC");
    }

    #[test]
    fn new_app_body_serializes_with_image_path_rename_and_skip() {
        let with = new_app_body("Halo", "halo.exe", "halo.png");
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(json["name"], "Halo");
        assert_eq!(json["cmd"], "halo.exe");
        assert_eq!(json["image-path"], "halo.png");
        // Empty image path is skipped entirely.
        let without = new_app_body("Doom", "doom.exe", "");
        let json = serde_json::to_value(&without).unwrap();
        assert!(json.get("image-path").is_none());
    }

    #[test]
    fn parse_pin_result_accepts_bool_or_string() {
        assert!(parse_pin_result(r#"{"status":"true"}"#));
        assert!(parse_pin_result(r#"{"status":true}"#));
        assert!(parse_pin_result(r#"{"status":"TRUE"}"#));
        assert!(!parse_pin_result(r#"{"status":"false"}"#));
        assert!(!parse_pin_result(r#"{"status":false}"#));
        assert!(!parse_pin_result(r#"{"other":1}"#));
        assert!(!parse_pin_result("not json"));
    }

    #[test]
    fn base64_known_answers() {
        // RFC 4648 §10 vectors.
        assert_eq!(b64encode(b""), "");
        assert_eq!(b64encode(b"f"), "Zg==");
        assert_eq!(b64encode(b"fo"), "Zm8=");
        assert_eq!(b64encode(b"foo"), "Zm9v");
        assert_eq!(b64encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn basic_auth_value_encodes_user_pass() {
        // base64("admin:secret") = YWRtaW46c2VjcmV0
        assert_eq!(basic_auth_value("admin", "secret"), "Basic YWRtaW46c2VjcmV0");
    }

    #[test]
    fn cert_fingerprint_is_lowercase_sha256_hex() {
        // sha256("") well-known digest.
        let fp = cert_fingerprint_hex(b"");
        assert_eq!(fp, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(fp.len(), 64);
    }

    #[test]
    fn fingerprint_matches_ignores_case_and_separators() {
        let bare = "aabbccdd";
        assert!(fingerprint_matches("AA:BB:CC:DD", bare));
        assert!(fingerprint_matches("aa bb cc dd", bare));
        assert!(fingerprint_matches(bare, "AABBCCDD"));
        assert!(!fingerprint_matches("aabbccde", bare));
        // Empty pin never matches — nothing trusted yet.
        assert!(!fingerprint_matches("", bare));
        assert!(!fingerprint_matches(bare, ""));
    }
}
