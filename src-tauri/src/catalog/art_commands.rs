//! SteamGridDB artwork commands (T12b): search the service for cover candidates
//! and apply a chosen cover by downloading it into the per-user art cache and
//! recording a cover override in `catalog_prefs.json`. The pure request/response
//! logic lives in `art.rs`; this is the thin HTTP + disk seam.
//!
//! The user supplies their own SteamGridDB API key (General settings). With no
//! key, `steamgriddb_search` returns a clear error rather than calling out.

use crate::catalog::art::{self, ArtCandidate};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::Manager;

/// Search SteamGridDB for cover-art candidates matching `name`. Resolves the
/// name to the best game match, then lists that game's grids. Returns an empty
/// list (not an error) when nothing matches; errors only on a missing key or a
/// transport/HTTP failure.
#[tauri::command]
pub async fn steamgriddb_search(name: String, api_key: String) -> AppResult<Vec<ArtCandidate>> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(AppError::msg("Add your SteamGridDB API key in Settings first."));
    }
    let client = reqwest::Client::new();

    // 1) name → game id (take the top autocomplete match).
    let search_body = client
        .get(art::autocomplete_url(&name))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("SteamGridDB search failed: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::msg(format!("SteamGridDB search read failed: {e}")))?;
    let games = art::parse_search(&search_body).map_err(|e| AppError::msg(format!("bad search response: {e}")))?;
    let Some(game) = games.into_iter().next() else {
        return Ok(Vec::new());
    };

    // 2) game id → grid candidates.
    let grids_body = client
        .get(art::grids_url(game.id))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("SteamGridDB grids failed: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::msg(format!("SteamGridDB grids read failed: {e}")))?;
    art::parse_assets(&grids_body).map_err(|e| AppError::msg(format!("bad grids response: {e}")))
}

/// Download `image_url` into the per-user art cache and return the absolute local
/// path of the saved cover, so the UI can record it as a cover override (through
/// the catalog-prefs hook, the single owner of prefs writes) and display it
/// immediately. Downloads only — never touches `library.json` or the prefs file.
#[tauri::command]
pub async fn apply_cover(app: tauri::AppHandle, game_id: String, image_url: String) -> AppResult<String> {
    if game_id.trim().is_empty() || image_url.trim().is_empty() {
        return Err(AppError::msg("game id and image url are required"));
    }

    // Download the image bytes.
    let bytes = reqwest::Client::new()
        .get(&image_url)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("cover download failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::msg(format!("cover download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::msg(format!("cover read failed: {e}")))?;

    // Write into the per-user art cache: <app_data>/art/<game_id>.<ext>.
    let art_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?
        .join("art");
    std::fs::create_dir_all(&art_dir).map_err(|e| AppError::msg(format!("mkdir failed: {e}")))?;
    let ext = art::extension_for(&image_url);
    let dest: PathBuf = art_dir.join(format!("{}.{ext}", sanitize_id(&game_id)));
    let tmp = dest.with_extension(format!("{ext}.part"));
    std::fs::write(&tmp, &bytes).map_err(|e| AppError::msg(format!("cover write failed: {e}")))?;
    std::fs::rename(&tmp, &dest).map_err(|e| AppError::msg(format!("cover finalize failed: {e}")))?;

    Ok(dest.to_string_lossy().into_owned())
}

/// Reduce a game id to filesystem-safe characters for the cache filename. Game
/// ids are `<platform>-<sha1>` so this is usually a no-op, but it guards against
/// any stray separators that could escape the art dir.
fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize_id;

    #[test]
    fn sanitizes_path_separators() {
        assert_eq!(sanitize_id("ps2-abc123"), "ps2-abc123");
        assert_eq!(sanitize_id("../etc/passwd"), "___etc_passwd");
        assert_eq!(sanitize_id("a/b\\c"), "a_b_c");
    }
}
