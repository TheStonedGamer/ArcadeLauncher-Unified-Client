//! Tauri commands for the multi-library Storage manager and cross-drive move.
//! Thin shells over the pure model (`model.rs`), the atomic store (`store.rs`),
//! disk-space queries (`disk.rs`), and the move IO core (`move.rs`). Install
//! location is data-driven: a record's `install_dir` is the source of truth, so
//! moving a game is just "relocate the folder, rewrite the record" — launch
//! resolution then follows automatically.

use crate::download::engine::DownloadManager;
use crate::download::records::{self, InstallState};
use crate::error::{AppError, AppResult};
use crate::library::model::{self, LibraryFolders};
use crate::library::{disk, r#move, store};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};

/// Event carrying cross-drive move progress (camelCase for the webview).
pub const MOVE_PROGRESS_EVENT: &str = "library://move-progress";

/// One library folder enriched for the Storage manager UI: identity + disk
/// capacity + how much of it this launcher's installs occupy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolderInfo {
    pub path: String,
    pub is_default: bool,
    /// Free bytes on the volume (0 if it can't be queried).
    pub free_bytes: u64,
    /// Total bytes on the volume (0 if it can't be queried).
    pub total_bytes: u64,
    /// Number of this launcher's installed games living under this folder.
    pub game_count: u64,
    /// Bytes those installs occupy (summed from the records' `total_bytes`).
    pub used_bytes: u64,
}

/// Progress payload for an in-flight move (mirrors the download-progress shape).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveProgress {
    game_id: String,
    copied_bytes: u64,
    total_bytes: u64,
    done: bool,
}

/// Resolve `(config_dir, data_dir)` for the app, mapping the rare failure to an
/// `AppError` so commands can `?` it.
fn dirs(app: &tauri::AppHandle) -> AppResult<(PathBuf, PathBuf)> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    Ok((config_dir, data_dir))
}

/// Load the library folders, seeding the implicit `app_data_dir/games` default
/// so a first run / legacy user always has exactly one (default) library, and
/// persist that seed so subsequent reads are stable.
fn load_seeded(config_dir: &Path, data_dir: &Path) -> AppResult<LibraryFolders> {
    let path = config_dir.join("library_folders.json");
    let mut folders = store::load(&path)?;
    let before = folders.clone();
    let games_dir = data_dir.join("games").to_string_lossy().into_owned();
    folders.ensure_default(&games_dir);
    if folders != before {
        store::save(&path, &folders)?;
    }
    Ok(folders)
}

/// Persist the library folders to `config_dir`.
fn save(config_dir: &Path, folders: &LibraryFolders) -> AppResult<()> {
    store::save(&config_dir.join("library_folders.json"), folders)
}

/// List every registered library folder with disk + install stats for the
/// Storage manager. Always returns at least the seeded default.
#[tauri::command]
pub fn list_library_folders(app: tauri::AppHandle) -> AppResult<Vec<LibraryFolderInfo>> {
    let (config_dir, data_dir) = dirs(&app)?;
    let folders = load_seeded(&config_dir, &data_dir)?;
    let recs = records::load(&config_dir.join("install_records.json")).unwrap_or_default();

    let info = folders
        .folders
        .iter()
        .map(|f| {
            let (free, total) = disk::space(Path::new(&f.path));
            // Fold in the installs that live under this folder.
            let mut game_count = 0u64;
            let mut used_bytes = 0u64;
            for r in recs.records.values() {
                let on_disk =
                    matches!(r.state, InstallState::Installed | InstallState::UpdateAvailable);
                if on_disk && !r.install_dir.is_empty() && model::is_within(&r.install_dir, &f.path) {
                    game_count += 1;
                    used_bytes += r.total_bytes;
                }
            }
            LibraryFolderInfo {
                path: f.path.clone(),
                is_default: f.is_default,
                free_bytes: free,
                total_bytes: total,
                game_count,
                used_bytes,
            }
        })
        .collect();
    Ok(info)
}

/// Register `path` as a new library folder (creating it on disk if needed).
#[tauri::command]
pub fn add_library_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let (config_dir, data_dir) = dirs(&app)?;
    let mut folders = load_seeded(&config_dir, &data_dir)?;
    folders.add(&path).map_err(AppError::msg)?;
    // Best-effort create so the first install doesn't have to.
    let _ = std::fs::create_dir_all(path.trim_end_matches(['/', '\\']));
    save(&config_dir, &folders)
}

/// Unregister `path`. Refuses the default folder and any folder that still holds
/// installs (the games must be moved or uninstalled first). The folder's files
/// on disk are left untouched.
#[tauri::command]
pub fn remove_library_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let (config_dir, data_dir) = dirs(&app)?;
    let mut folders = load_seeded(&config_dir, &data_dir)?;
    let recs = records::load(&config_dir.join("install_records.json")).unwrap_or_default();
    let holds_install = recs.records.values().any(|r| {
        matches!(r.state, InstallState::Installed | InstallState::UpdateAvailable)
            && !r.install_dir.is_empty()
            && model::is_within(&r.install_dir, &path)
    });
    if holds_install {
        return Err(AppError::msg(
            "this library still has installed games — move or uninstall them first",
        ));
    }
    folders.remove(&path).map_err(AppError::msg)?;
    save(&config_dir, &folders)
}

/// Make `path` the default install target.
#[tauri::command]
pub fn set_default_library_folder(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let (config_dir, data_dir) = dirs(&app)?;
    let mut folders = load_seeded(&config_dir, &data_dir)?;
    folders.set_default(&path).map_err(AppError::msg)?;
    save(&config_dir, &folders)
}

/// Move the installed game `game_id` to the library folder `target_path`,
/// emitting `library://move-progress` as it goes and rewriting the install
/// record on success so launches follow the files to their new home.
#[tauri::command]
pub async fn move_install(
    app: tauri::AppHandle,
    manager: State<'_, DownloadManager>,
    game_id: String,
    target_path: String,
) -> AppResult<()> {
    // 1) Never move a game that's still downloading/verifying.
    if manager.is_active(&game_id) {
        return Err(AppError::msg("can't move while this game is downloading"));
    }

    let (config_dir, data_dir) = dirs(&app)?;
    let records_path = config_dir.join("install_records.json");
    let recs = records::load(&records_path)?;
    let rec = recs
        .get(&game_id)
        .cloned()
        .ok_or_else(|| AppError::msg("game is not installed"))?;
    if !matches!(rec.state, InstallState::Installed | InstallState::UpdateAvailable) {
        return Err(AppError::msg("game is not fully installed"));
    }

    let src = if rec.install_dir.is_empty() {
        data_dir.join("games").join(&game_id)
    } else {
        PathBuf::from(&rec.install_dir)
    };
    if !src.exists() {
        return Err(AppError::msg("install folder not found on disk"));
    }

    let target_root = PathBuf::from(target_path.trim());
    if target_root.as_os_str().is_empty() {
        return Err(AppError::msg("no target library selected"));
    }
    // Already in that library? Compare the chosen root to the folder src sits in.
    if let Some(cur_root) = src.parent() {
        if model::norm_key(&cur_root.to_string_lossy()) == model::norm_key(&target_root.to_string_lossy())
        {
            return Err(AppError::msg("game is already in that library folder"));
        }
    }

    // Clean-title destination under the target root, disambiguated against every
    // other record and anything already on disk (same rule as install/migrate).
    let title = crate::catalog::loader::load_file(&config_dir.join("library.json"))
        .unwrap_or_default()
        .into_iter()
        .find(|g| g.id == game_id)
        .map(|g| g.title)
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| game_id.clone());
    let dst = crate::download::paths::unique_install_dir(&target_root, &game_id, &title, |cand| {
        cand.exists()
            || recs
                .records
                .values()
                .any(|r| r.game_id != game_id && Path::new(&r.install_dir) == cand)
    });

    let total = if rec.total_bytes > 0 {
        rec.total_bytes
    } else {
        r#move::dir_size(&src)
    };

    // 2) Do the move off the async runtime (it's blocking IO), streaming progress.
    let app_evt = app.clone();
    let gid = game_id.clone();
    let src_c = src.clone();
    let dst_c = dst.clone();
    let moved: AppResult<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        r#move::move_tree(&src_c, &dst_c, total, |copied| {
            let _ = app_evt.emit(
                MOVE_PROGRESS_EVENT,
                MoveProgress {
                    game_id: gid.clone(),
                    copied_bytes: copied,
                    total_bytes: total,
                    done: false,
                },
            );
        })
        .map(|()| dst_c)
        .map_err(|e| AppError::msg(format!("move failed: {e}")))
    })
    .await
    .map_err(|e| AppError::msg(format!("move task panicked: {e}")))?;
    let dst = moved?;

    // 3) Rewrite the record's install_dir (load-modify-save), then signal done.
    let mut recs = records::load(&records_path)?;
    if let Some(r) = recs.records.get_mut(&game_id) {
        r.install_dir = dst.to_string_lossy().into_owned();
    }
    records::save(&records_path, &recs)?;

    let _ = app.emit(
        MOVE_PROGRESS_EVENT,
        MoveProgress { game_id, copied_bytes: total, total_bytes: total, done: true },
    );
    Ok(())
}
