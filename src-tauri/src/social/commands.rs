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
use std::time::Duration;
use tauri::State;

/// HTTP client for the social REST calls. These are small, latency-sensitive
/// requests, so we cap how long the renderer can be left waiting: an
/// unreachable or stalled gateway surfaces as a clear error instead of an
/// indefinitely pending command (which would leave the UI spinning forever —
/// e.g. the "Searching…" state on the add-friend box). Falls back to the
/// default (no-timeout) client only if the builder fails, which it never does
/// with these options.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

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

    let client = http_client();
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

    let client = http_client();
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

    // The object-store PUT streams up to MAX_ATTACHMENT_BYTES, which can outlast
    // the short REST timeout on a slow link, so give the upload its own client
    // with a generous overall budget (connect still bounded).
    let upload_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default();
    let put = upload_client
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
    let client = http_client();
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
    let client = http_client();
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
    let client = http_client();
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

/// One friend's organization metadata (ROADMAP T9e). `groups` stays the raw
/// comma-separated wire string; the TS core (friendMeta.ts) parses it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendMeta {
    pub user_id: u64,
    pub note: String,
    pub groups: String,
    pub pinned: bool,
}

/// Fetch all the caller's friend-meta rows (notes/groups/pinned).
#[tauri::command]
pub async fn social_friendmeta_get(host: String, token: String) -> AppResult<Vec<FriendMeta>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        #[serde(default)]
        user_id: u64,
        #[serde(default)]
        note: Option<String>,
        #[serde(default)]
        groups: Option<String>,
        #[serde(default)]
        pinned: bool,
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        meta: Vec<Row>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.friendmeta_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("friend-meta request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("friend-meta lookup failed (HTTP {})", resp.status())));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid friend-meta response: {e}")))?;
    Ok(r
        .meta
        .into_iter()
        .map(|row| FriendMeta {
            user_id: row.user_id,
            note: row.note.unwrap_or_default(),
            groups: row.groups.unwrap_or_default(),
            pinned: row.pinned,
        })
        .collect())
}

/// Upsert note/groups/pinned for one friend. Only supplied fields change
/// server-side. `groups` is the comma-separated wire string.
#[tauri::command]
pub async fn social_friendmeta_set(
    host: String,
    token: String,
    user_id: u64,
    note: Option<String>,
    groups: Option<String>,
    pinned: Option<bool>,
) -> AppResult<()> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        user_id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        note: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        groups: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pinned: Option<bool>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .put(endpoint.friendmeta_url())
        .bearer_auth(endpoint.token())
        .json(&Body { user_id, note, groups, pinned })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("friend-meta update failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("friend-meta update failed (HTTP {})", resp.status())));
    }
    Ok(())
}

/// One username-search hit (ROADMAP T9e).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub user_id: u64,
    pub username: String,
}

/// Search accounts by username (server: LIKE, ≤20, excludes self and blocks).
#[tauri::command]
pub async fn social_user_search(host: String, token: String, query: String) -> AppResult<Vec<SearchHit>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Hit {
        #[serde(default)]
        user_id: u64,
        #[serde(default)]
        username: String,
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        users: Vec<Hit>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.search_url(&query))
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("search request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("search failed (HTTP {})", resp.status())));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid search response: {e}")))?;
    Ok(r
        .users
        .into_iter()
        .map(|h| SearchHit { user_id: h.user_id, username: h.username })
        .collect())
}

/// Send a friend request by username (ROADMAP T9e). The server resolves the
/// username, honours block/ignore/privacy, and may instant-accept if the target
/// already invited the caller. Returns the server's status string (e.g.
/// "request_sent" / "accepted").
#[tauri::command]
pub async fn social_friend_request(host: String, token: String, username: String) -> AppResult<String> {
    #[derive(Serialize)]
    struct Body {
        username: String,
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        status: String,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .post(endpoint.friend_request_url())
        .bearer_auth(endpoint.token())
        .json(&Body { username })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("friend request failed: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        // Surface the server's plain-text reason (e.g. "No such user").
        let body = resp.text().await.unwrap_or_default();
        let reason = if body.trim().is_empty() { status.to_string() } else { body };
        return Err(AppError::msg(format!("friend request failed: {reason}")));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid friend-request response: {e}")))?;
    Ok(if r.status.is_empty() { "request_sent".to_string() } else { r.status })
}

/// Respond to or unwind a friendship (the Requests tab Accept/Decline, plus
/// cancel/remove/ignore). `action` ∈ accept|decline|cancel|remove|ignore; the
/// server applies it against the pending/accepted row and notifies the peer
/// (except `ignore`, which is silent). Returns the server's status string
/// (e.g. "accepted" / "removed").
#[tauri::command]
pub async fn social_friend_respond(
    host: String,
    token: String,
    user_id: u64,
    action: String,
) -> AppResult<String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        user_id: u64,
        action: String,
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        status: String,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .post(endpoint.friend_respond_url())
        .bearer_auth(endpoint.token())
        .json(&Body { user_id, action })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("friend response failed: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let reason = if body.trim().is_empty() { status.to_string() } else { body };
        return Err(AppError::msg(format!("friend response failed: {reason}")));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid friend-response payload: {e}")))?;
    Ok(r.status)
}

/// The caller's privacy policies (ROADMAP T9f / 1.1b). `friend_policy` ∈
/// everyone|mutual|nobody; `dm_policy` ∈ everyone|friends|nobody.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Privacy {
    pub friend_policy: String,
    pub dm_policy: String,
}

/// Fetch the caller's friend-request + DM privacy policies.
#[tauri::command]
pub async fn social_privacy_get(host: String, token: String) -> AppResult<Privacy> {
    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.privacy_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("privacy request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("privacy lookup failed (HTTP {})", resp.status())));
    }
    resp.json()
        .await
        .map_err(|e| AppError::msg(format!("invalid privacy response: {e}")))
}

/// Update the caller's privacy policies; only supplied fields change.
#[tauri::command]
pub async fn social_privacy_set(
    host: String,
    token: String,
    friend_policy: Option<String>,
    dm_policy: Option<String>,
) -> AppResult<Privacy> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        #[serde(skip_serializing_if = "Option::is_none")]
        friend_policy: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        dm_policy: Option<String>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .put(endpoint.privacy_url())
        .bearer_auth(endpoint.token())
        .json(&Body { friend_policy, dm_policy })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("privacy update failed: {e}")))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let reason = if body.trim().is_empty() { st.to_string() } else { body };
        return Err(AppError::msg(format!("privacy update failed: {reason}")));
    }
    resp.json()
        .await
        .map_err(|e| AppError::msg(format!("invalid privacy response: {e}")))
}

/// Fetch the account ids the caller is ignoring.
#[tauri::command]
pub async fn social_ignores_get(host: String, token: String) -> AppResult<Vec<u64>> {
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        ignored: Vec<u64>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.ignores_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("ignores request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("ignores lookup failed (HTTP {})", resp.status())));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid ignores response: {e}")))?;
    Ok(r.ignored)
}

/// One ICE server entry for a WebRTC connection. `urls` may be a single string
/// or an array (RTCIceServer shape); we pass it through as raw JSON. `username`/
/// `credential` are present only for TURN servers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

/// ICE configuration for a voice call: the servers + the credential TTL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IceConfig {
    pub ice_servers: Vec<IceServer>,
    #[serde(default)]
    pub ttl: i64,
}

/// Fetch per-call WebRTC ICE servers (STUN + short-lived TURN credentials) for
/// voice (ROADMAP T9g). The server scopes TURN creds to the caller.
#[tauri::command]
pub async fn social_turn_servers(host: String, token: String) -> AppResult<IceConfig> {
    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.turn_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("turn request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("turn lookup failed (HTTP {})", resp.status())));
    }
    resp.json()
        .await
        .map_err(|e| AppError::msg(format!("invalid turn response: {e}")))
}

/// Add or remove a persistent ignore on another account.
#[tauri::command]
pub async fn social_ignore_set(host: String, token: String, user_id: u64, ignore: bool) -> AppResult<()> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        user_id: u64,
        ignore: bool,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .post(endpoint.ignores_url())
        .bearer_auth(endpoint.token())
        .json(&Body { user_id, ignore })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("ignore update failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("ignore update failed (HTTP {})", resp.status())));
    }
    Ok(())
}

/// One entry in the friends activity feed (ROADMAP 3.7). `kind` is the event
/// type (`played` | `review` | `screenshot` | …) and `payload` is passed
/// through as raw kind-specific JSON for the UI to render. `game_id` is present
/// for game-scoped events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: u64,
    pub user_id: u64,
    pub username: String,
    pub kind: String,
    pub game_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: i64,
}

/// Fetch the caller's friends activity feed (own + accepted friends, newest
/// first, ≤100). Server-derived and bearer-authed; done in Rust so the token
/// stays out of the renderer.
#[tauri::command]
pub async fn social_activity_fetch(host: String, token: String) -> AppResult<Vec<ActivityItem>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        #[serde(default)]
        id: u64,
        #[serde(default)]
        user_id: u64,
        #[serde(default)]
        username: String,
        #[serde(default)]
        kind: String,
        #[serde(default)]
        game_id: Option<String>,
        #[serde(default)]
        payload: serde_json::Value,
        #[serde(default)]
        created_at: i64,
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        activity: Vec<Row>,
    }

    let endpoint = Endpoint::new(host, token);
    let client = http_client();
    let resp = client
        .get(endpoint.activity_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("activity request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("activity lookup failed (HTTP {})", resp.status())));
    }
    let r: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid activity response: {e}")))?;
    Ok(r
        .activity
        .into_iter()
        .map(|row| ActivityItem {
            id: row.id,
            user_id: row.user_id,
            username: row.username,
            kind: row.kind,
            game_id: row.game_id,
            payload: row.payload,
            created_at: row.created_at,
        })
        .collect())
}
