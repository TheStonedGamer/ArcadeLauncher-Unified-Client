// Voice-call status bar (ROADMAP T9g): a floating bar shown whenever a call is
// active. Ringing (incoming) offers Accept/Decline; otherwise it shows the call
// phase with Mute + Hang up. Presentation only; state + actions from useVoice.

import type { VoiceApi } from "../useVoice";

const PHASE_LABEL: Record<string, string> = {
  inviting: "Calling…",
  ringing: "Incoming call",
  connecting: "Connecting…",
  connected: "In call",
};

export function CallBar({ voice, peerName }: { voice: VoiceApi; peerName: string }) {
  const { call } = voice;
  if (call.phase === "idle" || call.phase === "ended") return null;

  return (
    <div className={`callbar callbar--${call.phase}`}>
      <span className="callbar__dot" />
      <span className="callbar__who">{peerName || `User ${call.peerId}`}</span>
      <span className="callbar__phase">{PHASE_LABEL[call.phase] ?? call.phase}</span>
      <div className="callbar__actions">
        {call.phase === "ringing" ? (
          <>
            <button className="callbar__accept" onClick={voice.acceptCall}>Accept</button>
            <button className="callbar__hangup" onClick={voice.hangup}>Decline</button>
          </>
        ) : (
          <>
            <button className="callbar__mute" onClick={voice.toggleMute}>
              {call.muted ? "🔇 Unmute" : "🎙 Mute"}
            </button>
            <button className="callbar__hangup" onClick={voice.hangup}>Hang up</button>
          </>
        )}
      </div>
    </div>
  );
}
