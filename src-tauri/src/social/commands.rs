//! Social transport commands exposed to the webview. They are a thin shell over
//! the engine in `transport.rs` and the REST call below; all the connection
//! logic lives there. The host + token are passed per-call from the frontend
//! (which sources them from the user's session) and never persisted here.

use crate::error::{AppError, AppResult};
use crate::social::endpoint::Endpoint;
use crate::social::model::Friend;
use crate::social::transport::SocialTransport;
use serde::Deserialize;
use tauri::State;

/// Open (or replace) the live social gateway connection. Frames arrive as
/// `social://frame` events; lifecycle as `social://state` events.
#[tauri::command]
pub fn social_connect(
    app: tauri::AppHandle,
    transport: State<'_, SocialTransport>,
    host: String,
    token: String,
) {
    transport.connect(app, Endpoint::new(host, token));
}

/// Queue a raw outbound frame (built by the TS `outbound` helpers) for the
/// socket. Returns false if there is no live connection.
#[tauri::command]
pub fn social_send(transport: State<'_, SocialTransport>, frame: String) -> bool {
    transport.send(frame)
}

/// Tear down the live connection.
#[tauri::command]
pub fn social_disconnect(transport: State<'_, SocialTransport>) {
    transport.disconnect();
}

/// Pull the authoritative friend list from REST `/api/social/friends`. Done in
/// Rust (not webview `fetch`) so the bearer token stays out of the renderer and
/// there is no CORS surface.
#[tauri::command]
pub async fn social_fetch_friends(host: String, token: String) -> AppResult<Vec<Friend>> {
    let endpoint = Endpoint::new(host, token);

    #[derive(Deserialize)]
    struct FriendsResponse {
        #[serde(default)]
        friends: Vec<Friend>,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(endpoint.friends_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("friends request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::msg(format!("friends request returned HTTP {}", resp.status())));
    }

    let body: FriendsResponse = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid friends response: {e}")))?;
    Ok(body.friends)
}
