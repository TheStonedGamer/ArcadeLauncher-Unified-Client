// Social gateway wire protocol (TS mirror of Rust `social::protocol`). Inbound
// frames parse into a discriminated `Inbound` union; outbound frames are built
// by the helpers. Shapes match the C++ SocialManager exactly so the frontend
// speaks to the same gateway. Unknown frame types parse to { type: "unknown" }
// rather than throwing, so a newer server never breaks an older client.

export type Inbound =
  | { type: "hello"; selfId: number }
  | { type: "pong" }
  | { type: "presence"; userId: number; state: string; gameId: string; gameTitle: string; statusText: string }
  | { type: "typing"; fromId: number }
  | { type: "chat"; messageId: number; senderId: number; receiverId: number; text: string; attachmentId: number; replyTo: number; timestamp: number }
  | { type: "read"; readerId: number; upToId: number }
  | { type: "chat_edit"; messageId: number; text: string; editedAt: number }
  | { type: "chat_delete"; messageId: number }
  | { type: "reaction"; messageId: number; userId: number; emoji: string; on: boolean }
  | { type: "friend_request"; userId: number }
  | { type: "friend_accepted"; userId: number }
  | { type: "friend_removed"; userId: number }
  // Game invites (T12d): a friend invites us to join their game; cancel retracts.
  | { type: "game_invite"; inviteId: number; fromId: number; gameId: string; gameTitle: string; timestamp: number }
  | { type: "game_invite_cancel"; inviteId: number }
  // Group rooms / channels (T12f): multi-party rooms over the same gateway.
  | { type: "room_created"; roomId: number; name: string; ownerId: number; members: number[] }
  | { type: "room_renamed"; roomId: number; name: string }
  | { type: "room_member_added"; roomId: number; userId: number }
  | { type: "room_member_removed"; roomId: number; userId: number }
  | { type: "room_deleted"; roomId: number }
  // Group-room chat (T12f-2): a message posted to a room we belong to.
  | { type: "room_message"; roomId: number; messageId: number; senderId: number; text: string; timestamp: number }
  // Voice (ROADMAP T9g): opaque WebRTC signaling relayed between friends. The
  // `payload` is interpreted by voice.ts (parseSignal); we keep it untyped here.
  | { type: "voice_signal"; fromId: number; payload: unknown }
  | { type: "unknown" };

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

/** Parse one UTF-8 text frame. Returns null for malformed JSON. */
export function parseInbound(utf8: string): Inbound | null {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(utf8);
    if (typeof parsed !== "object" || parsed === null) return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (v.type) {
    case "hello":
      return { type: "hello", selfId: num(v.selfId) };
    case "pong":
      return { type: "pong" };
    case "presence":
      return {
        type: "presence",
        userId: num(v.userId),
        state: str(v.state),
        gameId: str(v.gameId),
        gameTitle: str(v.gameTitle),
        statusText: str(v.statusText),
      };
    case "typing":
      return { type: "typing", fromId: num(v.fromId) };
    case "chat":
      return {
        type: "chat",
        messageId: num(v.messageId),
        senderId: num(v.senderId),
        receiverId: num(v.receiverId),
        text: str(v.text),
        attachmentId: num(v.attachmentId),
        replyTo: num(v.replyTo),
        timestamp: num(v.timestamp),
      };
    case "read":
      return { type: "read", readerId: num(v.readerId), upToId: num(v.upToId) };
    case "chat_edit":
      return { type: "chat_edit", messageId: num(v.messageId), text: str(v.text), editedAt: num(v.editedAt) };
    case "chat_delete":
      return { type: "chat_delete", messageId: num(v.messageId) };
    case "reaction":
      return {
        type: "reaction",
        messageId: num(v.messageId),
        userId: num(v.userId),
        emoji: str(v.emoji),
        on: v.on === true,
      };
    case "friend_request":
      return { type: "friend_request", userId: num(v.userId) };
    case "friend_accepted":
      return { type: "friend_accepted", userId: num(v.userId) };
    case "friend_removed":
      return { type: "friend_removed", userId: num(v.userId) };
    case "game_invite":
      return {
        type: "game_invite",
        inviteId: num(v.inviteId),
        fromId: num(v.fromId),
        gameId: str(v.gameId),
        gameTitle: str(v.gameTitle),
        timestamp: num(v.timestamp),
      };
    case "game_invite_cancel":
      return { type: "game_invite_cancel", inviteId: num(v.inviteId) };
    case "room_created":
      return {
        type: "room_created",
        roomId: num(v.roomId),
        name: str(v.name),
        ownerId: num(v.ownerId),
        members: numArr(v.members),
      };
    case "room_renamed":
      return { type: "room_renamed", roomId: num(v.roomId), name: str(v.name) };
    case "room_member_added":
      return { type: "room_member_added", roomId: num(v.roomId), userId: num(v.userId) };
    case "room_member_removed":
      return { type: "room_member_removed", roomId: num(v.roomId), userId: num(v.userId) };
    case "room_deleted":
      return { type: "room_deleted", roomId: num(v.roomId) };
    case "room_message":
      return {
        type: "room_message",
        roomId: num(v.roomId),
        messageId: num(v.messageId),
        senderId: num(v.senderId),
        text: str(v.text),
        timestamp: num(v.timestamp),
      };
    case "voice_signal":
      return { type: "voice_signal", fromId: num(v.fromId), payload: v.payload };
    default:
      return { type: "unknown" };
  }
}

/** Outbound frame builders — match the C++ `SendGatewayJson` callers byte-for-byte field set. */
export const outbound = {
  ping: (): string => JSON.stringify({ type: "ping" }),
  resume: (afterMsgId: number): string => JSON.stringify({ type: "resume", afterMsgId }),
  presence: (state: string, statusText = "", dnd = false): string => {
    const f: Record<string, unknown> = { type: "presence", state };
    if (statusText) f.statusText = statusText;
    if (dnd) f.dnd = true;
    return JSON.stringify(f);
  },
  presenceInGame: (gameId: string): string => JSON.stringify({ type: "presence", state: "ingame", gameId }),
  chat: (to: number, text: string, replyTo = 0, attachmentId = 0): string => {
    const f: Record<string, unknown> = { type: "chat", to, text };
    if (replyTo > 0) f.replyTo = replyTo;
    if (attachmentId > 0) f.attachmentId = attachmentId;
    return JSON.stringify(f);
  },
  typing: (to: number): string => JSON.stringify({ type: "typing", to }),
  read: (to: number): string => JSON.stringify({ type: "read", to }),
  edit: (msgId: number, text: string): string => JSON.stringify({ type: "edit", msgId, text }),
  delete: (msgId: number): string => JSON.stringify({ type: "delete", msgId }),
  react: (msgId: number, emoji: string, on: boolean): string =>
    JSON.stringify({ type: "react", msgId, emoji, on }),
  // Game invites (T12d): invite a friend to join our game; accept/decline a received one.
  gameInvite: (to: number, gameId: string): string => JSON.stringify({ type: "game_invite", to, gameId }),
  gameInviteRespond: (inviteId: number, accept: boolean): string =>
    JSON.stringify({ type: "game_invite_respond", inviteId, accept }),
  // Group rooms / channels (T12f): create, rename, add a member, or leave.
  roomCreate: (name: string, members: number[]): string =>
    JSON.stringify({ type: "room_create", name, members }),
  roomRename: (roomId: number, name: string): string =>
    JSON.stringify({ type: "room_rename", roomId, name }),
  roomAddMember: (roomId: number, userId: number): string =>
    JSON.stringify({ type: "room_add_member", roomId, userId }),
  roomLeave: (roomId: number): string => JSON.stringify({ type: "room_leave", roomId }),
  // Group-room chat (T12f-2): post a message to a room.
  roomChat: (roomId: number, text: string): string => JSON.stringify({ type: "room_chat", roomId, text }),
  // Voice (ROADMAP T9g): relay an opaque WebRTC signaling payload to a friend.
  // The server's voice_signal handler also gates the (caller,peer) pair on
  // invite/accept/end, so `payload.kind` must carry those alongside offer/answer/
  // ice (see voice.ts SignalPayload).
  voiceSignal: (to: number, payload: unknown): string =>
    JSON.stringify({ type: "voice_signal", to, payload }),
};
