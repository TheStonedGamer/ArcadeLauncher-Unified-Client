// Pure voice-call core (ROADMAP T9g). Audio is peer-to-peer WebRTC; the server's
// `voice_signal` relay (social_api.rs) only carries opaque signaling payloads
// between friends — invite/accept/end plus the WebRTC SDP offer/answer and
// trickled ICE candidates. This module is the IO-free heart: a call-state FSM and
// the signaling-payload codec. The RTCPeerConnection/getUserMedia glue lives in
// useVoice; the wire frame (outbound.voiceSignal / inbound voice_signal) lives in
// protocol.ts. Everything here is deterministic → unit-tested in voice.test.ts.
//
// Video / screen share (T12e) rides the same connection and the same relay: the
// mode vocabulary and its UI helpers live in video.ts, and the call FSM below
// just tracks which mode each side is sending.

import type { VideoMode } from "./video";
import { parseVideoMode } from "./video";

/** Call lifecycle. `inviting` = I rang them; `ringing` = they rang me;
 *  `connecting` = invite accepted, negotiating media; `connected` = audio up. */
export type CallPhase = "idle" | "inviting" | "ringing" | "connecting" | "connected" | "ended";

export interface CallState {
  phase: CallPhase;
  /** The other account in the call (0 when idle). */
  peerId: number;
  /** Whether my mic is muted locally. */
  muted: boolean;
  /** What I'm currently sending on the video track (T12e). */
  localVideo: VideoMode;
  /** What the peer announced it is sending (T12e). */
  remoteVideo: VideoMode;
}

export const IDLE_CALL: CallState = {
  phase: "idle",
  peerId: 0,
  muted: false,
  localVideo: "none",
  remoteVideo: "none",
};

/** Events that drive the FSM. Local UI actions + remote signaling, unified. */
export type CallEvent =
  | { type: "invite"; peerId: number } // I start a call
  | { type: "incoming"; peerId: number } // remote invite arrives
  | { type: "accept" } // I accept the incoming call
  | { type: "remoteAccept" } // remote accepted my invite
  | { type: "connected" } // media is flowing (pc connected)
  | { type: "toggleMute" }
  | { type: "hangup" } // I end / cancel / decline
  | { type: "remoteEnd" } // remote ended / declined
  | { type: "localVideo"; mode: VideoMode } // my camera/screen track changed
  | { type: "remoteVideo"; mode: VideoMode }; // peer announced its video mode

/** Pure call-state transition. Invalid events for the current phase are ignored
 *  (return the same state) so out-of-order signaling can't corrupt the call. */
export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case "invite":
      if (state.phase !== "idle" && state.phase !== "ended") return state;
      return { ...IDLE_CALL, phase: "inviting", peerId: event.peerId };
    case "incoming":
      if (state.phase !== "idle" && state.phase !== "ended") return state;
      return { ...IDLE_CALL, phase: "ringing", peerId: event.peerId };
    case "accept":
      if (state.phase !== "ringing") return state;
      return { ...state, phase: "connecting" };
    case "remoteAccept":
      if (state.phase !== "inviting") return state;
      return { ...state, phase: "connecting" };
    case "connected":
      if (state.phase !== "connecting") return state;
      return { ...state, phase: "connected" };
    case "toggleMute":
      if (state.phase === "idle" || state.phase === "ended") return state;
      return { ...state, muted: !state.muted };
    case "localVideo":
    case "remoteVideo": {
      // Video only exists while a peer connection does; a stale announcement
      // arriving after hangup must not resurrect a picture.
      if (state.phase !== "connecting" && state.phase !== "connected") return state;
      const key = event.type === "localVideo" ? "localVideo" : "remoteVideo";
      if (state[key] === event.mode) return state;
      return { ...state, [key]: event.mode };
    }
    case "hangup":
    case "remoteEnd":
      if (state.phase === "idle") return state;
      return { ...IDLE_CALL, phase: "ended", peerId: state.peerId };
    default:
      return state;
  }
}

/** True when a call is active enough that a second call shouldn't start. */
export function isBusy(state: CallState): boolean {
  return state.phase !== "idle" && state.phase !== "ended";
}

// --- Signaling payload codec ----------------------------------------------
// These objects are placed in the `payload` field of a `voice_signal` frame.
// `kind` discriminates; the server relays them verbatim, so both peers agree on
// this shape (not the server).

export type SignalPayload =
  | { kind: "invite" }
  | { kind: "accept" }
  | { kind: "end" }
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string }
  /** Announces what the sender is putting on its video track. Sent alongside
   *  renegotiation so the receiver can label the picture — and, on "none", knows
   *  the track vanished deliberately rather than failing. */
  | { kind: "video"; mode: VideoMode };

/** Narrow an arbitrary relayed payload object to a known SignalPayload, or null
 *  if it's malformed/unknown. Defensive: the payload crosses the network. */
export function parseSignal(payload: unknown): SignalPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  switch (p.kind) {
    case "invite":
    case "accept":
    case "end":
      return { kind: p.kind };
    case "offer":
    case "answer":
      return typeof p.sdp === "string" ? { kind: p.kind, sdp: p.sdp } : null;
    case "ice":
      return typeof p.candidate === "string" ? { kind: "ice", candidate: p.candidate } : null;
    case "video": {
      const mode = parseVideoMode(p.mode);
      return mode ? { kind: "video", mode } : null;
    }
    default:
      return null;
  }
}
