// Voice-call engine (ROADMAP T9g). Audio is peer-to-peer WebRTC; signaling
// (invite/accept/end + SDP offer/answer + trickled ICE) is relayed through the
// social gateway's voice_signal frames (useSocial.voiceSend / setVoiceHandler).
// The pure call FSM + signaling codec live in voice.ts (unit-tested); this hook
// is the browser-API glue (RTCPeerConnection, getUserMedia, remote <audio>),
// which can't run under jsdom, so it stays thin.
//
// NAT note: ICE servers are fetched per call from the server's /api/social/turn
// (STUN + short-lived TURN creds) via the injected `iceProvider`. If that fetch
// fails or no provider is given, we fall back to public STUN — symmetric-NAT
// peers then won't connect until TURN is configured server-side.

import { useCallback, useEffect, useReducer, useRef } from "react";
import { callReducer, IDLE_CALL, isBusy, parseSignal, type CallState, type SignalPayload } from "./voice";
import { canShareVideo, nextVideoMode, videoConstraints, type VideoMode } from "./video";

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface VoiceApi {
  call: CallState;
  /** Whether voice is usable (a live session with a working transport). */
  enabled: boolean;
  /** Start a call to a friend. */
  startCall: (peerId: number) => void;
  /** Accept the current incoming call. */
  acceptCall: () => void;
  /** End / decline / cancel the current call. */
  hangup: () => void;
  /** Toggle local mic mute. */
  toggleMute: () => void;
  /** Turn camera or screen share on/off (T12e). Pressing the live mode stops it. */
  toggleVideo: (mode: Exclude<VideoMode, "none">) => void;
  /** Attach the <video> element that should show my own outgoing picture. */
  attachLocalVideo: (el: HTMLVideoElement | null) => void;
  /** Attach the <video> element that should show the peer's picture. */
  attachRemoteVideo: (el: HTMLVideoElement | null) => void;
}

interface VoiceTransport {
  voiceSend: (to: number, payload: unknown) => void;
  setVoiceHandler: (cb: (fromId: number, payload: unknown) => void) => void;
  /** Fetch ICE servers (STUN + TURN) for a call; absent → STUN-only fallback. */
  iceProvider?: () => Promise<RTCIceServer[]>;
}

export function useVoice(enabled: boolean, transport: VoiceTransport): VoiceApi {
  const [call, dispatch] = useReducer(callReducer, IDLE_CALL);
  const callRef = useRef(call);
  callRef.current = call;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // ICE candidates that arrive before the remote description is set are queued.
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  // Cached ICE servers for the in-progress call (fresh creds per call).
  const iceRef = useRef<RTCIceServer[] | null>(null);
  // --- video (T12e) ---
  // The mic is added exactly once per connection; renegotiation offers must not
  // re-acquire it (that would prompt again and duplicate the audio track).
  const audioAddedRef = useRef(false);
  const videoStreamRef = useRef<MediaStream | null>(null);
  // One video sender for the life of the call: created on first share, then
  // reused via replaceTrack so camera↔screen switches need no new m-line.
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const remoteElRef = useRef<HTMLVideoElement | null>(null);

  /** Stop and release whatever the camera/screen picker handed us. */
  const dropLocalVideo = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    videoStreamRef.current = null;
    if (localElRef.current) localElRef.current.srcObject = null;
  }, []);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    iceRef.current = null; // next call refetches fresh TURN credentials
    audioAddedRef.current = false;
    dropLocalVideo();
    videoSenderRef.current = null; // owned by the closed pc
    remoteStreamRef.current = null;
    if (remoteElRef.current) remoteElRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, [dropLocalVideo]);

  /** Resolve ICE servers for this call: fetched once, then cached. Falls back to
   *  public STUN if no provider or the fetch fails. */
  const ensureIce = useCallback(async (): Promise<RTCIceServer[]> => {
    if (iceRef.current) return iceRef.current;
    let servers = DEFAULT_ICE;
    if (transport.iceProvider) {
      try {
        const fetched = await transport.iceProvider();
        if (fetched.length) servers = fetched;
      } catch {
        // keep STUN fallback
      }
    }
    iceRef.current = servers;
    return servers;
  }, [transport]);

  /** Build a peer connection wired to send ICE + surface remote audio. */
  const makePc = useCallback(
    async (peerId: number) => {
      const iceServers = await ensureIce();
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (e) => {
        if (e.candidate) transport.voiceSend(peerId, { kind: "ice", candidate: JSON.stringify(e.candidate) });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (e.track.kind === "video") {
          // Video shares the same stream as audio; keep it off the <audio>
          // element and route it to the attached <video> instead.
          remoteStreamRef.current = stream;
          if (remoteElRef.current) {
            remoteElRef.current.srcObject = stream;
            void remoteElRef.current.play().catch(() => {});
          }
          return;
        }
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.srcObject = stream;
        void audioRef.current.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") dispatch({ type: "connected" });
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          transport.voiceSend(peerId, { kind: "end" });
          dispatch({ type: "remoteEnd" });
          cleanup();
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [transport, cleanup, ensureIce],
  );

  /** Acquire the mic and add its track to the connection. Idempotent: adding
   *  video renegotiates, and that second offer must not re-prompt for the mic
   *  or attach a duplicate audio track. */
  const addLocalAudio = useCallback(async (pc: RTCPeerConnection) => {
    if (audioAddedRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localRef.current = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    audioAddedRef.current = true;
    // Honour a mute toggled before the mic existed.
    if (callRef.current.muted) stream.getAudioTracks().forEach((t) => (t.enabled = false));
  }, []);

  /** End a call that can't proceed (mic denied, negotiation error): tell the
   *  peer, drop to ended, and release any media we grabbed. */
  const failCall = useCallback(
    (peerId: number) => {
      transport.voiceSend(peerId, { kind: "end" });
      dispatch({ type: "hangup" });
      cleanup();
    },
    [transport, cleanup],
  );

  const startCall = useCallback(
    (peerId: number) => {
      if (!enabled || isBusy(callRef.current) || !peerId) return;
      dispatch({ type: "invite", peerId });
      transport.voiceSend(peerId, { kind: "invite" });
    },
    [enabled, transport],
  );

  const acceptCall = useCallback(() => {
    const c = callRef.current;
    if (c.phase !== "ringing") return;
    dispatch({ type: "accept" });
    transport.voiceSend(c.peerId, { kind: "accept" });
    // The caller now sends an offer; we set up our pc + mic on offer arrival.
  }, [transport]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c.peerId) transport.voiceSend(c.peerId, { kind: "end" });
    dispatch({ type: "hangup" });
    cleanup();
  }, [transport, cleanup]);

  /** Re-offer after the track set changed. Waits for a stable signaling state so
   *  a renegotiation can't collide with the initial offer/answer still in
   *  flight; gives up rather than throwing if it never settles. */
  const renegotiate = useCallback(
    async (pc: RTCPeerConnection, peerId: number) => {
      for (let i = 0; i < 15 && pc.signalingState !== "stable"; i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (pc.signalingState !== "stable" || pcRef.current !== pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      transport.voiceSend(peerId, { kind: "offer", sdp: offer.sdp ?? "" });
    },
    [transport],
  );

  /** Switch the outgoing video track to `mode` ("none" stops sharing), announce
   *  it to the peer, and renegotiate. A cancelled picker leaves the call
   *  untouched — that's a decision, not a failure. */
  const setVideoMode = useCallback(
    async (mode: VideoMode) => {
      const c = callRef.current;
      const pc = pcRef.current;
      if (!pc || !canShareVideo(c.phase) || c.localVideo === mode) return;

      dropLocalVideo();
      let track: MediaStreamTrack | null = null;
      if (mode !== "none") {
        let stream: MediaStream;
        try {
          stream =
            mode === "screen"
              ? await navigator.mediaDevices.getDisplayMedia(videoConstraints("screen"))
              : await navigator.mediaDevices.getUserMedia(videoConstraints("camera"));
        } catch {
          // Picker dismissed or no device — fall back to whatever we had, which
          // dropLocalVideo already stopped, so report "none" to stay truthful.
          if (c.localVideo !== "none") await setVideoMode("none");
          return;
        }
        track = stream.getVideoTracks()[0] ?? null;
        if (!track) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoStreamRef.current = stream;
        // The browser's own "Stop sharing" bar ends the track behind our back.
        track.onended = () => void setVideoMode("none");
        if (localElRef.current) {
          localElRef.current.srcObject = stream;
          void localElRef.current.play().catch(() => {});
        }
      }

      if (videoSenderRef.current) {
        await videoSenderRef.current.replaceTrack(track);
      } else if (track) {
        videoSenderRef.current = pc.addTrack(track, videoStreamRef.current!);
      }
      dispatch({ type: "localVideo", mode });
      transport.voiceSend(c.peerId, { kind: "video", mode });
      await renegotiate(pc, c.peerId);
    },
    [transport, dropLocalVideo, renegotiate],
  );

  const toggleVideo = useCallback(
    (mode: Exclude<VideoMode, "none">) => {
      void setVideoMode(nextVideoMode(callRef.current.localVideo, mode));
    },
    [setVideoMode],
  );

  const attachLocalVideo = useCallback((el: HTMLVideoElement | null) => {
    localElRef.current = el;
    if (el && videoStreamRef.current) {
      el.srcObject = videoStreamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const attachRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteElRef.current = el;
    if (el && remoteStreamRef.current) {
      el.srcObject = remoteStreamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !callRef.current.muted;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    dispatch({ type: "toggleMute" });
  }, []);

  // Inbound signaling handler. Registered once; reads live state via refs.
  useEffect(() => {
    const handle = (fromId: number, raw: unknown) => {
      const sig = parseSignal(raw);
      if (!sig) return;
      const c = callRef.current;
      void onSignal(fromId, sig, c);
    };

    const onSignal = async (fromId: number, sig: SignalPayload, c: CallState) => {
      switch (sig.kind) {
        case "invite":
          if (!isBusy(c)) dispatch({ type: "incoming", peerId: fromId });
          else transport.voiceSend(fromId, { kind: "end" }); // busy → auto-decline
          return;
        case "accept": {
          // Remote accepted my invite → I'm the caller: make offer.
          if (c.phase !== "inviting" || fromId !== c.peerId) return;
          dispatch({ type: "remoteAccept" });
          const pc = await makePc(fromId);
          try {
            await addLocalAudio(pc);
          } catch {
            failCall(fromId); // mic unavailable/denied → end cleanly
            return;
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          transport.voiceSend(fromId, { kind: "offer", sdp: offer.sdp ?? "" });
          return;
        }
        case "offer": {
          // I'm the callee (already accepted) → answer. Also the renegotiation
          // path when the peer adds/removes video.
          if (fromId !== c.peerId) return;
          const pc = pcRef.current ?? (await makePc(fromId));
          // Glare: both peers re-offered at once. Ours is already in flight, so
          // drop theirs — their announce still landed, and the picture arrives
          // on our own renegotiation.
          if (pc.signalingState === "have-local-offer") return;
          try {
            await addLocalAudio(pc);
          } catch {
            failCall(fromId); // mic unavailable/denied → end cleanly
            return;
          }
          await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp });
          await flushIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          transport.voiceSend(fromId, { kind: "answer", sdp: answer.sdp ?? "" });
          return;
        }
        case "answer": {
          const pc = pcRef.current;
          if (!pc || fromId !== c.peerId) return;
          await pc.setRemoteDescription({ type: "answer", sdp: sig.sdp });
          await flushIce(pc);
          return;
        }
        case "ice": {
          const pc = pcRef.current;
          let cand: RTCIceCandidateInit;
          try {
            cand = JSON.parse(sig.candidate);
          } catch {
            return;
          }
          if (pc && pc.remoteDescription) await pc.addIceCandidate(cand).catch(() => {});
          else pendingIce.current.push(cand);
          return;
        }
        case "video":
          // Announcement only — the track itself arrives via renegotiation.
          if (fromId === c.peerId) {
            dispatch({ type: "remoteVideo", mode: sig.mode });
            // On a re-share the transceiver is reused, so ontrack won't fire
            // again — re-point the element at the stream we already hold.
            if (sig.mode !== "none" && remoteElRef.current && remoteStreamRef.current) {
              remoteElRef.current.srcObject = remoteStreamRef.current;
              void remoteElRef.current.play().catch(() => {});
            }
          }
          return;
        case "end":
          if (fromId === c.peerId) {
            dispatch({ type: "remoteEnd" });
            cleanup();
          }
          return;
      }
    };

    const flushIce = async (pc: RTCPeerConnection) => {
      const queued = pendingIce.current;
      pendingIce.current = [];
      for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
    };

    transport.setVoiceHandler(handle);
    return () => transport.setVoiceHandler(() => {});
  }, [transport, makePc, addLocalAudio, cleanup, failCall]);

  // Tear down media when a call leaves the active phases.
  useEffect(() => {
    if (call.phase === "ended" || call.phase === "idle") cleanup();
  }, [call.phase, cleanup]);

  // Auto-end calls that never reach "connected": an unanswered invite/ring
  // shouldn't ring forever, and stalled media negotiation shouldn't hang. Once
  // connected, the connectionstatechange handler owns teardown.
  useEffect(() => {
    const p = call.phase;
    if (p !== "inviting" && p !== "ringing" && p !== "connecting") return;
    const ms = p === "connecting" ? 20_000 : 45_000;
    const timer = setTimeout(() => {
      const c = callRef.current;
      if (c.peerId) transport.voiceSend(c.peerId, { kind: "end" });
      dispatch({ type: "hangup" });
      cleanup();
    }, ms);
    return () => clearTimeout(timer);
  }, [call.phase, transport, cleanup]);

  return {
    call,
    enabled,
    startCall,
    acceptCall,
    hangup,
    toggleMute,
    toggleVideo,
    attachLocalVideo,
    attachRemoteVideo,
  };
}
