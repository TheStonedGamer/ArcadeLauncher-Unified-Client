// Social state hook: owns the SocialState, drives it from gateway frames, and
// exposes derived views + actions to the UI. The reducer and selectors do all
// the real work (and are unit-tested); this hook is the thin React/transport
// glue. The gateway is injected so T3b can swap NullGateway for the real one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NullGateway, type Gateway, type GatewayState } from "./gateway";
import { DemoGateway } from "./demoGateway";
import { WsGateway } from "./wsGateway";
import { outbound } from "./protocol";
import {
  applyFriendList,
  applyInbound,
  initialSocialState,
  localEcho,
  markConversationRead,
  type SocialState,
} from "./reducer";
import { sortedFriends, totalUnread } from "./selectors";
import type { Conversation, Friend } from "./types";

export interface SocialApi {
  state: GatewayState;
  connected: boolean;
  friends: Friend[];
  selfId: number;
  selectedPeer: number | null;
  select: (peerId: number | null) => void;
  conversation: Conversation | null;
  unreadTotal: number;
  /** Send a message to the selected peer (optimistic echo + gateway send). */
  send: (text: string) => void;
  /** Tell the peer we're typing. */
  notifyTyping: () => void;
}

const EMPTY_CONV: Conversation = {
  peerId: 0,
  messages: [],
  unread: 0,
  peerTyping: false,
  peerTypingUntil: 0,
  readUpTo: 0,
};

/**
 * Default gateway selection:
 *  - `?ws=<host>&token=<token>` → the live {@link WsGateway} (manual testing
 *    against a real backend; the auth slice will select this with the user's
 *    real session instead of URL params).
 *  - `?demo` → the scripted {@link DemoGateway}.
 *  - otherwise → {@link NullGateway} (the safe production default until the
 *    session/auth layer exists to supply a host + token).
 */
function defaultGateway(): Gateway {
  if (typeof window === "undefined") return new NullGateway();
  const params = new URLSearchParams(window.location.search);
  const host = params.get("ws");
  const token = params.get("token");
  if (host && token) return new WsGateway(host, token);
  if (params.has("demo")) return new DemoGateway();
  return new NullGateway();
}

export function useSocial(gatewayFactory: () => Gateway = defaultGateway): SocialApi {
  const [social, setSocial] = useState<SocialState>(initialSocialState);
  const [state, setState] = useState<GatewayState>("disconnected");
  const [selectedPeer, setSelectedPeer] = useState<number | null>(null);
  const gatewayRef = useRef<Gateway | null>(null);

  useEffect(() => {
    const gw = gatewayFactory();
    gatewayRef.current = gw;
    gw.onFrame((msg) => setSocial((prev) => applyInbound(prev, msg, Date.now())));
    gw.onState((s) => {
      setState(s);
      // On (re)connect, pull the authoritative friend list.
      if (s === "connected") {
        gw.fetchFriends().then((friends) => setSocial((prev) => applyFriendList(prev, friends)));
      }
    });
    gw.connect();
    return () => {
      gw.disconnect();
      gatewayRef.current = null;
    };
    // gatewayFactory is expected to be stable (module-level); intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((peerId: number | null) => {
    setSelectedPeer(peerId);
    if (peerId != null) {
      setSocial((prev) => markConversationRead(prev, peerId));
      // Tell the server we've read this conversation.
      gatewayRef.current?.send(outbound.read(peerId));
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const peer = selectedPeer;
      const trimmed = text.trim();
      if (peer == null || trimmed === "") return;
      setSocial((prev) => localEcho(prev, peer, trimmed, Date.now()).state);
      gatewayRef.current?.send(outbound.chat(peer, trimmed));
    },
    [selectedPeer],
  );

  const notifyTyping = useCallback(() => {
    if (selectedPeer != null) gatewayRef.current?.send(outbound.typing(selectedPeer));
  }, [selectedPeer]);

  const friends = useMemo(() => sortedFriends(social), [social]);
  const unreadTotal = useMemo(() => totalUnread(social), [social]);
  const conversation =
    selectedPeer != null ? social.conversations[selectedPeer] ?? { ...EMPTY_CONV, peerId: selectedPeer } : null;

  return {
    state,
    connected: state === "connected",
    friends,
    selfId: social.selfId,
    selectedPeer,
    select,
    conversation,
    unreadTotal,
    send,
    notifyTyping,
  };
}
