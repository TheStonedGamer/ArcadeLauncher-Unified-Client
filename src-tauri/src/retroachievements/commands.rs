//! RetroAchievements command (T12a): fetch the signed-in user's RA score, rank,
//! and recent unlocks via the Web API. Pure URL/parse logic lives in `api.rs`;
//! this is the HTTP seam. Credentials (RA username + Web API key) are supplied by
//! the caller from General settings — with either missing, we return a clear
//! error rather than calling out.

use crate::error::{AppError, AppResult};
use crate::retroachievements::api::{self, RaSummary};

/// Look back this many minutes for "recent" unlocks (14 days).
const RECENT_WINDOW_MINUTES: u32 = 14 * 24 * 60;

/// Fetch the user's RA rank/score and recent unlocks. Best-effort on the recent
/// list: if that secondary call fails, the summary still returns with score/rank
/// and an empty `recent`.
#[tauri::command]
pub async fn retroachievements_summary(username: String, api_key: String) -> AppResult<RaSummary> {
    let user = username.trim();
    let key = api_key.trim();
    if user.is_empty() || key.is_empty() {
        return Err(AppError::msg(
            "Add your RetroAchievements username and Web API key in Settings first.",
        ));
    }
    let client = reqwest::Client::new();

    // Rank + score (the primary call — its failure is fatal).
    let rs_body = client
        .get(api::rank_score_url(user, key))
        .send()
        .await
        .map_err(|e| AppError::msg(format!("RetroAchievements request failed: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::msg(format!("RetroAchievements read failed: {e}")))?;
    let rank = api::parse_rank_score(&rs_body)
        .map_err(|e| AppError::msg(format!("bad RetroAchievements response: {e}")))?;

    // Recent unlocks (best-effort).
    let recent = match client
        .get(api::recent_achievements_url(user, key, RECENT_WINDOW_MINUTES))
        .send()
        .await
    {
        Ok(resp) => match resp.text().await {
            Ok(body) => api::parse_recent(&body).unwrap_or_default(),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    Ok(RaSummary {
        username: user.to_string(),
        score: rank.score,
        rank: rank.rank,
        total_ranked: rank.total_ranked,
        recent,
    })
}
