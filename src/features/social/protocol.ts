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
  // Voice (ROADMAP T9g): relay an opaque WebRTC signaling payload to a friend.
  // The server's voice_signal handler also gates the (caller,peer) pair on
  // invite/accept/end, so `payload.kind` must carry those alongside offer/answer/
  // ice (see voice.ts SignalPayload).
  voiceSignal: (to: number, payload: unknown): string =>
    JSON.stringify({ type: "voice_signal", to, payload }),
};
