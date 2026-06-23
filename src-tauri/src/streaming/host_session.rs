//! Persistent-session transport for engine **host mode** (`host.*`).
//!
//! Host mode is *stateful* in a way client calls are not: `host.enable` starts
//! the bundled Sunshine as a **managed child of the engine process**, and
//! `host.status`'s `running` reflects *that* engine's child. The one-shot
//! [`engine_conn`](super::engine_conn) seam spawns a fresh engine per call and
//! reaps it the instant the call returns — which for host mode means the engine
//! that just started Sunshine is immediately killed: Sunshine is orphaned, the
//! managed-child state is lost, and the *next* `host.status` (a brand-new engine)
//! reports `running:false`. The "Let this PC be streamed" toggle is bound to that
//! flag, so it could never latch on — it always flipped straight back off.
//!
//! The fix mirrors [`engine_session`](super::engine_session): keep **one**
//! `engine host` process and its connection alive for the app's lifetime, and
//! serialize every `host.*` request/response over it. Now a single engine (and a
//! single backend, holding the real Sunshine child) answers every call, so
//! `running` is truthful and the child survives between calls. The engine's
//! `host` server is a multi-request loop (`Server::run`), so this needs no engine
//! change.
//!
//! Lifecycle: lazily connected on the first `host.*` call; transparently
//! reconnected if the connection breaks; explicitly [`restart`](HostSession::restart)ed
//! after the Sunshine sidecar is fetched (so the engine re-spawns and inherits the
//! freshly-set `ARCADE_SUNSHINE`); and [`shutdown`](HostSession::shutdown) on app
//! exit gracefully stops Sunshine (`host.enable {on:false}`) before reaping, so
//! hosting doesn't leak past the launcher.

use crate::error::{AppError, AppResult};
use crate::streaming::engine::{
    check_handshake, hello_frame, parse_message, request_frame, try_decode, Incoming,
};
use crate::streaming::engine_conn::{engine_path, unique_token};
use serde_json::{json, Value};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

/// One concrete connection type per platform — no trait objects needed since each
/// build target has exactly one transport.
#[cfg(windows)]
type HostStream = tokio::net::windows::named_pipe::NamedPipeServer;
#[cfg(unix)]
type HostStream = tokio::net::UnixStream;

/// Budget for connecting (spawn + accept + hello handshake).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Budget for a single host.* round-trip. `host.enable` starts/stops the Sunshine
/// child (a quick spawn); the rest are catalog reads/writes — all sub-second, but
/// give generous headroom for a cold child start.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// The live host engine + its connection. While this exists, exactly one engine
/// owns the Sunshine child.
struct HostConn {
    child: Child,
    stream: HostStream,
    /// Bytes read past the last decoded frame, carried between calls.
    buf: Vec<u8>,
    /// Monotonic request id (the engine echoes it in the matching response).
    next_id: u64,
}

/// Managed state: the one persistent host engine connection, or `None` when no
/// engine is connected (initial state, after a teardown, or after a broken pipe).
#[derive(Default)]
pub struct HostSession {
    inner: Mutex<Option<HostConn>>,
}

/// Spawn the engine in `host` mode, connected back to our endpoint `token`. It
/// inherits our environment — crucially `ARCADE_SUNSHINE`, which points it at the
/// fetched sidecar (see [`host_fetch_commands`](super::host_fetch_commands)).
fn spawn_host_engine(token: &str) -> AppResult<Child> {
    let exe = engine_path()?;
    let mut cmd = Command::new(&exe);
    cmd.arg("host")
        .arg("--ipc")
        .arg(token)
        .stdin(Stdio::null())
        .stdout(crate::proc::log_stdio("sunshine-host.log"))
        .stderr(crate::proc::log_stdio("sunshine-host.log"));
    crate::proc::hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::msg(format!("failed to spawn stream engine (host): {e}")))
}

/// Best-effort reap of the host engine child.
fn reap(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Exchange hellos on a freshly connected stream (version-checked), returning any
/// bytes already buffered past the engine's hello so the first call doesn't lose
/// an early frame.
async fn handshake(stream: &mut HostStream) -> AppResult<Vec<u8>> {
    stream
        .write_all(&hello_frame(env!("CARGO_PKG_VERSION")))
        .await
        .map_err(|e| AppError::msg(format!("engine write (hello) failed: {e}")))?;

    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        while let Some((consumed, payload)) =
            try_decode(&buf).map_err(|e| AppError::msg(format!("engine framing error: {e}")))?
        {
            let msg = parse_message(&payload)
                .map_err(|e| AppError::msg(format!("engine protocol error: {e}")))?;
            buf.drain(..consumed);
            if let Incoming::Hello { protocol_version, .. } = msg {
                check_handshake(protocol_version).map_err(|e| AppError::msg(e.to_string()))?;
                return Ok(buf);
            }
            // Anything before the hello (there shouldn't be) is ignored.
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::msg(format!("engine read failed: {e}")))?;
        if n == 0 {
            return Err(AppError::msg("stream engine closed before handshake"));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Send one request on an established connection and read frames until its
/// response arrives (ignoring the hello / any events). Errors here mean the
/// connection is unusable — the caller drops it so the next call reconnects.
async fn round_trip(conn: &mut HostConn, method: &str, params: Value) -> AppResult<Value> {
    let id = conn.next_id;
    conn.next_id += 1;
    let req = request_frame(id, method, params)
        .map_err(|e| AppError::msg(format!("bad engine request: {e}")))?;
    conn.stream
        .write_all(&req)
        .await
        .map_err(|e| AppError::msg(format!("engine write (req) failed: {e}")))?;

    let mut chunk = [0u8; 4096];
    loop {
        while let Some((consumed, payload)) = try_decode(&conn.buf)
            .map_err(|e| AppError::msg(format!("engine framing error: {e}")))?
        {
            let msg = parse_message(&payload)
                .map_err(|e| AppError::msg(format!("engine protocol error: {e}")))?;
            conn.buf.drain(..consumed);
            if let Incoming::Res { id: rid, result } = msg {
                if rid == id {
                    // Surface the engine's in-band error (e.g. not_installed).
                    return result.map_err(|e| AppError::msg(e.to_string()));
                }
            }
            // Other responses / events / a late hello — keep reading.
        }
        let n = conn
            .stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::msg(format!("engine read failed: {e}")))?;
        if n == 0 {
            return Err(AppError::msg("stream engine closed before responding"));
        }
        conn.buf.extend_from_slice(&chunk[..n]);
    }
}

/// Open the launcher-side endpoint, spawn the host engine, accept, and handshake.
/// Platform-specific transport; identical protocol on top.
#[cfg(windows)]
async fn connect() -> AppResult<HostConn> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let token = unique_token();
    let pipe = format!(r"\\.\pipe\arcade-stream-engine-{token}");
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe)
        .map_err(|e| AppError::msg(format!("create pipe failed: {e}")))?;
    let child = spawn_host_engine(&token)?;
    let setup = async {
        server
            .connect()
            .await
            .map_err(|e| AppError::msg(format!("pipe connect failed: {e}")))?;
        let mut stream = server;
        let buf = handshake(&mut stream).await?;
        Ok::<_, AppError>((stream, buf))
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, setup).await {
        Ok(Ok((stream, buf))) => Ok(HostConn { child, stream, buf, next_id: 1 }),
        Ok(Err(e)) => {
            reap(child);
            Err(e)
        }
        Err(_) => {
            reap(child);
            Err(AppError::msg("stream engine timed out connecting for host mode"))
        }
    }
}

#[cfg(unix)]
async fn connect() -> AppResult<HostConn> {
    use tokio::net::UnixListener;
    let token = unique_token();
    let dir = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/tmp".to_string());
    let path = format!("{dir}/arcade-stream-engine-{token}.sock");
    let _ = std::fs::remove_file(&path);
    let listener =
        UnixListener::bind(&path).map_err(|e| AppError::msg(format!("bind {path} failed: {e}")))?;
    let child = spawn_host_engine(&token)?;
    let setup = async {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| AppError::msg(format!("socket accept failed: {e}")))?;
        let buf = handshake(&mut stream).await?;
        Ok::<_, AppError>((stream, buf))
    };
    let result = match tokio::time::timeout(CONNECT_TIMEOUT, setup).await {
        Ok(Ok((stream, buf))) => Ok(HostConn { child, stream, buf, next_id: 1 }),
        Ok(Err(e)) => {
            reap(child);
            Err(e)
        }
        Err(_) => {
            reap(child);
            Err(AppError::msg("stream engine timed out connecting for host mode"))
        }
    };
    let _ = std::fs::remove_file(&path); // connection already established
    result
}

impl HostSession {
    /// Call one `host.*` method over the persistent connection, (re)connecting the
    /// engine if needed. A transport error drops the connection so the next call
    /// reconnects; the engine's in-band method errors propagate as `Err`.
    pub async fn call(&self, method: &str, params: Value) -> AppResult<Value> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            *guard = Some(connect().await?);
        }
        let conn = guard.as_mut().expect("just connected");
        let result = tokio::time::timeout(CALL_TIMEOUT, round_trip(conn, method, params)).await;
        match result {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => {
                // Transport/protocol failure — the connection is suspect. Drop it
                // (reaping the child) so the next call gets a fresh engine.
                if let Some(c) = guard.take() {
                    reap(c.child);
                }
                Err(e)
            }
            Err(_) => {
                if let Some(c) = guard.take() {
                    reap(c.child);
                }
                Err(AppError::msg("stream engine timed out (host)"))
            }
        }
    }

    /// Drop the current host engine connection (reaping the child) so the next
    /// `call` spawns a fresh engine. Used after the Sunshine sidecar is fetched so
    /// the engine re-reads `ARCADE_SUNSHINE` from the environment.
    pub async fn restart(&self) {
        if let Some(conn) = self.inner.lock().await.take() {
            reap(conn.child);
        }
    }

    /// Gracefully tear hosting down on app exit: best-effort `host.enable {on:false}`
    /// so the engine stops Sunshine, then reap the engine. Without this, an enabled
    /// host would leak Sunshine past the launcher.
    pub async fn shutdown(&self) {
        let mut guard = self.inner.lock().await;
        if let Some(mut conn) = guard.take() {
            let _ = tokio::time::timeout(
                Duration::from_secs(5),
                round_trip(&mut conn, "host.enable", json!({ "on": false })),
            )
            .await;
            reap(conn.child);
        }
    }
}
