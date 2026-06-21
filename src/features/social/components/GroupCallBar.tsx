// In-call roster bar for a group room call (T12g). Shows each peer's connection
// phase + mute state, plus my mute/leave controls. Pure presentation over
// useGroupVoice's mesh state (the per-peer RTCPeerConnection lifecycle lives in
// the hook; the mesh reducer is unit-tested).

import { meshPeers, type MeshPeerPhase } from "../voiceMesh";
import type { GroupVoiceApi } from "../useGroupVoice";
import type { Friend } from "../types";

const PHASE_DOT: Record<MeshPeerPhase, string> = {
  pending: "○",
  connecting: "◔",
  connected: "●",
  failed: "✕",
};

interface Props {
  group: GroupVoiceApi;
  selfId: number;
  friends: Friend[];
}

export function GroupCallBar({ group, selfId, friends }: Props) {
  if (!group.inCall) return null;

  const nameOf = (id: number): string => {
    if (id === selfId) return "You";
    const f = friends.find((x) => x.accountId === id);
    return f ? f.nickname || f.username : `User ${id}`;
  };

  return (
    <div className="groupcall">
      <div className="groupcall__head">
        <span className="groupcall__title">
          Group call · {group.connected + 1}/{group.participants} connected
        </span>
        <div className="groupcall__controls">
          <button className="groupcall__btn" onClick={group.toggleMute}>
            {group.mesh.muted ? "🔇 Unmute" : "🎙 Mute"}
          </button>
          <button className="groupcall__btn groupcall__btn--leave" onClick={group.leaveCall}>
            Leave call
          </button>
        </div>
      </div>
      <div className="groupcall__roster">
        {meshPeers(group.mesh).map((p) => (
          <span key={p.peerId} className={`groupcall__peer groupcall__peer--${p.phase}`}>
            <span className="groupcall__peer-dot">{PHASE_DOT[p.phase]}</span>
            {nameOf(p.peerId)}
            {p.muted && <span className="groupcall__peer-muted">🔇</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
