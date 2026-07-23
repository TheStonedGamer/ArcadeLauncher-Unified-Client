import { describe, expect, it } from "vitest";
import {
  callReducer,
  callStatusText,
  canShareVideo,
  eventForSignal,
  IDLE_CALL,
  isBusy,
  nextVideoMode,
  parseSignal,
  parseVideoMode,
  type CallState,
} from "./call";

function at(phase: CallState["phase"], over: Partial<CallState> = {}): CallState {
  return { ...IDLE_CALL, phase, peerId: 42, ...over };
}

describe("placing and receiving a call", () => {
  it("goes idle -> inviting -> connecting -> connected for the caller", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 42 });
    expect(s).toMatchObject({ phase: "inviting", peerId: 42 });
    s = callReducer(s, { type: "remoteAccept" });
    expect(s.phase).toBe("connecting");
    s = callReducer(s, { type: "connected" });
    expect(s.phase).toBe("connected");
  });

  it("goes idle -> ringing -> connecting -> connected for the callee", () => {
    let s = callReducer(IDLE_CALL, { type: "incoming", peerId: 7 });
    expect(s).toMatchObject({ phase: "ringing", peerId: 7 });
    s = callReducer(s, { type: "accept" });
    expect(s.phase).toBe("connecting");
    s = callReducer(s, { type: "connected" });
    expect(s.phase).toBe("connected");
  });

  it("starts a fresh call from the ended state", () => {
    // Otherwise the second call of the evening would be impossible without a
    // separate reset step somebody will forget to dispatch.
    const ended = at("ended");
    expect(callReducer(ended, { type: "invite", peerId: 9 })).toMatchObject({
      phase: "inviting",
      peerId: 9,
    });
    expect(callReducer(ended, { type: "incoming", peerId: 9 })).toMatchObject({
      phase: "ringing",
      peerId: 9,
    });
  });

  it("does not let a second call interrupt a live one", () => {
    for (const phase of ["inviting", "ringing", "connecting", "connected"] as const) {
      const s = at(phase);
      expect(callReducer(s, { type: "invite", peerId: 99 })).toBe(s);
      expect(callReducer(s, { type: "incoming", peerId: 99 })).toBe(s);
    }
  });
});

describe("events that arrive in the wrong phase", () => {
  // The relay makes no ordering promise and a phone's socket drops whenever the
  // radio changes hands, so a signal for a call that already moved on must be
  // dropped rather than applied.
  it("ignores accept unless ringing", () => {
    for (const phase of ["idle", "inviting", "connecting", "connected", "ended"] as const) {
      const s = at(phase);
      expect(callReducer(s, { type: "accept" })).toBe(s);
    }
  });

  it("ignores remoteAccept unless inviting", () => {
    for (const phase of ["idle", "ringing", "connecting", "connected", "ended"] as const) {
      const s = at(phase);
      expect(callReducer(s, { type: "remoteAccept" })).toBe(s);
    }
  });

  it("ignores connected unless connecting", () => {
    for (const phase of ["idle", "inviting", "ringing", "connected", "ended"] as const) {
      const s = at(phase);
      expect(callReducer(s, { type: "connected" })).toBe(s);
    }
  });
});

describe("hanging up", () => {
  it("ends from any live phase and remembers who it was with", () => {
    for (const phase of ["inviting", "ringing", "connecting", "connected"] as const) {
      const s = callReducer(at(phase, { muted: true, localVideo: "camera" }), { type: "hangup" });
      expect(s).toEqual({ ...IDLE_CALL, phase: "ended", peerId: 42 });
    }
  });

  it("treats the peer hanging up the same way", () => {
    expect(callReducer(at("connected"), { type: "remoteEnd" })).toEqual({
      ...IDLE_CALL,
      phase: "ended",
      peerId: 42,
    });
  });

  it("is a no-op when there is no call", () => {
    expect(callReducer(IDLE_CALL, { type: "hangup" })).toBe(IDLE_CALL);
    expect(callReducer(IDLE_CALL, { type: "remoteEnd" })).toBe(IDLE_CALL);
  });

  it("clears mute and video, so the next call does not start muted", () => {
    const s = callReducer(at("connected", { muted: true, remoteVideo: "screen" }), { type: "hangup" });
    expect(s.muted).toBe(false);
    expect(s.remoteVideo).toBe("none");
  });
});

describe("mute", () => {
  it("toggles during a call, including while it is still ringing", () => {
    const s = callReducer(at("ringing"), { type: "toggleMute" });
    expect(s.muted).toBe(true);
    expect(callReducer(s, { type: "toggleMute" }).muted).toBe(false);
  });

  it("does nothing with no call to mute", () => {
    expect(callReducer(IDLE_CALL, { type: "toggleMute" })).toBe(IDLE_CALL);
    const ended = at("ended");
    expect(callReducer(ended, { type: "toggleMute" })).toBe(ended);
  });
});

describe("video", () => {
  it("records each side's mode once connected", () => {
    let s = callReducer(at("connected"), { type: "localVideo", mode: "camera" });
    expect(s.localVideo).toBe("camera");
    s = callReducer(s, { type: "remoteVideo", mode: "screen" });
    expect(s).toMatchObject({ localVideo: "camera", remoteVideo: "screen" });
  });

  it("accepts a mode while still connecting, since the offer carries it", () => {
    expect(callReducer(at("connecting"), { type: "localVideo", mode: "camera" }).localVideo).toBe("camera");
  });

  it("ignores a stale announcement that lands after the call ended", () => {
    // A late `video` frame must not put a picture back on a screen showing no
    // call at all.
    for (const phase of ["idle", "inviting", "ringing", "ended"] as const) {
      const s = at(phase);
      expect(callReducer(s, { type: "remoteVideo", mode: "camera" })).toBe(s);
    }
  });

  it("returns the same object when the mode did not change", () => {
    const s = at("connected", { remoteVideo: "camera" });
    expect(callReducer(s, { type: "remoteVideo", mode: "camera" })).toBe(s);
  });

  it("offers the camera as a plain toggle -- a phone has no screen to share", () => {
    expect(nextVideoMode("none")).toBe("camera");
    expect(nextVideoMode("camera")).toBe("none");
    expect(nextVideoMode("screen")).toBe("camera");
  });

  it("only offers video controls once there is a connection to renegotiate", () => {
    expect(canShareVideo("connecting")).toBe(true);
    expect(canShareVideo("connected")).toBe(true);
    for (const phase of ["idle", "inviting", "ringing", "ended"] as const) {
      expect(canShareVideo(phase)).toBe(false);
    }
  });
});

describe("isBusy", () => {
  it("is true exactly while a call occupies the microphone", () => {
    expect(isBusy(IDLE_CALL)).toBe(false);
    expect(isBusy(at("ended"))).toBe(false);
    for (const phase of ["inviting", "ringing", "connecting", "connected"] as const) {
      expect(isBusy(at(phase))).toBe(true);
    }
  });
});

describe("parseSignal", () => {
  // This payload crossed the network untouched by the server, so nothing about
  // its shape has been checked before it gets here.
  it("accepts the bare kinds", () => {
    expect(parseSignal({ kind: "invite" })).toEqual({ kind: "invite" });
    expect(parseSignal({ kind: "accept" })).toEqual({ kind: "accept" });
    expect(parseSignal({ kind: "end" })).toEqual({ kind: "end" });
  });

  it("requires the sdp on an offer or answer", () => {
    expect(parseSignal({ kind: "offer", sdp: "v=0" })).toEqual({ kind: "offer", sdp: "v=0" });
    expect(parseSignal({ kind: "answer", sdp: "v=0" })).toEqual({ kind: "answer", sdp: "v=0" });
    expect(parseSignal({ kind: "offer" })).toBeNull();
    expect(parseSignal({ kind: "answer", sdp: 5 })).toBeNull();
  });

  it("requires the candidate on an ice signal", () => {
    expect(parseSignal({ kind: "ice", candidate: "candidate:1" })).toEqual({
      kind: "ice",
      candidate: "candidate:1",
    });
    expect(parseSignal({ kind: "ice" })).toBeNull();
  });

  it("understands screen sharing even though it never sends it", () => {
    expect(parseSignal({ kind: "video", mode: "screen" })).toEqual({ kind: "video", mode: "screen" });
    expect(parseSignal({ kind: "video", mode: "hologram" })).toBeNull();
  });

  it("rejects junk instead of throwing", () => {
    for (const bad of [null, undefined, 5, "invite", [], {}, { kind: "reboot" }]) {
      expect(parseSignal(bad)).toBeNull();
    }
  });

  it("narrows a video mode on its own too", () => {
    expect(parseVideoMode("none")).toBe("none");
    expect(parseVideoMode("camera")).toBe("camera");
    expect(parseVideoMode(3)).toBeNull();
  });
});

describe("eventForSignal", () => {
  it("maps the state-changing signals, tagging the caller from the frame", () => {
    // peerId comes from who the frame was from, never from the payload -- the
    // payload is written by the other client and is not evidence of identity.
    expect(eventForSignal({ kind: "invite" }, 7)).toEqual({ type: "incoming", peerId: 7 });
    expect(eventForSignal({ kind: "accept" }, 7)).toEqual({ type: "remoteAccept" });
    expect(eventForSignal({ kind: "end" }, 7)).toEqual({ type: "remoteEnd" });
    expect(eventForSignal({ kind: "video", mode: "camera" }, 7)).toEqual({
      type: "remoteVideo",
      mode: "camera",
    });
  });

  it("maps nothing for the signals that drive the peer connection", () => {
    expect(eventForSignal({ kind: "offer", sdp: "v=0" }, 7)).toBeNull();
    expect(eventForSignal({ kind: "answer", sdp: "v=0" }, 7)).toBeNull();
    expect(eventForSignal({ kind: "ice", candidate: "c" }, 7)).toBeNull();
  });
});

describe("callStatusText", () => {
  it("names the phase in words", () => {
    expect(callStatusText(at("inviting"), "Sam")).toBe("Calling Sam…");
    expect(callStatusText(at("ringing"), "Sam")).toBe("Sam is calling");
    expect(callStatusText(at("connecting"), "Sam")).toBe("Connecting…");
    expect(callStatusText(at("connected"), "Sam")).toBe("On a call");
    expect(callStatusText(at("connected", { remoteVideo: "camera" }), "Sam")).toBe("On a video call");
    expect(callStatusText(at("ended"), "Sam")).toBe("Call ended");
    expect(callStatusText(IDLE_CALL, "Sam")).toBe("");
  });
});
