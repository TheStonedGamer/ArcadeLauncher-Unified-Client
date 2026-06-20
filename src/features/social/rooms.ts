// Pure group-room / channel state (T12f). Tracks the multi-party rooms a user
// belongs to as a referentially-transparent reducer over an immutable list —
// same KAT discipline as the social reducer and invites.ts. Transport (gateway
// frames) and UI (room list + composer) plug in on top. Rooms are keyed by
// `roomId`; message threading reuses the existing chat reducer keyed by room and
// lands with the UI wiring (T12f-2).

import type { Inbound } from "./protocol";

/** One group room/channel the user is a member of. */
export interface Room {
  roomId: number;
  name: string;
  ownerId: number;
  /** Member account ids; deduped and order-preserving. */
  members: number[];
}

export type RoomAction =
  /** Full room snapshot (created, or roster re-sent on resume) — replaces any prior. */
  | { type: "upsert"; room: Room }
  | { type: "rename"; roomId: number; name: string }
  | { type: "memberAdded"; roomId: number; userId: number }
  | { type: "memberRemoved"; roomId: number; userId: number }
  /** Drop a whole room (deleted server-side, or we left it). */
  | { type: "removeRoom"; roomId: number }
  | { type: "reset" };

function withMember(members: number[], userId: number): number[] {
  return members.includes(userId) ? members : [...members, userId];
}

/** Reduce the room list. A re-sent snapshot replaces the existing room rather
 *  than merging, so the server's roster is always authoritative. */
export function roomsReducer(state: Room[], action: RoomAction): Room[] {
  switch (action.type) {
    case "upsert": {
      const room: Room = { ...action.room, members: action.room.members.filter((m, i, a) => a.indexOf(m) === i) };
      const rest = state.filter((r) => r.roomId !== room.roomId);
      return [...rest, room];
    }
    case "rename":
      return state.map((r) => (r.roomId === action.roomId ? { ...r, name: action.name } : r));
    case "memberAdded":
      return state.map((r) =>
        r.roomId === action.roomId ? { ...r, members: withMember(r.members, action.userId) } : r,
      );
    case "memberRemoved":
      return state.map((r) =>
        r.roomId === action.roomId ? { ...r, members: r.members.filter((m) => m !== action.userId) } : r,
      );
    case "removeRoom":
      return state.filter((r) => r.roomId !== action.roomId);
    case "reset":
      return [];
    default:
      return state;
  }
}

/** Translate a gateway frame into a room action, or null if irrelevant.
 *  `selfId` lets us treat "I was removed" / "I left" as dropping the whole room. */
export function roomActionFromFrame(frame: Inbound, selfId: number): RoomAction | null {
  switch (frame.type) {
    case "room_created":
      return {
        type: "upsert",
        room: {
          roomId: frame.roomId,
          name: frame.name,
          ownerId: frame.ownerId,
          members: frame.members,
        },
      };
    case "room_renamed":
      return { type: "rename", roomId: frame.roomId, name: frame.name };
    case "room_member_added":
      return { type: "memberAdded", roomId: frame.roomId, userId: frame.userId };
    case "room_member_removed":
      // If we're the one removed, the room is gone from our perspective.
      return frame.userId === selfId
        ? { type: "removeRoom", roomId: frame.roomId }
        : { type: "memberRemoved", roomId: frame.roomId, userId: frame.userId };
    case "room_deleted":
      return { type: "removeRoom", roomId: frame.roomId };
    default:
      return null;
  }
}

/** Rooms sorted for display: by name (case-insensitive), then id as a tiebreak. */
export function sortedRooms(state: Room[]): Room[] {
  return [...state].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.roomId - b.roomId,
  );
}

/** Look up one room by id, or null. */
export function roomById(state: Room[], roomId: number): Room | null {
  return state.find((r) => r.roomId === roomId) ?? null;
}

/** Number of rooms (for a badge). */
export function roomCount(state: Room[]): number {
  return state.length;
}

/** Member count of a room (0 if the room is unknown). */
export function roomMemberCount(state: Room[], roomId: number): number {
  return roomById(state, roomId)?.members.length ?? 0;
}

/** Whether `userId` is a member of `roomId`. */
export function isMember(state: Room[], roomId: number, userId: number): boolean {
  return roomById(state, roomId)?.members.includes(userId) ?? false;
}
