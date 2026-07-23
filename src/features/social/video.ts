// Pure video/screen-share core (ROADMAP T12e). Video rides the SAME peer
// connection and the same `voice_signal` relay as audio — this is a second track
// on an existing call, not a second subsystem. Everything here is IO-free and
// deterministic; the getUserMedia/getDisplayMedia + renegotiation glue lives in
// useVoice.
//
// Wire contract: a peer announces its own video state with a `{kind:"video"}`
// signal, then renegotiates (offer/answer) to actually move the track. The
// announcement is separate from the SDP because a peer that STOPS sharing
// removes the track, and "track ended" alone doesn't tell the other side whether
// the stop was deliberate or a failure.

/** What the local peer is currently sending on the video track. */
export type VideoMode = "none" | "camera" | "screen";

export const VIDEO_MODES: readonly VideoMode[] = ["none", "camera", "screen"];

/** Narrow an arbitrary value to a VideoMode, or null when unrecognized. This
 *  crosses the network, so it is validated rather than cast. */
export function parseVideoMode(value: unknown): VideoMode | null {
  return typeof value === "string" && (VIDEO_MODES as readonly string[]).includes(value)
    ? (value as VideoMode)
    : null;
}

/** Toggle semantics for the UI buttons: pressing the mode you're already
 *  sending turns it OFF; pressing the other mode switches straight to it
 *  (no stop-then-start round trip). */
export function nextVideoMode(current: VideoMode, pressed: Exclude<VideoMode, "none">): VideoMode {
  return current === pressed ? "none" : pressed;
}

/** Whether video controls should be offered at all. Video is only meaningful
 *  once there is a peer connection to renegotiate, so it is gated on the two
 *  phases that own one. */
export function canShareVideo(phase: string): boolean {
  return phase === "connecting" || phase === "connected";
}

/** Media constraints for a mode. Screen share deliberately requests audio:false
 *  — the call already carries mic audio, and mixing in system audio would
 *  double up the speaker's own voice. */
export function videoConstraints(mode: Exclude<VideoMode, "none">): MediaStreamConstraints {
  return mode === "camera"
    ? { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
    : { video: { frameRate: { ideal: 30, max: 60 } }, audio: false };
}

/** Button label for a mode, given what's currently being sent. */
export function videoButtonLabel(current: VideoMode, button: Exclude<VideoMode, "none">): string {
  const on = current === button;
  if (button === "camera") return on ? "📷 Stop camera" : "📷 Camera";
  return on ? "🖥 Stop sharing" : "🖥 Share screen";
}

/** Human label for what the remote peer is sending; null when there's nothing
 *  to show, so the caller can skip rendering the stage entirely. */
export function remoteVideoLabel(mode: VideoMode, peerName: string): string | null {
  const who = peerName || "Peer";
  if (mode === "camera") return `${who}'s camera`;
  if (mode === "screen") return `${who}'s screen`;
  return null;
}

/** Whether a video stage should be rendered at all: either side sending
 *  anything means there's a picture worth showing. */
export function hasVideo(local: VideoMode, remote: VideoMode): boolean {
  return local !== "none" || remote !== "none";
}

/** Which stream should occupy the large tile. A remote share is what you joined
 *  to look at, so it always wins; otherwise the local preview takes the stage
 *  when it's the only picture. Returns null when there is nothing to show. */
export function primaryTile(local: VideoMode, remote: VideoMode): "local" | "remote" | null {
  if (remote !== "none") return "remote";
  if (local !== "none") return "local";
  return null;
}
