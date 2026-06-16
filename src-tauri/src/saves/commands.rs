//! Cloud-save transport, exposed to the webview. Thin glue over the pure core:
//! list the server's saves for a game, scan the local save folder, ask
//! `sync::plan_sync` what to do, optionally settle conflicts with the chosen
//! policy, then execute — GET each download into the local folder, PUT each
//! upload to the server. Both calls carry the session Bearer token.
//!
//! The local save folder is per-user, per-game: `app_data/saves/<game_id>`.
//! (Mapping a game's real on-disk save location is a later refinement; v1 syncs
//! this managed folder so it never touches arbitrary user directories.)

use crate::download::paths::resolve_target;
use crate::error::{AppError, AppResult};
use crate::saves::scan::scan_save_dir;
use crate::saves::sync::{
    apply_conflict_policy, plan_sync, ConflictPolicy, SaveFile, SyncAction, SyncSummary,
};
use filetime::{set_file_mtime, FileTime};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The server's `GET /api/saves/:id` response shape.
#[derive(Deserialize)]
struct RemoteList {
    #[serde(default)]
    files: Vec<SaveFile>,
}

/// What a sync run did, returned to the UI.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub uploaded: usize,
    pub downloaded: usize,
    /// Paths left unresolved (only when policy is `skip`).
    pub conflicts: Vec<String>,
    /// Per-file failures (path: reason); a failure never aborts the rest.
    pub errors: Vec<String>,
}

/// Strip scheme/trailing slash so we control the transport scheme.
fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

/// The local save folder for a game. When the user has configured a real save
/// directory (`save_path`, an absolute path) we use it; otherwise we fall back
/// to the managed per-user folder `app_data/saves/<id>`, which is always safe.
fn save_base(app: &tauri::AppHandle, game_id: &str, save_path: Option<&str>) -> AppResult<PathBuf> {
    if let Some(p) = save_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        if !path.is_absolute() {
            return Err(AppError::msg("save folder must be an absolute path"));
        }
        return Ok(path);
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    Ok(dir.join("saves").join(game_id))
}

async fn list_remote(client: &reqwest::Client, host: &str, token: &str, game_id: &str) -> AppResult<Vec<SaveFile>> {
    let url = format!("https://{host}/api/saves/{game_id}");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("save list request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("save list failed (HTTP {})", resp.status())));
    }
    let list: RemoteList = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("save list parse failed: {e}")))?;
    Ok(list.files)
}

/// Preview a sync without transferring anything: returns the per-action counts
/// so the UI can show "3 to upload, 1 to download, 1 conflict" before the user
/// commits.
#[tauri::command]
pub async fn saves_plan(
    app: tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
    save_path: Option<String>,
) -> AppResult<SyncSummary> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();
    let remote = list_remote(&client, &host, &token, &game_id).await?;
    let base = save_base(&app, &game_id, save_path.as_deref())?;
    let local = scan_save_dir(&base).map_err(|e| AppError::msg(format!("save scan failed: {e}")))?;
    let plan = plan_sync(&local, &remote);
    Ok(SyncSummary::of(&plan))
}

/// Run a full sync for `game_id`. `policy` is `"skip"` (default), `"preferLocal"`,
/// or `"preferRemote"` for conflict handling. Uploads and downloads are executed
/// best-effort; a single file's failure is recorded and the rest proceed.
#[tauri::command]
pub async fn saves_sync(
    app: tauri::AppHandle,
    host: String,
    token: String,
    game_id: String,
    policy: Option<String>,
    save_path: Option<String>,
) -> AppResult<SyncReport> {
    let host = normalize_host(&host);
    let policy = match policy.as_deref() {
        Some("preferLocal") => ConflictPolicy::PreferLocal,
        Some("preferRemote") => ConflictPolicy::PreferRemote,
        _ => ConflictPolicy::Skip,
    };
    let client = reqwest::Client::new();
    let base = save_base(&app, &game_id, save_path.as_deref())?;

    let remote = list_remote(&client, &host, &token, &game_id).await?;
    let local = scan_save_dir(&base).map_err(|e| AppError::msg(format!("save scan failed: {e}")))?;
    let plan = apply_conflict_policy(plan_sync(&local, &remote), policy);

    let mut report = SyncReport::default();
    for item in plan {
        match item.action {
            SyncAction::InSync => {}
            SyncAction::Conflict => report.conflicts.push(item.path),
            SyncAction::Download => {
                let mtime = item.remote.as_ref().map(|f| f.mtime).unwrap_or(0);
                match download_one(&client, &host, &token, &game_id, &base, &item.path, mtime).await {
                    Ok(()) => report.downloaded += 1,
                    Err(e) => report.errors.push(format!("{}: {e}", item.path)),
                }
            }
            SyncAction::Upload => {
                let mtime = item.local.as_ref().map(|f| f.mtime).unwrap_or(0);
                match upload_one(&client, &host, &token, &game_id, &base, &item.path, mtime).await {
                    Ok(()) => report.uploaded += 1,
                    Err(e) => report.errors.push(format!("{}: {e}", item.path)),
                }
            }
        }
    }
    Ok(report)
}

async fn download_one(
    client: &reqwest::Client,
    host: &str,
    token: &str,
    game_id: &str,
    base: &Path,
    rel: &str,
    mtime: i64,
) -> AppResult<()> {
    // Resolve under the save base with the same traversal guard installs use.
    let dest = resolve_target(base, rel).ok_or_else(|| AppError::msg("unsafe save path"))?;
    let url = format!("https://{host}/api/saves/{game_id}/file");
    let resp = client
        .get(&url)
        .query(&[("path", rel)])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("download failed (HTTP {})", resp.status())));
    }
    let bytes = resp.bytes().await.map_err(|e| AppError::msg(format!("download read failed: {e}")))?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::msg(format!("mkdir failed: {e}")))?;
    }
    // Atomic write (temp + rename) so a crash mid-write can't leave a torn save.
    let tmp = dest.with_extension("savetmp");
    std::fs::write(&tmp, &bytes).map_err(|e| AppError::msg(format!("write failed: {e}")))?;
    std::fs::rename(&tmp, &dest).map_err(|e| AppError::msg(format!("rename failed: {e}")))?;
    // Stamp the server's mtime so the next sync sees this file as in-sync.
    let _ = set_file_mtime(&dest, FileTime::from_unix_time(mtime, 0));
    Ok(())
}

async fn upload_one(
    client: &reqwest::Client,
    host: &str,
    token: &str,
    game_id: &str,
    base: &Path,
    rel: &str,
    mtime: i64,
) -> AppResult<()> {
    let src = resolve_target(base, rel).ok_or_else(|| AppError::msg("unsafe save path"))?;
    let bytes = std::fs::read(&src).map_err(|e| AppError::msg(format!("read failed: {e}")))?;
    let url = format!("https://{host}/api/saves/{game_id}/file");
    let resp = client
        .put(&url)
        .query(&[("path", rel), ("mtime", &mtime.to_string())])
        .bearer_auth(token)
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("upload failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("upload failed (HTTP {})", resp.status())));
    }
    Ok(())
}
