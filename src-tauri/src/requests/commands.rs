//! Tauri commands for the in-client Game Requests board (T12h-2). Thin HTTP seam
//! over the pure core in `api.rs`. The board is the standalone
//! `ArcadeLauncher-Requests` service, deployed behind nginx at `<host>/requests`.
//!
//! Auth model: the service accepts the **launcher's** per-user bearer token (the
//! same token `session_login` returns), validated against the shared
//! `launcher_tokens` table. So every command takes `host` + `token` and sends
//! `Authorization: Bearer <token>` — no separate cookie login from the client.

use crate::error::{AppError, AppResult};
use crate::requests::api::{
    self, Board, CreateBody, CreateResult, Me, RateResult, SearchHit, VoteResult,
};

/// Strip any scheme/trailing slash so we control the transport scheme (mirrors
/// the catalog/download host normalization).
fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

/// Build the endpoint rooted at the service's public base (`https://{host}/requests`).
fn endpoint(host: &str) -> api::Endpoint {
    api::Endpoint::new(&format!("https://{}/requests", normalize_host(host)))
}

/// Validate the bearer token is present before we call out.
fn require_token(token: &str) -> AppResult<&str> {
    let t = token.trim();
    if t.is_empty() {
        return Err(AppError::msg("Sign in to use the Game Requests board."));
    }
    Ok(t)
}

/// GET the request board (`GET /api/requests`).
#[tauri::command]
pub async fn requests_board(host: String, token: String) -> AppResult<Board> {
    let token = require_token(&token)?;
    let body = get(&endpoint(&host).requests_url(), token).await?;
    api::parse_board(&body).map_err(|e| AppError::msg(format!("bad board response: {e}")))
}

/// Current session info (`GET /api/me`) — confirms the token is accepted.
#[tauri::command]
pub async fn requests_me(host: String, token: String) -> AppResult<Me> {
    let token = require_token(&token)?;
    let body = get(&endpoint(&host).me_url(), token).await?;
    api::parse_me(&body).map_err(|e| AppError::msg(format!("bad me response: {e}")))
}

/// Search IGDB for a release to request (`GET /api/search?q=&platform=`).
#[tauri::command]
pub async fn requests_search(
    host: String,
    token: String,
    query: String,
    platform: String,
) -> AppResult<Vec<SearchHit>> {
    let token = require_token(&token)?;
    let url = endpoint(&host).search_url(query.trim(), &platform);
    let body = get(&url, token).await?;
    api::parse_search(&body).map_err(|e| AppError::msg(format!("bad search response: {e}")))
}

/// Create a request (`POST /api/requests`). A dupe folds into an upvote of the
/// existing row; either way the returned `id` is the board row that now carries it.
#[tauri::command]
pub async fn requests_create(
    host: String,
    token: String,
    body: CreateBody,
) -> AppResult<CreateResult> {
    let token = require_token(&token)?;
    let resp = post_json(&endpoint(&host).requests_url(), token, &body).await?;
    api::parse_create(&resp).map_err(|e| AppError::msg(format!("bad create response: {e}")))
}

/// Upvote a request (`POST /api/requests/:id/vote`).
#[tauri::command]
pub async fn requests_vote(host: String, token: String, id: u64) -> AppResult<VoteResult> {
    let token = require_token(&token)?;
    let resp = post_json(&endpoint(&host).vote_url(id), token, &serde_json::json!({})).await?;
    api::parse_vote(&resp).map_err(|e| AppError::msg(format!("bad vote response: {e}")))
}

/// Rate a game 1–5 stars (`POST /api/requests/:id/rating` with `{stars}`).
#[tauri::command]
pub async fn requests_rate(
    host: String,
    token: String,
    id: u64,
    stars: i64,
) -> AppResult<RateResult> {
    let token = require_token(&token)?;
    if !(1..=5).contains(&stars) {
        return Err(AppError::msg("Rating must be between 1 and 5 stars."));
    }
    let resp = post_json(
        &endpoint(&host).rating_url(id),
        token,
        &serde_json::json!({ "stars": stars }),
    )
    .await?;
    api::parse_rate(&resp).map_err(|e| AppError::msg(format!("bad rating response: {e}")))
}

/// Admin: set a request's status (`POST /api/requests/:id/status` with `{status}`).
#[tauri::command]
pub async fn requests_status(
    host: String,
    token: String,
    id: u64,
    status: String,
) -> AppResult<bool> {
    let token = require_token(&token)?;
    if !api::is_valid_status(&status) {
        return Err(AppError::msg(format!("Invalid status: {status}")));
    }
    post_json(
        &endpoint(&host).status_url(id),
        token,
        &serde_json::json!({ "status": status }),
    )
    .await?;
    Ok(true)
}

/// Bearer-authed GET returning the body text, with a clear error on non-2xx.
async fn get(url: &str, token: &str) -> AppResult<String> {
    let resp = reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("requests request failed: {e}")))?;
    read_body(resp).await
}

/// Bearer-authed JSON POST returning the body text, with a clear error on non-2xx.
async fn post_json<T: serde::Serialize>(url: &str, token: &str, body: &T) -> AppResult<String> {
    let resp = reqwest::Client::new()
        .post(url)
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("requests request failed: {e}")))?;
    read_body(resp).await
}

/// Map a non-2xx status to an `AppError` (401/403 get a sign-in hint), else return
/// the body text.
async fn read_body(resp: reqwest::Response) -> AppResult<String> {
    let status = resp.status();
    if !status.is_success() {
        if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            return Err(AppError::msg(
                "The Game Requests board rejected your sign-in. Try reconnecting.",
            ));
        }
        return Err(AppError::msg(format!("requests call failed (HTTP {status})")));
    }
    resp.text()
        .await
        .map_err(|e| AppError::msg(format!("requests read failed: {e}")))
}
