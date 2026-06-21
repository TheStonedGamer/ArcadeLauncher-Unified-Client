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
import {
  invitesReducer,
  inviteActionFromFrame,
  sortedInvites,
  type GameInvite,
} from "./invites";
import { roomsReducer, roomActionFromFrame, sortedRooms, type Room } from "./rooms";
import { isGroupSignal } from "./voiceMesh";
import {
  applyRoomMessage,
  localEchoRoom,
  clearRoomChat,
  roomMessages,
  type RoomChats,
  type RoomMessage,
} from "./roomChat";
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
  /** Register the handler for inbound 1:1 voice_signal frames (useVoice owns it). */
  setVoiceHandler: (cb: (fromId: number, payload: unknown) => void) => void;
  /** Register the handler for inbound group voice_signal frames (useGroupVoice). */
  setGroupVoiceHandler: (cb: (fromId: number, payload: unknown) => void) => void;
  /** Pending "join my game" invites I've received, newest-first (ROADMAP T12d). */
  gameInvites: GameInvite[];
  /** Invite a friend to join the game I'm playing. */
  sendGameInvite: (to: number, gameId: string) => void;
  /** Accept an invite: tell the server, then drop it locally. Returns the gameId
   *  to launch (or null if the invite is no longer pending) so the caller can do
   *  the launch handoff. */
  acceptGameInvite: (inviteId: number) => string | null;
  /** Decline/dismiss an invite: tell the server and drop it locally. */
  declineGameInvite: (inviteId: number) => void;
  // --- Group rooms / channels (T12f) ------------------------------------
  /** Rooms I belong to, sorted for display. */
  rooms: Room[];
  /** The currently-open room (null = none). */
  selectedRoom: number | null;
  /** Open a room (or close with null). */
  selectRoom: (roomId: number | null) => void;
  /** Messages in the selected room, oldest-first. */
  roomConversation: RoomMessage[];
  /** Create a room with an initial member set. */
  createRoom: (name: string, memberIds: number[]) => void;
  /** Rename a room I own. */
  renameRoom: (roomId: number, name: string) => void;
  /** Add a friend to a room. */
  addRoomMember: (roomId: number, userId: number) => void;
  /** Leave a room (drops it locally too). */
  leaveRoom: (roomId: number) => void;
  /** Post a message to the selected room (optimistic echo + gateway send). */
  sendRoomMessage: (text: string) => void;
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
  // Pending game invites (T12d). Driven by the gateway frames below; the pure
  // reducer + frame mapper are unit-tested in invites.test.ts.
  const [invites, setInvites] = useState<GameInvite[]>([]);
  const invitesRef = useRef(invites);
  invitesRef.current = invites;
  // Group rooms / channels (T12f). Membership in `rooms`, per-room message logs
  // in `roomChats`; both driven by the room_* frames below and unit-tested in
  // rooms.test.ts / roomChat.test.ts.
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomChats, setRoomChats] = useState<RoomChats>({});
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
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
  // Group voice (T12g) rides the same voice_signal relay; payloads tagged
  // `group: true` route here instead of the 1:1 handler so the two coexist.
  const groupVoiceHandlerRef = useRef<(fromId: number, payload: unknown) => void>(() => {});

  const host = auth?.host ?? null;
  const token = auth?.token ?? null;

  useEffect(() => {
    const gw = gatewayFor(host && token ? { host, token } : null);
    gatewayRef.current = gw;
    gw.onFrame((msg) => {
      if (msg.type === "voice_signal") {
        if (isGroupSignal(msg.payload)) groupVoiceHandlerRef.current(msg.fromId, msg.payload);
        else voiceHandlerRef.current(msg.fromId, msg.payload);
      }
      // Game invites (T12d): a game_invite / cancel / friend_removed frame maps to
      // an invite action; everything else is ignored by the mapper.
      const ia = inviteActionFromFrame(msg, Date.now());
      if (ia) setInvites((prev) => invitesReducer(prev, ia));
      // Group rooms (T12f): membership frames drive the room reducer; room_message
      // appends to that room's log; leaving/deletion clears the log too.
      const selfId = socialRef.current.selfId;
      const ra = roomActionFromFrame(msg, selfId);
      if (ra) setRooms((prev) => roomsReducer(prev, ra));
      if (msg.type === "room_message") {
        setRoomChats((prev) => applyRoomMessage(prev, msg.roomId, msg));
      }
      if (msg.type === "room_deleted" || (msg.type === "room_member_removed" && msg.userId === selfId)) {
        setRoomChats((prev) => clearRoomChat(prev, msg.roomId));
      }
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
      setInvites([]); // invites are per-session; drop them on sign-out/reconnect-rebuild.
      setRooms([]);
      setRoomChats({});
      setSelectedRoom(null);
    };
    // Rebuild the gateway when the session host/token changes (sign in/out).
  }, [host, token]);

  // Demo seed: `?invites-demo` drops a couple of pending invites so the toast
  // stack can be exercised without a live gateway (mirrors `?downloads-demo`).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("invites-demo")) return;
    const now = Date.now();
    setInvites([
      { inviteId: 9001, fromId: 1, gameId: "celeste", gameTitle: "Celeste", receivedAt: now },
      { inviteId: 9002, fromId: 2, gameId: "hades", gameTitle: "Hades", receivedAt: now - 1000 },
    ]);
  }, []);

  // Prune stale invites (no response within INVITE_TTL_MS) on a slow timer.
  useEffect(() => {
    const id = setInterval(
      () => setInvites((prev) => invitesReducer(prev, { type: "prune", now: Date.now() })),
      30_000,
    );
    return () => clearInterval(id);
  }, []);

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

  const setGroupVoiceHandler = useCallback((cb: (fromId: number, payload: unknown) => void) => {
    groupVoiceHandlerRef.current = cb;
  }, []);

  const sendGameInvite = useCallback((to: number, gameId: string) => {
    if (to && gameId) gatewayRef.current?.send(outbound.gameInvite(to, gameId));
  }, []);

  const acceptGameInvite = useCallback((inviteId: number): string | null => {
    if (!inviteId) return null;
    const target = invitesRef.current.find((i) => i.inviteId === inviteId)?.gameId ?? null;
    gatewayRef.current?.send(outbound.gameInviteRespond(inviteId, true));
    setInvites((prev) => invitesReducer(prev, { type: "remove", inviteId }));
    return target;
  }, []);

  const declineGameInvite = useCallback((inviteId: number) => {
    if (!inviteId) return;
    gatewayRef.current?.send(outbound.gameInviteRespond(inviteId, false));
    setInvites((prev) => invitesReducer(prev, { type: "remove", inviteId }));
  }, []);

  const selectRoom = useCallback((roomId: number | null) => setSelectedRoom(roomId), []);

  const createRoom = useCallback((name: string, memberIds: number[]) => {
    const n = name.trim();
    if (n) gatewayRef.current?.send(outbound.roomCreate(n, memberIds));
  }, []);

  const renameRoom = useCallback((roomId: number, name: string) => {
    const n = name.trim();
    if (roomId && n) gatewayRef.current?.send(outbound.roomRename(roomId, n));
  }, []);

  const addRoomMember = useCallback((roomId: number, userId: number) => {
    if (roomId && userId) gatewayRef.current?.send(outbound.roomAddMember(roomId, userId));
  }, []);

  const leaveRoom = useCallback((roomId: number) => {
    if (!roomId) return;
    gatewayRef.current?.send(outbound.roomLeave(roomId));
    // Optimistically drop the room + its log; the server echo (room_member_removed
    // for us / room_deleted) would do the same, but don't wait for it.
    setRooms((prev) => roomsReducer(prev, { type: "removeRoom", roomId }));
    setRoomChats((prev) => clearRoomChat(prev, roomId));
    setSelectedRoom((cur) => (cur === roomId ? null : cur));
  }, []);

  const sendRoomMessage = useCallback(
    (text: string) => {
      const roomId = selectedRoom;
      const trimmed = text.trim();
      if (roomId == null || trimmed === "") return;
      const self = socialRef.current.selfId;
      setRoomChats((prev) => localEchoRoom(prev, roomId, self, trimmed, Date.now()));
      gatewayRef.current?.send(outbound.roomChat(roomId, trimmed));
    },
    [selectedRoom],
  );

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
  const roomList = useMemo(() => sortedRooms(rooms), [rooms]);
  const roomConversation = useMemo(
    () => (selectedRoom != null ? roomMessages(roomChats, selectedRoom) : []),
    [roomChats, selectedRoom],
  );
  const gameInvites = useMemo(() => sortedInvites(invites), [invites]);
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
    setGroupVoiceHandler,
    gameInvites,
    sendGameInvite,
    acceptGameInvite,
    declineGameInvite,
    rooms: roomList,
    selectedRoom,
    selectRoom,
    roomConversation,
    createRoom,
    renameRoom,
    addRoomMember,
    leaveRoom,
    sendRoomMessage,
  };
}
