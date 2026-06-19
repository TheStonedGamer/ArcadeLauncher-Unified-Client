//! Pure RetroAchievements Web API request shaping + response parsing.
//!
//! The legacy RA Web API authenticates every call with `z=<username>&y=<api_key>`
//! query params (the caller's own credentials), and targets a user with `u=`.
//! Here the caller and the target are the same person (their own profile), so we
//! pass the username for both. Everything in this file is pure (params in,
//! URL/structs out) and unit-tested; the HTTP + key handling lives in
//! `commands.rs`.
//!
//! Reference: <https://api-docs.retroachievements.org/>.

use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://retroachievements.org/API";

/// Percent-encode a query-parameter value (usernames/keys are usually plain, but
/// guard against spaces/specials so the query string can't break).
pub fn encode_param(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The shared `z`/`y` auth suffix appended to every RA API call.
fn auth(username: &str, api_key: &str) -> String {
    format!("z={}&y={}", encode_param(username), encode_param(api_key))
}

/// URL for the user's rank + score (`API_GetUserRankAndScore`).
pub fn rank_score_url(username: &str, api_key: &str) -> String {
    format!(
        "{API_BASE}/API_GetUserRankAndScore.php?u={}&{}",
        encode_param(username),
        auth(username, api_key)
    )
}

/// URL for the user's recent unlocks within the last `minutes` minutes
/// (`API_GetUserRecentAchievements`).
pub fn recent_achievements_url(username: &str, api_key: &str, minutes: u32) -> String {
    format!(
        "{API_BASE}/API_GetUserRecentAchievements.php?u={}&m={minutes}&{}",
        encode_param(username),
        auth(username, api_key)
    )
}

/// Parsed rank + score for a user.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RankScore {
    #[serde(rename = "Score", default)]
    pub score: i64,
    #[serde(rename = "Rank", default)]
    pub rank: i64,
    #[serde(rename = "TotalRanked", default)]
    pub total_ranked: i64,
}

/// One recently-unlocked achievement, trimmed to what the panel shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlock {
    pub title: String,
    pub description: String,
    pub points: i64,
    pub game_title: String,
    /// Server-formatted unlock timestamp (`YYYY-MM-DD HH:MM:SS`).
    pub date: String,
    /// Whether this was a hardcore-mode unlock.
    pub hardcore: bool,
}

/// The combined summary the command returns to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaSummary {
    pub username: String,
    pub score: i64,
    pub rank: i64,
    pub total_ranked: i64,
    pub recent: Vec<Unlock>,
}

#[derive(Deserialize)]
struct RawUnlock {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "Points", default)]
    points: i64,
    #[serde(rename = "GameTitle", default)]
    game_title: String,
    #[serde(rename = "Date", default)]
    date: String,
    // RA sends 1/0; tolerate bool or int via serde_json::Value below.
    #[serde(rename = "HardcoreMode", default)]
    hardcore: serde_json::Value,
}

/// Parse the rank/score response. RA returns `[]` (an empty JSON array) for an
/// unknown user; treat that as a zeroed score rather than an error.
pub fn parse_rank_score(body: &str) -> Result<RankScore, serde_json::Error> {
    let trimmed = body.trim_start();
    if trimmed.starts_with('[') {
        return Ok(RankScore { score: 0, rank: 0, total_ranked: 0 });
    }
    serde_json::from_str(body)
}

/// Parse the recent-achievements array into trimmed `Unlock`s.
pub fn parse_recent(body: &str) -> Result<Vec<Unlock>, serde_json::Error> {
    let raw: Vec<RawUnlock> = serde_json::from_str(body)?;
    Ok(raw
        .into_iter()
        .map(|r| Unlock {
            title: r.title,
            description: r.description,
            points: r.points,
            game_title: r.game_title,
            date: r.date,
            hardcore: truthy(&r.hardcore),
        })
        .collect())
}

/// Coerce RA's flexible `HardcoreMode` (1/0, "1"/"0", true/false) to a bool.
fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_i64().map(|i| i != 0).unwrap_or(false),
        serde_json::Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_params() {
        assert_eq!(encode_param("Cheevos_Fan"), "Cheevos_Fan");
        assert_eq!(encode_param("a b&c"), "a%20b%26c");
    }

    #[test]
    fn builds_authed_urls() {
        assert_eq!(
            rank_score_url("me", "KEY"),
            "https://retroachievements.org/API/API_GetUserRankAndScore.php?u=me&z=me&y=KEY"
        );
        assert_eq!(
            recent_achievements_url("me", "KEY", 1440),
            "https://retroachievements.org/API/API_GetUserRecentAchievements.php?u=me&m=1440&z=me&y=KEY"
        );
    }

    #[test]
    fn parses_rank_score() {
        let body = r#"{"Score":12345,"SoftcoreScore":0,"Rank":678,"TotalRanked":90000}"#;
        let rs = parse_rank_score(body).unwrap();
        assert_eq!(rs.score, 12345);
        assert_eq!(rs.rank, 678);
        assert_eq!(rs.total_ranked, 90000);
    }

    #[test]
    fn unknown_user_rank_is_zeroed() {
        assert_eq!(parse_rank_score("[]").unwrap(), RankScore { score: 0, rank: 0, total_ranked: 0 });
    }

    #[test]
    fn parses_recent_unlocks_with_flexible_hardcore() {
        let body = r#"[
            {"Title":"First Blood","Description":"Win a match","Points":5,"GameTitle":"DOOM","Date":"2026-06-19 10:00:00","HardcoreMode":1},
            {"Title":"Pacifist","Description":"No kills","Points":25,"GameTitle":"DOOM","Date":"2026-06-19 09:00:00","HardcoreMode":0}
        ]"#;
        let unlocks = parse_recent(body).unwrap();
        assert_eq!(unlocks.len(), 2);
        assert_eq!(unlocks[0].title, "First Blood");
        assert!(unlocks[0].hardcore);
        assert!(!unlocks[1].hardcore);
        assert_eq!(unlocks[1].points, 25);
    }

    #[test]
    fn empty_recent_is_empty() {
        assert!(parse_recent("[]").unwrap().is_empty());
    }
}
