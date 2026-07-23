// The peer connection, and nothing else. Every decision worth testing — which
// phase follows which event, what a relayed payload is allowed to look like —
// is in core/call.ts and covered by KATs on both CI legs. This file only wires
// react-native-webrtc to that machine and to the gateway socket.
//
// Roles: whoever pressed Call is the offerer. The callee answers. Deciding this
// from who invited (rather than from, say, the lower user id) means both ends
// agree without a negotiation about how to negotiate.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";

import {
  callReducer,
  eventForSignal,
  IDLE_CALL,
  isBusy,
  parseSignal,
  type CallState,
  type SignalPayload,
  type VideoMode,
} from "./core/call";
import type { Frame } from "./core/social";
import { outbound } from "./core/social";

/** Google's public STUN. Enough for two peers behind ordinary home NATs, which
 *  is the case this feature exists for: the owner's phone and the owner's PC.
 *  Symmetric-NAT pairs would need a TURN server, which is a running cost the
 *  owner has not asked for. */
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export interface Call {
  state: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Non-empty when the call failed for a reason worth showing. */
  error: string;
  start: (peerId: number) => void;
  accept: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
}

export function useCall(
  send: (frame: string) => boolean,
  setFrameHandler: (handler: ((frame: Frame) => void) | null) => void,
): Call {
  const [state, dispatch] = useReducer(callReducer, IDLE_CALL);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");

  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const peer = useRef(0);
  // Candidates can arrive before the remote description is set, and adding one
  // then throws. They are held here and flushed once there is somewhere to put
  // them; dropping them instead is a call that connects only sometimes.
  const pending = useRef<RTCIceCandidate[]>([]);
  const haveRemote = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const signal = useCallback((payload: SignalPayload) => {
    if (peer.current > 0) sendRef.current(outbound.voiceSignal(peer.current, payload));
  }, []);

  const teardown = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    pending.current = [];
    haveRemote.current = false;
    peer.current = 0;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  // Media is captured audio-only to begin with; the camera is added later by
  // renegotiating, so answering a call never lights up the camera unasked.
  const capture = useCallback(async (): Promise<MediaStream> => {
    if (local.current) return local.current;
    const stream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
    local.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const connection = useCallback(
    async (): Promise<RTCPeerConnection> => {
      if (pc.current) return pc.current;
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.current = conn;

      // react-native-webrtc types these handlers as bare Events, so each one is
      // narrowed here rather than trusted.
      conn.onicecandidate = ((event: { candidate?: unknown }) => {
        if (event.candidate) signal({ kind: "ice", candidate: JSON.stringify(event.candidate) });
      }) as typeof conn.onicecandidate;

      conn.ontrack = ((event: { streams?: MediaStream[] }) => {
        const stream = event.streams?.[0];
        if (stream) setRemoteStream(stream);
      }) as typeof conn.ontrack;

      conn.onconnectionstatechange = (() => {
        const s = conn.connectionState;
        if (s === "connected") dispatch({ type: "connected" });
        if (s === "failed") {
          setError("The call could not connect.");
          dispatch({ type: "hangup" });
        }
      }) as typeof conn.onconnectionstatechange;

      const stream = await capture();
      stream.getTracks().forEach((track) => conn.addTrack(track, stream));
      return conn;
    },
    [capture, signal],
  );

  const offer = useCallback(async () => {
    try {
      const conn = await connection();
      const description = await conn.createOffer({});
      await conn.setLocalDescription(description);
      signal({ kind: "offer", sdp: JSON.stringify(conn.localDescription) });
    } catch {
      setError("Could not start the call. Check the microphone permission.");
      dispatch({ type: "hangup" });
    }
  }, [connection, signal]);

  const flushCandidates = useCallback(async () => {
    const conn = pc.current;
    if (!conn) return;
    haveRemote.current = true;
    const queued = pending.current;
    pending.current = [];
    for (const candidate of queued) {
      try {
        await conn.addIceCandidate(candidate);
      } catch {
        // A candidate the other end could not have used anyway. ICE tries the
        // rest; failing the whole call over one of them would be worse.
      }
    }
  }, []);

  const onSignal = useCallback(
    async (payload: SignalPayload, fromId: number) => {
      // Only the peer we are actually on a call with may steer it. Without this
      // any friend could hang up somebody else's call by sending `end`.
      if (peer.current > 0 && fromId !== peer.current) {
        if (payload.kind === "invite") signal({ kind: "end" });
        return;
      }

      switch (payload.kind) {
        case "invite":
          peer.current = fromId;
          setError("");
          break;
        case "accept":
          // The caller learns its invite was picked up, and only now builds the
          // offer — so no media is negotiated for a call nobody answered.
          void offer();
          break;
        case "offer": {
          try {
            const conn = await connection();
            await conn.setRemoteDescription(new RTCSessionDescription(JSON.parse(payload.sdp)));
            await flushCandidates();
            const answer = await conn.createAnswer();
            await conn.setLocalDescription(answer);
            signal({ kind: "answer", sdp: JSON.stringify(conn.localDescription) });
          } catch {
            setError("Could not answer the call.");
            dispatch({ type: "hangup" });
          }
          break;
        }
        case "answer":
          try {
            await pc.current?.setRemoteDescription(new RTCSessionDescription(JSON.parse(payload.sdp)));
            await flushCandidates();
          } catch {
            setError("The call could not connect.");
            dispatch({ type: "hangup" });
          }
          break;
        case "ice": {
          try {
            const candidate = new RTCIceCandidate(JSON.parse(payload.candidate));
            if (pc.current && haveRemote.current) await pc.current.addIceCandidate(candidate);
            else pending.current.push(candidate);
          } catch {
            // Malformed candidate from the far end; ignore it.
          }
          break;
        }
        default:
          break;
      }

      const event = eventForSignal(payload, fromId);
      if (event) dispatch(event);
    },
    [connection, flushCandidates, offer, signal],
  );

  useEffect(() => {
    setFrameHandler((frame) => {
      if (frame.type !== "voice_signal") return;
      const payload = parseSignal(frame.payload);
      if (payload) void onSignal(payload, frame.fromId);
    });
    return () => setFrameHandler(null);
  }, [setFrameHandler, onSignal]);

  // The peer connection and the microphone are released the moment the machine
  // leaves a live phase, however it got there — our hangup, theirs, or a
  // failure. Nothing else in the app has to remember to do it.
  useEffect(() => {
    if (!isBusy(state)) teardown();
  }, [state, teardown]);

  const start = useCallback(
    (peerId: number) => {
      if (isBusy(state) || peerId <= 0) return;
      setError("");
      peer.current = peerId;
      dispatch({ type: "invite", peerId });
      signal({ kind: "invite" });
    },
    [state, signal],
  );

  const accept = useCallback(() => {
    if (state.phase !== "ringing") return;
    dispatch({ type: "accept" });
    signal({ kind: "accept" });
  }, [state.phase, signal]);

  const hangup = useCallback(() => {
    // Told first, torn down second: the effect above releases the hardware once
    // the phase changes, and by then the frame is already on the socket.
    signal({ kind: "end" });
    dispatch({ type: "hangup" });
  }, [signal]);

  const toggleMute = useCallback(() => {
    const next = !state.muted;
    local.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    dispatch({ type: "toggleMute" });
  }, [state.muted]);

  const toggleCamera = useCallback(() => {
    const mode: VideoMode = state.localVideo === "camera" ? "none" : "camera";
    void (async () => {
      const conn = pc.current;
      const stream = local.current;
      if (!conn || !stream) return;
      try {
        if (mode === "camera") {
          const cam = (await mediaDevices.getUserMedia({ video: { facingMode: "user" } })) as MediaStream;
          cam.getVideoTracks().forEach((track) => {
            stream.addTrack(track);
            conn.addTrack(track, stream);
          });
        } else {
          stream.getVideoTracks().forEach((track) => {
            track.stop();
            stream.removeTrack(track);
          });
        }
        // Adding or dropping a track changes the session, so the offer has to be
        // made again; the far end answers it as an ordinary offer.
        dispatch({ type: "localVideo", mode });
        signal({ kind: "video", mode });
        await offer();
      } catch {
        setError("Could not turn the camera on. Check the camera permission.");
      }
    })();
  }, [state.localVideo, offer, signal]);

  return { state, localStream, remoteStream, error, start, accept, hangup, toggleMute, toggleCamera };
}
