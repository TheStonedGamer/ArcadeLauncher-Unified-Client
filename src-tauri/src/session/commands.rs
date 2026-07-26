//! Login command: performs the server's challenge-response auth in Rust so the
//! password never leaves the process except as a derived proof, and the bearer
//! token is decrypted here (never travels in cleartext). Falls back to the
//! plain `/api/login` form when an account has no challenge key.
//!
//! The returned [`Session`] carries the host + token the social/download
//! features need; the password is used only to derive the key and is never
//! stored or logged.

use crate::error::{AppError, AppResult};
use crate::session::crypto;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// A signed-in session handed back to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Normalized host authority (no scheme), e.g. `arcade.orlandoaio.net`.
    pub host: String,
    pub username: String,
    pub token: String,
    pub is_admin: bool,
    pub must_change_password: bool,
}

/// Strip any scheme and trailing slash so we control the transport scheme.
fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

/// Load the signed-in account's server-synced profile picture as a data URL.
/// A missing avatar is not an error; the UI falls back to the username initial.
#[tauri::command]
pub async fn session_avatar(host: String, token: String) -> AppResult<Option<String>> {
    let host = normalize_host(&host);
    let resp = reqwest::Client::new()
        .get(format!("https://{host}/api/account/avatar"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("avatar request failed: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::msg(format!(
            "avatar request failed (HTTP {status})"
        )));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("image/png")
        .trim()
        .to_string();
    if !mime.starts_with("image/") {
        return Err(AppError::msg("avatar response was not an image"));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::msg(format!("read avatar: {e}")))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[derive(Deserialize)]
struct ChallengeResp {
    nonce: String,
}

#[derive(Deserialize)]
struct VerifyResp {
    iv: String,
    token: String,
    #[serde(default)]
    username: String,
    #[serde(default, rename = "isAdmin")]
    is_admin: bool,
    #[serde(default, rename = "mustChangePassword")]
    must_change_password: bool,
}

#[derive(Deserialize)]
struct LoginResp {
    token: String,
    #[serde(default)]
    username: String,
    #[serde(default, rename = "isAdmin")]
    is_admin: bool,
    #[serde(default, rename = "mustChangePassword")]
    must_change_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrSigninStart {
    pub challenge_id: String,
    pub scan_secret: String,
    pub poll_token: String,
    pub expires_in: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QrPollResp {
    status: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    is_admin: bool,
    #[serde(default)]
    must_change_password: bool,
}

/// Create a short-lived launcher QR sign-in request. The scan secret is safe to
/// render; the distinct poll token must remain on this desktop.
#[tauri::command]
pub async fn session_qr_start(host: String) -> AppResult<QrSigninStart> {
    let host = normalize_host(&host);
    let resp = reqwest::Client::new()
        .post(format!("https://{host}/api/auth/qr/start"))
        .form(&[
            ("target", "launcher"),
            ("deviceName", "Arcade Launcher desktop"),
        ])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("QR sign-in request failed: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let msg = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| format!("QR sign-in failed (HTTP {status})"));
        return Err(AppError::msg(msg));
    }
    resp.json()
        .await
        .map_err(|e| AppError::msg(format!("invalid QR sign-in response: {e}")))
}

/// Poll once for a QR sign-in result. Pending returns `None`; approval returns a
/// normal Session that the existing store persists exactly like password login.
#[tauri::command]
pub async fn session_qr_poll(
    host: String,
    challenge_id: String,
    poll_token: String,
) -> AppResult<Option<Session>> {
    let host = normalize_host(&host);
    let resp = reqwest::Client::new()
        .post(format!("https://{host}/api/auth/qr/poll"))
        .form(&[
            ("challengeId", challenge_id.as_str()),
            ("pollToken", poll_token.as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("QR sign-in poll failed: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid QR sign-in poll response: {e}")))?;
    if status == reqwest::StatusCode::ACCEPTED {
        return Ok(None);
    }
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("QR sign-in failed (HTTP {status})"));
        return Err(AppError::msg(msg));
    }
    let completed: QrPollResp = serde_json::from_value(body)
        .map_err(|e| AppError::msg(format!("invalid QR sign-in completion: {e}")))?;
    if completed.status != "complete" || completed.token.is_empty() {
        return Err(AppError::msg("server returned an incomplete QR sign-in"));
    }
    Ok(Some(Session {
        host,
        username: completed.username,
        token: completed.token,
        is_admin: completed.is_admin,
        must_change_password: completed.must_change_password,
    }))
}

/// Log in to `host` with `username`/`password` (+ optional `totp_code`).
#[tauri::command]
pub async fn session_login(
    host: String,
    username: String,
    password: String,
    totp_code: String,
) -> AppResult<Session> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();

    // 1) Try the privacy-preserving challenge-response flow.
    let challenge = client
        .get(format!("https://{host}/api/auth/challenge"))
        .query(&[("username", username.as_str())])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("challenge request failed: {e}")))?;

    if challenge.status().is_success() {
        let ChallengeResp { nonce } = challenge
            .json()
            .await
            .map_err(|e| AppError::msg(format!("invalid challenge response: {e}")))?;

        let key = crypto::derive_auth_key(&username, &password);
        let proof = crypto::challenge_proof(&key, &nonce);

        let resp = client
            .post(format!("https://{host}/api/auth/verify"))
            .form(&[
                ("username", username.as_str()),
                ("proof", proof.as_str()),
                ("totpCode", totp_code.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::msg(format!("verify request failed: {e}")))?;

        if resp.status().is_success() {
            let v: VerifyResp = resp
                .json()
                .await
                .map_err(|e| AppError::msg(format!("invalid verify response: {e}")))?;
            let token = crypto::decrypt_token(&key, &v.iv, &v.token).map_err(AppError::msg)?;
            return Ok(Session {
                host,
                username: pick_name(v.username, &username),
                token,
                is_admin: v.is_admin,
                must_change_password: v.must_change_password,
            });
        }
        // A 401 here usually means "no challenge key for this account" — fall
        // through to password login. Other errors also fall through and surface
        // from the password attempt (so the user sees one clear message).
    }

    // 2) Fallback: plain password login.
    login_with_password(&client, &host, &username, &password, &totp_code).await
}

async fn login_with_password(
    client: &reqwest::Client,
    host: &str,
    username: &str,
    password: &str,
    totp_code: &str,
) -> AppResult<Session> {
    let resp = client
        .post(format!("https://{host}/api/login"))
        .form(&[
            ("username", username),
            ("password", password),
            ("totp_code", totp_code),
        ])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("login request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        // Surface the server's message when present.
        let msg = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("login failed (HTTP {status})"));
        return Err(AppError::msg(msg));
    }

    let l: LoginResp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid login response: {e}")))?;
    Ok(Session {
        host: host.to_string(),
        username: pick_name(l.username, username),
        token: l.token,
        is_admin: l.is_admin,
        must_change_password: l.must_change_password,
    })
}

/// Outcome of a self-registration request: the server-supplied human-readable
/// message to show the user (the account is created in a pending state and an
/// admin must approve it before sign-in works).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterOutcome {
    pub status: String,
    pub message: String,
}

#[derive(Deserialize)]
struct RegisterResp {
    #[serde(default)]
    status: String,
    #[serde(default)]
    message: String,
}

/// Submit a self-registration request to `host`. On success the account is left
/// pending admin approval; the password is sent over TLS to the register
/// endpoint (the server hashes it) and is never stored locally.
#[tauri::command]
pub async fn session_register(
    host: String,
    username: String,
    email: String,
    password: String,
) -> AppResult<RegisterOutcome> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("https://{host}/api/auth/register"))
        .form(&[
            ("username", username.trim()),
            ("email", email.trim()),
            ("password", password.as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("register request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        // Surface the server's `error` message (closed/duplicate/validation).
        let msg = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("registration failed (HTTP {status})"));
        return Err(AppError::msg(msg));
    }

    let r: RegisterResp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid register response: {e}")))?;
    Ok(RegisterOutcome {
        status: if r.status.is_empty() { "pending".into() } else { r.status },
        message: if r.message.is_empty() {
            "Request submitted — an administrator must approve your account.".into()
        } else {
            r.message
        },
    })
}

/// Outcome of a password-reset request. The server always returns a generic
/// success (anti-enumeration), so this just carries the message to display.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotOutcome {
    pub message: String,
}

#[derive(Deserialize)]
struct ForgotResp {
    #[serde(default)]
    message: String,
}

/// Request a password-reset link for `identifier` (username or email) on `host`.
/// The server emails a single-use reset link and always responds with a generic
/// message, so this never reveals whether the account exists.
#[tauri::command]
pub async fn session_forgot(host: String, identifier: String) -> AppResult<ForgotOutcome> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("https://{host}/api/auth/forgot"))
        .form(&[("identifier", identifier.trim())])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("reset request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let msg = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("password reset failed (HTTP {status})"));
        return Err(AppError::msg(msg));
    }

    let r: ForgotResp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid reset response: {e}")))?;
    Ok(ForgotOutcome {
        message: if r.message.is_empty() {
            "If an account matches, a password reset link has been emailed.".into()
        } else {
            r.message
        },
    })
}

/// Prefer the server-confirmed username; fall back to what the user typed.
fn pick_name(from_server: String, typed: &str) -> String {
    if from_server.is_empty() {
        typed.to_string()
    } else {
        from_server
    }
}
