// Derived views over SocialState. Pure functions, unit-tested — components read
// these instead of re-deriving sort/unread logic inline.

import type { SocialState } from "./reducer";
import { isVisible, type ChatMessage, type Friend, type Presence } from "./types";

/** Display name = nickname override if set, else username. */
export function displayName(f: Friend): string {
  return f.nickname.trim() !== "" ? f.nickname : f.username;
}

// Presence ordering for the friend list: in-game and online float to the top,
// offline sinks. Lower rank sorts first.
const PRESENCE_RANK: Record<Presence, number> = {
  ingame: 0,
  online: 1,
  away: 2,
  busy: 3,
  invisible: 4,
  offline: 5,
};

/**
 * Friend list order, mirroring the C++ client: favorites pinned to the top, then
 * by presence (in-game/online first), then most-recently-interacted, then name.
 * Returns a new array; does not mutate.
 */
export function sortedFriends(state: SocialState): Friend[] {
  return [...state.friends]
    .filter((f) => f.relation === "accepted")
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const pr = PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence];
      if (pr !== 0) return pr;
      if (a.lastInteract !== b.lastInteract) return b.lastInteract - a.lastInteract;
      return displayName(a).localeCompare(displayName(b));
    });
}

/** Pending incoming friend requests, for the requests section/badge. */
export function incomingRequests(state: SocialState): Friend[] {
  return state.friends.filter((f) => f.relation === "request_received");
}

/** Pending outgoing friend requests I've sent that aren't accepted yet. */
export function outgoingRequests(state: SocialState): Friend[] {
  return state.friends.filter((f) => f.relation === "request_sent");
}

/** Total unread across all conversations — drives the nav badge. */
export function totalUnread(state: SocialState): number {
  return Object.values(state.conversations).reduce((sum, c) => sum + c.unread, 0);
}

/** Count of friends currently reachable (online/away/busy/in-game). */
export function onlineCount(state: SocialState): number {
  return state.friends.filter((f) => f.relation === "accepted" && isVisible(f.presence)).length;
}

/** One row in the Chats tab: a peer conversation summarized for the list. */
export interface ChatSummary {
  peerId: number;
  /** The friend record for this peer, if still in the roster (else undefined). */
  friend: Friend | undefined;
  /** The most recent message in the thread (may be pending or a tombstone). */
  lastMessage: ChatMessage;
  /** Unread count for this thread. */
  unread: number;
  /** Sort key — the last message's timestamp (epoch seconds). */
  lastActivity: number;
}

/**
 * Conversations that have at least one message, summarized for the Chats tab and
 * ordered most-recent-first (newest DM on top). Each row carries the last message
 * and the peer's friend record (when still in the roster). Threads with no
 * messages are omitted — the Chats tab lists active conversations, not friends.
 */
export function chatSummaries(state: SocialState): ChatSummary[] {
  const byId = new Map(state.friends.map((f) => [f.accountId, f]));
  const rows: ChatSummary[] = [];
  for (const conv of Object.values(state.conversations)) {
    if (conv.messages.length === 0) continue;
    const lastMessage = conv.messages[conv.messages.length - 1];
    rows.push({
      peerId: conv.peerId,
      friend: byId.get(conv.peerId),
      lastMessage,
      unread: conv.unread,
      lastActivity: lastMessage.timestamp,
    });
  }
  return rows.sort((a, b) => b.lastActivity - a.lastActivity);
}

/** Sort modes for the Friends tab roster. */
export type FriendSort = "status" | "name" | "recent";

export const FRIEND_SORT_LABELS: Record<FriendSort, string> = {
  status: "Status",
  name: "Name",
  recent: "Recent",
};

/**
 * Re-order an already-accepted friend list by the chosen mode. Favorites stay
 * pinned to the top in every mode (they're explicit user picks); the mode is the
 * secondary key. `status` = presence rank then name; `name` = A→Z; `recent` =
 * most-recently-interacted first. Returns a new array; does not mutate.
 */
export function sortFriendsBy(friends: Friend[], mode: FriendSort): Friend[] {
  return [...friends].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (mode === "name") return displayName(a).localeCompare(displayName(b));
    if (mode === "recent") {
      if (a.lastInteract !== b.lastInteract) return b.lastInteract - a.lastInteract;
      return displayName(a).localeCompare(displayName(b));
    }
    const pr = PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence];
    if (pr !== 0) return pr;
    return displayName(a).localeCompare(displayName(b));
  });
}
