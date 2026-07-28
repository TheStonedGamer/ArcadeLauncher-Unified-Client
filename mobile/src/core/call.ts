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
  /** This call was placed as a video call, by either end. The camera is turned
   *  on once media is up rather than at invite time, so a call nobody answers
   *  never lights up a camera. */
  wantsVideo: boolean;
  /** Why the call is over, so the phone can say something truthful instead of
   *  the overlay simply vanishing. Only meaningful while `phase` is "ended". */
  endReason: CallEndReason;
}

/** How a call finished. "offline" and "noanswer" are the cases that used to
 *  look exactly like a dead button. */
export type CallEndReason = "" | "hungup" | "declined" | "offline" | "noanswer";

/** Whether the ending is worth showing the user a notice about. */
export function isCallFailure(reason: CallEndReason): boolean {
  return reason === "offline" || reason === "noanswer" || reason === "declined";
}

export const CALL_END_LABEL: Record<CallEndReason, string> = {
  "": "",
  hungup: "Call ended",
  declined: "Call declined",
  offline: "They're offline",
  noanswer: "No answer",
};

export const IDLE_CALL: CallState = {
  phase: "idle",
  peerId: 0,
  muted: false,
  localVideo: "none",
  remoteVideo: "none",
  wantsVideo: false,
  endReason: "",
};

export type CallEvent =
  | { type: "invite"; peerId: number; video: boolean }
  | { type: "incoming"; peerId: number; video: boolean }
  | { type: "accept" }
  | { type: "remoteAccept" }
  | { type: "connected" }
  | { type: "toggleMute" }
  | { type: "hangup" }
  | { type: "remoteEnd" }
  | { type: "localVideo"; mode: VideoMode }
  | { type: "remoteVideo"; mode: VideoMode }
  /** The server told us the callee has no live socket at all. */
  | { type: "unreachable" }
  /** Nobody picked up before the ring window closed. */
  | { type: "noAnswer" }
  /** The user acknowledged the failure notice. */
  | { type: "dismiss" };

/** Pure transition. An event that does not fit the current phase is ignored
 *  rather than applied, so out-of-order signalling cannot corrupt a call --
 *  which matters more on a phone, where the socket drops every time the radio
 *  changes hands. */
export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case "invite":
      if (state.phase !== "idle" && state.phase !== "ended") return state;
      return { ...IDLE_CALL, phase: "inviting", peerId: event.peerId, wantsVideo: event.video };
    case "incoming":
      if (state.phase !== "idle" && state.phase !== "ended") return state;
      return { ...IDLE_CALL, phase: "ringing", peerId: event.peerId, wantsVideo: event.video };
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
      if (state.phase === "idle") return state;
      return { ...IDLE_CALL, phase: "ended", peerId: state.peerId, endReason: "hungup" };
    case "remoteEnd":
      if (state.phase === "idle") return state;
      // Ending an invite we never got an answer to is a decline; ending a call
      // that had connected is just a hang-up.
      return {
        ...IDLE_CALL,
        phase: "ended",
        peerId: state.peerId,
        endReason: state.phase === "inviting" ? "declined" : "hungup",
      };
    // Both only mean anything while we are the ones ringing. Arriving late (the
    // call connected in the meantime) they must not kill a live call.
    case "unreachable":
      if (state.phase !== "inviting") return state;
      return { ...IDLE_CALL, phase: "ended", peerId: state.peerId, endReason: "offline" };
    case "noAnswer":
      if (state.phase !== "inviting") return state;
      return { ...IDLE_CALL, phase: "ended", peerId: state.peerId, endReason: "noanswer" };
    case "dismiss":
      if (state.phase !== "ended") return state;
      return IDLE_CALL;
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
  /** `video` marks a call placed from the video button. An older client omits
   *  the field; that reads as a voice call, which is what it is. */
  | { kind: "invite"; video: boolean }
  | { kind: "accept" }
  | { kind: "end" }
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string }
  | { kind: "video"; mode: VideoMode }
  // The two frames the *server* originates rather than relays: the callee has
  // no socket, and the ring outlived the server's backstop timeout.
  | { kind: "unreachable" }
  | { kind: "timeout" };

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
      return { kind: "invite", video: p.video === true };
    case "accept":
    case "end":
    case "unreachable":
    case "timeout":
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
      return { type: "incoming", peerId: fromId, video: signal.video === true };
    case "accept":
      return { type: "remoteAccept" };
    case "end":
      return { type: "remoteEnd" };
    case "video":
      return { type: "remoteVideo", mode: signal.mode };
    case "unreachable":
      return { type: "unreachable" };
    case "timeout":
      return { type: "noAnswer" };
    default:
      return null;
  }
}

/** The line under the caller's name. */
export function callStatusText(state: CallState, name: string): string {
  switch (state.phase) {
    case "inviting":
      return state.wantsVideo ? `Video calling ${name}…` : `Calling ${name}…`;
    case "ringing":
      return state.wantsVideo ? `${name} is video calling` : `${name} is calling`;
    case "connecting":
      return "Connecting…";
    case "connected":
      return state.remoteVideo === "none" && state.localVideo === "none"
        ? "On a call"
        : "On a video call";
    case "ended":
      return CALL_END_LABEL[state.endReason] || "Call ended";
    default:
      return "";
  }
}
