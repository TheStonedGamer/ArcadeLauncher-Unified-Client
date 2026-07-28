// Voice-call status bar (ROADMAP T9g): a floating bar shown whenever a call is
// active. Ringing (incoming) offers Accept/Decline; otherwise it shows the call
// phase with Mute + Hang up. Once connected it also offers Camera / Share screen
// (T12e) and floats the video stage above itself. Presentation only; state +
// actions from useVoice.

import type { VoiceApi } from "../useVoice";
import { CallStage } from "./CallStage";
import { canShareVideo, videoButtonLabel } from "../video";
import { CALL_END_LABEL, isCallFailure } from "../voice";

const PHASE_LABEL: Record<string, string> = {
  inviting: "Calling…",
  ringing: "Incoming call",
  connecting: "Connecting…",
  connected: "In call",
};

export function CallBar({ voice, peerName }: { voice: VoiceApi; peerName: string }) {
  const { call } = voice;
  // A call that failed says why for a few seconds. Silently disappearing is
  // what made an unanswered call look like a broken button.
  if (call.phase === "ended") {
    if (!isCallFailure(call.endReason)) return null;
    return (
      <div className="callbar callbar--failed">
        <span className="callbar__dot" />
        <span className="callbar__who">{peerName || `User ${call.peerId}`}</span>
        <span className="callbar__phase">{CALL_END_LABEL[call.endReason]}</span>
        <div className="callbar__actions">
          <button className="callbar__mute" onClick={voice.dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  if (call.phase === "idle") return null;

  const video = canShareVideo(call.phase);

  return (
    <>
      <CallStage voice={voice} peerName={peerName} />
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
            {video && (
              <>
                <button
                  className={`callbar__video${call.localVideo === "camera" ? " is-on" : ""}`}
                  onClick={() => voice.toggleVideo("camera")}
                >
                  {videoButtonLabel(call.localVideo, "camera")}
                </button>
                <button
                  className={`callbar__video${call.localVideo === "screen" ? " is-on" : ""}`}
                  onClick={() => voice.toggleVideo("screen")}
                >
                  {videoButtonLabel(call.localVideo, "screen")}
                </button>
              </>
            )}
            <button className="callbar__hangup" onClick={voice.hangup}>Hang up</button>
          </>
        )}
      </div>
      </div>
    </>
  );
}
