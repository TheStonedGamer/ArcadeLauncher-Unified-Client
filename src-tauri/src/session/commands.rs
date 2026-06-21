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
