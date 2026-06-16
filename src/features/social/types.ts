// Social value model — a TypeScript mirror of the Rust `social::model` types
// (and the C++ client's social:: types before that). Identifiers are server
// account ids. Field names/casing match the gateway wire format and the REST
// payloads so both clients share one backend.

export type Presence =
  | "offline"
  | "online"
  | "away"
  | "busy"
  | "invisible"
  | "ingame";

export type Relation =
  | "none"
  | "request_sent"
  | "request_received"
  | "accepted"
  | "blocked";

/** Map an arbitrary server token to a Presence; unknown → "offline". */
export function presenceFromWire(s: string): Presence {
  switch (s) {
    case "online":
    case "away":
    case "busy":
    case "invisible":
    case "ingame":
      return s;
    default:
      return "offline";
  }
}

export function relationFromWire(s: string): Relation {
  switch (s) {
    case "accepted":
    case "request_sent":
    case "request_received":
    case "blocked":
      return s;
    default:
      return "none";
  }
}

export interface Friend {
  accountId: number;
  username: string;
  presence: Presence;
  relation: Relation;
  currentGameId: string;
  currentGameTitle: string;
  /** Custom status text (ROADMAP 1.6), or "" when unset. Server-pushed. */
  statusText: string;
  lastOnline: number;
  // Client-local personalization (never sent to the server). Mirrors the C++
  // social_prefs.json fields; the reducer keeps them across friend re-pulls.
  favorite: boolean;
  nickname: string;
  lastInteract: number;
}

/** One emoji reaction by one user on one message (mirrors the server's
 * social_message_reactions rows: { emoji, userId }). */
export interface Reaction {
  emoji: string;
  userId: number;
}

export interface ChatMessage {
  messageId: number;
  senderId: number;
  receiverId: number;
  text: string;
  timestamp: number;
  isRead: boolean;
  /** Sent locally, not yet acked by the gateway. */
  pending: boolean;
  editedAt: number;
  deleted: boolean;
  attachmentId: number;
  attachmentName: string;
  /** Emoji reactions, one entry per (emoji,user). Server is authoritative. */
  reactions: Reaction[];
  /** messageId this is a reply to (0 = not a reply). */
  replyTo: number;
}

export interface Conversation {
  peerId: number;
  messages: ChatMessage[];
  unread: number;
  peerTyping: boolean;
  /** Epoch ms after which the typing indicator clears. */
  peerTypingUntil: number;
  /** Highest of MY message ids the peer has read. */
  readUpTo: number;
}

/** Whether a presence state should render as "reachable" (dot lit). */
export function isVisible(p: Presence): boolean {
  return p !== "offline" && p !== "invisible";
}
