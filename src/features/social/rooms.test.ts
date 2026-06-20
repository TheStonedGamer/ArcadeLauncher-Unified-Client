import { describe, it, expect } from "vitest";
import type { Inbound } from "./protocol";
import {
  type Room,
  roomsReducer,
  roomActionFromFrame,
  sortedRooms,
  roomById,
  roomCount,
  roomMemberCount,
  isMember,
} from "./rooms";

const room = (roomId: number, name: string, ownerId: number, members: number[]): Room => ({
  roomId,
  name,
  ownerId,
  members,
});

describe("roomsReducer", () => {
  it("upserts a new room", () => {
    const s = roomsReducer([], { type: "upsert", room: room(5, "Squad", 2, [2, 3]) });
    expect(s).toHaveLength(1);
    expect(s[0].name).toBe("Squad");
    expect(s[0].members).toEqual([2, 3]);
  });

  it("replaces a room on re-sent snapshot (server roster is authoritative)", () => {
    const s0 = roomsReducer([], { type: "upsert", room: room(5, "Squad", 2, [2, 3]) });
    const s1 = roomsReducer(s0, { type: "upsert", room: room(5, "Crew", 2, [2, 9]) });
    expect(s1).toHaveLength(1);
    expect(s1[0].name).toBe("Crew");
    expect(s1[0].members).toEqual([2, 9]);
  });

  it("dedupes members in an upserted snapshot", () => {
    const s = roomsReducer([], { type: "upsert", room: room(5, "Squad", 2, [2, 2, 3, 3]) });
    expect(s[0].members).toEqual([2, 3]);
  });

  it("renames only the matching room", () => {
    const s0 = [room(5, "Squad", 2, [2]), room(6, "Other", 2, [2])];
    const s1 = roomsReducer(s0, { type: "rename", roomId: 5, name: "Crew" });
    expect(roomById(s1, 5)?.name).toBe("Crew");
    expect(roomById(s1, 6)?.name).toBe("Other");
  });

  it("adds a member without duplicating", () => {
    const s0 = [room(5, "Squad", 2, [2, 3])];
    const s1 = roomsReducer(s0, { type: "memberAdded", roomId: 5, userId: 9 });
    expect(roomById(s1, 5)?.members).toEqual([2, 3, 9]);
    const s2 = roomsReducer(s1, { type: "memberAdded", roomId: 5, userId: 9 });
    expect(roomById(s2, 5)?.members).toEqual([2, 3, 9]);
  });

  it("removes a member", () => {
    const s0 = [room(5, "Squad", 2, [2, 3, 9])];
    const s1 = roomsReducer(s0, { type: "memberRemoved", roomId: 5, userId: 3 });
    expect(roomById(s1, 5)?.members).toEqual([2, 9]);
  });

  it("removes a whole room", () => {
    const s0 = [room(5, "Squad", 2, [2]), room(6, "Other", 2, [2])];
    const s1 = roomsReducer(s0, { type: "removeRoom", roomId: 5 });
    expect(s1.map((r) => r.roomId)).toEqual([6]);
  });

  it("reset clears all rooms", () => {
    const s0 = [room(5, "Squad", 2, [2])];
    expect(roomsReducer(s0, { type: "reset" })).toEqual([]);
  });
});

describe("roomActionFromFrame", () => {
  it("maps room_created to an upsert", () => {
    const f: Inbound = { type: "room_created", roomId: 5, name: "Squad", ownerId: 2, members: [2, 3] };
    expect(roomActionFromFrame(f, 2)).toEqual({
      type: "upsert",
      room: { roomId: 5, name: "Squad", ownerId: 2, members: [2, 3] },
    });
  });

  it("maps room_renamed and room_member_added", () => {
    expect(roomActionFromFrame({ type: "room_renamed", roomId: 5, name: "Crew" }, 2)).toEqual({
      type: "rename",
      roomId: 5,
      name: "Crew",
    });
    expect(roomActionFromFrame({ type: "room_member_added", roomId: 5, userId: 9 }, 2)).toEqual({
      type: "memberAdded",
      roomId: 5,
      userId: 9,
    });
  });

  it("treats being removed myself as dropping the room", () => {
    const f: Inbound = { type: "room_member_removed", roomId: 5, userId: 2 };
    expect(roomActionFromFrame(f, 2)).toEqual({ type: "removeRoom", roomId: 5 });
  });

  it("treats another user's removal as a member drop", () => {
    const f: Inbound = { type: "room_member_removed", roomId: 5, userId: 9 };
    expect(roomActionFromFrame(f, 2)).toEqual({ type: "memberRemoved", roomId: 5, userId: 9 });
  });

  it("maps room_deleted to removeRoom", () => {
    expect(roomActionFromFrame({ type: "room_deleted", roomId: 5 }, 2)).toEqual({
      type: "removeRoom",
      roomId: 5,
    });
  });

  it("returns null for unrelated frames", () => {
    expect(roomActionFromFrame({ type: "pong" }, 2)).toBeNull();
  });
});

describe("selectors", () => {
  const rooms = [room(6, "beta", 2, [2, 3]), room(5, "Alpha", 2, [2, 3, 9]), room(7, "alpha", 2, [2])];

  it("sorts case-insensitively by name then id", () => {
    expect(sortedRooms(rooms).map((r) => r.roomId)).toEqual([5, 7, 6]);
  });

  it("counts rooms and members", () => {
    expect(roomCount(rooms)).toBe(3);
    expect(roomMemberCount(rooms, 5)).toBe(3);
    expect(roomMemberCount(rooms, 999)).toBe(0);
  });

  it("reports membership", () => {
    expect(isMember(rooms, 5, 9)).toBe(true);
    expect(isMember(rooms, 5, 42)).toBe(false);
    expect(isMember(rooms, 999, 2)).toBe(false);
  });
});
