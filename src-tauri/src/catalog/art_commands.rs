//! Live IGDB cover-art fetch. Composes the pure helpers in `art.rs` with reqwest
//! to: authenticate against Twitch (client-credentials), search IGDB for the
//! title, and download the first match's cover into the per-user art cache. It
//! is a thin, creds-gated transport shell — all the URL/query/predicate logic is
//! in `art.rs` and unit-tested. A cached cover is returned without a network
//! round-trip, so re-fetches are cheap and idempotent.
//!
//! Credentials (Twitch client id/secret) come from the user's settings; with no
//! creds the command is a no-op returning `None`, so it never fails a build that
//! simply hasn't configured IGDB.

use crate::catalog::art;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// Fetch (or reuse a cached) cover for `title` into `cache_dir`, returning the
/// absolute path to the image, or `None` when there are no credentials or no
/// match with a cover. Never rewrites `library.json` — the cover lives only in
/// the cache dir and the returned path is applied in-memory by the UI.
#[tauri::command]
pub async fn fetch_cover_art(
    game_id: String,
    title: String,
    client_id: String,
    client_secret: String,
    cache_dir: String,
) -> AppResult<Option<String>> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() || title.trim().is_empty() {
        return Ok(None);
    }

    let dir = PathBuf::from(&cache_dir);
    let dest = dir.join(art::cache_file_name(&game_id));
    if dest.exists() {
        return Ok(Some(dest.to_string_lossy().into_owned()));
    }

    let client = reqwest::Client::new();

    // 1. Twitch client-credentials token.
    let token: String = {
        let resp = client
            .post("https://id.twitch.tv/oauth2/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(art::token_body(&client_id, &client_secret))
            .send()
            .await
            .map_err(|e| AppError::msg(format!("twitch auth failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::msg(format!("twitch auth returned HTTP {}", resp.status())));
        }
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::msg(format!("invalid twitch response: {e}")))?;
        match body.get("access_token").and_then(|v| v.as_str()) {
            Some(t) => t.to_string(),
            None => return Err(AppError::msg("twitch response missing access_token")),
        }
    };

    // 2. IGDB title search → first result carrying a cover image id.
    let image_id: Option<String> = {
        let resp = client
            .post("https://api.igdb.com/v4/games")
            .header("Client-ID", &client_id)
            .bearer_auth(&token)
            .body(art::search_query(&title, 5))
            .send()
            .await
            .map_err(|e| AppError::msg(format!("igdb search failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::msg(format!("igdb search returned HTTP {}", resp.status())));
        }
        let games: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::msg(format!("invalid igdb response: {e}")))?;
        games
            .as_array()
            .and_then(|arr| {
                arr.iter()
                    .find_map(|g| g.get("cover").and_then(|c| c.get("image_id")).and_then(|v| v.as_str()))
            })
            .map(|s| s.to_string())
    };

    let Some(image_id) = image_id else {
        return Ok(None); // no match with a cover — leave the game art-less
    };

    // 3. Download the cover into the cache.
    let bytes = {
        let resp = client
            .get(art::cover_url(&image_id, "cover_big"))
            .send()
            .await
            .map_err(|e| AppError::msg(format!("cover download failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::msg(format!("cover download returned HTTP {}", resp.status())));
        }
        resp.bytes()
            .await
            .map_err(|e| AppError::msg(format!("cover read failed: {e}")))?
    };

    std::fs::create_dir_all(&dir)?;
    std::fs::write(&dest, &bytes)?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}
