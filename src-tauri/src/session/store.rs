//! Thin disk/IPC glue for the remembered session. The pure obfuscation + expiry
//! logic lives in `storage`; this file only resolves the per-user path, derives
//! the install seed, does atomic file IO, and exposes the Tauri commands.

use crate::error::{AppError, AppResult};
use crate::session::storage::{self, StoredSession};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Where the remembered session lives (a separate per-user file, never mixed
/// into `config.json`), plus the dir used as the obfuscation seed.
fn session_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("session.json"))
}

/// Stable per-install seed for the storage key: the app-config-dir path.
fn storage_key(app: &tauri::AppHandle) -> AppResult<[u8; 32]> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(storage::derive_storage_key(&dir.to_string_lossy()))
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Persist a session so it can be restored on next launch. Atomic (temp +
/// rename) and obfuscated at rest. `expiresUnix` is optional.
#[tauri::command]
pub fn session_save(
    app: tauri::AppHandle,
    host: String,
    username: String,
    token: String,
    is_admin: bool,
    must_change_password: bool,
    expires_unix: Option<i64>,
) -> AppResult<()> {
    let stored = StoredSession {
        host,
        username,
        token,
        is_admin,
        must_change_password,
        saved_unix: now_unix(),
        expires_unix,
    };
    let key = storage_key(&app)?;
    // IV from the current time keeps the keystream from repeating across saves.
    let iv = now_unix().to_be_bytes();
    let text = storage::encode(&key, &iv, &stored).map_err(AppError::msg)?;

    let path = session_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Restore a remembered session, if any. Returns `None` when there is no file,
/// it can't be decoded (wrong install / corrupt), or it has expired — and in
/// the expired/corrupt cases the stale file is removed.
#[tauri::command]
pub fn session_restore(app: tauri::AppHandle) -> AppResult<Option<StoredSession>> {
    let path = session_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)?;
    let key = storage_key(&app)?;
    match storage::decode(&key, &text) {
        Ok(stored) if !storage::is_expired(&stored, now_unix()) => Ok(Some(stored)),
        // Expired or undecodable: drop the stale file so we don't retry it.
        _ => {
            let _ = std::fs::remove_file(&path);
            Ok(None)
        }
    }
}

/// Forget the remembered session (sign out). Missing file is not an error.
#[tauri::command]
pub fn session_clear(app: tauri::AppHandle) -> AppResult<()> {
    let path = session_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}
