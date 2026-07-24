import { describe, expect, it } from "vitest";
import { friendNames, friendPresence, parseFriends, presenceOnline } from "./friends";

describe("parseFriends", () => {
  it("maps the server's camelCase fields the phone renders", () => {
    const list = parseFriends({
      friends: [
        {
          accountId: 7,
          username: "ada",
          presence: "online",
          relation: "accepted",
          currentGameTitle: "Portal",
          statusText: "brb",
        },
      ],
    });
    expect(list).toEqual([
      { id: 7, username: "ada", presence: "online", gameTitle: "Portal", statusText: "brb" },
    ]);
  });

  it("keeps only accepted relationships", () => {
    const list = parseFriends({
      friends: [
        { accountId: 1, username: "friend", relation: "accepted" },
        { accountId: 2, username: "pending", relation: "request_received" },
        { accountId: 3, username: "blocked", relation: "blocked" },
      ],
    });
    expect(list.map((f) => f.id)).toEqual([1]);
  });

  it("treats a missing relation as an accepted legacy row", () => {
    const list = parseFriends({ friends: [{ accountId: 5, username: "legacy" }] });
    expect(list).toHaveLength(1);
    expect(list[0].presence).toBe("offline");
  });

  it("sorts by username and drops junk rows", () => {
    const list = parseFriends({
      friends: [
        { accountId: 2, username: "zoe" },
        { accountId: 1, username: "amy" },
        { accountId: 0, username: "noid" },
        null,
        "nonsense",
      ],
    });
    expect(list.map((f) => f.username)).toEqual(["amy", "zoe"]);
  });

  it("returns empty for a malformed or missing body", () => {
    expect(parseFriends(null)).toEqual([]);
    expect(parseFriends({})).toEqual([]);
    expect(parseFriends({ friends: "no" })).toEqual([]);
  });
});

describe("friendNames / friendPresence", () => {
  const list = parseFriends({
    friends: [
      { accountId: 1, username: "amy", presence: "online" },
      { accountId: 2, username: "bob", presence: "offline" },
    ],
  });

  it("indexes names by id", () => {
    expect(friendNames(list)).toEqual({ 1: "amy", 2: "bob" });
  });

  it("seeds presence by id, to be overridden by live frames", () => {
    expect(friendPresence(list)).toEqual({ 1: "online", 2: "offline" });
  });
});

describe("presenceOnline", () => {
  it("counts anything but offline/invisible/unset as reachable", () => {
    expect(presenceOnline("online")).toBe(true);
    expect(presenceOnline("ingame")).toBe(true);
    expect(presenceOnline("away")).toBe(true);
    expect(presenceOnline("offline")).toBe(false);
    expect(presenceOnline("invisible")).toBe(false);
    expect(presenceOnline(undefined)).toBe(false);
  });
});
