// Voice and video calls, phone side.
//
// The call rides the server's existing `voice_signal` relay, which carries
// opaque payloads between two friends and interprets none of them. That means
// the contract lives at the two ends, and the phone's end must match the
// desktop's src/features/social/voice.ts exactly or a PC and a phone can never
// complete a call. The FSM and the codec below are restated from it deliberately
// -- same phases, same payload kinds, same "ignore what does not fit" rule.
//
// The one intentional difference is the video vocabulary: a phone can send its
// camera but has no screen to share, so "screen" is understood when it arrives
// from a PC and is never sent from here.

export type CallPhase = "idle" | "inviting" | "ringing" | "connecting" | "connected" | "ended";

/** What a peer is putting on its video track. "screen" is receive-only here. */
export type VideoMode = "none" | "camera" | "screen";

const VIDEO_MODES: readonly VideoMode[] = ["none", "camera", "screen"];

export interface CallState {
  phase: CallPhase;
  /** The other account (0 when idle). */
  peerId: number;
  muted: boolean;
  localVideo: VideoMode;
  remoteVideo: VideoMode;
}

export const IDLE_CALL: CallState = {
  phase: "idle",
  peerId: 0,
  muted: false,
  localVideo: "none",
  remoteVideo: "none",
};

export type CallEvent =
  | { type: "invite"; peerId: number }
  | { type: "incoming"; peerId: number }
  | { type: "accept" }
  | { type: "remoteAccept" }
  | { type: "connected" }
  | { type: "toggleMute" }
  | { type: "hangup" }
  | { type: "remoteEnd" }
  | { type: "localVideo"; mode: VideoMode }
  | { type: "remoteVideo"; mode: VideoMode };

/** Pure transition. An event that does not fit the current phase is ignored
 *  rather than applied, so out-of-order signalling cannot corrupt a call --
 *  which matters more on a phone, where the socket drops every time the radio
 *  changes hands. */
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
  }
  return state;
}

/** True when a call is live enough that a second one must not start. */
export function isBusy(state: CallState): boolean {
  return state.phase !== "idle" && state.phase !== "ended";
}

/** Whether video controls are worth offering: only once there is a peer
 *  connection to renegotiate. */
export function canShareVideo(phase: CallPhase): boolean {
  return phase === "connecting" || phase === "connected";
}

/** Pressing the camera button toggles it; there is no screen button on a phone. */
export function nextVideoMode(current: VideoMode): VideoMode {
  return current === "camera" ? "none" : "camera";
}

// --- Signalling payloads ---------------------------------------------------
// Placed in the `payload` field of a voice_signal frame. The server relays them
// verbatim, so this shape is agreed between the two clients, not with it.

export type SignalPayload =
  | { kind: "invite" }
  | { kind: "accept" }
  | { kind: "end" }
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string }
  | { kind: "video"; mode: VideoMode };

export function parseVideoMode(value: unknown): VideoMode | null {
  return typeof value === "string" && (VIDEO_MODES as readonly string[]).includes(value)
    ? (value as VideoMode)
    : null;
}

/** Narrow a relayed payload, or null when malformed or unknown. Defensive on
 *  purpose: this crossed the network and was never inspected on the way. */
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

/** Turn an inbound signal into the FSM event it implies, if any. Offer, answer
 *  and ice drive the peer connection rather than the state machine, so they map
 *  to nothing here. */
export function eventForSignal(signal: SignalPayload, fromId: number): CallEvent | null {
  switch (signal.kind) {
    case "invite":
      return { type: "incoming", peerId: fromId };
    case "accept":
      return { type: "remoteAccept" };
    case "end":
      return { type: "remoteEnd" };
    case "video":
      return { type: "remoteVideo", mode: signal.mode };
    default:
      return null;
  }
}

/** The line under the caller's name. */
export function callStatusText(state: CallState, name: string): string {
  switch (state.phase) {
    case "inviting":
      return `Calling ${name}…`;
    case "ringing":
      return `${name} is calling`;
    case "connecting":
      return "Connecting…";
    case "connected":
      return state.remoteVideo === "none" ? "On a call" : "On a video call";
    case "ended":
      return "Call ended";
    default:
      return "";
  }
}
