import { describe, it, expect } from "vitest";
import {
  emptyMesh,
  meshReducer,
  isInitiator,
  peersToOffer,
  meshPeers,
  connectedCount,
  participantCount,
  isMeshActive,
  groupSignal,
  parseGroupSignal,
  isGroupSignal,
  type MeshState,
} from "./voiceMesh";

const SELF = 10;

function seeded(memberIds: number[]): MeshState {
  return meshReducer(emptyMesh(SELF), { type: "roster", memberIds });
}

describe("voiceMesh reducer", () => {
  it("starts empty and inactive", () => {
    const m = emptyMesh(SELF);
    expect(m.selfId).toBe(SELF);
    expect(meshPeers(m)).toEqual([]);
    expect(isMeshActive(m)).toBe(false);
    expect(participantCount(m)).toBe(0);
  });

  it("roster adds others as pending and drops self", () => {
    const m = seeded([SELF, 20, 30]);
    expect(meshPeers(m).map((p) => p.peerId)).toEqual([20, 30]);
    expect(meshPeers(m).every((p) => p.phase === "pending")).toBe(true);
    expect(participantCount(m)).toBe(3); // 2 peers + me
  });

  it("roster preserves phase of peers that remain", () => {
    let m = seeded([20, 30]);
    m = meshReducer(m, { type: "peerPhase", peerId: 20, phase: "connected" });
    m = meshReducer(m, { type: "roster", memberIds: [20, 40] });
    expect(m.peers[20].phase).toBe("connected"); // preserved
    expect(m.peers[40].phase).toBe("pending"); // new
    expect(m.peers[30]).toBeUndefined(); // dropped
  });

  it("peerJoin adds, is idempotent, and ignores self", () => {
    let m = emptyMesh(SELF);
    m = meshReducer(m, { type: "peerJoin", peerId: 20 });
    const after = meshReducer(m, { type: "peerJoin", peerId: 20 });
    expect(after).toBe(m); // idempotent: same ref
    const withSelf = meshReducer(m, { type: "peerJoin", peerId: SELF });
    expect(withSelf).toBe(m); // self ignored
  });

  it("peerLeave removes and is a no-op for unknown peers", () => {
    let m = seeded([20, 30]);
    m = meshReducer(m, { type: "peerLeave", peerId: 20 });
    expect(m.peers[20]).toBeUndefined();
    const same = meshReducer(m, { type: "peerLeave", peerId: 999 });
    expect(same).toBe(m);
  });

  it("peerPhase / peerMuted ignore unknown peers", () => {
    const m = seeded([20]);
    expect(meshReducer(m, { type: "peerPhase", peerId: 77, phase: "connected" })).toBe(m);
    expect(meshReducer(m, { type: "peerMuted", peerId: 77, muted: true })).toBe(m);
  });

  it("peerMuted tracks remote mute", () => {
    let m = seeded([20]);
    m = meshReducer(m, { type: "peerMuted", peerId: 20, muted: true });
    expect(m.peers[20].muted).toBe(true);
  });

  it("toggleMute flips my local mute", () => {
    let m = seeded([20]);
    expect(m.muted).toBe(false);
    m = meshReducer(m, { type: "toggleMute" });
    expect(m.muted).toBe(true);
  });

  it("reset clears the mesh but keeps selfId", () => {
    let m = seeded([20, 30]);
    m = meshReducer(m, { type: "reset" });
    expect(meshPeers(m)).toEqual([]);
    expect(m.selfId).toBe(SELF);
  });
});

describe("voiceMesh roles + selectors", () => {
  it("isInitiator: lower id offers", () => {
    expect(isInitiator(10, 20)).toBe(true);
    expect(isInitiator(20, 10)).toBe(false);
    expect(isInitiator(10, 10)).toBe(false);
  });

  it("peersToOffer lists only pending peers I should initiate, sorted", () => {
    // SELF=10 → initiates to 20,30 (higher), not to 5 (lower)
    let m = seeded([30, 20, 5]);
    expect(peersToOffer(m)).toEqual([20, 30]);
    // once 20 is connecting, it drops out of the offer list
    m = meshReducer(m, { type: "peerPhase", peerId: 20, phase: "connecting" });
    expect(peersToOffer(m)).toEqual([30]);
  });

  it("connectedCount counts only connected peers", () => {
    let m = seeded([20, 30, 40]);
    m = meshReducer(m, { type: "peerPhase", peerId: 20, phase: "connected" });
    m = meshReducer(m, { type: "peerPhase", peerId: 30, phase: "connected" });
    m = meshReducer(m, { type: "peerPhase", peerId: 40, phase: "failed" });
    expect(connectedCount(m)).toBe(2);
  });

  it("isMeshActive true once any peer present", () => {
    expect(isMeshActive(seeded([20]))).toBe(true);
    expect(isMeshActive(seeded([]))).toBe(false);
  });
});

describe("group signaling codec", () => {
  it("builds a tagged payload with extras", () => {
    expect(groupSignal(5, "offer", { sdp: "v=0" })).toEqual({ group: true, roomId: 5, kind: "offer", sdp: "v=0" });
    expect(groupSignal(5, "announce")).toEqual({ group: true, roomId: 5, kind: "announce" });
  });
  it("round-trips through parse", () => {
    const s = groupSignal(7, "ice", { candidate: "{}" });
    expect(parseGroupSignal(s)).toEqual(s);
  });
  it("rejects 1:1 voice payloads and junk", () => {
    expect(parseGroupSignal({ kind: "offer", sdp: "x" })).toBeNull(); // no group marker
    expect(parseGroupSignal({ group: true, kind: "offer" })).toBeNull(); // no roomId
    expect(parseGroupSignal({ group: true, roomId: 5, kind: "bogus" })).toBeNull();
    expect(parseGroupSignal(null)).toBeNull();
    expect(parseGroupSignal("nope")).toBeNull();
  });
  it("isGroupSignal mirrors parse", () => {
    expect(isGroupSignal(groupSignal(1, "leave"))).toBe(true);
    expect(isGroupSignal({ kind: "accept" })).toBe(false);
  });
  it("drops fields of the wrong type", () => {
    const out = parseGroupSignal({ group: true, roomId: 5, kind: "mute", muted: "yes" });
    expect(out).toEqual({ group: true, roomId: 5, kind: "mute" });
  });
});
