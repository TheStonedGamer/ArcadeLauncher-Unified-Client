// Group-voice engine (ROADMAP T12g). A room call of 3+ is a full mesh: one
// RTCPeerConnection per *other* participant. The pure mesh state + offer-role
// rule + signaling codec live in voiceMesh.ts (unit-tested); this hook is the
// browser-API glue (RTCPeerConnection/getUserMedia/<audio> per peer), which
// can't run under jsdom, so it stays thin — the 1:1 useVoice analogue.
//
// Signaling reuses the per-peer voice_signal relay, with payloads tagged
// `group: true` (+ roomId) so they route to setGroupVoiceHandler, never the 1:1
// handler. Offer roles: for any pair the lower account id offers (isInitiator),
// so each pair negotiates exactly once with no central coordination. A joiner
// offers to higher-id members directly and `announce`s itself so lower-id
// members offer back.

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  emptyMesh,
  meshReducer,
  isInitiator,
  groupSignal,
  parseGroupSignal,
  participantCount,
  connectedCount,
  type MeshState,
  type GroupSignalKind,
} from "./voiceMesh";

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface GroupVoiceApi {
  mesh: MeshState;
  /** The room id of the active call, or null. */
  activeRoom: number | null;
  /** Whether a group call is in progress. */
  inCall: boolean;
  /** Total participants including me (0 when idle). */
  participants: number;
  /** Peers whose audio is actually up. */
  connected: number;
  /** Start/join the call for `roomId` with the room's member ids (self filtered). */
  joinCall: (roomId: number, memberIds: number[]) => void;
  /** Leave the active call (tears down every peer connection). */
  leaveCall: () => void;
  /** Toggle my mic; broadcasts the new state to peers. */
  toggleMute: () => void;
}

interface GroupTransport {
  voiceSend: (to: number, payload: unknown) => void;
  setGroupVoiceHandler: (cb: (fromId: number, payload: unknown) => void) => void;
  iceProvider?: () => Promise<RTCIceServer[]>;
}

export function useGroupVoice(selfId: number, enabled: boolean, transport: GroupTransport): GroupVoiceApi {
  const [mesh, dispatch] = useReducer(meshReducer, emptyMesh(selfId));
  const meshRef = useRef(mesh);
  meshRef.current = mesh;

  const activeRoomRef = useRef<number | null>(null);
  const pcsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const audiosRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const pendingIceRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());
  const localRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[] | null>(null);

  // selfId is fixed for a session, but if it changes (sign-out/in) reset.
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [selfId]);

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

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    if (localRef.current) return localRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localRef.current = stream;
    return stream;
  }, []);

  const sendTo = useCallback(
    (peerId: number, kind: GroupSignalKind, extra?: { sdp?: string; candidate?: string; muted?: boolean }) => {
      const roomId = activeRoomRef.current;
      if (roomId == null) return;
      transport.voiceSend(peerId, groupSignal(roomId, kind, extra));
    },
    [transport],
  );

  const closePeer = useCallback((peerId: number) => {
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    const audio = audiosRef.current.get(peerId);
    if (audio) audio.srcObject = null;
    audiosRef.current.delete(peerId);
  }, []);

  const makePeer = useCallback(
    async (peerId: number): Promise<RTCPeerConnection> => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;
      const iceServers = await ensureIce();
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (e) => {
        if (e.candidate) sendTo(peerId, "ice", { candidate: JSON.stringify(e.candidate) });
      };
      pc.ontrack = (e) => {
        let audio = audiosRef.current.get(peerId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audiosRef.current.set(peerId, audio);
        }
        audio.srcObject = e.streams[0];
        void audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") dispatch({ type: "peerPhase", peerId, phase: "connected" });
        if (pc.connectionState === "failed") dispatch({ type: "peerPhase", peerId, phase: "failed" });
      };
      const mic = await ensureMic();
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
      pcsRef.current.set(peerId, pc);
      return pc;
    },
    [ensureIce, ensureMic, sendTo],
  );

  const flushIce = useCallback(async (peerId: number, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.set(peerId, []);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
  }, []);

  const offerTo = useCallback(
    async (peerId: number) => {
      dispatch({ type: "peerPhase", peerId, phase: "connecting" });
      try {
        const pc = await makePeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendTo(peerId, "offer", { sdp: offer.sdp ?? "" });
      } catch {
        dispatch({ type: "peerPhase", peerId, phase: "failed" });
      }
    },
    [makePeer, sendTo],
  );

  const teardown = useCallback(() => {
    for (const peerId of [...pcsRef.current.keys()]) closePeer(peerId);
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    iceRef.current = null;
    activeRoomRef.current = null;
    dispatch({ type: "reset" });
  }, [closePeer]);

  const joinCall = useCallback(
    (roomId: number, memberIds: number[]) => {
      if (!enabled || activeRoomRef.current != null) return;
      const others = memberIds.filter((id) => id !== selfId);
      activeRoomRef.current = roomId;
      dispatch({ type: "roster", memberIds: others });
      void (async () => {
        try {
          await ensureMic();
        } catch {
          teardown(); // mic denied → abort the call cleanly
          return;
        }
        for (const peerId of others) {
          // Announce to everyone so lower-id members offer back; directly offer
          // to members for whom I'm the initiator (their id is higher).
          sendTo(peerId, "announce");
          if (isInitiator(selfId, peerId)) void offerTo(peerId);
        }
      })();
    },
    [enabled, selfId, ensureMic, sendTo, offerTo, teardown],
  );

  const leaveCall = useCallback(() => {
    if (activeRoomRef.current == null) return;
    for (const peerId of [...pcsRef.current.keys()]) sendTo(peerId, "leave");
    teardown();
  }, [sendTo, teardown]);

  const toggleMute = useCallback(() => {
    const next = !meshRef.current.muted;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    dispatch({ type: "toggleMute" });
    for (const peerId of [...pcsRef.current.keys()]) sendTo(peerId, "mute", { muted: next });
  }, [sendTo]);

  // Inbound group signaling. Registered once; reads live state via refs.
  useEffect(() => {
    const handle = (fromId: number, raw: unknown) => {
      const sig = parseGroupSignal(raw);
      if (!sig || sig.roomId !== activeRoomRef.current) return;
      void onSignal(fromId, sig);
    };

    const onSignal = async (fromId: number, sig: NonNullable<ReturnType<typeof parseGroupSignal>>) => {
      switch (sig.kind) {
        case "announce": {
          dispatch({ type: "peerJoin", peerId: fromId });
          // The lower id offers; if that's me, open the connection now.
          if (isInitiator(selfId, fromId)) void offerTo(fromId);
          return;
        }
        case "offer": {
          dispatch({ type: "peerJoin", peerId: fromId });
          dispatch({ type: "peerPhase", peerId: fromId, phase: "connecting" });
          try {
            const pc = await makePeer(fromId);
            await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp ?? "" });
            await flushIce(fromId, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendTo(fromId, "answer", { sdp: answer.sdp ?? "" });
          } catch {
            dispatch({ type: "peerPhase", peerId: fromId, phase: "failed" });
          }
          return;
        }
        case "answer": {
          const pc = pcsRef.current.get(fromId);
          if (!pc) return;
          await pc.setRemoteDescription({ type: "answer", sdp: sig.sdp ?? "" }).catch(() => {});
          await flushIce(fromId, pc);
          return;
        }
        case "ice": {
          let cand: RTCIceCandidateInit;
          try {
            cand = JSON.parse(sig.candidate ?? "");
          } catch {
            return;
          }
          const pc = pcsRef.current.get(fromId);
          if (pc && pc.remoteDescription) await pc.addIceCandidate(cand).catch(() => {});
          else {
            const q = pendingIceRef.current.get(fromId) ?? [];
            q.push(cand);
            pendingIceRef.current.set(fromId, q);
          }
          return;
        }
        case "mute":
          dispatch({ type: "peerMuted", peerId: fromId, muted: sig.muted === true });
          return;
        case "leave":
          closePeer(fromId);
          dispatch({ type: "peerLeave", peerId: fromId });
          return;
      }
    };

    transport.setGroupVoiceHandler(handle);
    return () => transport.setGroupVoiceHandler(() => {});
  }, [transport, selfId, makePeer, offerTo, flushIce, sendTo, closePeer]);

  // Tear down any live call when the hook unmounts / voice is disabled.
  useEffect(() => {
    if (!enabled && activeRoomRef.current != null) teardown();
  }, [enabled, teardown]);
  useEffect(() => () => teardown(), [teardown]);

  return {
    mesh,
    activeRoom: activeRoomRef.current,
    inCall: activeRoomRef.current != null,
    participants: participantCount(mesh),
    connected: connectedCount(mesh),
    joinCall,
    leaveCall,
    toggleMute,
  };
}
