//! Server-brokered Headscale pre-auth (T12k-8 — play-from-anywhere).
//!
//! The launcher never holds the Headscale API key; it asks the server (which
//! does) to mint a short-lived, single-use pre-auth key so the bundled
//! `tailscaled` can join the overlay with no interactive Tailscale login. This is
//! the renderer-facing transport for `POST /api/social/mesh/preauth`, mirroring
//! the host+token-per-call shape of `mypcs_commands`. The minted key is then fed
//! to `mesh_join` (in `conn`); nothing here touches the daemon.

use crate::error::{AppError, AppResult};
use crate::social::endpoint::Endpoint;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Same bounded timeouts as the other social REST calls so an unreachable gateway
/// fails fast instead of spinning the UI.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

/// Request body for `POST /api/social/mesh/preauth`. Both fields are optional
/// server-side; we always send them so the intent is explicit.
#[derive(Debug, Clone, Serialize)]
struct PreauthReq {
    hostname: String,
    ephemeral: bool,
}

/// The server's minted key + overlay coordinates (mirrors the endpoint's JSON).
/// `login_server` is the Headscale control URL the daemon joins; `user` is
/// informational. Field names are the server's camelCase wire form.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPreauth {
    pub key: String,
    pub login_server: String,
    pub user: String,
    pub ephemeral: bool,
    pub expires_at: String,
}

/// Mint a single-use Headscale pre-auth key for this device via the server. The
/// session `token` gates the call (the server checks the launcher user); a stream
/// *client* passes `ephemeral = true` so Headscale auto-reaps the node when it
/// goes offline. The feature is dormant (HTTP 503) until the server is configured
/// with a Headscale API key — callers degrade to LAN-only on error.
#[tauri::command]
pub async fn mesh_preauth(
    host: String,
    token: String,
    hostname: String,
    ephemeral: bool,
) -> AppResult<MeshPreauth> {
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .post(endpoint.mesh_preauth_url())
        .bearer_auth(endpoint.token())
        .json(&PreauthReq { hostname, ephemeral })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("mesh preauth request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("mesh preauth failed (HTTP {})", resp.status())));
    }
    resp.json::<MeshPreauth>()
        .await
        .map_err(|e| AppError::msg(format!("invalid mesh preauth response: {e}")))
}
