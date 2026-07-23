// Video stage for a 1:1 call (ROADMAP T12e). Renders only when at least one side
// is sending a picture: the peer's stream takes the big tile, my own outgoing
// picture sits in a small self-view corner (muted, so I never hear myself).
// The <video> elements are handed to useVoice, which owns the MediaStreams.

import type { VoiceApi } from "../useVoice";
import { hasVideo, primaryTile, remoteVideoLabel } from "../video";

export function CallStage({ voice, peerName }: { voice: VoiceApi; peerName: string }) {
  const { call } = voice;
  const who = peerName || `User ${call.peerId}`;
  // Elements stay mounted while a stream may exist so srcObject survives a
  // camera↔screen switch; the wrapper is what appears and disappears.
  if (!hasVideo(call.localVideo, call.remoteVideo)) return null;
  const remoteIsPrimary = primaryTile(call.localVideo, call.remoteVideo) === "remote";

  return (
    <div className="callstage">
      {remoteIsPrimary ? (
        <>
          <video className="callstage__main" ref={voice.attachRemoteVideo} autoPlay playsInline />
          <div className="callstage__label">{remoteVideoLabel(call.remoteVideo, who)}</div>
          {call.localVideo !== "none" && (
            <video className="callstage__self" ref={voice.attachLocalVideo} autoPlay playsInline muted />
          )}
        </>
      ) : (
        <>
          <video className="callstage__main" ref={voice.attachLocalVideo} autoPlay playsInline muted />
          <div className="callstage__label">
            {call.localVideo === "screen" ? "You're sharing your screen" : "Your camera"}
          </div>
        </>
      )}
    </div>
  );
}
