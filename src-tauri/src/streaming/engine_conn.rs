//! Transport seam for the stream engine: spawn the engine binary and speak the
//! IPC protocol (engine `docs/IPC.md`) over a launcher-created named pipe
//! (Windows) / Unix socket. The launcher is the **listener**; the engine
//! connects back with `--ipc <token>`.
//!
//! One engine invocation per request — matching the engine's "one control
//! connection per invocation" — so the seam is: create the endpoint, spawn the
//! engine, exchange hellos (version-checked), send the request, read until the
//! matching response, then tear down. Pairing and discovery are one-shot, so
//! this is the whole story for now; a persistent connection with live
//! `stream.*` events lands when `client.start` does real streaming.
//!
//! Built on the pure [`engine`](super::engine) protocol core (framing,
//! envelopes, handshake) — this file is only the IO, mirroring the rest of the
//! client's pure-core + thin-transport split.

use crate::error::{AppError, AppResult};
use crate::streaming::engine::{
    check_handshake, hello_frame, parse_message, request_frame, try_decode, Incoming,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const ENGINE_BIN: &str = if cfg!(windows) {
    "arcade-stream-engine.exe"
} else {
    "arcade-stream-engine"
};

/// Overall budget for one engine call (spawn + handshake + request/response).
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

static TOKEN_SEQ: AtomicU64 = AtomicU64::new(0);

/// A process-unique endpoint token. The engine derives the real pipe name /
/// socket path from it (`arcade-stream-engine-<token>`), so it only has to be
/// unique among our concurrent calls — pid + a counter suffices.
fn unique_token() -> String {
    format!("{}-{}", std::process::id(), TOKEN_SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Locate the engine binary: an explicit override first (dev), then next to our
/// own executable (the bundled-sidecar location in a release install).
fn engine_path() -> AppResult<PathBuf> {
    if let Ok(p) = std::env::var("ARCADE_STREAM_ENGINE") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(cand) = exe.parent().map(|d| d.join(ENGINE_BIN)) {
            if cand.is_file() {
                return Ok(cand);
            }
        }
    }
    Err(AppError::msg(
        "stream engine not found — set ARCADE_STREAM_ENGINE (dev) or install the bundled engine",
    ))
}

/// The engine subcommand for a method namespace: `client.*` → `stream`, `host.*` → `host`.
fn engine_mode(method: &str) -> &'static str {
    if method.starts_with("host.") {
        "host"
    } else {
        "stream"
    }
}

/// Spawn the engine, told to connect to our endpoint `token`, stdio quieted.
fn spawn_engine(method: &str, token: &str) -> AppResult<Child> {
    let exe = engine_path()?;
    Command::new(&exe)
        .arg(engine_mode(method))
        .arg("--ipc")
        .arg(token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::msg(format!("failed to spawn stream engine: {e}")))
}

/// Best-effort reap of the engine child once a call is done.
fn reap(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Drive the wire exchange over a connected stream: send our hello + the
/// request, then read frames until the response for `REQ_ID` arrives. The
/// engine's hello is version-checked; any events seen meanwhile are ignored
/// (no live stream in this one-shot path).
async fn exchange<S>(mut stream: S, method: &str, params: Value) -> AppResult<Value>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    const REQ_ID: u64 = 1;

    stream
        .write_all(&hello_frame(env!("CARGO_PKG_VERSION")))
        .await
        .map_err(|e| AppError::msg(format!("engine write (hello) failed: {e}")))?;
    let req = request_frame(REQ_ID, method, params)
        .map_err(|e| AppError::msg(format!("bad engine request: {e}")))?;
    stream
        .write_all(&req)
        .await
        .map_err(|e| AppError::msg(format!("engine write (req) failed: {e}")))?;

    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut handshaken = false;
    loop {
        // Drain whole frames already buffered before reading more.
        while let Some((consumed, payload)) =
            try_decode(&buf).map_err(|e| AppError::msg(format!("engine framing error: {e}")))?
        {
            let msg = parse_message(&payload)
                .map_err(|e| AppError::msg(format!("engine protocol error: {e}")))?;
            buf.drain(..consumed);
            match msg {
                Incoming::Hello { protocol_version, .. } => {
                    check_handshake(protocol_version).map_err(|e| AppError::msg(e.to_string()))?;
                    handshaken = true;
                }
                // The engine reports method errors in-band: surface code + message.
                Incoming::Res { id, result } if id == REQ_ID => {
                    return result.map_err(|e| AppError::msg(e.to_string()));
                }
                _ => {} // other res / events / unknown — keep reading
            }
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::msg(format!("engine read failed: {e}")))?;
        if n == 0 {
            return Err(AppError::msg(if handshaken {
                "stream engine closed before responding"
            } else {
                "stream engine closed before handshake"
            }));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Create the endpoint, spawn the engine, accept its connection, run the
/// exchange, and tear everything down. Platform-specific transport; identical
/// protocol on top.
#[cfg(windows)]
async fn serve(token: &str, method: &str, params: Value) -> AppResult<Value> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let pipe = format!(r"\\.\pipe\arcade-stream-engine-{token}");
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe)
        .map_err(|e| AppError::msg(format!("create pipe failed: {e}")))?;
    let child = spawn_engine(method, token)?;
    let res = async {
        server
            .connect()
            .await
            .map_err(|e| AppError::msg(format!("pipe connect failed: {e}")))?;
        exchange(server, method, params).await
    }
    .await;
    reap(child);
    res
}

#[cfg(unix)]
async fn serve(token: &str, method: &str, params: Value) -> AppResult<Value> {
    use tokio::net::UnixListener;
    let dir = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/tmp".to_string());
    let path = format!("{dir}/arcade-stream-engine-{token}.sock");
    let _ = std::fs::remove_file(&path); // clear any stale socket
    let listener =
        UnixListener::bind(&path).map_err(|e| AppError::msg(format!("bind {path} failed: {e}")))?;
    let child = spawn_engine(method, token)?;
    let res = async {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| AppError::msg(format!("socket accept failed: {e}")))?;
        exchange(stream, method, params).await
    }
    .await;
    reap(child);
    let _ = std::fs::remove_file(&path);
    res
}

/// Call one engine method end-to-end, with an overall timeout.
async fn engine_call(method: &str, params: Value) -> AppResult<Value> {
    let token = unique_token();
    match tokio::time::timeout(CALL_TIMEOUT, serve(&token, method, params)).await {
        Ok(r) => r,
        Err(_) => Err(AppError::msg("stream engine timed out")),
    }
}

// ----------------------------------------------------------------------------------------------
// Tauri commands — thin wrappers the My PCs UI calls. Each returns the engine's JSON result or a
// surfaced engine error (e.g. `not_paired`, `pin_wrong`, `host_unreachable`).
// ----------------------------------------------------------------------------------------------

/// Pair with a GameStream host by PIN (engine `client.pair`).
#[tauri::command]
pub async fn engine_pair(host: String, pin: String) -> AppResult<Value> {
    engine_call("client.pair", json!({ "host": host, "pin": pin })).await
}

/// Hosts the engine knows about (engine `client.hosts`).
#[tauri::command]
pub async fn engine_hosts() -> AppResult<Value> {
    engine_call("client.hosts", Value::Null).await
}

/// A host's streamable apps (engine `client.apps`).
#[tauri::command]
pub async fn engine_apps(host: String) -> AppResult<Value> {
    engine_call("client.apps", json!({ "host": host })).await
}

/// Stop the current stream (engine `client.stop`).
#[tauri::command]
pub async fn engine_stop() -> AppResult<Value> {
    engine_call("client.stop", Value::Null).await
}

// ----- Host mode (engine `host.*`) — let *this* PC be streamed --------------------------------
// These drive the engine's host side (a forked Sunshine): query/toggle hosting and publish the
// local library as streamable apps. The engine's host handlers are stubs until that milestone
// lands, so today these surface honest `not_installed`/`unsupported_method` errors; the launcher
// UI degrades gracefully on those. Wiring them now keeps the launcher the thin driver the design
// calls for, ready when the engine fills the handlers in.

/// This machine's hosting status (engine `host.status`):
/// `{ installed, running, configured, gpuCapable, appsCount }`.
#[tauri::command]
pub async fn engine_host_status() -> AppResult<Value> {
    engine_call("host.status", Value::Null).await
}

/// Start/stop hosting this PC (engine `host.enable`) → `{ running }`.
#[tauri::command]
pub async fn engine_host_enable(on: bool) -> AppResult<Value> {
    engine_call("host.enable", json!({ "on": on })).await
}

/// Publish the local library to the host as streamable apps (engine `host.syncApps`):
/// `{ games: [{ id, name, coverPath, launchCmd }] }` → `{ added, removed, updated }`.
#[tauri::command]
pub async fn engine_host_sync_apps(games: Value) -> AppResult<Value> {
    engine_call("host.syncApps", json!({ "games": games })).await
}

/// The games this host currently exposes (engine `host.listApps`):
/// `{ apps: [{ gameKey, name, coverRef }] }`.
#[tauri::command]
pub async fn engine_host_list_apps() -> AppResult<Value> {
    engine_call("host.listApps", Value::Null).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end seam check: spawn the real engine and round-trip `client.hosts`.
    /// Skipped unless `ARCADE_STREAM_ENGINE` points at an engine binary, so CI
    /// without the engine stays green; run locally with the env var set.
    #[tokio::test]
    async fn live_hosts_roundtrip() {
        if std::env::var("ARCADE_STREAM_ENGINE").is_err() {
            eprintln!("skip live_hosts_roundtrip: ARCADE_STREAM_ENGINE not set");
            return;
        }
        let v = engine_call("client.hosts", Value::Null)
            .await
            .expect("client.hosts round-trip");
        assert!(v.get("hosts").is_some(), "expected a hosts array, got {v}");
    }
}
