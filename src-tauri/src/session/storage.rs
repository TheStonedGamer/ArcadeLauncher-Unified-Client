//! Pure, OS/IO-free token-storage core: the on-disk model for a remembered
//! session plus obfuscation-at-rest and the expiry decision.
//!
//! Security note: the unified client is admin-free and ships identically on
//! Windows and Linux, so we deliberately avoid an OS keychain (which would pull
//! in libsecret/DBus on Linux and diverge the two builds). Instead the token is
//! kept in the user's private app-config dir and obfuscated at rest with an
//! HMAC-CTR keystream keyed by a stable per-install seed (the config-dir path).
//! This stops the token from sitting in plaintext; it is not hardware-backed
//! encryption. All functions here are deterministic and unit-tested.

use crate::session::crypto::hmac_ctr_xor;
use sha2::{Digest, Sha256};

/// A remembered session as persisted to disk. Mirrors the live `Session` plus
/// the bookkeeping needed to auto-restore and expire it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub host: String,
    pub username: String,
    pub token: String,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub must_change_password: bool,
    /// Unix seconds when this session was saved.
    #[serde(default)]
    pub saved_unix: i64,
    /// Optional Unix-seconds expiry; `None` means "until the server rejects it".
    #[serde(default)]
    pub expires_unix: Option<i64>,
}

/// The obfuscated on-disk envelope: a random-ish `iv` (hex) and the keystream-
/// XORed JSON blob (hex). Symmetric, so `open` reverses `seal`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Envelope {
    iv: String,
    blob: String,
}

/// Derive the 32-byte storage key from a stable per-install `seed` (e.g. the
/// app-config-dir path). Domain-separated so it can never collide with the
/// auth key derived from a password.
pub fn derive_storage_key(seed: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"arcade-session-store-v1\x1f");
    h.update(seed.as_bytes());
    h.finalize().into()
}

/// Serialize + obfuscate a session into the JSON envelope text written to disk.
/// `iv` should vary per save (callers pass time/random bytes); any length works.
pub fn encode(key: &[u8], iv: &[u8], session: &StoredSession) -> Result<String, String> {
    let json = serde_json::to_vec(session).map_err(|e| format!("encode session: {e}"))?;
    let blob = hmac_ctr_xor(key, iv, &json);
    let env = Envelope {
        iv: hex::encode(iv),
        blob: hex::encode(blob),
    };
    serde_json::to_string(&env).map_err(|e| format!("encode envelope: {e}"))
}

/// Reverse [`encode`]: parse the envelope, de-obfuscate with `key`, and decode
/// the session JSON. A wrong key (or tampered/corrupt file) yields an `Err`
/// because the recovered bytes won't be valid session JSON.
pub fn decode(key: &[u8], text: &str) -> Result<StoredSession, String> {
    let env: Envelope = serde_json::from_str(text).map_err(|e| format!("bad envelope: {e}"))?;
    let iv = hex::decode(env.iv.trim()).map_err(|e| format!("bad iv hex: {e}"))?;
    let blob = hex::decode(env.blob.trim()).map_err(|e| format!("bad blob hex: {e}"))?;
    let json = hmac_ctr_xor(key, &iv, &blob);
    serde_json::from_slice::<StoredSession>(&json)
        .map_err(|e| format!("decode session (wrong key or corrupt): {e}"))
}

/// Whether the stored session has expired as of `now_unix`. Sessions with no
/// `expires_unix` never expire on the client (the server is the authority).
pub fn is_expired(session: &StoredSession, now_unix: i64) -> bool {
    match session.expires_unix {
        Some(exp) => now_unix >= exp,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> StoredSession {
        StoredSession {
            host: "arcade.orlandoaio.net".into(),
            username: "alice".into(),
            token: "eyJhbGciOiJIUzI1NiJ9.payload.sig".into(),
            is_admin: true,
            must_change_password: false,
            saved_unix: 1_700_000_000,
            expires_unix: Some(1_700_086_400),
        }
    }

    #[test]
    fn round_trips_through_the_envelope() {
        let key = derive_storage_key("/home/alice/.config/com.arcade");
        let iv = [9u8; 16];
        let text = encode(&key, &iv, &sample()).unwrap();
        // The token must not appear in cleartext in the on-disk text.
        assert!(!text.contains("payload.sig"), "token leaked in plaintext: {text}");
        assert_eq!(decode(&key, &text).unwrap(), sample());
    }

    #[test]
    fn wrong_key_fails_to_decode() {
        let iv = [3u8; 16];
        let text = encode(&derive_storage_key("seed-A"), &iv, &sample()).unwrap();
        // A different install seed derives a different key -> garbage -> error.
        assert!(decode(&derive_storage_key("seed-B"), &text).is_err());
    }

    #[test]
    fn storage_key_is_deterministic_and_seed_specific() {
        assert_eq!(derive_storage_key("x"), derive_storage_key("x"));
        assert_ne!(derive_storage_key("x"), derive_storage_key("y"));
    }

    #[test]
    fn decode_rejects_corrupt_text() {
        let key = derive_storage_key("s");
        assert!(decode(&key, "not json").is_err());
        assert!(decode(&key, r#"{"iv":"zz","blob":"00"}"#).is_err());
    }

    #[test]
    fn expiry_decision() {
        let mut s = sample();
        s.expires_unix = Some(1000);
        assert!(!is_expired(&s, 999));
        assert!(is_expired(&s, 1000)); // boundary: expired at the instant it expires
        assert!(is_expired(&s, 1001));
        s.expires_unix = None;
        assert!(!is_expired(&s, i64::MAX)); // never expires client-side
    }

    #[test]
    fn missing_optional_fields_default() {
        // A minimal stored blob (older shape) still decodes with defaults.
        let key = derive_storage_key("s");
        let minimal = StoredSession {
            host: "h".into(),
            username: "u".into(),
            token: "t".into(),
            is_admin: false,
            must_change_password: false,
            saved_unix: 0,
            expires_unix: None,
        };
        let text = encode(&key, &[1u8; 8], &minimal).unwrap();
        assert_eq!(decode(&key, &text).unwrap(), minimal);
    }
}
