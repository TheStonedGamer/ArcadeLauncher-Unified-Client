// Thin glue over the pure cores: one WebSocket, a heartbeat, and a reconnect.
// Every decision worth testing is in src/core/social.ts (the wire) and
// src/core/roster.ts (the state); this file only moves bytes between them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Application from "expo-application";
import { Platform } from "react-native";

import type { MobileSession } from "./core/session";
import { applyFrame, emptyRoster, type RosterState } from "./core/roster";
import { gatewayUrl, outbound, parseFrame, type Frame } from "./core/social";

export type GatewayState = "connecting" | "connected" | "reconnecting" | "offline";

const HEARTBEAT_MS = 20_000;
/** Same schedule as the desktop client's Backoff: quick first retry, then back
 *  off to a minute so a server that is down is not hammered by every phone. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

/** This phone's identity on the gateway. Android's installation id is stable
 *  across app updates and unique per install, which is exactly the property a
 *  device id needs — and unlike the desktop's derived hash there is no host
 *  name to derive from here. */
function localDevice(): { id: string; name: string; version: string } {
  const id = (Platform.OS === "android" ? Application.getAndroidId?.() : null) ?? "";
  return {
    id: String(id ?? "").slice(0, 64),
    name: [Application.applicationName, Platform.OS].filter(Boolean).join(" ") || "Phone",
    version: Application.nativeApplicationVersion ?? "",
  };
}

export interface Gateway {
  state: GatewayState;
  roster: RosterState;
  /** Queue a raw frame. False when there is no live socket — callers show the
   *  offline state rather than pretending the message was sent. */
  send: (frame: string) => boolean;
  /** Clear the one-shot install notice once the user has seen it. */
  dismissInstall: () => void;
  /** Clear the sign-in prompt once it has been answered. */
  dismissGuard: () => void;
  /** Watch every inbound frame. Calls need this: WebRTC signalling drives a
   *  peer connection rather than any roster state, so it cannot be read back
   *  out of the roster afterwards. One watcher at a time, replaced on set. */
  setFrameHandler: (handler: ((frame: Frame) => void) | null) => void;
}

export function useGateway(session: MobileSession | null): Gateway {
  const [state, setState] = useState<GatewayState>("offline");
  const [roster, setRoster] = useState<RosterState>(emptyRoster);
  const socket = useRef<WebSocket | null>(null);
  const onFrame = useRef<((frame: Frame) => void) | null>(null);
  const device = useMemo(localDevice, []);
  // Stable identity: the watcher is registered from an effect, and a new
  // function every render would re-register it on every render.
  const setFrameHandler = useCallback((handler: ((frame: Frame) => void) | null) => {
    onFrame.current = handler;
  }, []);
  const send = useCallback((frame: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(frame);
    return true;
  }, []);

  useEffect(() => {
    if (!session) {
      setState("offline");
      setRoster(emptyRoster());
      return;
    }

    let closed = false;
    let attempt = 0;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      setState(attempt === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(gatewayUrl(session.host, session.token, device));
      socket.current = ws;

      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        setState("connected");
        // Ask for the account's machines straight away so the install picker is
        // populated before the user opens it.
        ws.send(outbound.devices());
        ws.send(outbound.presence("online"));
        heartbeat = setInterval(() => ws.send(outbound.ping()), HEARTBEAT_MS);
      };

      ws.onmessage = (event) => {
        if (closed || typeof event.data !== "string") return;
        const frame = parseFrame(event.data);
        setRoster((prev) => applyFrame(prev, frame, Math.floor(Date.now() / 1000)));
        onFrame.current?.(frame);
      };

      const drop = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        socket.current = null;
        if (closed) return;
        setState("reconnecting");
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retry = setTimeout(open, wait);
      };

      ws.onclose = drop;
      // An error is always followed by a close on RN's WebSocket, so there is
      // nothing to do here but stop it reaching the console as unhandled.
      ws.onerror = () => {};
    };

    open();

    return () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (retry) clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
      setState("offline");
    };
  }, [session, device]);

  return {
    state,
    roster,
    send,
    dismissInstall: () => setRoster((prev) => (prev.install ? { ...prev, install: null } : prev)),
    dismissGuard: () => setRoster((prev) => (prev.guard ? { ...prev, guard: null } : prev)),
    setFrameHandler,
  };
}
