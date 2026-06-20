// Pure game-invite state (T12d). Tracks the pending "join my game" invites a
// user has received, as a referentially-transparent reducer over an immutable
// list — same KAT discipline as the social reducer. Transport (gateway frames)
// and UI (toast + Join button) plug in on top. A "Join" target is derived here
// too, so the launch wiring stays trivial.

import type { Inbound } from "./protocol";

/** One pending invite to join a friend's game. `receivedAt` is ms-epoch. */
export interface GameInvite {
  inviteId: number;
  fromId: number;
  gameId: string;
  gameTitle: string;
  receivedAt: number;
}

/** Invites older than this (no response/cancel) are pruned as stale. */
export const INVITE_TTL_MS = 5 * 60 * 1000;

export type InviteAction =
  | { type: "received"; invite: GameInvite }
  /** Remove one invite (accepted, declined, or server-cancelled). */
  | { type: "remove"; inviteId: number }
  /** Drop every invite from a friend (e.g. they went offline). */
  | { type: "clearFrom"; fromId: number }
  /** Drop invites older than `now - INVITE_TTL_MS`. */
  | { type: "prune"; now: number }
  | { type: "reset" };

/** Reduce the pending-invite list. Newest invite from a given sender for a given
 *  game replaces an older one (re-invite refreshes rather than duplicates). */
export function invitesReducer(state: GameInvite[], action: InviteAction): GameInvite[] {
  switch (action.type) {
    case "received": {
      const inv = action.invite;
      // Drop any prior invite with the same id, or the same (sender, game) pair.
      const rest = state.filter(
        (i) => i.inviteId !== inv.inviteId && !(i.fromId === inv.fromId && i.gameId === inv.gameId),
      );
      return [...rest, inv];
    }
    case "remove":
      return state.filter((i) => i.inviteId !== action.inviteId);
    case "clearFrom":
      return state.filter((i) => i.fromId !== action.fromId);
    case "prune":
      return state.filter((i) => action.now - i.receivedAt < INVITE_TTL_MS);
    case "reset":
      return [];
    default:
      return state;
  }
}

/** Translate a gateway frame into an invite action, or null if irrelevant.
 *  `now` stamps the receive time (kept as a parameter so this stays pure). */
export function inviteActionFromFrame(frame: Inbound, now: number): InviteAction | null {
  switch (frame.type) {
    case "game_invite":
      return {
        type: "received",
        invite: {
          inviteId: frame.inviteId,
          fromId: frame.fromId,
          gameId: frame.gameId,
          gameTitle: frame.gameTitle,
          receivedAt: now,
        },
      };
    case "game_invite_cancel":
      return { type: "remove", inviteId: frame.inviteId };
    case "friend_removed":
      return { type: "clearFrom", fromId: frame.userId };
    default:
      return null;
  }
}

/** Invites sorted newest-first for display. */
export function sortedInvites(state: GameInvite[]): GameInvite[] {
  return [...state].sort((a, b) => b.receivedAt - a.receivedAt || b.inviteId - a.inviteId);
}

/** Count of pending invites (for a badge). */
export function inviteCount(state: GameInvite[]): number {
  return state.length;
}

/** The game id a "Join" on `inviteId` should launch, or null if not pending. */
export function joinTarget(state: GameInvite[], inviteId: number): string | null {
  return state.find((i) => i.inviteId === inviteId)?.gameId ?? null;
}
