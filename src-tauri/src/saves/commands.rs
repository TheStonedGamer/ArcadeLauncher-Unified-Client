//! Cloud-save transport, exposed to the webview. Thin glue over the pure core:
//! list the server's saves for a game, scan the local save folder, ask
//! `sync::plan_sync` what to do, optionally settle conflicts with the chosen
//! policy, then execute — GET each download into the local folder, PUT each
//! upload to the server. Both calls carry the session Bearer token.
//!
//! Where we sync from is a [`SaveScope`]: the user's configured `save_path` when
//! set — which may be a directory *or* a single file, for emulators that keep one
//! memory-card image — else the managed per-user folder `app_data/saves/<id>`.
//! `saves_default_path` supplies the real on-disk location for a game so the UI
//! can offer it instead of the empty managed folder; see `saves::defaults`.

use crate::download::paths::resolve_target;
use crate::error::{AppError, AppResult};
use crate::saves::defaults::{self, SaveRoots};
use crate::saves::scan::{scan_save_dir, scan_save_file};
use crate::saves::sync::{
    apply_conflict_policy, plan_sync, ConflictPolicy, SaveFile, SyncAction, SyncSummary,
};
use crate::saves::versions::{self, SaveVersion};
use filetime::{set_file_mtime, FileTime};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
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

/// What a sync run covers. `base` is the directory we scan and resolve wire
/// paths against; `only` names a single file within it when the user pointed at
/// a file rather than a folder. Restricting to one file matters: a chosen file
/// usually sits in a directory full of things that must never be synced (an
/// emulator's config folder, a game's install dir), so every list — local *and*
/// remote — is filtered down to it.
struct SaveScope {
    base: PathBuf,
    only: Option<String>,
}

impl SaveScope {
    /// The local files in scope.
    fn scan(&self) -> AppResult<Vec<SaveFile>> {
        let r = match &self.only {
            Some(name) => scan_save_file(&self.base, name),
            None => scan_save_dir(&self.base),
        };
        r.map_err(|e| AppError::msg(format!("save scan failed: {e}")))
    }

    /// Drop anything the scope excludes — used on the server's file list, which
    /// knows nothing about a single-file scope.
    fn retain(&self, mut files: Vec<SaveFile>) -> Vec<SaveFile> {
        if let Some(name) = &self.only {
            files.retain(|f| &f.path == name);
        }
        files
    }
}

/// Resolve a game's save scope. An explicit `save_path` wins and may name a
/// directory or a file; otherwise we use the managed per-user folder
/// `app_data/saves/<id>`, which is always safe.
fn save_scope(app: &tauri::AppHandle, game_id: &str, save_path: Option<&str>) -> AppResult<SaveScope> {
    if let Some(p) = save_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        if !path.is_absolute() {
            return Err(AppError::msg("save path must be absolute"));
        }
        // Only an existing file gets file scope; anything else (a directory, or
        // a path not yet created) is treated as the folder to sync.
        if path.is_file() {
            let (Some(parent), Some(name)) = (path.parent(), path.file_name().and_then(|s| s.to_str()))
            else {
                return Err(AppError::msg("save file has no parent directory"));
            };
            return Ok(SaveScope { base: parent.to_path_buf(), only: Some(name.to_string()) });
        }
        return Ok(SaveScope { base: path, only: None });
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    Ok(SaveScope { base: dir.join("saves").join(game_id), only: None })
}

/// The well-known save roots on this machine, for `game_id` on `platform`.
fn machine_roots(app: &tauri::AppHandle, game_id: &str, platform: &str) -> SaveRoots {
    let home = app.path().home_dir().ok();
    SaveRoots {
        // The emulator's own directory is the parent of the exe we'd launch, so
        // portable layouts resolve wherever the runtime happens to be unpacked.
        emulator_root: crate::emulators::launch::emulators_dir(app).and_then(|d| {
            crate::emulators::launch::find_exe(
                &d.join("_runtimes"),
                crate::emulators::launch::exe_candidates(platform),
            )
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        }),
        documents: app.path().document_dir().ok(),
        roaming: std::env::var_os("APPDATA").map(PathBuf::from),
        local: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        saved_games: home.map(|h| h.join("Saved Games")),
        install_dir: crate::emulators::launch::resolve_install_dir(app, game_id),
    }
}

/// The detected real save location for a game, or `None` when we can't find one
/// that exists. The UI offers this as the default so cloud saves cover the files
/// the game actually writes instead of an empty managed folder.
#[tauri::command]
pub async fn saves_default_path(
    app: tauri::AppHandle,
    game_id: String,
    platform: String,
    title: String,
) -> AppResult<Option<String>> {
    let roots = machine_roots(&app, &game_id, &platform);
    let mut candidates = defaults::emulator_candidates(&platform, &roots);
    if candidates.is_empty() {
        // Not an emulated platform — fall back to the PC heuristics.
        candidates = defaults::pc_candidates(&title, &roots);
    }
    Ok(defaults::pick_existing(&candidates, |p| p.exists()).map(|p| p.to_string_lossy().into_owned()))
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
    let scope = save_scope(&app, &game_id, save_path.as_deref())?;
    let remote = scope.retain(list_remote(&client, &host, &token, &game_id).await?);
    let local = scope.scan()?;
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
    let scope = save_scope(&app, &game_id, save_path.as_deref())?;
    let base = scope.base.clone();

    let remote = scope.retain(list_remote(&client, &host, &token, &game_id).await?);
    let local = scope.scan()?;
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

// ---------------------------------------------------------------------------
// Version history (T12i) — thin IO glue over `saves::versions`. Each snapshot is
// a copy of the managed save folder under `app_data/saves_versions/<id>/<vid>/`;
// the pure core decides ids and which snapshots to prune.
// ---------------------------------------------------------------------------

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Root holding every snapshot directory for `game_id`.
fn versions_base(app: &tauri::AppHandle, game_id: &str) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    Ok(dir.join("saves_versions").join(game_id))
}

/// Read the existing snapshots for a game (each subdirectory is one version).
fn read_versions(root: &Path) -> Vec<SaveVersion> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else { return out };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Some(created_at) = versions::parse_version_time(&id) else { continue };
        let files = scan_save_dir(&entry.path()).unwrap_or_default();
        out.push(SaveVersion {
            id,
            created_at,
            file_count: files.len(),
            total_bytes: files.iter().map(|f| f.size).sum(),
        });
    }
    out
}

/// Recursively copy `src` into `dst` (creating `dst`). Used to snapshot a save
/// folder into a version dir and to restore one back.
fn copy_tree(src: &Path, dst: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dst).map_err(|e| AppError::msg(format!("mkdir failed: {e}")))?;
    let entries = std::fs::read_dir(src).map_err(|e| AppError::msg(format!("read dir failed: {e}")))?;
    for entry in entries {
        let entry = entry.map_err(|e| AppError::msg(format!("dir entry failed: {e}")))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = entry.metadata().map_err(|e| AppError::msg(format!("stat failed: {e}")))?;
        if meta.is_dir() {
            copy_tree(&from, &to)?;
        } else if meta.is_file() {
            std::fs::copy(&from, &to).map_err(|e| AppError::msg(format!("copy failed: {e}")))?;
        }
    }
    Ok(())
}

/// List a game's restorable save snapshots, newest first.
#[tauri::command]
pub async fn saves_versions(app: tauri::AppHandle, game_id: String) -> AppResult<Vec<SaveVersion>> {
    let root = versions_base(&app, &game_id)?;
    let mut list = read_versions(&root);
    let plan = versions::plan_retention(&list, list.len().max(1));
    // Order newest-first using the same ordering the retention plan applies.
    let order: std::collections::HashMap<&str, usize> =
        plan.keep.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    list.sort_by_key(|v| *order.get(v.id.as_str()).unwrap_or(&usize::MAX));
    Ok(list)
}

/// Snapshot the current save folder into a new restorable version, then prune to
/// the newest `keep` (default 10). A snapshot with no files is skipped. Returns
/// the kept versions, newest first.
#[tauri::command]
pub async fn saves_snapshot(
    app: tauri::AppHandle,
    game_id: String,
    keep: Option<usize>,
    save_path: Option<String>,
) -> AppResult<Vec<SaveVersion>> {
    let scope = save_scope(&app, &game_id, save_path.as_deref())?;
    let current = scope.scan()?;
    let root = versions_base(&app, &game_id)?;
    let existing = read_versions(&root);

    // Nothing to snapshot — don't create an empty version.
    if current.is_empty() {
        return saves_versions(app, game_id).await;
    }

    let id = versions::next_version_id(now_unix(), &existing);
    let dest = root.join(&id);
    match &scope.only {
        // File scope: snapshot just that file, never its neighbours.
        Some(name) => {
            std::fs::create_dir_all(&dest).map_err(|e| AppError::msg(format!("mkdir failed: {e}")))?;
            std::fs::copy(scope.base.join(name), dest.join(name))
                .map_err(|e| AppError::msg(format!("copy failed: {e}")))?;
        }
        None => copy_tree(&scope.base, &dest)?,
    }

    // Prune overflow beyond the retention count.
    let mut all = read_versions(&root);
    let keep = keep.unwrap_or(versions::DEFAULT_KEEP);
    let plan = versions::plan_retention(&all, keep);
    for pruned_id in &plan.prune {
        let _ = std::fs::remove_dir_all(root.join(pruned_id));
    }
    all.retain(|v| plan.keep.contains(&v.id));
    let order: std::collections::HashMap<&str, usize> =
        plan.keep.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    all.sort_by_key(|v| *order.get(v.id.as_str()).unwrap_or(&usize::MAX));
    Ok(all)
}

/// Restore a stored snapshot back into the live save folder. The current folder
/// is snapshotted first (so a restore is itself undoable), then replaced.
#[tauri::command]
pub async fn saves_restore_version(
    app: tauri::AppHandle,
    game_id: String,
    version_id: String,
    save_path: Option<String>,
) -> AppResult<bool> {
    if versions::parse_version_time(&version_id).is_none() {
        return Err(AppError::msg("invalid version id"));
    }
    let root = versions_base(&app, &game_id)?;
    let src = root.join(&version_id);
    if !src.is_dir() {
        return Err(AppError::msg("version not found"));
    }
    let scope = save_scope(&app, &game_id, save_path.as_deref())?;

    // Safety snapshot of the current state before we overwrite it.
    let _ = saves_snapshot(app.clone(), game_id.clone(), None, save_path.clone()).await;

    match &scope.only {
        // File scope: put back only that file. Clearing the directory here would
        // wipe whatever else lives beside it, which is not ours to delete.
        Some(name) => {
            let from = src.join(name);
            if !from.is_file() {
                return Err(AppError::msg("version does not contain that save file"));
            }
            std::fs::copy(&from, scope.base.join(name))
                .map_err(|e| AppError::msg(format!("restore failed: {e}")))?;
        }
        None => {
            // Replace the live folder wholesale — the snapshot above is the undo.
            if scope.base.exists() {
                std::fs::remove_dir_all(&scope.base)
                    .map_err(|e| AppError::msg(format!("clear failed: {e}")))?;
            }
            copy_tree(&src, &scope.base)?;
        }
    }
    Ok(true)
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
