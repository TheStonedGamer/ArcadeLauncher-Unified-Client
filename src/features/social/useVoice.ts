// Voice-call engine (ROADMAP T9g). Audio is peer-to-peer WebRTC; signaling
// (invite/accept/end + SDP offer/answer + trickled ICE) is relayed through the
// social gateway's voice_signal frames (useSocial.voiceSend / setVoiceHandler).
// The pure call FSM + signaling codec live in voice.ts (unit-tested); this hook
// is the browser-API glue (RTCPeerConnection, getUserMedia, remote <audio>),
// which can't run under jsdom, so it stays thin.
//
// NAT note: ICE uses public STUN only for now. Symmetric-NAT peers will need a
// TURN server — that's the pending nginx/infra step; add its creds to ICE_SERVERS
// when available.

import { useCallback, useEffect, useReducer, useRef } from "react";
import { callReducer, IDLE_CALL, isBusy, parseSignal, type CallState, type SignalPayload } from "./voice";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

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

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  /** Build a peer connection wired to send ICE + surface remote audio. */
  const makePc = useCallback(
    (peerId: number) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
    [transport, cleanup],
  );

  /** Acquire the mic and add its track to the connection. */
  const addLocalAudio = useCallback(async (pc: RTCPeerConnection) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localRef.current = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }, []);

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
          const pc = makePc(fromId);
          await addLocalAudio(pc);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          transport.voiceSend(fromId, { kind: "offer", sdp: offer.sdp ?? "" });
          return;
        }
        case "offer": {
          // I'm the callee (already accepted) → answer.
          if (fromId !== c.peerId) return;
          const pc = pcRef.current ?? makePc(fromId);
          await addLocalAudio(pc);
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
  }, [transport, makePc, addLocalAudio, cleanup]);

  // Tear down media when a call leaves the active phases.
  useEffect(() => {
    if (call.phase === "ended" || call.phase === "idle") cleanup();
  }, [call.phase, cleanup]);

  return { call, enabled, startCall, acceptCall, hangup, toggleMute };
}
