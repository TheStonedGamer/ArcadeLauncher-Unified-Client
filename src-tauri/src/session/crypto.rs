//! Pure challenge-response auth crypto, mirroring the server's `auth.rs` exactly
//! so the privacy-preserving login flow works without ever sending the password.
//!
//! Flow (see ArcadeLauncher-Server/src/auth.rs):
//!   1. GET /api/auth/challenge?username=… -> { nonce }
//!   2. key = SHA-256( lowercase(trim(username)) || 0x1f || password )   (32 bytes)
//!      proof = hex( HMAC-SHA256(key, nonce_ascii) )
//!      POST /api/auth/verify {username, proof, totpCode}
//!        -> { iv (hex), token (hex ciphertext), … }
//!   3. token = HMAC-CTR-XOR(key, iv, ciphertext)  (symmetric; same as encrypt)
//!
//! All functions here are OS/IO-free and exhaustively unit-tested, including a
//! round-trip against the same construction the server uses to encrypt.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Password-derived shared secret: `SHA-256( lower(trim(username)) || 0x1f || password )`.
/// Returns the raw 32-byte digest (the server keeps the hex form but decodes it
/// back to these bytes before use).
pub fn derive_auth_key(username: &str, password: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(username.trim().to_lowercase().as_bytes());
    h.update([0x1fu8]);
    h.update(password.as_bytes());
    h.finalize().into()
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

/// The proof for the challenge nonce: `hex( HMAC-SHA256(key, nonce) )`.
pub fn challenge_proof(key: &[u8], nonce: &str) -> String {
    hex::encode(hmac_sha256(key, nonce.as_bytes()))
}

/// HMAC-SHA256 counter-mode keystream XOR. Symmetric, so this both encrypts and
/// decrypts. Block i = HMAC-SHA256(key, iv || be_u32(i)); counter starts at 0.
pub fn hmac_ctr_xor(key: &[u8], iv: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut counter: u32 = 0;
    let mut block: Vec<u8> = Vec::new();
    let mut bi = 32usize; // force a fresh block on the first byte
    for &b in data {
        if bi >= 32 {
            let mut msg = Vec::with_capacity(iv.len() + 4);
            msg.extend_from_slice(iv);
            msg.extend_from_slice(&counter.to_be_bytes());
            block = hmac_sha256(key, &msg);
            counter = counter.wrapping_add(1);
            bi = 0;
        }
        out.push(b ^ block[bi]);
        bi += 1;
    }
    out
}

/// Decrypt the token from a `/api/auth/verify` response: `iv` and `token` are
/// hex strings; the plaintext is a UTF-8 token. Returns an error string on bad
/// hex or non-UTF-8 plaintext (suitable for surfacing to the user).
pub fn decrypt_token(key: &[u8], iv_hex: &str, token_hex: &str) -> Result<String, String> {
    let iv = hex::decode(iv_hex.trim()).map_err(|e| format!("bad iv hex: {e}"))?;
    let ct = hex::decode(token_hex.trim()).map_err(|e| format!("bad token hex: {e}"))?;
    let pt = hmac_ctr_xor(key, &iv, &ct);
    String::from_utf8(pt).map_err(|e| format!("token not utf-8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_key_matches_known_construction() {
        // Independently compute SHA-256("alice" || 0x1f || "hunter2pass").
        let mut h = Sha256::new();
        h.update(b"alice");
        h.update([0x1fu8]);
        h.update(b"hunter2pass");
        let expected: [u8; 32] = h.finalize().into();
        // Username is lower-cased and trimmed by derive_auth_key.
        assert_eq!(derive_auth_key("  Alice  ", "hunter2pass"), expected);
    }

    #[test]
    fn proof_is_hex_hmac_of_nonce() {
        let key = derive_auth_key("bob", "correct horse");
        let proof = challenge_proof(&key, "nonce-xyz");
        // 32-byte HMAC -> 64 hex chars, lowercase.
        assert_eq!(proof.len(), 64);
        assert!(proof.bytes().all(|b| b.is_ascii_hexdigit()));
        // Deterministic.
        assert_eq!(proof, challenge_proof(&key, "nonce-xyz"));
        assert_ne!(proof, challenge_proof(&key, "nonce-abc"));
    }

    #[test]
    fn ctr_round_trips_and_is_symmetric() {
        let key = derive_auth_key("carol", "pw");
        let iv = [7u8; 16];
        let token = b"a-real-session-token.with.dots-and_underscores";
        let ct = hmac_ctr_xor(&key, &iv, token);
        assert_ne!(&ct[..], &token[..], "ciphertext must differ from plaintext");
        // Symmetric: applying again recovers the plaintext.
        let pt = hmac_ctr_xor(&key, &iv, &ct);
        assert_eq!(&pt[..], &token[..]);
    }

    #[test]
    fn decrypt_token_reverses_server_encrypt() {
        // Reproduce exactly what the server does: encrypt with HMAC-CTR then send
        // hex(iv) + hex(ciphertext); the client must recover the token.
        let key = derive_auth_key("dave", "s3cr3t");
        let iv = [0xABu8; 16];
        let token = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
        let ct = hmac_ctr_xor(&key, &iv, token.as_bytes());
        let got = decrypt_token(&key, &hex::encode(iv), &hex::encode(ct)).unwrap();
        assert_eq!(got, token);
    }

    #[test]
    fn crosses_the_32_byte_block_boundary() {
        // A token longer than one 32-byte keystream block exercises the counter.
        let key = derive_auth_key("erin", "pw");
        let iv = [1u8; 16];
        let token = "x".repeat(100);
        let ct = hmac_ctr_xor(&key, &iv, token.as_bytes());
        assert_eq!(decrypt_token(&key, &hex::encode(iv), &hex::encode(ct)).unwrap(), token);
    }

    #[test]
    fn decrypt_rejects_bad_hex() {
        let key = derive_auth_key("f", "p");
        assert!(decrypt_token(&key, "zz", "00").is_err());
        assert!(decrypt_token(&key, "00", "zz").is_err());
    }
}
