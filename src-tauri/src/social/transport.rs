//! Live WebSocket transport for the social gateway. This is the glue the tested
//! foundation sits under: it owns the tokio task that connects via
//! `tokio-tungstenite`, runs the 20s ping heartbeat, reconnects on drop using
//! the [`Backoff`] schedule, and resumes after the last seen message id. Inbound
//! text frames and lifecycle changes are forwarded to the webview as Tauri
//! events (`social://frame` / `social://state`); the frontend parses frames with
//! the same tested `parseInbound` used by the demo gateway, so nothing in the
//! reducer or UI changes.
//!
//! Connection identity is tracked by a monotonic generation counter held in the
//! managed [`SocialTransport`]. Each spawned task captures its own generation;
//! before emitting any event it checks it is still current, and a superseded
//! task exits silently. This is the guard against double-connect (e.g. React
//! StrictMode's mount→unmount→mount in dev re-invokes `connect`): the second
//! connect bumps the generation, the first task goes quiet, and the UI never
//! sees a stale `disconnected` clobbering a live `connected`.

use crate::social::backoff::Backoff;
use crate::social::device;
use crate::social::endpoint::Endpoint;
use crate::social::protocol::{outbound, Inbound};
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

/// Event name carrying one raw inbound text frame (a JSON string) to the webview.
pub const FRAME_EVENT: &str = "social://frame";
/// Event name carrying a [`GatewayState`](crate) token: connecting / connected /
/// reconnecting / disconnected.
pub const STATE_EVENT: &str = "social://state";

const HEARTBEAT: Duration = Duration::from_secs(20);

/// Managed state: the outbound channel to the live connection task (if any) and
/// the generation counter that identifies the current connection.
#[derive(Default)]
pub struct SocialTransport {
    tx: Mutex<Option<UnboundedSender<String>>>,
    generation: Arc<AtomicU64>,
}

impl SocialTransport {
    /// Queue a raw outbound frame for the live socket. Returns false if there is
    /// no live connection (frame dropped — the UI is optimistic and will resend
    /// nothing; this mirrors the C++ "offline send is a no-op" behavior).
    pub fn send(&self, frame: String) -> bool {
        match self.tx.lock().unwrap().as_ref() {
            Some(tx) => tx.send(frame).is_ok(),
            None => false,
        }
    }

    /// Open (or replace) the connection to `endpoint`. Any existing connection is
    /// superseded: its generation is invalidated and its outbound channel
    /// dropped, so it tears down without emitting further events.
    pub fn connect(&self, app: AppHandle, endpoint: Endpoint) {
        let my_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        *self.tx.lock().unwrap() = Some(tx); // drops the previous sender
        let generation = self.generation.clone();
        tauri::async_runtime::spawn(run_connection(app, endpoint, rx, generation, my_gen));
    }

    /// Tear the connection down. Bumping the generation invalidates the running
    /// task's emits; dropping the sender closes its outbound channel so it exits.
    pub fn disconnect(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.tx.lock().unwrap() = None;
    }
}

/// Emit `payload` on `event` only if this task is still the current connection.
/// Returns false when the task has been superseded, signaling it should stop.
fn emit_if_current(app: &AppHandle, gen: &AtomicU64, my_gen: u64, event: &str, payload: &str) -> bool {
    if gen.load(Ordering::SeqCst) != my_gen {
        return false;
    }
    let _ = app.emit(event, payload);
    true
}

/// How a connection session ended.
enum SessionEnd {
    /// The outbound channel closed (explicit disconnect) — stop for good.
    Shutdown,
    /// A newer connection superseded this one — stop silently.
    Superseded,
    /// The socket dropped/errored — reconnect after backoff.
    Dropped,
}

/// The outer reconnect loop: connect, run a session, back off, repeat — until
/// shutdown or supersession.
async fn run_connection(
    app: AppHandle,
    endpoint: Endpoint,
    mut rx: UnboundedReceiver<String>,
    gen: Arc<AtomicU64>,
    my_gen: u64,
) {
    let mut backoff = Backoff::standard();
    let mut last_msg_id: u64 = 0;
    let mut first = true;

    loop {
        if gen.load(Ordering::SeqCst) != my_gen {
            return; // superseded before we could (re)connect
        }
        let state = if first { "connecting" } else { "reconnecting" };
        first = false;
        if !emit_if_current(&app, &gen, my_gen, STATE_EVENT, state) {
            return;
        }

        // Identity is derived per connect rather than cached: it is two env
        // reads and a hash, and re-deriving means a machine renamed while the
        // launcher is open reconnects under its new name.
        let (host, user) = device::local_identity();
        let url = endpoint.ws_url_with_device(
            &device::device_id(&host, &user),
            &device::device_name(&host, &user),
            device::DEVICE_KIND,
            env!("CARGO_PKG_VERSION"),
        );
        match tokio_tungstenite::connect_async(url).await {
            Ok((ws, _)) => {
                backoff.reset();
                if !emit_if_current(&app, &gen, my_gen, STATE_EVENT, "connected") {
                    return;
                }
                match run_session(&app, &gen, my_gen, ws, &mut rx, &mut last_msg_id).await {
                    SessionEnd::Shutdown => break,
                    SessionEnd::Superseded => return,
                    SessionEnd::Dropped => {
                        // Fall through to backoff + reconnect.
                    }
                }
            }
            Err(_e) => {
                // Connect failed; back off and retry. (No detail emitted — the
                // token must never be logged, and the error may embed the URL.)
            }
        }

        // Backoff wait before the next attempt. A jitter in [0, base] avoids
        // synchronized reconnect storms across many clients.
        let base = backoff.next_base_delay_ms();
        let delay = base.saturating_sub(jitter_offset(base));
        tokio::time::sleep(Duration::from_millis(delay)).await;
        if gen.load(Ordering::SeqCst) != my_gen {
            return; // disconnected/superseded during the wait
        }
    }

    let _ = emit_if_current(&app, &gen, my_gen, STATE_EVENT, "disconnected");
}

/// One connected session: pump outbound frames, the heartbeat, and inbound
/// frames until the socket drops or the connection is torn down.
async fn run_session(
    app: &AppHandle,
    gen: &AtomicU64,
    my_gen: u64,
    ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    rx: &mut UnboundedReceiver<String>,
    last_msg_id: &mut u64,
) -> SessionEnd {
    let (mut write, mut read) = ws.split();

    // After a reconnect, ask the server to replay anything we missed.
    if *last_msg_id > 0 && write.send(Message::Text(outbound::resume(*last_msg_id).into())).await.is_err() {
        return SessionEnd::Dropped;
    }

    let mut ping = tokio::time::interval(HEARTBEAT);
    ping.tick().await; // the first tick fires immediately; skip it

    loop {
        tokio::select! {
            outbound = rx.recv() => match outbound {
                Some(frame) => {
                    if write.send(Message::Text(frame.into())).await.is_err() {
                        return SessionEnd::Dropped;
                    }
                }
                None => {
                    let _ = write.close().await;
                    return SessionEnd::Shutdown;
                }
            },
            _ = ping.tick() => {
                if write.send(Message::Text(outbound::ping().into())).await.is_err() {
                    return SessionEnd::Dropped;
                }
                // Re-check supersession on the heartbeat so a superseded idle
                // connection tears down within one heartbeat.
                if gen.load(Ordering::SeqCst) != my_gen {
                    let _ = write.close().await;
                    return SessionEnd::Superseded;
                }
            },
            inbound = read.next() => match inbound {
                Some(Ok(Message::Text(t))) => {
                    let text = t.as_str();
                    // Track the high-water message id so a reconnect can resume.
                    if let Some(Inbound::Chat { message_id, .. }) = Inbound::parse(text) {
                        if message_id > *last_msg_id {
                            *last_msg_id = message_id;
                        }
                    }
                    if !emit_if_current(app, gen, my_gen, FRAME_EVENT, text) {
                        let _ = write.close().await;
                        return SessionEnd::Superseded;
                    }
                }
                Some(Ok(Message::Close(_))) | None => return SessionEnd::Dropped,
                Some(Ok(_)) => { /* binary / ping / pong — ignore */ }
                Some(Err(_)) => return SessionEnd::Dropped,
            },
        }
    }
}

/// A cheap, dependency-free jitter offset in `[0, base/2]` derived from the
/// current time. Subtracted from the base delay so retries spread out without
/// pulling in an RNG crate.
fn jitter_offset(base: u64) -> u64 {
    if base == 0 {
        return 0;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    nanos % (base / 2 + 1)
}
