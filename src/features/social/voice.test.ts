import { describe, it, expect } from "vitest";
import { callReducer, IDLE_CALL, isBusy, parseSignal, type CallState } from "./voice";

describe("callReducer — outbound call", () => {
  it("invite → inviting, remoteAccept → connecting, connected", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(s).toEqual({ ...IDLE_CALL, phase: "inviting", peerId: 7 });
    s = callReducer(s, { type: "remoteAccept" });
    expect(s.phase).toBe("connecting");
    s = callReducer(s, { type: "connected" });
    expect(s.phase).toBe("connected");
  });

  it("remote declines my invite → ended", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    s = callReducer(s, { type: "remoteEnd" });
    expect(s).toEqual({ ...IDLE_CALL, phase: "ended", peerId: 7 });
  });
});

describe("callReducer — inbound call", () => {
  it("incoming → ringing, accept → connecting", () => {
    let s = callReducer(IDLE_CALL, { type: "incoming", peerId: 3 });
    expect(s).toEqual({ ...IDLE_CALL, phase: "ringing", peerId: 3 });
    s = callReducer(s, { type: "accept" });
    expect(s.phase).toBe("connecting");
  });

  it("hangup from ringing (decline) → ended", () => {
    let s = callReducer(IDLE_CALL, { type: "incoming", peerId: 3 });
    s = callReducer(s, { type: "hangup" });
    expect(s.phase).toBe("ended");
  });
});

describe("callReducer — guards", () => {
  it("ignores invite while already busy", () => {
    const busy = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(callReducer(busy, { type: "invite", peerId: 9 })).toBe(busy);
    expect(callReducer(busy, { type: "incoming", peerId: 9 })).toBe(busy);
  });
  it("accept only valid from ringing", () => {
    expect(callReducer(IDLE_CALL, { type: "accept" })).toBe(IDLE_CALL);
    const inviting = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(callReducer(inviting, { type: "accept" })).toBe(inviting);
  });
  it("connected only from connecting", () => {
    const inviting = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(callReducer(inviting, { type: "connected" })).toBe(inviting);
  });
  it("hangup from idle is a no-op", () => {
    expect(callReducer(IDLE_CALL, { type: "hangup" })).toBe(IDLE_CALL);
  });
});

describe("toggleMute", () => {
  it("flips mute while in a call, no-op when idle", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    s = callReducer(s, { type: "toggleMute" });
    expect(s.muted).toBe(true);
    s = callReducer(s, { type: "toggleMute" });
    expect(s.muted).toBe(false);
    expect(callReducer(IDLE_CALL, { type: "toggleMute" })).toBe(IDLE_CALL);
  });
});

describe("isBusy", () => {
  it("true mid-call, false idle/ended", () => {
    expect(isBusy(IDLE_CALL)).toBe(false);
    const inviting = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(isBusy(inviting)).toBe(true);
    const ended: CallState = { ...IDLE_CALL, phase: "ended", peerId: 7 };
    expect(isBusy(ended)).toBe(false);
  });
});

describe("callReducer — video (T12e)", () => {
  const connected = () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    s = callReducer(s, { type: "remoteAccept" });
    return callReducer(s, { type: "connected" });
  };

  it("starts with no video on either side", () => {
    expect(IDLE_CALL.localVideo).toBe("none");
    expect(connected().remoteVideo).toBe("none");
  });

  it("tracks each side independently", () => {
    let s = callReducer(connected(), { type: "localVideo", mode: "screen" });
    expect(s).toMatchObject({ localVideo: "screen", remoteVideo: "none" });
    s = callReducer(s, { type: "remoteVideo", mode: "camera" });
    expect(s).toMatchObject({ localVideo: "screen", remoteVideo: "camera" });
  });

  it("allows video while still connecting (renegotiation can start early)", () => {
    const connecting = callReducer(callReducer(IDLE_CALL, { type: "invite", peerId: 7 }), {
      type: "remoteAccept",
    });
    expect(callReducer(connecting, { type: "localVideo", mode: "camera" }).localVideo).toBe("camera");
  });

  it("ignores video events with no peer connection behind them", () => {
    for (const state of [
      IDLE_CALL,
      callReducer(IDLE_CALL, { type: "invite", peerId: 7 }),
      callReducer(IDLE_CALL, { type: "incoming", peerId: 3 }),
      callReducer(connected(), { type: "hangup" }),
    ]) {
      expect(callReducer(state, { type: "localVideo", mode: "camera" })).toBe(state);
      expect(callReducer(state, { type: "remoteVideo", mode: "screen" })).toBe(state);
    }
  });

  it("is referentially stable when the mode does not change", () => {
    const s = callReducer(connected(), { type: "localVideo", mode: "camera" });
    expect(callReducer(s, { type: "localVideo", mode: "camera" })).toBe(s);
    expect(callReducer(s, { type: "remoteVideo", mode: "none" })).toBe(s);
  });

  it("clears both sides when the call ends", () => {
    let s = callReducer(connected(), { type: "localVideo", mode: "screen" });
    s = callReducer(s, { type: "remoteVideo", mode: "camera" });
    const ended = callReducer(s, { type: "remoteEnd" });
    expect(ended).toMatchObject({ phase: "ended", localVideo: "none", remoteVideo: "none" });
  });

  it("does not leak video state into the next call", () => {
    let s = callReducer(connected(), { type: "localVideo", mode: "screen" });
    s = callReducer(s, { type: "hangup" });
    s = callReducer(s, { type: "incoming", peerId: 9 });
    expect(s).toMatchObject({ phase: "ringing", peerId: 9, localVideo: "none", remoteVideo: "none" });
  });
});

describe("parseSignal", () => {
  it("parses simple kinds", () => {
    expect(parseSignal({ kind: "invite" })).toEqual({ kind: "invite" });
    expect(parseSignal({ kind: "accept" })).toEqual({ kind: "accept" });
    expect(parseSignal({ kind: "end" })).toEqual({ kind: "end" });
  });
  it("parses offer/answer with sdp", () => {
    expect(parseSignal({ kind: "offer", sdp: "v=0" })).toEqual({ kind: "offer", sdp: "v=0" });
    expect(parseSignal({ kind: "answer", sdp: "v=0" })).toEqual({ kind: "answer", sdp: "v=0" });
  });
  it("parses ice with candidate", () => {
    expect(parseSignal({ kind: "ice", candidate: "candidate:1" })).toEqual({ kind: "ice", candidate: "candidate:1" });
  });
  it("parses video announcements", () => {
    expect(parseSignal({ kind: "video", mode: "screen" })).toEqual({ kind: "video", mode: "screen" });
    expect(parseSignal({ kind: "video", mode: "camera" })).toEqual({ kind: "video", mode: "camera" });
    expect(parseSignal({ kind: "video", mode: "none" })).toEqual({ kind: "video", mode: "none" });
  });
  it("rejects video announcements with a bad mode", () => {
    expect(parseSignal({ kind: "video" })).toBeNull();
    expect(parseSignal({ kind: "video", mode: "webcam" })).toBeNull();
    expect(parseSignal({ kind: "video", mode: 1 })).toBeNull();
  });
  it("rejects malformed / unknown", () => {
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal("nope")).toBeNull();
    expect(parseSignal({ kind: "offer" })).toBeNull(); // missing sdp
    expect(parseSignal({ kind: "ice" })).toBeNull(); // missing candidate
    expect(parseSignal({ kind: "bogus" })).toBeNull();
  });
});
