//! Download URL construction. A manifest file may carry an absolute `url`; when
//! it doesn't, the file is served by game id + install-relative path at
//! `https://{host}/files/{id}/{rel}` — the same contract the C++ `ServerClient`
//! uses for its ranged GETs. Pure and deterministic so it is unit-tested without
//! a network.

use crate::download::manifest::ManifestFile;

/// Strip any scheme and trailing slash from a user/config-supplied host, leaving
/// the bare authority (`host[:port]`). Matches the social [`Endpoint`] handling
/// so a single configured host string works for both subsystems.
pub fn normalize_host(host: &str) -> String {
    let stripped = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    stripped.trim_end_matches('/').to_string()
}

/// Build the id+path GET URL for a file: `https://{host}/files/{id}/{rel}`. Each
/// path segment is percent-encoded (so spaces and the like survive) while the
/// `/` separators between segments are preserved.
pub fn file_url(host: &str, game_id: &str, rel: &str) -> String {
    let host = normalize_host(host);
    let id = encode_segment(game_id);
    let path = encode_path(rel);
    format!("https://{host}/files/{id}/{path}")
}

/// The URL to fetch `file` from: its explicit `url` if the manifest provides one,
/// otherwise the id+path fallback. Centralizing the choice keeps the transport
/// from re-deciding it per request.
pub fn resolve_url(host: &str, game_id: &str, file: &ManifestFile) -> String {
    if file.url.is_empty() {
        file_url(host, game_id, &file.path)
    } else {
        file.url.clone()
    }
}

/// Percent-encode one path segment, leaving the unreserved set untouched.
fn encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Encode an install-relative path: normalize `\` to `/`, encode each segment,
/// and rejoin with `/`. Empty and `.` segments are dropped.
fn encode_path(rel: &str) -> String {
    rel.split(['/', '\\'])
        .filter(|c| !c.is_empty() && *c != ".")
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_id_path_url() {
        assert_eq!(
            file_url("arcade.example.com", "zelda", "data/a.pak"),
            "https://arcade.example.com/files/zelda/data/a.pak"
        );
    }

    #[test]
    fn strips_scheme_and_trailing_slash() {
        for host in ["https://h.test/", "http://h.test", "h.test/"] {
            assert_eq!(file_url(host, "g", "f.bin"), "https://h.test/files/g/f.bin", "host={host}");
        }
    }

    #[test]
    fn normalizes_backslashes_and_encodes_segments() {
        assert_eq!(
            file_url("h.test", "g", "data\\my folder\\x.bin"),
            "https://h.test/files/g/data/my%20folder/x.bin"
        );
    }

    #[test]
    fn resolve_prefers_explicit_url() {
        let f = ManifestFile { path: "a.bin".into(), url: "https://cdn/x".into(), sha256: String::new(), size: 0 };
        assert_eq!(resolve_url("h.test", "g", &f), "https://cdn/x");
    }

    #[test]
    fn resolve_falls_back_to_id_path() {
        let f = ManifestFile { path: "sub/a.bin".into(), url: String::new(), sha256: String::new(), size: 0 };
        assert_eq!(resolve_url("h.test", "g", &f), "https://h.test/files/g/sub/a.bin");
    }
}
