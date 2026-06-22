//! Launcher-side client for the GPL stream engine (`ArcadeLauncher-StreamEngine`),
//! spoken over the arm's-length IPC boundary documented in the engine's `docs/IPC.md`.
//!
//! This module owns the **pure wire protocol** — length-prefixed framing, the JSON
//! request/response/event envelopes, and the version handshake — mirroring the engine's
//! `src/ipc/{frame,server,json}`. It is IO-free and KAT-tested, matching the rest of the
//! client (`download`, `saves`, `social`, the existing `streaming::control`). The
//! process-spawn + named-pipe/Unix-socket transport and the Tauri commands layer on top of
//! this core (the engine connects to a launcher-created endpoint; the launcher is the listener).
//!
//! Keeping the protocol a real, documented contract two independent programs speak is what
//! keeps the engine's GPL code at arm's length (mere aggregation) from this proprietary client.

use serde::Serialize;
use serde_json::{json, Map, Value};

/// IPC protocol version. MUST match the engine's `ipc::kProtocolVersion`. Bump on any breaking
/// change to the message/handshake shape (mirrors the client↔server major.minor lockstep).
pub const PROTOCOL_VERSION: u32 = 1;

/// Maximum frame size — frames larger than this are rejected on both ends (engine: `kMaxFrame`).
pub const MAX_FRAME: usize = 8 * 1024 * 1024;

/// Errors from shaping/parsing the wire protocol (not transport IO — that lives in the seam).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtoError {
    /// A frame's declared length exceeds [`MAX_FRAME`].
    TooLarge,
    /// The payload was not valid UTF-8 JSON.
    BadJson,
    /// The top-level JSON value was not an object.
    NotObject,
    /// The engine advertised a protocol version we don't speak.
    VersionMismatch { expected: u32, got: u32 },
}

impl std::fmt::Display for ProtoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProtoError::TooLarge => write!(f, "IPC frame exceeds {} byte cap", MAX_FRAME),
            ProtoError::BadJson => write!(f, "IPC frame was not valid JSON"),
            ProtoError::NotObject => write!(f, "IPC message was not a JSON object"),
            ProtoError::VersionMismatch { expected, got } => write!(
                f,
                "stream-engine protocol mismatch (launcher speaks v{expected}, engine v{got}) — \
                 update the engine and launcher together"
            ),
        }
    }
}
impl std::error::Error for ProtoError {}

/// An error result carried by a `res` frame (`{ ok:false, error:{ code, message } }`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

/// A decoded message from the engine.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    /// The engine's handshake.
    Hello { protocol_version: u32, engine_version: String },
    /// A response to a request `id` — `Ok(result)` or `Err(error)`.
    Res { id: u64, result: Result<Value, IpcError> },
    /// An unsolicited event (`stream.state`, `stream.stats`, `host.appsChanged`, …).
    Event { event: String, data: Value },
    /// A frame we don't model (forward-compatible: ignore rather than error).
    Other,
}

// ----------------------------------------------------------------------------------------------
// Framing — 4-byte little-endian length prefix, then that many bytes of UTF-8 JSON.
// ----------------------------------------------------------------------------------------------

/// Encode one frame: a 4-byte LE length prefix followed by `payload`.
pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, ProtoError> {
    if payload.len() > MAX_FRAME {
        return Err(ProtoError::TooLarge);
    }
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Try to peel one frame off the front of `buf` (an accumulating read buffer).
///
/// Returns `Ok(Some((consumed, payload)))` when a whole frame is present (the caller drains
/// `consumed` bytes), `Ok(None)` when more bytes are needed, or `Err` if the declared length
/// is oversize. Pure and incremental, so the transport seam can call it in a read loop.
pub fn try_decode(buf: &[u8]) -> Result<Option<(usize, Vec<u8>)>, ProtoError> {
    if buf.len() < 4 {
        return Ok(None);
    }
    let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    if len > MAX_FRAME {
        return Err(ProtoError::TooLarge);
    }
    if buf.len() < 4 + len {
        return Ok(None);
    }
    Ok(Some((4 + len, buf[4..4 + len].to_vec())))
}

// ----------------------------------------------------------------------------------------------
// Envelopes — build outgoing frames, parse incoming ones.
// ----------------------------------------------------------------------------------------------

/// Build the launcher's handshake frame (sent immediately on connect, both ways).
pub fn hello_frame(launcher_version: &str) -> Vec<u8> {
    let v = json!({
        "kind": "hello",
        "protocolVersion": PROTOCOL_VERSION,
        "launcherVersion": launcher_version,
    });
    // A hello is tiny, well under MAX_FRAME — encoding cannot fail.
    encode_frame(&serde_json::to_vec(&v).expect("hello serializes")).expect("hello fits a frame")
}

/// Build a `req` frame: `{ kind:"req", id, method, params? }`. `params` is omitted when null.
pub fn request_frame(id: u64, method: &str, params: Value) -> Result<Vec<u8>, ProtoError> {
    let mut obj = Map::new();
    obj.insert("kind".into(), Value::from("req"));
    obj.insert("id".into(), Value::from(id));
    obj.insert("method".into(), Value::from(method));
    if !params.is_null() {
        obj.insert("params".into(), params);
    }
    let bytes = serde_json::to_vec(&Value::Object(obj)).map_err(|_| ProtoError::BadJson)?;
    encode_frame(&bytes)
}

/// Typed helper for `request_frame` params (callers can pass any `Serialize`).
pub fn request_frame_with<P: Serialize>(
    id: u64,
    method: &str,
    params: &P,
) -> Result<Vec<u8>, ProtoError> {
    let v = serde_json::to_value(params).map_err(|_| ProtoError::BadJson)?;
    request_frame(id, method, v)
}

/// Parse one frame payload into an [`Incoming`] message.
pub fn parse_message(bytes: &[u8]) -> Result<Incoming, ProtoError> {
    let v: Value = serde_json::from_slice(bytes).map_err(|_| ProtoError::BadJson)?;
    let obj = v.as_object().ok_or(ProtoError::NotObject)?;
    match obj.get("kind").and_then(Value::as_str) {
        Some("hello") => Ok(Incoming::Hello {
            protocol_version: obj.get("protocolVersion").and_then(Value::as_u64).unwrap_or(0) as u32,
            engine_version: obj
                .get("engineVersion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        }),
        Some("res") => {
            let id = obj.get("id").and_then(Value::as_u64).unwrap_or(0);
            let ok = obj.get("ok").and_then(Value::as_bool).unwrap_or(false);
            let result = if ok {
                Ok(obj.get("result").cloned().unwrap_or(Value::Null))
            } else {
                let e = obj.get("error");
                Err(IpcError {
                    code: e
                        .and_then(|e| e.get("code"))
                        .and_then(Value::as_str)
                        .unwrap_or("internal")
                        .to_string(),
                    message: e
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                })
            };
            Ok(Incoming::Res { id, result })
        }
        Some("event") => Ok(Incoming::Event {
            event: obj.get("event").and_then(Value::as_str).unwrap_or("").to_string(),
            data: obj.get("data").cloned().unwrap_or(Value::Null),
        }),
        _ => Ok(Incoming::Other),
    }
}

/// Verify the engine's advertised protocol version matches ours.
pub fn check_handshake(engine_protocol: u32) -> Result<(), ProtoError> {
    if engine_protocol == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(ProtoError::VersionMismatch {
            expected: PROTOCOL_VERSION,
            got: engine_protocol,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip() {
        let payload = br#"{"kind":"req"}"#;
        let framed = encode_frame(payload).unwrap();
        // 4-byte LE header equals the payload length.
        assert_eq!(framed[0] as usize, payload.len());
        assert_eq!(&framed[1..4], &[0, 0, 0]);
        let (consumed, got) = try_decode(&framed).unwrap().unwrap();
        assert_eq!(consumed, framed.len());
        assert_eq!(got, payload);
    }

    #[test]
    fn try_decode_needs_more_then_splits_trailing() {
        let a = encode_frame(b"one").unwrap();
        let b = encode_frame(b"two").unwrap();

        // Short of even the header / body -> None.
        assert_eq!(try_decode(&a[..2]).unwrap(), None);
        assert_eq!(try_decode(&a[..6]).unwrap(), None);

        // Two frames concatenated: decode the first, leave the second.
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        let (consumed, first) = try_decode(&buf).unwrap().unwrap();
        assert_eq!(first, b"one");
        let (_, second) = try_decode(&buf[consumed..]).unwrap().unwrap();
        assert_eq!(second, b"two");
    }

    #[test]
    fn try_decode_rejects_oversize() {
        // Header claims > MAX_FRAME bytes.
        let huge = (MAX_FRAME as u32 + 1).to_le_bytes();
        assert_eq!(try_decode(&huge), Err(ProtoError::TooLarge));
    }

    #[test]
    fn hello_frame_shape() {
        let framed = hello_frame("0.10.12");
        let (_, payload) = try_decode(&framed).unwrap().unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], "hello");
        assert_eq!(v["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(v["launcherVersion"], "0.10.12");
    }

    #[test]
    fn request_frame_omits_null_params() {
        let framed = request_frame(7, "host.status", Value::Null).unwrap();
        let (_, payload) = try_decode(&framed).unwrap().unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], "req");
        assert_eq!(v["id"], 7);
        assert_eq!(v["method"], "host.status");
        assert!(v.get("params").is_none(), "null params must be omitted");
    }

    #[test]
    fn request_frame_carries_params() {
        let framed =
            request_frame(2, "client.apps", json!({ "host": "10.0.0.5" })).unwrap();
        let (_, payload) = try_decode(&framed).unwrap().unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["params"]["host"], "10.0.0.5");
    }

    #[test]
    fn parse_engine_hello() {
        let msg = parse_message(
            br#"{"kind":"hello","protocolVersion":1,"engineVersion":"0.1.0"}"#,
        )
        .unwrap();
        assert_eq!(
            msg,
            Incoming::Hello { protocol_version: 1, engine_version: "0.1.0".into() }
        );
    }

    #[test]
    fn parse_res_ok_and_err() {
        let ok = parse_message(br#"{"kind":"res","id":1,"ok":true,"result":{"hosts":[]}}"#).unwrap();
        match ok {
            Incoming::Res { id, result } => {
                assert_eq!(id, 1);
                assert_eq!(result.unwrap(), json!({ "hosts": [] }));
            }
            other => panic!("expected res, got {other:?}"),
        }

        let err = parse_message(
            br#"{"kind":"res","id":2,"ok":false,"error":{"code":"not_paired","message":"pair first"}}"#,
        )
        .unwrap();
        match err {
            Incoming::Res { id, result } => {
                assert_eq!(id, 2);
                assert_eq!(
                    result.unwrap_err(),
                    IpcError { code: "not_paired".into(), message: "pair first".into() }
                );
            }
            other => panic!("expected res, got {other:?}"),
        }
    }

    #[test]
    fn parse_event_and_unknown() {
        let ev = parse_message(
            br#"{"kind":"event","event":"stream.state","data":{"phase":"streaming"}}"#,
        )
        .unwrap();
        assert_eq!(
            ev,
            Incoming::Event {
                event: "stream.state".into(),
                data: json!({ "phase": "streaming" }),
            }
        );
        // Unknown kinds are tolerated (forward compatibility), not errors.
        assert_eq!(parse_message(br#"{"kind":"future"}"#).unwrap(), Incoming::Other);
    }

    #[test]
    fn parse_rejects_garbage() {
        assert_eq!(parse_message(b"not json"), Err(ProtoError::BadJson));
        assert_eq!(parse_message(b"[1,2,3]"), Err(ProtoError::NotObject));
    }

    #[test]
    fn handshake_version_check() {
        assert!(check_handshake(PROTOCOL_VERSION).is_ok());
        assert_eq!(
            check_handshake(999),
            Err(ProtoError::VersionMismatch { expected: PROTOCOL_VERSION, got: 999 })
        );
    }
}
