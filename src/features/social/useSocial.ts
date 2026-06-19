// Social state hook: owns the SocialState, drives it from gateway frames, and
// exposes derived views + actions to the UI. The reducer and selectors do all
// the real work (and are unit-tested); this hook is the thin React/transport
// glue. The gateway is injected so T3b can swap NullGateway for the real one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NullGateway, type Gateway, type GatewayState } from "./gateway";
import { DemoGateway } from "./demoGateway";
import { fetchFriendsDirect, WsGateway } from "./wsGateway";
import { attachmentLink, uploadAttachment, respondToFriendRequest, type FriendAction } from "./api";
import { outbound } from "./protocol";
import {
  applyFriendList,
  applyInbound,
  applyReaction,
  initialSocialState,
  localEcho,
  markConversationRead,
  optimisticDelete,
  optimisticEdit,
  type SocialState,
} from "./reducer";
import { incomingRequests, outgoingRequests, sortedFriends, totalUnread } from "./selectors";
import { presenceFrameInput, type SelfStatus } from "./statusMenu";
import type { Conversation, Friend } from "./types";

export interface SocialApi {
  state: GatewayState;
  connected: boolean;
  friends: Friend[];
  /** Pending incoming friend requests (drives the Requests tab + badge). */
  incoming: Friend[];
  /** Pending outgoing friend requests I've sent. */
  outgoing: Friend[];
  /** Accept/decline an incoming request, cancel an outgoing one, or remove a
   *  friend. Refreshes the roster from the server afterwards. */
  respondToRequest: (userId: number, action: FriendAction) => void;
  selfId: number;
  selectedPeer: number | null;
  select: (peerId: number | null) => void;
  conversation: Conversation | null;
  unreadTotal: number;
  /** Send a message to the selected peer (optimistic echo + gateway send). */
  send: (text: string) => void;
  /** Tell the peer we're typing. */
  notifyTyping: () => void;
  /** Edit one of my own messages (optimistic update + gateway send). */
  editMessage: (msgId: number, text: string) => void;
  /** Delete one of my own messages (optimistic tombstone + gateway send). */
  deleteMessage: (msgId: number) => void;
  /** Toggle my reaction with `emoji` on a message (optimistic + gateway send). */
  toggleReaction: (msgId: number, emoji: string) => void;
  /** The message the composer is currently replying to (0 = none). */
  replyTo: number;
  /** Set/clear the reply target. */
  setReplyTo: (msgId: number) => void;
  /** Whether DM attachments are available (needs a live, signed-in session). */
  attachEnabled: boolean;
  /** Pick a file and send it to the selected peer as an attachment. */
  sendAttachment: () => void;
  /** Resolve + open an attachment's download URL in the OS default handler. */
  openAttachment: (attachmentId: number) => void;
  /** My currently chosen presence status (re-sent on each reconnect). */
  myStatus: SelfStatus;
  /** My custom status text ("" when unset). */
  myStatusText: string;
  /** Set my presence status + custom text (gateway send + persists locally). */
  setStatus: (status: SelfStatus, statusText: string) => void;
  /** Relay a WebRTC voice-signaling payload to a friend (ROADMAP T9g). */
  voiceSend: (to: number, payload: unknown) => void;
  /** Register the handler for inbound voice_signal frames (useVoice owns it). */
  setVoiceHandler: (cb: (fromId: number, payload: unknown) => void) => void;
}

const EMPTY_CONV: Conversation = {
  peerId: 0,
  messages: [],
  unread: 0,
  peerTyping: false,
  peerTypingUntil: 0,
  readUpTo: 0,
};

/** Host + token for the live gateway (sourced from the user's session). */
export interface SocialAuth {
  host: string;
  token: string;
}

/**
 * Gateway selection for a given auth:
 *  - a real `auth` (the signed-in session) → the live {@link WsGateway}.
 *  - else `?ws=<host>&token=<token>` → live gateway (manual backend testing).
 *  - else `?demo` → the scripted {@link DemoGateway}.
 *  - otherwise → {@link NullGateway} (safe default until the user signs in).
 */
function gatewayFor(auth: SocialAuth | null): Gateway {
  if (auth && auth.host && auth.token) return new WsGateway(auth.host, auth.token);
  if (typeof window === "undefined") return new NullGateway();
  const params = new URLSearchParams(window.location.search);
  const host = params.get("ws");
  const token = params.get("token");
  if (host && token) return new WsGateway(host, token);
  if (params.has("demo")) return new DemoGateway();
  return new NullGateway();
}

export function useSocial(auth: SocialAuth | null = null): SocialApi {
  const [social, setSocial] = useState<SocialState>(initialSocialState);
  const [state, setState] = useState<GatewayState>("disconnected");
  const [selectedPeer, setSelectedPeer] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState(0);
  const [myStatus, setMyStatus] = useState<SelfStatus>("online");
  const [myStatusText, setMyStatusText] = useState("");
  const gatewayRef = useRef<Gateway | null>(null);
  // Latest chosen status, read on (re)connect to re-assert presence without
  // re-subscribing the connect effect to status changes.
  const statusRef = useRef({ status: myStatus, text: myStatusText });
  statusRef.current = { status: myStatus, text: myStatusText };
  // Latest state, read by toggleReaction to decide add-vs-remove without
  // re-creating the callback on every frame.
  const socialRef = useRef(social);
  socialRef.current = social;
  // Voice signaling (T9g): inbound voice_signal frames are routed here so
  // useVoice can drive its RTCPeerConnection without a second gateway.
  const voiceHandlerRef = useRef<(fromId: number, payload: unknown) => void>(() => {});

  const host = auth?.host ?? null;
  const token = auth?.token ?? null;

  useEffect(() => {
    const gw = gatewayFor(host && token ? { host, token } : null);
    gatewayRef.current = gw;
    gw.onFrame((msg) => {
      if (msg.type === "voice_signal") voiceHandlerRef.current(msg.fromId, msg.payload);
      // A friend_* frame means the relationship graph changed (new request,
      // accept, or removal). The reducer can't synthesize the row, so re-pull the
      // authoritative roster — this is what keeps the Requests tab live.
      if (
        msg.type === "friend_request" ||
        msg.type === "friend_accepted" ||
        msg.type === "friend_removed"
      ) {
        gw.fetchFriends().then((friends) => setSocial((prev) => applyFriendList(prev, friends)));
      }
      setSocial((prev) => applyInbound(prev, msg, Date.now()));
    });
    gw.onState((s) => {
      setState(s);
      // On (re)connect, pull the authoritative friend list and re-assert my
      // chosen presence (the server resets to "online" on a fresh socket).
      if (s === "connected") {
        gw.fetchFriends().then((friends) => setSocial((prev) => applyFriendList(prev, friends)));
        const { status, text } = statusRef.current;
        if (status !== "online" || text) {
          const f = presenceFrameInput(status, text);
          gw.send(outbound.presence(f.state, f.statusText, f.dnd));
        }
      }
    });
    gw.connect();
    return () => {
      gw.disconnect();
      gatewayRef.current = null;
    };
    // Rebuild the gateway when the session host/token changes (sign in/out).
  }, [host, token]);

  const select = useCallback((peerId: number | null) => {
    setSelectedPeer(peerId);
    setReplyTo(0); // a reply target is per-conversation; clear on switch.
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
      const rt = replyTo;
      setSocial((prev) => localEcho(prev, peer, trimmed, Date.now(), rt).state);
      gatewayRef.current?.send(outbound.chat(peer, trimmed, rt));
      setReplyTo(0); // consumed.
    },
    [selectedPeer, replyTo],
  );

  const attachEnabled = !!(host && token);

  const sendAttachment = useCallback(() => {
    const peer = selectedPeer;
    if (peer == null || !host || !token) return;
    const rt = replyTo;
    void (async () => {
      try {
        const picked = await openFileDialog({ multiple: false, directory: false });
        const path = typeof picked === "string" ? picked : null;
        if (!path) return;
        const up = await uploadAttachment(host, token, path);
        // Optimistic echo (empty text, attachment rides along); the acked frame
        // resolves it (matched on sender + text + attachmentId — see reducer).
        setSocial((prev) => localEcho(prev, peer, "", Date.now(), rt, up.attachmentId, up.filename).state);
        gatewayRef.current?.send(outbound.chat(peer, "", rt, up.attachmentId));
        setReplyTo(0);
      } catch (e) {
        console.error("attachment send failed", e);
      }
    })();
  }, [selectedPeer, replyTo, host, token]);

  const openAttachment = useCallback(
    (attachmentId: number) => {
      if (!attachmentId || !host || !token) return;
      void (async () => {
        try {
          const link = await attachmentLink(host, token, attachmentId);
          if (link.downloadUrl) await openUrl(link.downloadUrl);
        } catch (e) {
          console.error("open attachment failed", e);
        }
      })();
    },
    [host, token],
  );

  const setStatus = useCallback((status: SelfStatus, statusText: string) => {
    const f = presenceFrameInput(status, statusText);
    setMyStatus(status);
    setMyStatusText(f.statusText);
    gatewayRef.current?.send(outbound.presence(f.state, f.statusText, f.dnd));
  }, []);

  const notifyTyping = useCallback(() => {
    if (selectedPeer != null) gatewayRef.current?.send(outbound.typing(selectedPeer));
  }, [selectedPeer]);

  const respondToRequest = useCallback(
    (userId: number, action: FriendAction) => {
      if (!host || !token || !userId) return;
      respondToFriendRequest(host, token, userId, action)
        .then(() =>
          // Refresh the roster so the request row clears. Prefer the live
          // gateway, but fall back to a direct REST pull when the socket is
          // momentarily down — otherwise an accepted/declined request lingers.
          (gatewayRef.current?.fetchFriends() ?? fetchFriendsDirect(host, token)).then((friends) =>
            setSocial((prev) => applyFriendList(prev, friends)),
          ),
        )
        .catch((e) => console.error("friend respond failed", e));
    },
    [host, token],
  );

  const voiceSend = useCallback((to: number, payload: unknown) => {
    if (to) gatewayRef.current?.send(outbound.voiceSignal(to, payload));
  }, []);

  const setVoiceHandler = useCallback((cb: (fromId: number, payload: unknown) => void) => {
    voiceHandlerRef.current = cb;
  }, []);

  const editMessage = useCallback((msgId: number, text: string) => {
    const trimmed = text.trim();
    if (!msgId || trimmed === "") return;
    setSocial((prev) => optimisticEdit(prev, msgId, trimmed, Date.now()));
    gatewayRef.current?.send(outbound.edit(msgId, trimmed));
  }, []);

  const deleteMessage = useCallback((msgId: number) => {
    if (!msgId) return;
    setSocial((prev) => optimisticDelete(prev, msgId));
    gatewayRef.current?.send(outbound.delete(msgId));
  }, []);

  const toggleReaction = useCallback((msgId: number, emoji: string) => {
    if (!msgId || emoji === "") return;
    const prev = socialRef.current;
    const self = prev.selfId;
    // Find the message to decide whether I'm toggling on or off.
    let mine = false;
    for (const conv of Object.values(prev.conversations)) {
      const m = conv.messages.find((x) => x.messageId === msgId);
      if (m) {
        mine = m.reactions.some((r) => r.userId === self && r.emoji === emoji);
        break;
      }
    }
    const on = !mine;
    setSocial((s) => applyReaction(s, msgId, self, emoji, on));
    gatewayRef.current?.send(outbound.react(msgId, emoji, on));
  }, []);

  const friends = useMemo(() => sortedFriends(social), [social]);
  const incoming = useMemo(() => incomingRequests(social), [social]);
  const outgoing = useMemo(() => outgoingRequests(social), [social]);
  const unreadTotal = useMemo(() => totalUnread(social), [social]);
  const conversation =
    selectedPeer != null ? social.conversations[selectedPeer] ?? { ...EMPTY_CONV, peerId: selectedPeer } : null;

  return {
    state,
    connected: state === "connected",
    friends,
    incoming,
    outgoing,
    respondToRequest,
    selfId: social.selfId,
    selectedPeer,
    select,
    conversation,
    unreadTotal,
    send,
    notifyTyping,
    editMessage,
    deleteMessage,
    toggleReaction,
    replyTo,
    setReplyTo,
    attachEnabled,
    sendAttachment,
    openAttachment,
    myStatus,
    myStatusText,
    setStatus,
    voiceSend,
    setVoiceHandler,
  };
}
