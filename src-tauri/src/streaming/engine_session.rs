//! Persistent-session transport for engine-driven playback (`client.start`).
//!
//! The one-shot [`engine_conn`](super::engine_conn) seam (spawn → one req/res →
//! tear down) is right for pairing and discovery, but streaming is **long-lived**:
//! `client.start` returns `{started:true}` quickly, then the engine streams on a
//! worker thread and emits `stream.state` / `stream.stats` events over the *same*
//! connection until `client.stop`. So this module keeps the connection open:
//!
//!   1. create the launcher-side endpoint, spawn the engine in `stream` mode,
//!      accept its connection, exchange hellos (version-checked);
//!   2. send `client.start` and await its `{started:true}` response (errors like
//!      `not_paired` / `host_unreachable` surface synchronously to the UI);
//!   3. split the connection and hand it to a reader task that forwards every
//!      `stream.*` event to the webview as Tauri events and tears the session
//!      (and the engine child) down on a terminal phase, EOF, or stop.
//!
//! Lifecycle is managed exactly like the social gateway ([`SocialTransport`]):
//! a monotonic generation counter in the managed [`StreamSession`] identifies the
//! current session; starting a new stream or calling stop bumps it, so a
//! superseded reader goes quiet and never clobbers a live session's UI state. The
//! stop channel doubles as the shutdown signal — dropping its sender closes it,
//! the reader sends `client.stop`, and the engine child is reaped.
//!
//! Built on the pure [`engine`](super::engine) protocol core (framing/envelopes/
//! handshake) and [`play`](super::play) (params + terminal-phase decision); this
//! file is only the IO, matching the client's pure-core + thin-transport split.

use crate::error::{AppError, AppResult};
use crate::streaming::engine::{
    check_handshake, hello_frame, parse_message, request_frame, try_decode, Incoming,
};
use crate::streaming::engine_conn::{engine_path, unique_token};
use crate::streaming::moonlight::StreamSettings;
use crate::streaming::play::{
    client_start_params, is_terminal_phase, state_phase, STREAM_STATE_EVENT, STREAM_STATS_EVENT,
};
use crate::streaming::control;
use serde_json::Value;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{split, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

/// The single request id we use for `client.start` on a session connection.
const START_REQ_ID: u64 = 1;
/// And for the `client.stop` we send on graceful shutdown.
const STOP_REQ_ID: u64 = 2;
/// Budget for the synchronous start handshake (spawn + hello + launch handshake).
/// The engine's own launch does a few short HTTP round-trips to the host, so this
/// is generous; the live stream that follows has no timeout (it runs until stop).
const START_TIMEOUT: Duration = Duration::from_secs(30);

/// Managed state: the current session's stop channel + a generation counter
/// identifying it. Default = no active stream.
#[derive(Default)]
pub struct StreamSession {
    stop_tx: Mutex<Option<UnboundedSender<()>>>,
    generation: Arc<AtomicU64>,
}

impl StreamSession {
    /// Register a new session as current, superseding any previous one (its
    /// generation is invalidated and its stop channel dropped, so its reader tears
    /// down). Returns the generation + the stop receiver for the new reader task.
    fn take_over(&self) -> (u64, UnboundedReceiver<()>) {
        let my_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::unbounded_channel::<()>();
        *self.stop_tx.lock().unwrap() = Some(tx); // drops the previous sender
        (my_gen, rx)
    }

    /// Stop the current stream: bump the generation (so the reader's emits go
    /// quiet) and drop the stop sender (closing the channel signals the reader to
    /// send `client.stop` and reap the engine). Idempotent.
    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.stop_tx.lock().unwrap() = None;
    }
}

/// Spawn the engine in `stream` mode, connected back to our endpoint `token`.
/// Output is teed to the Moonlight log and the console window suppressed.
fn spawn_stream_engine(token: &str) -> AppResult<Child> {
    let exe = engine_path()?;
    let mut cmd = Command::new(&exe);
    cmd.arg("stream")
        .arg("--ipc")
        .arg(token)
        .stdin(Stdio::null())
        .stdout(crate::proc::log_stdio("moonlight.log"))
        .stderr(crate::proc::log_stdio("moonlight.log"));
    crate::proc::hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::msg(format!("failed to spawn stream engine: {e}")))
}

/// Best-effort reap of the engine child once the session ends.
fn reap(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Drive the synchronous part on a freshly connected stream: exchange hellos
/// (version-checked) and send `client.start`, reading frames until its response.
/// On success returns any bytes already buffered past the response (so an early
/// event isn't lost when the reader takes over). Any `stream.*` events seen before
/// the response are forwarded so the UI can show "connecting" immediately.
async fn handshake_and_start<S>(
    app: &AppHandle,
    stream: &mut S,
    params: Value,
) -> AppResult<Vec<u8>>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    stream
        .write_all(&hello_frame(env!("CARGO_PKG_VERSION")))
        .await
        .map_err(|e| AppError::msg(format!("engine write (hello) failed: {e}")))?;
    let req = request_frame(START_REQ_ID, "client.start", params)
        .map_err(|e| AppError::msg(format!("bad client.start request: {e}")))?;
    stream
        .write_all(&req)
        .await
        .map_err(|e| AppError::msg(format!("engine write (client.start) failed: {e}")))?;

    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut handshaken = false;
    loop {
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
                Incoming::Res { id, result } if id == START_REQ_ID => {
                    // Surface the engine's in-band error (not_paired, host_unreachable, …);
                    // on success hand the reader whatever frames were buffered after the res.
                    result.map_err(|e| AppError::msg(e.to_string()))?;
                    return Ok(buf);
                }
                // Early events (e.g. a "connecting" stream.state) — forward now.
                Incoming::Event { event, data } => forward_event(app, &event, &data),
                _ => {}
            }
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::msg(format!("engine read failed: {e}")))?;
        if n == 0 {
            return Err(AppError::msg(if handshaken {
                "stream engine closed before the stream started"
            } else {
                "stream engine closed before handshake"
            }));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Forward one engine event to the webview as a Tauri event. `stream.state` and
/// `stream.stats` payloads are passed through raw (the frontend parses them with
/// its own tested core); other events are ignored here.
fn forward_event(app: &AppHandle, event: &str, data: &Value) {
    match event {
        "stream.state" => {
            let _ = app.emit(STREAM_STATE_EVENT, data);
        }
        "stream.stats" => {
            let _ = app.emit(STREAM_STATS_EVENT, data);
        }
        _ => {}
    }
}

/// The reader task: forward `stream.*` events until a terminal phase, EOF, or a
/// stop signal (the stop channel closing). On stop, ask the engine to `client.stop`
/// gracefully; either way the engine child is reaped. Emits are gated on the
/// generation so a superseded session never touches the UI.
async fn run_reader<S>(
    app: AppHandle,
    child: Child,
    stream: S,
    mut leftover: Vec<u8>,
    mut stop_rx: UnboundedReceiver<()>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let current = |g: &AtomicU64| g.load(Ordering::SeqCst) == my_gen;
    let (mut read, mut write) = split(stream);
    let mut chunk = [0u8; 4096];
    let mut stopping = false;

    // Drain anything already buffered from the handshake before reading more.
    loop {
        // Whole frames currently buffered; stop on need-more-bytes or a framing
        // error (both fall through to the read below).
        while let Ok(Some((consumed, payload))) = try_decode(&leftover) {
            let msg = parse_message(&payload);
            leftover.drain(..consumed);
            if let Ok(Incoming::Event { event, data }) = msg {
                if !current(&generation) {
                    reap(child);
                    return;
                }
                forward_event(&app, &event, &data);
                if event == "stream.state" && is_terminal_phase(state_phase(&data)) {
                    reap(child);
                    return;
                }
            }
        }

        tokio::select! {
            // Stop requested (channel closed by StreamSession::stop or a new start):
            // best-effort client.stop, then keep reading briefly until EOF/terminal.
            _ = stop_rx.recv(), if !stopping => {
                stopping = true;
                if let Ok(frame) = request_frame(STOP_REQ_ID, "client.stop", Value::Null) {
                    let _ = write.write_all(&frame).await;
                }
            }
            n = read.read(&mut chunk) => match n {
                Ok(0) => {
                    // EOF: the engine exited. Tell the UI the stream ended (unless superseded).
                    if current(&generation) {
                        let _ = app.emit(STREAM_STATE_EVENT, serde_json::json!({ "phase": "ended" }));
                    }
                    reap(child);
                    return;
                }
                Ok(n) => leftover.extend_from_slice(&chunk[..n]),
                Err(_) => {
                    reap(child);
                    return;
                }
            },
        }
    }
}

/// Open the endpoint, spawn the engine, accept, run the start handshake, and (on
/// success) spawn the reader task that owns the live connection. Platform-specific
/// transport; identical protocol on top.
#[cfg(windows)]
async fn start_session(
    app: AppHandle,
    params: Value,
    stop_rx: UnboundedReceiver<()>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
) -> AppResult<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let token = unique_token();
    let pipe = format!(r"\\.\pipe\arcade-stream-engine-{token}");
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe)
        .map_err(|e| AppError::msg(format!("create pipe failed: {e}")))?;
    let child = spawn_stream_engine(&token)?;

    let setup = async {
        server
            .connect()
            .await
            .map_err(|e| AppError::msg(format!("pipe connect failed: {e}")))?;
        let mut server = server;
        let leftover = handshake_and_start(&app, &mut server, params).await?;
        Ok::<_, AppError>((server, leftover))
    };
    match tokio::time::timeout(START_TIMEOUT, setup).await {
        Ok(Ok((server, leftover))) => {
            tauri::async_runtime::spawn(run_reader(
                app, child, server, leftover, stop_rx, generation, my_gen,
            ));
            Ok(())
        }
        Ok(Err(e)) => {
            reap(child);
            Err(e)
        }
        Err(_) => {
            reap(child);
            Err(AppError::msg("stream engine timed out starting the stream"))
        }
    }
}

#[cfg(unix)]
async fn start_session(
    app: AppHandle,
    params: Value,
    stop_rx: UnboundedReceiver<()>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
) -> AppResult<()> {
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
    let child = spawn_stream_engine(&token)?;

    let setup = async {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| AppError::msg(format!("socket accept failed: {e}")))?;
        let leftover = handshake_and_start(&app, &mut stream, params).await?;
        Ok::<_, AppError>((stream, leftover))
    };
    let result = match tokio::time::timeout(START_TIMEOUT, setup).await {
        Ok(Ok((stream, leftover))) => {
            tauri::async_runtime::spawn(run_reader(
                app, child, stream, leftover, stop_rx, generation, my_gen,
            ));
            Ok(())
        }
        Ok(Err(e)) => {
            reap(child);
            Err(e)
        }
        Err(_) => {
            reap(child);
            Err(AppError::msg("stream engine timed out starting the stream"))
        }
    };
    let _ = std::fs::remove_file(&path); // the connection is already established
    result
}

// ----------------------------------------------------------------------------------------------
// Tauri commands — the My PCs / StreamFromHost UI drives these.
// ----------------------------------------------------------------------------------------------

/// Whether the bundled stream engine is present (so the UI can prefer in-engine
/// streaming over external Moonlight). Cheap path probe; no spawn.
#[tauri::command]
pub fn engine_stream_available() -> bool {
    engine_path().is_ok()
}

/// Start streaming `app` from `address` through the engine (`client.start`). The
/// engine renders into its own borderless window (`embedWindow:false`). Returns
/// once the stream has started; live progress arrives as `stream://state` /
/// `stream://stats` Tauri events. Engine errors (`not_paired`, `host_unreachable`,
/// `app_not_found`, …) surface here as an `Err` the UI shows.
#[tauri::command]
pub async fn stream_start(
    handle: AppHandle,
    session: tauri::State<'_, StreamSession>,
    address: String,
    app: String,
    settings: Option<StreamSettings>,
) -> AppResult<bool> {
    let host = control::normalize_address(&address);
    if host.is_empty() {
        return Err(AppError::msg("No streaming host address."));
    }
    if app.trim().is_empty() {
        return Err(AppError::msg("No app to stream."));
    }
    let settings = settings.unwrap_or_default();
    let params = client_start_params(&host, &app, &settings, false);

    let (my_gen, stop_rx) = session.take_over();
    let generation = session.generation.clone();
    // On any start failure, retire this generation so a stale reader can't linger.
    match start_session(handle, params, stop_rx, generation, my_gen).await {
        Ok(()) => Ok(true),
        Err(e) => {
            session.stop();
            Err(e)
        }
    }
}

/// Stop the current engine stream (graceful `client.stop` + reap). Idempotent —
/// a no-op when nothing is streaming.
#[tauri::command]
pub async fn stream_stop(session: tauri::State<'_, StreamSession>) -> AppResult<bool> {
    session.stop();
    Ok(true)
}
