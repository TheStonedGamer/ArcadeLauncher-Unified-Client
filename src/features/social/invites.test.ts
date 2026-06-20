import { describe, it, expect } from "vitest";
import type { Inbound } from "./protocol";
import {
  type GameInvite,
  INVITE_TTL_MS,
  invitesReducer,
  inviteActionFromFrame,
  sortedInvites,
  inviteCount,
  joinTarget,
} from "./invites";

const inv = (inviteId: number, fromId: number, gameId: string, receivedAt = 1000): GameInvite => ({
  inviteId,
  fromId,
  gameId,
  gameTitle: gameId.toUpperCase(),
  receivedAt,
});

describe("invitesReducer", () => {
  it("adds a received invite", () => {
    const s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    expect(s).toHaveLength(1);
    expect(s[0].inviteId).toBe(1);
  });

  it("replaces a prior invite with the same id", () => {
    const s0 = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    const s1 = invitesReducer(s0, { type: "received", invite: inv(1, 2, "g1", 2000) });
    expect(s1).toHaveLength(1);
    expect(s1[0].receivedAt).toBe(2000);
  });

  it("re-invite from same sender+game refreshes, not duplicates", () => {
    const s0 = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    const s1 = invitesReducer(s0, { type: "received", invite: inv(9, 2, "g1", 2000) });
    expect(s1).toHaveLength(1);
    expect(s1[0].inviteId).toBe(9);
  });

  it("keeps distinct sender/game invites", () => {
    let s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    s = invitesReducer(s, { type: "received", invite: inv(2, 3, "g1") });
    s = invitesReducer(s, { type: "received", invite: inv(3, 2, "g2") });
    expect(s).toHaveLength(3);
  });

  it("removes by id", () => {
    let s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    s = invitesReducer(s, { type: "remove", inviteId: 1 });
    expect(s).toHaveLength(0);
  });

  it("clears all invites from a sender", () => {
    let s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    s = invitesReducer(s, { type: "received", invite: inv(2, 2, "g2") });
    s = invitesReducer(s, { type: "received", invite: inv(3, 4, "g3") });
    s = invitesReducer(s, { type: "clearFrom", fromId: 2 });
    expect(s.map((i) => i.inviteId)).toEqual([3]);
  });

  it("prunes stale invites past the TTL", () => {
    let s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1", 1000) });
    s = invitesReducer(s, { type: "received", invite: inv(2, 3, "g2", 1000 + INVITE_TTL_MS - 1) });
    s = invitesReducer(s, { type: "prune", now: 1000 + INVITE_TTL_MS });
    // First is exactly TTL old → pruned; second is younger → kept.
    expect(s.map((i) => i.inviteId)).toEqual([2]);
  });

  it("reset empties the list", () => {
    let s = invitesReducer([], { type: "received", invite: inv(1, 2, "g1") });
    s = invitesReducer(s, { type: "reset" });
    expect(s).toHaveLength(0);
  });
});

describe("inviteActionFromFrame", () => {
  it("maps a game_invite frame to received", () => {
    const frame: Inbound = {
      type: "game_invite",
      inviteId: 7,
      fromId: 3,
      gameId: "g1",
      gameTitle: "Crystalis",
      timestamp: 123,
    };
    const a = inviteActionFromFrame(frame, 5000);
    expect(a).toEqual({
      type: "received",
      invite: { inviteId: 7, fromId: 3, gameId: "g1", gameTitle: "Crystalis", receivedAt: 5000 },
    });
  });

  it("maps a cancel frame to remove", () => {
    expect(inviteActionFromFrame({ type: "game_invite_cancel", inviteId: 7 }, 0)).toEqual({
      type: "remove",
      inviteId: 7,
    });
  });

  it("maps friend_removed to clearFrom", () => {
    expect(inviteActionFromFrame({ type: "friend_removed", userId: 4 }, 0)).toEqual({
      type: "clearFrom",
      fromId: 4,
    });
  });

  it("ignores unrelated frames", () => {
    expect(inviteActionFromFrame({ type: "pong" }, 0)).toBeNull();
  });
});

describe("selectors", () => {
  it("sorts newest-first, tie-break by id desc, without mutating", () => {
    const input = [inv(1, 2, "g1", 100), inv(2, 3, "g2", 300), inv(3, 4, "g3", 200)];
    const out = sortedInvites(input);
    expect(out.map((i) => i.inviteId)).toEqual([2, 3, 1]);
    expect(input[0].inviteId).toBe(1);
  });

  it("counts pending invites", () => {
    expect(inviteCount([inv(1, 2, "g1"), inv(2, 3, "g2")])).toBe(2);
  });

  it("resolves a join target by id", () => {
    const s = [inv(1, 2, "zelda")];
    expect(joinTarget(s, 1)).toBe("zelda");
    expect(joinTarget(s, 99)).toBeNull();
  });
});
