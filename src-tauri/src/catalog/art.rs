//! IGDB cover-art helpers. The pure, deterministic pieces of the art pipeline —
//! the image CDN URL, the apicalypse search query, the Twitch token request
//! body, the "this game still needs a cover" predicate, and the on-disk cache
//! filename — live here and are unit-tested without a network. The live fetch
//! glue (`commands::fetch_cover_art`) composes them with reqwest. Field choices
//! mirror the C++ `IgdbClient` so both clients pull identical art.

/// Build the cover image URL for an IGDB `image_id` at the given size (e.g.
/// `cover_big`), matching `IgdbClient::CoverUrl`.
pub fn cover_url(image_id: &str, size: &str) -> String {
    format!("https://images.igdb.com/igdb/image/upload/t_{size}/{image_id}.jpg")
}

/// The apicalypse body for a title search returning the fields we cache. Mirrors
/// `IgdbClient::Search` (cover requested as the embedded `cover.image_id`). The
/// title's `"` are escaped so the query stays well-formed.
pub fn search_query(title: &str, limit: u32) -> String {
    let mut escaped = String::with_capacity(title.len());
    for c in title.chars() {
        if c == '"' {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    format!(
        "search \"{escaped}\";fields name,summary,rating,rating_count,first_release_date,cover.image_id,genres.name;limit {limit};"
    )
}

/// The `application/x-www-form-urlencoded` body for the Twitch client-credentials
/// token request (`id.twitch.tv/oauth2/token`).
pub fn token_body(client_id: &str, client_secret: &str) -> String {
    format!("client_id={client_id}&client_secret={client_secret}&grant_type=client_credentials")
}

/// Whether a game still needs a cover fetched: true only when it has neither a
/// local cover path nor a cover URL (the C++ client's missing-cover condition).
/// The catalog UI applies the same predicate in TS to decide which games to
/// offer a fetch for; this Rust copy keeps the contract tested on both sides.
#[allow(dead_code)]
pub fn needs_art(cover_path: &str, cover_url: &str) -> bool {
    cover_path.trim().is_empty() && cover_url.trim().is_empty()
}

/// Deterministic cache filename for a game id: the id with every non
/// `[A-Za-z0-9._-]` byte replaced by `_`, plus a `.jpg` extension. Keeps cached
/// covers inside the cache dir regardless of what the id contains.
pub fn cache_file_name(game_id: &str) -> String {
    let mut s = String::with_capacity(game_id.len() + 4);
    for b in game_id.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-' => s.push(b as char),
            _ => s.push('_'),
        }
    }
    s.push_str(".jpg");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_url_matches_igdb_cdn() {
        assert_eq!(
            cover_url("co1xyz", "cover_big"),
            "https://images.igdb.com/igdb/image/upload/t_cover_big/co1xyz.jpg"
        );
    }

    #[test]
    fn search_query_escapes_quotes_and_sets_limit() {
        let q = search_query("Mario \"3D\" World", 5);
        assert!(q.starts_with("search \"Mario \\\"3D\\\" World\";"));
        assert!(q.contains("cover.image_id"));
        assert!(q.ends_with("limit 5;"));
    }

    #[test]
    fn token_body_is_form_encoded() {
        assert_eq!(
            token_body("cid", "secret"),
            "client_id=cid&client_secret=secret&grant_type=client_credentials"
        );
    }

    #[test]
    fn needs_art_only_when_both_empty() {
        assert!(needs_art("", ""));
        assert!(needs_art("   ", ""));
        assert!(!needs_art("/covers/a.jpg", ""));
        assert!(!needs_art("", "https://cdn/x.jpg"));
    }

    #[test]
    fn cache_file_name_sanitizes() {
        assert_eq!(cache_file_name("zelda-oot"), "zelda-oot.jpg");
        assert_eq!(cache_file_name("sega/genesis:sonic"), "sega_genesis_sonic.jpg");
        assert_eq!(cache_file_name("a b"), "a_b.jpg");
    }
}
