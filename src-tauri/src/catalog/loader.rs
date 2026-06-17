//! Reads and parses `library.json` from disk into `Vec<Game>`.
//!
//! The file is the JSON array produced by `GameLibrary::Save`. A missing file
//! is not an error — it yields an empty catalog (fresh install). Malformed JSON
//! IS an error so we never silently show an empty library when the file exists
//! but is corrupt.

use crate::catalog::model::Game;
use crate::error::AppResult;
use std::path::Path;

/// Parse catalog entries from a JSON array string.
pub fn parse(json: &str) -> AppResult<Vec<Game>> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str::<Vec<Game>>(trimmed)?)
}

/// Parse the server's `GET /api/catalog` response into `Vec<Game>`.
///
/// The server wraps the list in a `{ "schemaVersion", "generatedBy", "games": [..] }`
/// envelope, whereas the on-disk `library.json` is a bare array. Accept either
/// shape so this also tolerates a future server that returns a plain array (and
/// so a cached `library.json` could be fed back through here).
pub fn parse_catalog_response(json: &str) -> AppResult<Vec<Game>> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // Bare array first (matches library.json); fall back to the wrapped envelope.
    if let Ok(games) = serde_json::from_str::<Vec<Game>>(trimmed) {
        return Ok(games);
    }
    #[derive(serde::Deserialize)]
    struct Envelope {
        #[serde(default)]
        games: Vec<Game>,
    }
    Ok(serde_json::from_str::<Envelope>(trimmed)?.games)
}

/// Load + parse `library.json` from `path`. Missing file → empty catalog.
pub fn load_file(path: &Path) -> AppResult<Vec<Game>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path)?;
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_ok() {
        assert!(parse("").unwrap().is_empty());
        assert!(parse("   ").unwrap().is_empty());
    }

    #[test]
    fn parses_subset_and_defaults_missing() {
        let json = r#"[
            {"id":"1","title":"Crystalis","platform":"NES","favorite":true},
            {"id":"2","title":"Super Mario Bros 3","exePath":"smb3.exe"}
        ]"#;
        let games = parse(json).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].title, "Crystalis");
        assert!(games[0].favorite);
        assert!(!games[0].hidden); // defaulted
        assert_eq!(games[1].exe_path, "smb3.exe");
    }

    #[test]
    fn corrupt_json_errors() {
        assert!(parse("[ {not json } ]").is_err());
    }

    #[test]
    fn catalog_response_accepts_envelope_and_array() {
        // Wrapped envelope (what GET /api/catalog returns).
        let env = r#"{"schemaVersion":1,"generatedBy":"mariadb-rust","games":[
            {"id":"nes-abc","title":"Crystalis","platform":"NES"}]}"#;
        let g = parse_catalog_response(env).unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].title, "Crystalis");

        // Bare array (library.json on disk).
        let arr = r#"[{"id":"1","title":"SMB3"}]"#;
        assert_eq!(parse_catalog_response(arr).unwrap().len(), 1);

        // Empty input → empty catalog, not an error.
        assert!(parse_catalog_response("   ").unwrap().is_empty());
    }
}
