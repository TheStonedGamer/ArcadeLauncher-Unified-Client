//! Social transport commands exposed to the webview. They are a thin shell over
//! the engine in `transport.rs` and the REST call below; all the connection
//! logic lives there. The host + token are passed per-call from the frontend
//! (which sources them from the user's session) and never persisted here.

use crate::error::{AppError, AppResult};
use crate::social::attach::{basename, guess_content_type, is_acceptable_size, MAX_ATTACHMENT_BYTES};
use crate::social::endpoint::Endpoint;
use crate::social::model::Friend;
use crate::social::transport::SocialTransport;
use serde::{Deserialize, Serialize};
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

/// Result of uploading a local file as a DM attachment: the server-assigned
/// attachment id (to ride along on the next `chat` frame) plus the metadata the
/// UI shows on the optimistic bubble before the acked frame arrives.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAttachment {
    pub attachment_id: u64,
    pub filename: String,
    pub size: u64,
}

/// Upload a user-picked file as a pending DM attachment: register it
/// (`POST /attachments/presign`) and PUT the bytes straight to the returned
/// presigned URL (which carries its own auth, so no bearer there). The returned
/// `attachmentId` is then sent on a `chat` frame to link it to the message.
///
/// Bytes never transit the webview; the token stays in Rust. Over-large or empty
/// files are rejected before any network call. 503 from the server means the
/// object store isn't configured — surfaced as a friendly error.
#[tauri::command]
pub async fn social_attachment_upload(
    host: String,
    token: String,
    file_path: String,
) -> AppResult<UploadedAttachment> {
    let endpoint = Endpoint::new(host, token);
    let bytes = std::fs::read(&file_path).map_err(|e| AppError::msg(format!("can't read file: {e}")))?;
    let size = bytes.len() as u64;
    if !is_acceptable_size(size) {
        return Err(AppError::msg(format!(
            "attachment must be 1 byte to {} MiB",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        )));
    }
    let filename = basename(&file_path);
    if filename.is_empty() {
        return Err(AppError::msg("invalid file name"));
    }
    let content_type = guess_content_type(&filename);

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PresignReq<'a> {
        filename: &'a str,
        content_type: &'a str,
        size: u64,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PresignResp {
        attachment_id: u64,
        upload_url: String,
    }

    let client = reqwest::Client::new();
    let presign = client
        .post(endpoint.attachment_presign_url())
        .bearer_auth(endpoint.token())
        .json(&PresignReq { filename: &filename, content_type, size })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("presign request failed: {e}")))?;
    if presign.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE {
        return Err(AppError::msg("attachments are not enabled on this server"));
    }
    if !presign.status().is_success() {
        return Err(AppError::msg(format!("presign failed (HTTP {})", presign.status())));
    }
    let presign: PresignResp = presign
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid presign response: {e}")))?;

    let put = client
        .put(&presign.upload_url)
        .header("Content-Type", content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("upload failed: {e}")))?;
    if !put.status().is_success() {
        return Err(AppError::msg(format!("upload failed (HTTP {})", put.status())));
    }

    Ok(UploadedAttachment { attachment_id: presign.attachment_id, filename, size })
}

/// A presigned download for one attachment, gated server-side to the owner or
/// the DM's two participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentLink {
    pub download_url: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub size: i64,
}

/// Resolve a short-lived presigned download URL (+ metadata) for an attachment
/// id, so the webview can open or download it. The bearer token authorizes the
/// lookup; the returned URL is self-authorizing for the actual GET.
#[tauri::command]
pub async fn social_attachment_url(host: String, token: String, attachment_id: u64) -> AppResult<AttachmentLink> {
    let endpoint = Endpoint::new(host, token);
    let client = reqwest::Client::new();
    let resp = client
        .get(endpoint.attachment_url(attachment_id))
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("attachment request failed: {e}")))?;
    if resp.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE {
        return Err(AppError::msg("attachments are not enabled on this server"));
    }
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("attachment lookup failed (HTTP {})", resp.status())));
    }
    resp.json::<AttachmentLink>()
        .await
        .map_err(|e| AppError::msg(format!("invalid attachment response: {e}")))
}

/// A user's public profile (ROADMAP T9d). `banner`/`bio` are normalized to empty
/// strings (the server stores them nullable). `level` is server-computed from
/// `xp`; the client mirrors the same formula for the progress bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub user_id: u64,
    pub username: String,
    pub avatar_version: i64,
    pub banner: String,
    pub bio: String,
    pub level: i64,
    pub xp: i64,
}

/// Fetch any account's public profile. Bearer-authed (the endpoint is gated to
/// signed-in callers, but any signed-in user may view any profile).
#[tauri::command]
pub async fn social_profile_get(host: String, token: String, user_id: u64) -> AppResult<Profile> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Resp {
        #[serde(default)]
        user_id: u64,
        #[serde(default)]
        username: String,
        #[serde(default)]
        avatar_version: i64,
        #[serde(default)]
        banner: Option<String>,
        #[serde(default)]
        bio: Option<String>,
        #[serde(default)]
        level: i64,
        #[serde(default)]
        xp: i64,
    }

    let endpoint = Endpoint::new(host, token);
    let client = reqwest::Client::new();
    let resp = client
        .get(endpoint.profile_url(user_id))
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("profile request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("profile lookup failed (HTTP {})", resp.status())));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid profile response: {e}")))?;
    Ok(Profile {
        user_id: r.user_id,
        username: r.username,
        avatar_version: r.avatar_version,
        banner: r.banner.unwrap_or_default(),
        bio: r.bio.unwrap_or_default(),
        level: r.level,
        xp: r.xp,
    })
}

/// Update the caller's own profile. Only the supplied fields are sent (and the
/// server updates only those), so banner and bio can change independently.
#[tauri::command]
pub async fn social_profile_update(
    host: String,
    token: String,
    banner: Option<String>,
    bio: Option<String>,
) -> AppResult<()> {
    #[derive(Serialize)]
    struct Body {
        #[serde(skip_serializing_if = "Option::is_none")]
        banner: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bio: Option<String>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = reqwest::Client::new();
    let resp = client
        .put(endpoint.profile_self_url())
        .bearer_auth(endpoint.token())
        .json(&Body { banner, bio })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("profile update failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("profile update failed (HTTP {})", resp.status())));
    }
    Ok(())
}
