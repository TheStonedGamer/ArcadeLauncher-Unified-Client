//! Tauri commands for the launcher-side streaming registry + playback.
//!
//! Pairing/discovery now run through the **stream engine** (GameStream PIN
//! handshake over the launcher↔engine IPC, `engine_conn`), replacing the old
//! Sunshine config-API (HTTPS Basic-auth) seam. The launcher still owns the
//! persistent host registry (`store` → `streaming_hosts.json`): the engine does
//! not yet persist pairings across sessions, so the registry is the source of
//! truth for the "paired hosts" UI.
//!
//! Actual playback still shells out to the **external Moonlight** client
//! (`stream_launch` → `moonlight`), kept until the engine's `client.start` does
//! real video — so migrating pairing to the engine doesn't regress playing.
//!
//! Credentials are no longer needed to pair (the engine pairs by PIN); only the
//! host record + its pinned cert fingerprint live on disk.

use crate::error::{AppError, AppResult};
use crate::streaming::control;
use crate::streaming::host::{HostState, StreamHost};
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

/// Pair with a GameStream host by PIN **through the stream engine** and record
/// it in the launcher's host registry. The engine runs the GameStream pairing
/// handshake (no Sunshine web credentials) and returns the host's pinned cert;
/// on success we upsert the host so the "paired hosts" UI and the Moonlight
/// launch can find it. `name` is the display label; blank → the address.
/// Returns whether the engine reported a successful pair.
#[tauri::command]
pub async fn host_pair(
    app: tauri::AppHandle,
    address: String,
    pin: String,
    name: String,
) -> AppResult<bool> {
    if !control::is_valid_pin(&pin) {
        return Err(AppError::msg("PIN must be exactly 4 digits."));
    }
    let addr = control::normalize_address(&address);
    if addr.is_empty() {
        return Err(AppError::msg("No streaming host address."));
    }

    // Pair via the engine; in-band errors (`pin_wrong`, `host_unreachable`, …)
    // surface here as an Err the UI shows.
    let result = crate::streaming::engine_conn::engine_pair(addr.clone(), pin).await?;
    let paired = result.get("paired").and_then(|v| v.as_bool()).unwrap_or(false);
    if !paired {
        return Ok(false);
    }
    // The engine returns the pinned host cert as hex (`serverCert`); persist it so
    // a later swapped cert is detectable.
    let fingerprint = result
        .get("serverCert")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let path = hosts_path(&app)?;
    let mut hosts = store::load(&path)?;
    let existing = hosts.get(&addr).cloned();
    let label = name.trim();
    hosts.upsert(StreamHost {
        name: existing
            .as_ref()
            .map(|h| h.name.clone())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| if label.is_empty() { addr.clone() } else { label.to_string() }),
        address: addr.clone(),
        paired: true,
        state: HostState::Online,
        fingerprint,
    });
    store::save(&path, &hosts)?;
    Ok(true)
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
