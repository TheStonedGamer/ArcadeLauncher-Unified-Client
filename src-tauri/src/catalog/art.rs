//! SteamGridDB artwork lookup — pure request shaping + response parsing (T12b).
//!
//! The flow mirrors the existing IGDB-style "fetch art" pattern: resolve a game
//! name to a SteamGridDB game id via the autocomplete search, then list cover
//! ("grid") candidates for that id. Everything here is pure (URL strings in,
//! parsed structs out) so it is unit-tested against captured API shapes; the
//! HTTP + disk side lives in `art_commands.rs`.
//!
//! API reference: <https://www.steamgriddb.com/api/v2>. All endpoints are
//! Bearer-authed with the user's SteamGridDB API key.

use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://www.steamgriddb.com/api/v2";

/// Percent-encode a search term for use in a path segment. Conservative: only
/// unreserved characters pass through; everything else (spaces, punctuation,
/// UTF-8) is `%XX`-escaped, so the term round-trips through the API router.
pub fn encode_term(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Autocomplete-search URL for a game name (resolves a name → game ids).
pub fn autocomplete_url(term: &str) -> String {
    format!("{API_BASE}/search/autocomplete/{}", encode_term(term))
}

/// Grid (cover-art) listing URL for a resolved SteamGridDB game id.
pub fn grids_url(game_id: u64) -> String {
    format!("{API_BASE}/grids/game/{game_id}")
}

/// One matched game from the autocomplete search.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SgdbGame {
    pub id: u64,
    #[serde(default)]
    pub name: String,
}

/// One cover-art candidate (full image + thumbnail) for the picker UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtCandidate {
    /// Full-resolution image URL (downloaded when the user picks it).
    pub url: String,
    /// Thumbnail URL for the grid of choices.
    pub thumb: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<SgdbGame>,
}

#[derive(Deserialize)]
struct AssetItem {
    #[serde(default)]
    url: String,
    #[serde(default)]
    thumb: String,
}

#[derive(Deserialize)]
struct AssetsResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<AssetItem>,
}

/// Parse an autocomplete response into its matched games (empty on
/// `success:false` or no data).
pub fn parse_search(body: &str) -> Result<Vec<SgdbGame>, serde_json::Error> {
    let resp: SearchResponse = serde_json::from_str(body)?;
    if !resp.success {
        return Ok(Vec::new());
    }
    Ok(resp.data)
}

/// Parse a grids response into cover candidates, dropping any entry missing a
/// full URL (a thumb alone isn't downloadable).
pub fn parse_assets(body: &str) -> Result<Vec<ArtCandidate>, serde_json::Error> {
    let resp: AssetsResponse = serde_json::from_str(body)?;
    if !resp.success {
        return Ok(Vec::new());
    }
    Ok(resp
        .data
        .into_iter()
        .filter(|a| !a.url.is_empty())
        .map(|a| ArtCandidate {
            thumb: if a.thumb.is_empty() { a.url.clone() } else { a.thumb },
            url: a.url,
        })
        .collect())
}

/// Pick a sensible file extension for a downloaded cover from its URL, defaulting
/// to `png`. Used to name the cached file (`<game_id>.<ext>`).
pub fn extension_for(url: &str) -> &'static str {
    let lower = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpg"
    } else if lower.ends_with(".webp") {
        "webp"
    } else {
        "png"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_terms_for_path_segments() {
        assert_eq!(encode_term("Halo"), "Halo");
        assert_eq!(encode_term("Ratchet & Clank"), "Ratchet%20%26%20Clank");
        assert_eq!(encode_term("Pokémon"), "Pok%C3%A9mon");
    }

    #[test]
    fn builds_endpoint_urls() {
        assert_eq!(
            autocomplete_url("Final Fantasy VII"),
            "https://www.steamgriddb.com/api/v2/search/autocomplete/Final%20Fantasy%20VII"
        );
        assert_eq!(grids_url(1234), "https://www.steamgriddb.com/api/v2/grids/game/1234");
    }

    #[test]
    fn parses_search_results() {
        let body = r#"{"success":true,"data":[{"id":1,"name":"Halo"},{"id":2,"name":"Halo 2"}]}"#;
        let games = parse_search(body).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0], SgdbGame { id: 1, name: "Halo".into() });
    }

    #[test]
    fn search_failure_yields_empty() {
        assert!(parse_search(r#"{"success":false,"errors":["bad key"]}"#).unwrap().is_empty());
    }

    #[test]
    fn parses_assets_and_drops_urlless() {
        let body = r#"{"success":true,"data":[
            {"url":"https://cdn/a.png","thumb":"https://cdn/a_t.png"},
            {"url":"https://cdn/b.jpg","thumb":""},
            {"url":"","thumb":"https://cdn/c_t.png"}
        ]}"#;
        let assets = parse_assets(body).unwrap();
        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].url, "https://cdn/a.png");
        // A missing thumb falls back to the full url.
        assert_eq!(assets[1].thumb, "https://cdn/b.jpg");
    }

    #[test]
    fn extension_from_url() {
        assert_eq!(extension_for("https://cdn/a.png"), "png");
        assert_eq!(extension_for("https://cdn/a.JPG"), "jpg");
        assert_eq!(extension_for("https://cdn/a.jpeg?x=1"), "jpg");
        assert_eq!(extension_for("https://cdn/a.webp"), "webp");
        assert_eq!(extension_for("https://cdn/a"), "png");
    }
}
