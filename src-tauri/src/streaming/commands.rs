//! Tauri commands for Sunshine host control (T12k-2, live half). Thin HTTPS seam
//! over the pure `control` core: pair via PIN, list the host's apps, and add a
//! launcher game as a Sunshine app. The pure layer owns URL/body/parse shaping
//! and the cert-pin decision; this layer only does the IO.
//!
//! **Certificate pinning (TOFU).** Sunshine's config API uses a self-signed
//! cert whose CN never matches a LAN IP, so a normal CA/hostname check can't
//! work. Instead the client accepts the cert at the TLS layer (`tls_info`
//! captures the presented leaf cert), computes its SHA-256, and enforces a
//! **pin**: the fingerprint is recorded on first pair and every later request
//! must match it — a swapped cert is rejected. So we never blindly trust beyond
//! the first pair, and we never need a custom rustls verifier (no extra dep).
//!
//! Credentials (Sunshine Basic-auth user/pass) are passed per-call from the
//! frontend and never persisted; only the host record + pin live on disk.

use crate::error::{AppError, AppResult};
use crate::streaming::control::{self, ControlEndpoint};
use crate::streaming::host::{HostState, StreamHost, SunshineApp};
use crate::streaming::moonlight::{self, StreamSettings};
use crate::streaming::store;
use std::path::PathBuf;
use tauri::Manager;

/// Per-user registry path (`app_config_dir/streaming_hosts.json`).
fn hosts_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("streaming_hosts.json"))
}

/// The TOFU HTTPS client. It accepts the host's self-signed cert at the TLS
/// layer (Sunshine certs are self-signed; CN won't match a LAN address) and
/// captures the presented cert so the caller can enforce the SHA-256 pin — a
/// changed cert is still refused by `enforce_pin`, so this is pinned, not open.
fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .tls_info(true)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::msg(format!("tls client build failed: {e}")))
}

/// SHA-256 fingerprint of the cert the host presented on this response.
fn peer_fingerprint(resp: &reqwest::Response) -> AppResult<String> {
    let info = resp
        .extensions()
        .get::<reqwest::tls::TlsInfo>()
        .ok_or_else(|| AppError::msg("no TLS info on response (cannot pin host)"))?;
    let der = info
        .peer_certificate()
        .ok_or_else(|| AppError::msg("host presented no certificate"))?;
    Ok(control::cert_fingerprint_hex(der))
}

/// Reject a connection whose presented fingerprint doesn't match the pinned one.
/// `expected = None` means we have no pin yet (first pair / TOFU) and accept.
fn enforce_pin(expected: Option<&str>, presented: &str) -> AppResult<()> {
    match expected {
        Some(p) if !control::fingerprint_matches(p, presented) => Err(AppError::msg(
            "The streaming host's certificate changed since pairing — refusing to \
             connect (possible man-in-the-middle). Forget and re-pair the host if \
             this change is expected.",
        )),
        _ => Ok(()),
    }
}

/// Map a Basic-auth rejection to a clear error; other non-2xx pass through with
/// the status so the caller can surface it.
fn check_auth(status: reqwest::StatusCode) -> AppResult<()> {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::msg(
            "Sunshine rejected the username/password. Check the host's Web UI credentials.",
        ));
    }
    Ok(())
}

/// Pair with a Sunshine host: submit the 4-digit PIN (the host shows it / you
/// set it in Sunshine), record the host + its cert pin on success. `name` is the
/// device label Sunshine stores; blank → "ArcadeLauncher". Returns whether
/// Sunshine accepted the PIN.
#[tauri::command]
pub async fn sunshine_pair(
    app: tauri::AppHandle,
    address: String,
    username: String,
    password: String,
    pin: String,
    name: String,
) -> AppResult<bool> {
    if !control::is_valid_pin(&pin) {
        return Err(AppError::msg("PIN must be exactly 4 digits."));
    }
    let addr = control::normalize_address(&address);
    let ep = ControlEndpoint::new(&addr);
    let label = if name.trim().is_empty() { "ArcadeLauncher" } else { name.trim() };

    let resp = client()?
        .post(ep.pin_url())
        .header("Authorization", control::basic_auth_value(&username, &password))
        .json(&control::pin_body(&pin, label))
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Sunshine pair request failed: {e}")))?;

    let presented = peer_fingerprint(&resp)?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    check_auth(status)?;

    // Enforce an existing pin (re-pair), or accept this one as the TOFU pin.
    let path = hosts_path(&app)?;
    let mut hosts = store::load(&path)?;
    enforce_pin(hosts.pinned_fingerprint(&addr), &presented)?;

    let accepted = control::parse_pin_result(&body);
    if accepted {
        let existing = hosts.get(&addr).cloned();
        hosts.upsert(StreamHost {
            name: existing
                .as_ref()
                .map(|h| h.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| addr.clone()),
            address: addr.clone(),
            paired: true,
            state: HostState::Online,
            fingerprint: presented,
        });
        store::save(&path, &hosts)?;
    }
    Ok(accepted)
}

/// List the apps a paired host advertises (`GET /api/apps`). Requires a prior
/// pair (so we have a pin to enforce). Marks the host Online on success.
#[tauri::command]
pub async fn sunshine_apps(
    app: tauri::AppHandle,
    address: String,
    username: String,
    password: String,
) -> AppResult<Vec<SunshineApp>> {
    let addr = control::normalize_address(&address);
    let ep = ControlEndpoint::new(&addr);
    let path = hosts_path(&app)?;
    let mut hosts = store::load(&path)?;
    let pin = hosts
        .pinned_fingerprint(&addr)
        .ok_or_else(|| AppError::msg("Pair with this host before listing its apps."))?
        .to_string();

    let resp = client()?
        .get(ep.apps_url())
        .header("Authorization", control::basic_auth_value(&username, &password))
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Sunshine apps request failed: {e}")))?;

    let presented = peer_fingerprint(&resp)?;
    enforce_pin(Some(&pin), &presented)?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    check_auth(status)?;
    if !status.is_success() {
        return Err(AppError::msg(format!("Sunshine apps call failed (HTTP {status})")));
    }
    let apps = crate::streaming::host::parse_apps(&body)
        .map_err(|e| AppError::msg(format!("bad apps response: {e}")))?;

    // Reachable → mark Online.
    if let Some(h) = hosts.get(&addr).cloned() {
        hosts.upsert(StreamHost { state: HostState::Online, ..h });
        store::save(&path, &hosts)?;
    }
    Ok(apps)
}

/// Add a launcher game to a paired host as a Sunshine app (`POST /api/apps`), so
/// launching it on the host runs `cmd`. Requires a prior pair. Returns success.
#[tauri::command]
pub async fn sunshine_add_app(
    app: tauri::AppHandle,
    address: String,
    username: String,
    password: String,
    name: String,
    cmd: String,
    image_path: String,
) -> AppResult<bool> {
    let addr = control::normalize_address(&address);
    let ep = ControlEndpoint::new(&addr);
    let path = hosts_path(&app)?;
    let hosts = store::load(&path)?;
    let pin = hosts
        .pinned_fingerprint(&addr)
        .ok_or_else(|| AppError::msg("Pair with this host before adding a game."))?
        .to_string();

    let resp = client()?
        .post(ep.apps_url())
        .header("Authorization", control::basic_auth_value(&username, &password))
        .json(&control::new_app_body(&name, &cmd, &image_path))
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Sunshine add-app request failed: {e}")))?;

    let presented = peer_fingerprint(&resp)?;
    enforce_pin(Some(&pin), &presented)?;
    let status = resp.status();
    check_auth(status)?;
    Ok(status.is_success())
}

/// The hosts on record (for the streaming UI / host picker). Read-only.
#[tauri::command]
pub async fn streaming_hosts(app: tauri::AppHandle) -> AppResult<Vec<StreamHost>> {
    Ok(store::load(&hosts_path(&app)?)?.hosts)
}

/// Resolve the Moonlight client executable by probing the platform's candidate
/// names across `PATH`. Returns the first match, or `None` if none is installed.
fn resolve_moonlight() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for cand in moonlight::executable_candidates() {
            let full = dir.join(cand);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

/// Whether a Moonlight client is installed and launchable on this machine.
#[tauri::command]
pub async fn moonlight_available() -> AppResult<bool> {
    Ok(resolve_moonlight().is_some())
}

/// Launch the Moonlight client to stream `app` from `host` with `settings`.
/// We shell out to the upstream Moonlight binary (GPL, separate process — never
/// linked); the pure `moonlight` core shapes the argv. Returns once the child is
/// spawned (Moonlight owns its own window thereafter).
#[tauri::command]
pub async fn stream_launch(
    address: String,
    app: String,
    settings: Option<StreamSettings>,
) -> AppResult<bool> {
    let exe = resolve_moonlight().ok_or_else(|| {
        AppError::msg(
            "Moonlight is not installed (or not on PATH). Install the Moonlight client to stream.",
        )
    })?;
    let host = control::normalize_address(&address);
    if host.is_empty() {
        return Err(AppError::msg("No streaming host address."));
    }
    if app.trim().is_empty() {
        return Err(AppError::msg("No app to stream."));
    }
    let settings = settings.unwrap_or_default();
    let args = moonlight::stream_args(&host, &app, &settings);
    std::process::Command::new(&exe)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::msg(format!("Failed to launch Moonlight: {e}")))?;
    Ok(true)
}

/// Forget a host (drops its record + pin). Returns whether one was removed.
#[tauri::command]
pub async fn streaming_forget_host(app: tauri::AppHandle, address: String) -> AppResult<bool> {
    let path = hosts_path(&app)?;
    let mut hosts = store::load(&path)?;
    let removed = hosts.remove(&control::normalize_address(&address));
    if removed {
        store::save(&path, &hosts)?;
    }
    Ok(removed)
}
