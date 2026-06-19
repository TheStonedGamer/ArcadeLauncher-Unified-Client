//! SHA-256 integrity verification. After a file finishes downloading, its full
//! content is hashed and compared to the manifest's expected hex digest before
//! the `.part` is finalized — the same write-then-verify contract the C++ client
//! uses. The hashing helper is pure (bytes in, hex out) so it is unit-tested
//! against known vectors; the streaming hasher is exposed for the transport.

use sha2::{Digest, Sha256};

/// Hex-encode `bytes` as lowercase, matching the manifest's digest format.
pub fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
    }
    s
}

/// SHA-256 of `data` as a lowercase hex string.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex(&h.finalize())
}

/// Whether `actual` data matches the `expected` hex digest. The comparison is
/// case-insensitive on the hex; an empty `expected` means "no digest provided",
/// which is treated as a match (the server didn't supply one to check against).
pub fn matches(expected_hex: &str, actual: &[u8]) -> bool {
    if expected_hex.is_empty() {
        return true;
    }
    sha256_hex(actual).eq_ignore_ascii_case(expected_hex)
}

/// SHA-256 of a file on disk as a lowercase hex string, streamed in fixed-size
/// blocks so a multi-GB file is hashed without buffering it in memory. Mirrors
/// the C++ client's `Sha256File`, used to validate already-present files during a
/// "verify & repair" pass before deciding whether to re-download them.
pub fn sha256_file(path: &std::path::Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

/// A streaming SHA-256 the download transport feeds chunks into as they arrive,
/// so a large file is verified without buffering it in memory.
#[derive(Default)]
pub struct Hasher(Sha256);

impl Hasher {
    pub fn new() -> Self {
        Hasher(Sha256::new())
    }
    pub fn update(&mut self, chunk: &[u8]) {
        self.0.update(chunk);
    }
    /// Finish and return the lowercase hex digest.
    pub fn finalize_hex(self) -> String {
        hex(&self.0.finalize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Known SHA-256 vectors.
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn hashes_known_vectors() {
        assert_eq!(sha256_hex(b""), EMPTY);
        assert_eq!(sha256_hex(b"abc"), ABC);
    }

    #[test]
    fn matches_is_case_insensitive() {
        assert!(matches(ABC, b"abc"));
        assert!(matches(&ABC.to_uppercase(), b"abc"));
        assert!(!matches(ABC, b"abd"));
    }

    #[test]
    fn empty_expected_is_a_match() {
        assert!(matches("", b"anything"));
    }

    #[test]
    fn sha256_file_matches_oneshot() {
        let dir = std::env::temp_dir().join(format!("verify_file_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("data.bin");
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), ABC);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn streaming_matches_oneshot() {
        let mut h = Hasher::new();
        h.update(b"a");
        h.update(b"b");
        h.update(b"c");
        assert_eq!(h.finalize_hex(), ABC);
    }
}
