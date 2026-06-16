//! Live HTTP download transport. This is the glue the tested core (manifest,
//! safe paths, sha256 verify, queue FSM, file-URL endpoint, throttle math) sits
//! under. For each file in a game's install manifest it performs a single
//! resumable ranged GET into a `.part`, streams the bytes through a SHA-256
//! hasher while throttling to the configured KB/s cap, verifies the full-file
//! digest, then atomically renames the `.part` into place — the same
//! write-then-verify-then-finalize contract the C++ `ServerClient` uses.
//!
//! Progress and lifecycle are forwarded to the webview as Tauri events
//! (`download://progress` / `download://status`), so the React queue UI (T4d)
//! consumes them the same way the social UI consumes gateway events. Each active
//! install is identified by its game id and carries a small atomic control flag
//! the `pause` / `resume` / `cancel` commands flip; the streaming loop polls it
//! between chunks. A pause stops reading and waits in place, re-issuing the
//! ranged GET from the current offset on resume, so the task (and its handle)
//! stays alive the whole time. A tokio semaphore enforces the concurrent-install
//! cap so a large library doesn't open dozens of sockets at once.

use crate::download::endpoint;
use crate::download::manifest::{Manifest, ManifestFile};
use crate::download::paths::resolve_target;
use crate::download::queue::{DownloadStatus, Progress};
use crate::download::rate::Throttle;
use crate::download::records::{self, InstallRecord, InstallState};
use crate::download::verify::Hasher;
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

/// Event carrying a [`Progress`] update for one install (game id + byte counts).
pub const PROGRESS_EVENT: &str = "download://progress";
/// Event carrying a lifecycle/status change (with an optional error message).
pub const STATUS_EVENT: &str = "download://status";

/// Max installs transferring at once. The rest sit `Queued` until a slot frees.
const MAX_CONCURRENT: usize = 3;
/// Emit a progress event at most this often, so a fast download doesn't flood
/// the webview with events.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
/// How often a paused install re-checks whether it has been resumed or cancelled.
const PAUSE_POLL: Duration = Duration::from_millis(200);

// Control-flag values shared between the commands and the streaming loop.
const RUNNING: u8 = 0;
const PAUSED: u8 = 1;
const CANCELLED: u8 = 2;

/// Per-install control flag flipped by pause/resume/cancel.
struct DownloadHandle {
    control: AtomicU8,
}

/// Managed state: the set of in-flight installs and the concurrency limiter.
pub struct DownloadManager {
    active: Mutex<HashMap<String, Arc<DownloadHandle>>>,
    permits: Arc<Semaphore>,
    /// Serializes load-modify-save of the install-records file so concurrent
    /// installs can't clobber each other's record updates.
    record_io: Mutex<()>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        DownloadManager {
            active: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT)),
            record_io: Mutex::new(()),
        }
    }
}

impl DownloadManager {
    /// Begin the install of `game_id`. If an install for this id is already
    /// active it is left alone — the caller should cancel first. Spawns a task
    /// that drives the manifest to completion and emits progress events.
    pub fn start(&self, ctx: InstallContext) {
        let mut active = self.active.lock().unwrap();
        if active.contains_key(&ctx.game_id) {
            return;
        }
        let handle = Arc::new(DownloadHandle { control: AtomicU8::new(RUNNING) });
        active.insert(ctx.game_id.clone(), handle.clone());
        let permits = self.permits.clone();
        tauri::async_runtime::spawn(run_install(ctx, handle, permits));
    }

    /// Pause an active install. The streaming loop stops reading until resumed.
    pub fn pause(&self, game_id: &str) {
        if let Some(h) = self.active.lock().unwrap().get(game_id) {
            // Only running → paused; never override a pending cancel.
            let _ = h.control.compare_exchange(RUNNING, PAUSED, Ordering::SeqCst, Ordering::SeqCst);
        }
    }

    /// Resume a paused install.
    pub fn resume(&self, game_id: &str) {
        if let Some(h) = self.active.lock().unwrap().get(game_id) {
            let _ = h.control.compare_exchange(PAUSED, RUNNING, Ordering::SeqCst, Ordering::SeqCst);
        }
    }

    /// Cancel an active install; its `.part` files are discarded.
    pub fn cancel(&self, game_id: &str) {
        if let Some(h) = self.active.lock().unwrap().get(game_id) {
            h.control.store(CANCELLED, Ordering::SeqCst);
        }
    }

    /// Write `state` for this install into the client-local records file
    /// (load-modify-save under the record lock). Non-destructive: it only
    /// touches `install_records.json`, never the catalog.
    fn persist_record(&self, ctx: &InstallContext, state: InstallState) {
        let _guard = self.record_io.lock().unwrap();
        let mut recs = records::load(&ctx.records_path).unwrap_or_default();
        recs.upsert(InstallRecord {
            game_id: ctx.game_id.clone(),
            state,
            version: ctx.version.clone(),
            install_dir: ctx.install_dir.to_string_lossy().into_owned(),
            total_bytes: ctx.manifest.total_bytes(),
            updated_at: now_secs(),
        });
        let _ = records::save(&ctx.records_path, &recs);
    }

    /// Drop this install's record (used on cancel, so it reverts to
    /// not-installed).
    fn clear_record(&self, ctx: &InstallContext) {
        let _guard = self.record_io.lock().unwrap();
        let mut recs = records::load(&ctx.records_path).unwrap_or_default();
        if recs.remove(&ctx.game_id) {
            let _ = records::save(&ctx.records_path, &recs);
        }
    }
}

/// Current Unix time in whole seconds (0 if the clock is before the epoch).
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Persist `state` for `ctx`'s install if the manager is reachable.
fn record_state(ctx: &InstallContext, state: InstallState) {
    if let Some(mgr) = ctx.app.try_state::<DownloadManager>() {
        mgr.persist_record(ctx, state);
    }
}

/// Clear `ctx`'s install record if the manager is reachable.
fn record_clear(ctx: &InstallContext) {
    if let Some(mgr) = ctx.app.try_state::<DownloadManager>() {
        mgr.clear_record(ctx);
    }
}

/// Everything one install task needs. Built by the command from frontend args.
pub struct InstallContext {
    pub app: AppHandle,
    pub game_id: String,
    pub install_dir: PathBuf,
    pub host: String,
    pub token: String,
    pub manifest: Manifest,
    pub cap_kbps: u64,
    /// Path to the client-local `install_records.json` to update.
    pub records_path: PathBuf,
    /// Installed content version recorded for update checks.
    pub version: String,
    /// For `pc_archive` installs, the install-relative path of the downloaded
    /// archive to extract after verification (then deleted). `None` = the files
    /// are the install as-is (no extraction step).
    pub archive: Option<String>,
}

#[derive(Serialize, Clone)]
struct ProgressEvent<'a> {
    game_id: &'a str,
    #[serde(flatten)]
    progress: Progress,
}

#[derive(Serialize, Clone)]
struct StatusEvent<'a> {
    game_id: &'a str,
    status: DownloadStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit_status(app: &AppHandle, game_id: &str, status: DownloadStatus, error: Option<String>) {
    let _ = app.emit(STATUS_EVENT, StatusEvent { game_id, status, error });
}

fn emit_progress(app: &AppHandle, game_id: &str, progress: &Progress) {
    let _ = app.emit(PROGRESS_EVENT, ProgressEvent { game_id, progress: progress.clone() });
}

/// Result of streaming one file (or the whole install).
enum Outcome {
    Completed,
    Cancelled,
    Failed(String),
}

/// Drive one game's manifest to completion: acquire a concurrency slot, download
/// each file, then mark the install done. Always de-registers itself on exit.
async fn run_install(ctx: InstallContext, handle: Arc<DownloadHandle>, permits: Arc<Semaphore>) {
    let total = ctx.manifest.total_bytes();
    let mut progress = Progress::queued(total);

    // Wait for a free slot (the item stays Queued meanwhile).
    emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Queued, None);
    let _permit = permits.acquire().await;

    progress.set_status(DownloadStatus::Downloading);
    emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Downloading, None);
    record_state(&ctx, InstallState::Installing);

    let client = reqwest::Client::new();
    let mut done_bytes: u64 = 0;

    for file in &ctx.manifest.files {
        let outcome = download_file(&ctx, &client, file, &handle, &mut progress, done_bytes).await;
        match outcome {
            Outcome::Completed => done_bytes = done_bytes.saturating_add(file.size),
            Outcome::Cancelled => {
                progress.set_status(DownloadStatus::Failed);
                emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Failed, Some("cancelled".into()));
                discard_parts(&ctx);
                record_clear(&ctx);
                deregister(&ctx);
                return;
            }
            Outcome::Failed(e) => {
                progress.set_status(DownloadStatus::Failed);
                emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Failed, Some(e));
                record_state(&ctx, InstallState::Failed);
                deregister(&ctx);
                return;
            }
        }
    }

    // Every file was fetched and individually SHA-256-verified on finalize.
    progress.set_status(DownloadStatus::Verifying);
    emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Verifying, None);

    // pc_archive installs: unpack the downloaded archive into the install dir.
    if let Some(rel) = &ctx.archive {
        progress.set_status(DownloadStatus::Extracting);
        emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Extracting, None);
        if let Err(e) = run_extraction(&ctx, rel) {
            progress.set_status(DownloadStatus::Failed);
            emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Failed, Some(e));
            record_state(&ctx, InstallState::Failed);
            deregister(&ctx);
            return;
        }
    }

    progress.set_status(DownloadStatus::Done);
    progress.downloaded_bytes = total;
    emit_progress(&ctx.app, &ctx.game_id, &progress);
    emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Done, None);
    record_state(&ctx, InstallState::Installed);
    deregister(&ctx);
}

/// Extract `rel` (relative to the install dir) and delete the archive on
/// success. Returns a human-readable error string on failure.
fn run_extraction(ctx: &InstallContext, rel: &str) -> Result<(), String> {
    let archive = resolve_target(&ctx.install_dir, rel)
        .ok_or_else(|| format!("unsafe archive path: {rel}"))?;
    crate::download::extract::extract_zip(&archive, &ctx.install_dir)
        .map_err(|e| format!("extract failed: {e}"))?;
    let _ = std::fs::remove_file(&archive); // archive consumed; reclaim the space
    Ok(())
}

/// Download a single manifest file with resume, throttle, and SHA-256 verify.
/// `prior_bytes` is the total already-finalized across earlier files so the
/// emitted progress reflects the whole install. Pauses wait in place and
/// reconnect from the current offset; the file handle and hasher live across
/// reconnects.
async fn download_file(
    ctx: &InstallContext,
    client: &reqwest::Client,
    file: &ManifestFile,
    handle: &Arc<DownloadHandle>,
    progress: &mut Progress,
    prior_bytes: u64,
) -> Outcome {
    let Some(target) = resolve_target(&ctx.install_dir, &file.path) else {
        return Outcome::Failed(format!("unsafe manifest path: {}", file.path));
    };
    // Already finalized from a previous run? Skip re-downloading.
    if target.exists() {
        return Outcome::Completed;
    }
    if let Some(parent) = target.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Outcome::Failed(format!("mkdir failed: {e}"));
        }
    }
    let part = part_path(&target);

    // Resume from an existing `.part`: seed the hasher with its bytes.
    let mut hasher = Hasher::new();
    let mut downloaded: u64 = 0;
    if let Ok(existing) = std::fs::read(&part) {
        hasher.update(&existing);
        downloaded = existing.len() as u64;
    }
    let mut out = match std::fs::OpenOptions::new().create(true).append(true).open(&part) {
        Ok(f) => f,
        Err(e) => return Outcome::Failed(format!("open .part failed: {e}")),
    };

    let url = endpoint::resolve_url(&ctx.host, &ctx.game_id, file);

    // Reconnect loop: each pass streams from `downloaded` to the end. It exits
    // when the stream completes (file done) or an unrecoverable result occurs.
    loop {
        let mut req = client.get(&url);
        if !ctx.token.is_empty() {
            req = req.bearer_auth(&ctx.token);
        }
        if downloaded > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={downloaded}-"));
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => return Outcome::Failed(format!("request failed: {e}")),
        };
        if !resp.status().is_success() {
            return Outcome::Failed(format!("HTTP {} for {}", resp.status(), file.path));
        }

        let mut throttle = Throttle::new(ctx.cap_kbps);
        let started = Instant::now();
        let mut last_emit = Instant::now();
        let mut stream = resp.bytes_stream();
        let mut paused = false;

        while let Some(chunk) = stream.next().await {
            match handle.control.load(Ordering::SeqCst) {
                CANCELLED => return Outcome::Cancelled,
                PAUSED => {
                    paused = true;
                    break;
                }
                _ => {}
            }
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => return Outcome::Failed(format!("stream error: {e}")),
            };
            if let Err(e) = out.write_all(&chunk) {
                return Outcome::Failed(format!("write failed: {e}"));
            }
            hasher.update(&chunk);
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            progress.downloaded_bytes = prior_bytes.saturating_add(downloaded);

            if last_emit.elapsed() >= PROGRESS_INTERVAL {
                emit_progress(&ctx.app, &ctx.game_id, progress);
                last_emit = Instant::now();
            }

            if throttle.is_limited() {
                throttle.record(chunk.len() as u64);
                let delay = throttle.delay_ms(started.elapsed().as_millis() as u64);
                if delay > 0 {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }
        }

        if paused {
            // Drop the current response and wait for resume/cancel, then reconnect.
            drop(stream);
            let _ = out.flush();
            emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Paused, None);
            match wait_for_resume(handle).await {
                ResumeOutcome::Resumed => {
                    emit_status(&ctx.app, &ctx.game_id, DownloadStatus::Downloading, None);
                    continue;
                }
                ResumeOutcome::Cancelled => return Outcome::Cancelled,
            }
        }

        // Stream ended normally → the file is fully transferred. Verify + finalize.
        if let Err(e) = out.flush() {
            return Outcome::Failed(format!("flush failed: {e}"));
        }
        drop(out);
        let digest = hasher.finalize_hex();
        if !file.sha256.is_empty() && !digest.eq_ignore_ascii_case(&file.sha256) {
            let _ = std::fs::remove_file(&part); // corrupt; force a clean re-fetch
            return Outcome::Failed(format!("sha256 mismatch for {}", file.path));
        }
        if let Err(e) = std::fs::rename(&part, &target) {
            return Outcome::Failed(format!("finalize failed: {e}"));
        }
        return Outcome::Completed;
    }
}

enum ResumeOutcome {
    Resumed,
    Cancelled,
}

/// Block until the install leaves the paused state, returning whether it was
/// resumed or cancelled.
async fn wait_for_resume(handle: &Arc<DownloadHandle>) -> ResumeOutcome {
    loop {
        match handle.control.load(Ordering::SeqCst) {
            RUNNING => return ResumeOutcome::Resumed,
            CANCELLED => return ResumeOutcome::Cancelled,
            _ => tokio::time::sleep(PAUSE_POLL).await,
        }
    }
}

/// `<target>.part` — the in-progress download file.
fn part_path(target: &Path) -> PathBuf {
    let mut s = target.as_os_str().to_os_string();
    s.push(".part");
    PathBuf::from(s)
}

/// Best-effort removal of every `.part` for a cancelled install so a later retry
/// starts clean.
fn discard_parts(ctx: &InstallContext) {
    for file in &ctx.manifest.files {
        if let Some(target) = resolve_target(&ctx.install_dir, &file.path) {
            let _ = std::fs::remove_file(part_path(&target));
        }
    }
}

/// Remove this install from the active map, however the task exited.
fn deregister(ctx: &InstallContext) {
    if let Some(mgr) = ctx.app.try_state::<DownloadManager>() {
        mgr.active.lock().unwrap().remove(&ctx.game_id);
    }
}
