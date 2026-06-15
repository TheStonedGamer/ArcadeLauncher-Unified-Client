// Derived views over SocialState. Pure functions, unit-tested — components read
// these instead of re-deriving sort/unread logic inline.

import type { SocialState } from "./reducer";
import { isVisible, type Friend, type Presence } from "./types";

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

/** Total unread across all conversations — drives the nav badge. */
export function totalUnread(state: SocialState): number {
  return Object.values(state.conversations).reduce((sum, c) => sum + c.unread, 0);
}

/** Count of friends currently reachable (online/away/busy/in-game). */
export function onlineCount(state: SocialState): number {
  return state.friends.filter((f) => f.relation === "accepted" && isVisible(f.presence)).length;
}
