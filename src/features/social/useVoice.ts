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

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    iceRef.current = null; // next call refetches fresh TURN credentials
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

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
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.autoplay = true;
        }
        audioRef.current.srcObject = e.streams[0];
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

  /** Acquire the mic and add its track to the connection. */
  const addLocalAudio = useCallback(async (pc: RTCPeerConnection) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localRef.current = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
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
          // I'm the callee (already accepted) → answer.
          if (fromId !== c.peerId) return;
          const pc = pcRef.current ?? (await makePc(fromId));
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

  return { call, enabled, startCall, acceptCall, hangup, toggleMute };
}
