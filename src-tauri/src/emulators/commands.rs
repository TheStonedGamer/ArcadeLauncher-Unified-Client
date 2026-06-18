//! Tauri commands backing the Settings "Emulators" section: list the runtimes
//! the server hosts, report which are present locally, and download (stage) one
//! into the per-user data dir. Download progress arrives as `emulator://progress`.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerEmulatorFile {
    rel: String,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerEmulator {
    id: String,
    name: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    total_bytes: u64,
    files: Vec<ServerEmulatorFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct EmulatorList {
    #[serde(default)]
    emulators: Vec<ServerEmulator>,
}

/// One emulator with its local readiness, as shown in Settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorStatus {
    id: String,
    name: String,
    kind: String,
    total_bytes: u64,
    file_count: usize,
    /// Every file present locally with a matching size.
    ready: bool,
    /// Bytes already staged locally (for a partial "X of Y" display).
    local_bytes: u64,
}

fn normalize_host(host: &str) -> String {
    let s = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    s.trim_end_matches('/').to_string()
}

fn emulators_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("no data dir: {e}")))?;
    Ok(dir.join("emulators"))
}

/// Percent-encode a `/`-delimited relative path, preserving the separators so
/// it maps onto the server's `/emulators/*rel` wildcard route. The server
/// `url`-decodes each segment, so escaped spaces/UTF-8 round-trip cleanly.
fn encode_rel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'/' | b'-' | b'_' | b'.' | b'~' | b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// List the server's emulator runtimes with each one's local readiness.
#[tauri::command]
pub async fn list_emulators(
    app: tauri::AppHandle,
    host: String,
    token: String,
) -> AppResult<Vec<EmulatorStatus>> {
    let host = normalize_host(&host);
    let url = format!("https://{host}/api/emulators");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("emulator list request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "emulator list failed (HTTP {})",
            resp.status()
        )));
    }
    let list: EmulatorList = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("bad emulator list: {e}")))?;

    // `rel` is relative to the emulators root, so resolve files directly under
    // the local emulators dir (no per-id subdir).
    let root = emulators_dir(&app)?;
    let mut out = Vec::new();
    for e in list.emulators {
        let mut local_bytes = 0u64;
        let mut ready = !e.files.is_empty();
        for f in &e.files {
            match std::fs::metadata(root.join(&f.rel)) {
                Ok(m) if m.len() == f.size => local_bytes += f.size,
                _ => ready = false,
            }
        }
        out.push(EmulatorStatus {
            id: e.id,
            name: e.name,
            kind: e.kind,
            total_bytes: e.total_bytes,
            file_count: e.files.len(),
            ready,
            local_bytes,
        });
    }
    Ok(out)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorProgress {
    id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    done: bool,
    error: Option<String>,
}

/// Fetch the current server emulator list (Bearer-authed).
async fn fetch_list(client: &reqwest::Client, host: &str, token: &str) -> AppResult<EmulatorList> {
    client
        .get(format!("https://{host}/api/emulators"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("emulator list request failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::msg(format!("bad emulator list: {e}")))
}

/// Stage one emulator's files into `base` (the local emulators dir). Skips files
/// already present at the right size, streams the rest to a `.part` sibling and
/// atomically renames. Emits `emulator://progress` keyed by `em.id`. Returns the
/// staging error (after emitting it) so callers can decide whether to continue.
async fn stage_emulator(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    host: &str,
    token: &str,
    base: &std::path::Path,
    em: &ServerEmulator,
) -> AppResult<()> {
    let id = em.id.clone();
    let total = em.total_bytes;
    let mut downloaded = 0u64;
    let emit = |downloaded: u64, done: bool, error: Option<String>| {
        let _ = app.emit(
            "emulator://progress",
            EmulatorProgress {
                id: id.clone(),
                downloaded_bytes: downloaded,
                total_bytes: total,
                done,
                error,
            },
        );
    };
    emit(0, false, None);

    for f in &em.files {
        let dest = base.join(&f.rel);
        if std::fs::metadata(&dest).map(|m| m.len() == f.size).unwrap_or(false) {
            downloaded += f.size;
            emit(downloaded, false, None);
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::msg(format!("mkdir failed: {e}")))?;
        }
        let file_url = format!("https://{host}/emulators/{}", encode_rel(&f.rel));
        let mut r = client
            .get(&file_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::msg(format!("download failed: {e}")))?;
        if !r.status().is_success() {
            let msg = format!("download failed (HTTP {})", r.status());
            emit(downloaded, true, Some(msg.clone()));
            return Err(AppError::msg(msg));
        }
        let tmp = dest.with_extension("part");
        let mut file =
            std::fs::File::create(&tmp).map_err(|e| AppError::msg(format!("create failed: {e}")))?;
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|e| AppError::msg(format!("stream failed: {e}")))?
        {
            file.write_all(&chunk).map_err(|e| AppError::msg(format!("write failed: {e}")))?;
            downloaded += chunk.len() as u64;
            emit(downloaded, false, None);
        }
        file.flush().ok();
        drop(file);
        std::fs::rename(&tmp, &dest).map_err(|e| AppError::msg(format!("finalize failed: {e}")))?;
    }

    // Unpack archive runtimes (.zip/.7z) into a per-emulator runtime dir so the
    // launch layer can find the emulator's executable. Loose .exe/firmware blobs
    // need no unpacking. A `.unpacked` marker (the source archive's name) lets us
    // skip the expensive re-extract when the runtime is already current.
    if em.files.len() == 1 && crate::emulators::unpack::is_archive(&em.files[0].rel) {
        let archive = base.join(&em.files[0].rel);
        let runtime = runtime_dir(&base, &em.id);
        let marker = runtime.join(".unpacked");
        let want = format!("{}:{}", em.files[0].rel, em.files[0].size);
        let have = std::fs::read_to_string(&marker).unwrap_or_default();
        if have.trim() != want {
            let _ = std::fs::remove_dir_all(&runtime);
            crate::emulators::unpack::unpack_archive(&archive, &runtime)?;
            let _ = std::fs::write(&marker, &want);
        }
    }

    emit(downloaded, true, None);
    Ok(())
}

/// Per-emulator runtime (unpacked) directory: `<emulators>/_runtimes/<id>`.
/// Kept under the emulators dir but namespaced so it never collides with a
/// staged archive of the same name.
fn runtime_dir(emulators_dir: &std::path::Path, id: &str) -> PathBuf {
    emulators_dir.join("_runtimes").join(id)
}

/// Download (stage) one emulator's runtime files into the per-user data dir.
/// Resumes by skipping files already present at the right size.
#[tauri::command]
pub async fn download_emulator(
    app: tauri::AppHandle,
    host: String,
    token: String,
    id: String,
) -> AppResult<()> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();
    let list = fetch_list(&client, &host, &token).await?;
    let em = list
        .emulators
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::msg(format!("emulator '{id}' not found on server")))?;
    let base = emulators_dir(&app)?;
    stage_emulator(&app, &client, &host, &token, &base, &em).await
}

/// Stage EVERY emulator/firmware the server hosts that isn't already complete
/// locally. Used by the Settings "Download all" button and by the background
/// auto-stage on launch. Files already present at the right size are skipped, so
/// repeat runs are cheap. One emulator failing doesn't abort the rest.
#[tauri::command]
pub async fn download_all_emulators(
    app: tauri::AppHandle,
    host: String,
    token: String,
) -> AppResult<()> {
    let host = normalize_host(&host);
    let client = reqwest::Client::new();
    let list = fetch_list(&client, &host, &token).await?;
    let base = emulators_dir(&app)?;
    for em in &list.emulators {
        // Skip ones already fully present so we don't re-emit churn for them.
        let complete = !em.files.is_empty()
            && em.files.iter().all(|f| {
                std::fs::metadata(base.join(&f.rel)).map(|m| m.len() == f.size).unwrap_or(false)
            });
        if complete {
            continue;
        }
        // Best-effort: log-and-continue on a single emulator's failure.
        let _ = stage_emulator(&app, &client, &host, &token, &base, em).await;
    }
    Ok(())
}
