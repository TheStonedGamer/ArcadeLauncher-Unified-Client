import { describe, it, expect } from "vitest";
import {
  applyRoomMessage,
  clearRoomChat,
  localEchoRoom,
  roomMessages,
  type RoomChats,
} from "./roomChat";

const m = (messageId: number, senderId: number, text: string, timestamp: number) => ({
  messageId,
  senderId,
  text,
  timestamp,
});

describe("localEchoRoom", () => {
  it("appends a pending echo with no server id", () => {
    const s = localEchoRoom({}, 5, 1, "hi", 100);
    expect(roomMessages(s, 5)).toEqual([{ messageId: 0, senderId: 1, text: "hi", timestamp: 100, pending: true }]);
  });
  it("keeps other rooms untouched", () => {
    const s = localEchoRoom({ 9: [m(1, 2, "x", 1) as never] } as RoomChats, 5, 1, "hi", 100);
    expect(roomMessages(s, 9).length).toBe(1);
    expect(roomMessages(s, 5).length).toBe(1);
  });
});

describe("applyRoomMessage", () => {
  it("appends an inbound message", () => {
    const s = applyRoomMessage({}, 5, m(7, 3, "gg", 200));
    expect(roomMessages(s, 5)).toEqual([{ messageId: 7, senderId: 3, text: "gg", timestamp: 200, pending: false }]);
  });
  it("reconciles a matching pending echo instead of duplicating", () => {
    let s = localEchoRoom({}, 5, 1, "hi", 100);
    s = applyRoomMessage(s, 5, m(7, 1, "hi", 105));
    const log = roomMessages(s, 5);
    expect(log.length).toBe(1);
    expect(log[0]).toEqual({ messageId: 7, senderId: 1, text: "hi", timestamp: 105, pending: false });
  });
  it("ignores a duplicate message id (resume/resend)", () => {
    let s = applyRoomMessage({}, 5, m(7, 3, "gg", 200));
    s = applyRoomMessage(s, 5, m(7, 3, "gg", 200));
    expect(roomMessages(s, 5).length).toBe(1);
  });
  it("does not reconcile an echo from a different sender", () => {
    let s = localEchoRoom({}, 5, 1, "hi", 100);
    s = applyRoomMessage(s, 5, m(7, 2, "hi", 105));
    expect(roomMessages(s, 5).length).toBe(2);
  });
});

describe("roomMessages", () => {
  it("sorts oldest-first by timestamp then id", () => {
    let s: RoomChats = {};
    s = applyRoomMessage(s, 5, m(3, 1, "c", 300));
    s = applyRoomMessage(s, 5, m(1, 1, "a", 100));
    s = applyRoomMessage(s, 5, m(2, 1, "b", 200));
    expect(roomMessages(s, 5).map((x) => x.text)).toEqual(["a", "b", "c"]);
  });
  it("returns [] for an unknown room", () => {
    expect(roomMessages({}, 99)).toEqual([]);
  });
});

describe("clearRoomChat", () => {
  it("drops a room's log", () => {
    let s = applyRoomMessage({}, 5, m(7, 3, "gg", 200));
    s = clearRoomChat(s, 5);
    expect(roomMessages(s, 5)).toEqual([]);
  });
  it("is a no-op for an unknown room (same ref)", () => {
    const s = applyRoomMessage({}, 5, m(7, 3, "gg", 200));
    expect(clearRoomChat(s, 99)).toBe(s);
  });
});
