// Social gateway wire protocol (TS mirror of Rust `social::protocol`). Inbound
// frames parse into a discriminated `Inbound` union; outbound frames are built
// by the helpers. Shapes match the C++ SocialManager exactly so the frontend
// speaks to the same gateway. Unknown frame types parse to { type: "unknown" }
// rather than throwing, so a newer server never breaks an older client.

export type Inbound =
  | { type: "hello"; selfId: number }
  | { type: "pong" }
  | { type: "presence"; userId: number; state: string; gameId: string; gameTitle: string }
  | { type: "typing"; fromId: number }
  | { type: "chat"; messageId: number; senderId: number; receiverId: number; text: string; attachmentId: number; timestamp: number }
  | { type: "read"; readerId: number; upToId: number }
  | { type: "chat_edit"; messageId: number; text: string; editedAt: number }
  | { type: "chat_delete"; messageId: number }
  | { type: "reaction"; messageId: number; userId: number; emoji: string; on: boolean }
  | { type: "friend_request"; userId: number }
  | { type: "friend_accepted"; userId: number }
  | { type: "friend_removed"; userId: number }
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
    default:
      return { type: "unknown" };
  }
}

/** Outbound frame builders — match the C++ `SendGatewayJson` callers byte-for-byte field set. */
export const outbound = {
  ping: (): string => JSON.stringify({ type: "ping" }),
  resume: (afterMsgId: number): string => JSON.stringify({ type: "resume", afterMsgId }),
  presence: (state: string): string => JSON.stringify({ type: "presence", state }),
  presenceInGame: (gameId: string): string => JSON.stringify({ type: "presence", state: "ingame", gameId }),
  chat: (to: number, text: string): string => JSON.stringify({ type: "chat", to, text }),
  typing: (to: number): string => JSON.stringify({ type: "typing", to }),
  read: (to: number): string => JSON.stringify({ type: "read", to }),
  edit: (msgId: number, text: string): string => JSON.stringify({ type: "edit", msgId, text }),
  delete: (msgId: number): string => JSON.stringify({ type: "delete", msgId }),
  react: (msgId: number, emoji: string, on: boolean): string =>
    JSON.stringify({ type: "react", msgId, emoji, on }),
};
