import { describe, it, expect } from "vitest";
import { callReducer, IDLE_CALL, isBusy, parseSignal, type CallState } from "./voice";

describe("callReducer — outbound call", () => {
  it("invite → inviting, remoteAccept → connecting, connected", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    expect(s).toEqual({ phase: "inviting", peerId: 7, muted: false });
    s = callReducer(s, { type: "remoteAccept" });
    expect(s.phase).toBe("connecting");
    s = callReducer(s, { type: "connected" });
    expect(s.phase).toBe("connected");
  });

  it("remote declines my invite → ended", () => {
    let s = callReducer(IDLE_CALL, { type: "invite", peerId: 7 });
    s = callReducer(s, { type: "remoteEnd" });
    expect(s).toEqual({ phase: "ended", peerId: 7, muted: false });
  });
});

describe("callReducer — inbound call", () => {
  it("incoming → ringing, accept → connecting", () => {
    let s = callReducer(IDLE_CALL, { type: "incoming", peerId: 3 });
    expect(s).toEqual({ phase: "ringing", peerId: 3, muted: false });
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
    const ended: CallState = { phase: "ended", peerId: 7, muted: false };
    expect(isBusy(ended)).toBe(false);
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
  it("rejects malformed / unknown", () => {
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal("nope")).toBeNull();
    expect(parseSignal({ kind: "offer" })).toBeNull(); // missing sdp
    expect(parseSignal({ kind: "ice" })).toBeNull(); // missing candidate
    expect(parseSignal({ kind: "bogus" })).toBeNull();
  });
});
