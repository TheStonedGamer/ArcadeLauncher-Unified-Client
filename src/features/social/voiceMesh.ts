// Pure group-voice mesh core (ROADMAP T12g). 1:1 voice (voice.ts) is a single
// RTCPeerConnection; a group call of 3+ is a full mesh — every participant holds
// one peer connection to every *other* participant. This module is the IO-free
// heart: it tracks the set of mesh peers and each per-peer connection phase, and
// makes the deterministic decisions a mesh needs that a 1:1 call doesn't:
//
//   * who initiates the offer for a given peer pair (must be exactly one side,
//     agreed without coordination → derived from the two account ids), and
//   * which peers we still need to open / can tear down as the roster changes.
//
// The RTCPeerConnection-per-peer engine and the getUserMedia/track plumbing live
// in a useGroupVoice hook (glue); the wire frames reuse the existing per-peer
// `voice_signal` relay (protocol.ts) addressed to each mesh member. Everything
// here is deterministic → unit-tested in voiceMesh.test.ts.

/** Per-peer connection lifecycle within the mesh. `pending` = roster says this
 *  peer is here but no RTCPeerConnection exists yet; `connecting` = negotiating
 *  media; `connected` = audio up; `failed` = the pc errored (retryable). */
export type MeshPeerPhase = "pending" | "connecting" | "connected" | "failed";

export interface MeshPeer {
  peerId: number;
  phase: MeshPeerPhase;
  /** Whether this remote peer is muted (as last signaled by them). */
  muted: boolean;
}

export interface MeshState {
  /** My own account id — fixed for the lifetime of the mesh; used to derive the
   *  offer-initiator role and to reject a self-entry in the roster. */
  selfId: number;
  /** Per-peer map keyed by peerId. Excludes selfId. */
  peers: Record<number, MeshPeer>;
  /** Whether my own mic is muted locally. */
  muted: boolean;
}

/** A fresh, empty mesh for the given local account. */
export function emptyMesh(selfId: number): MeshState {
  return { selfId, peers: {}, muted: false };
}

/** Events driving the mesh. Roster events come from the room/group membership;
 *  per-peer phase + mute events come from the RTCPeerConnection engine and the
 *  relayed signaling. */
export type MeshEvent =
  // The authoritative roster of *other* members (selfId is dropped if present).
  | { type: "roster"; memberIds: number[] }
  | { type: "peerJoin"; peerId: number }
  | { type: "peerLeave"; peerId: number }
  | { type: "peerPhase"; peerId: number; phase: MeshPeerPhase }
  | { type: "peerMuted"; peerId: number; muted: boolean }
  | { type: "toggleMute" }
  | { type: "reset" };

function withPeer(state: MeshState, peer: MeshPeer): MeshState {
  return { ...state, peers: { ...state.peers, [peer.peerId]: peer } };
}

function withoutPeer(state: MeshState, peerId: number): MeshState {
  if (!(peerId in state.peers)) return state;
  const peers = { ...state.peers };
  delete peers[peerId];
  return { ...state, peers };
}

/** Pure mesh transition. A `roster` snapshot is authoritative: it adds missing
 *  peers as `pending` and drops peers no longer present, but preserves the phase
 *  of peers that remain (so an in-flight connection isn't reset by a roster
 *  refresh). Per-peer events for an unknown peer are ignored (out-of-order
 *  signaling can't conjure a peer the roster hasn't introduced). */
export function meshReducer(state: MeshState, event: MeshEvent): MeshState {
  switch (event.type) {
    case "roster": {
      const wanted = event.memberIds.filter((id) => id !== state.selfId);
      const next: Record<number, MeshPeer> = {};
      for (const id of wanted) {
        next[id] = state.peers[id] ?? { peerId: id, phase: "pending", muted: false };
      }
      return { ...state, peers: next };
    }
    case "peerJoin": {
      if (event.peerId === state.selfId || event.peerId in state.peers) return state;
      return withPeer(state, { peerId: event.peerId, phase: "pending", muted: false });
    }
    case "peerLeave":
      return withoutPeer(state, event.peerId);
    case "peerPhase": {
      const existing = state.peers[event.peerId];
      if (!existing) return state;
      return withPeer(state, { ...existing, phase: event.phase });
    }
    case "peerMuted": {
      const existing = state.peers[event.peerId];
      if (!existing) return state;
      return withPeer(state, { ...existing, muted: event.muted });
    }
    case "toggleMute":
      return { ...state, muted: !state.muted };
    case "reset":
      return emptyMesh(state.selfId);
    default:
      return state;
  }
}

// --- Role + selector helpers ----------------------------------------------

/** Deterministic offer-initiator rule for a peer pair: the *lower* account id
 *  initiates (sends the offer); the higher answers. Both sides compute the same
 *  answer from the same two ids with no coordination, so exactly one offer is
 *  ever made per pair — the mesh equivalent of perfect-negotiation roles. */
export function isInitiator(selfId: number, peerId: number): boolean {
  return selfId < peerId;
}

/** Peers for which *I* should create and send the offer (I'm the initiator and
 *  the connection hasn't been opened yet). Sorted for stable iteration. */
export function peersToOffer(state: MeshState): number[] {
  return Object.values(state.peers)
    .filter((p) => p.phase === "pending" && isInitiator(state.selfId, p.peerId))
    .map((p) => p.peerId)
    .sort((a, b) => a - b);
}

/** All current mesh peers, sorted by id. */
export function meshPeers(state: MeshState): MeshPeer[] {
  return Object.values(state.peers).sort((a, b) => a.peerId - b.peerId);
}

/** Count of peers whose audio is actually up. */
export function connectedCount(state: MeshState): number {
  return Object.values(state.peers).filter((p) => p.phase === "connected").length;
}

/** Total members in the call including me (0 when the mesh is empty — no call). */
export function participantCount(state: MeshState): number {
  const n = Object.keys(state.peers).length;
  return n === 0 ? 0 : n + 1;
}

/** A group call is "active" once there's at least one other member. */
export function isMeshActive(state: MeshState): boolean {
  return Object.keys(state.peers).length > 0;
}
