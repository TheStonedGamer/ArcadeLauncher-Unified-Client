import { describe, expect, it } from "vitest";
import { applyFriendList, applyInbound, initialSocialState, type SocialState } from "./reducer";
import { displayName, incomingRequests, onlineCount, sortedFriends, totalUnread } from "./selectors";
import type { Friend } from "./types";

const NOW = 1_700_000_000_000;

function friend(over: Partial<Friend>): Friend {
  return {
    accountId: 0,
    username: "",
    presence: "offline",
    relation: "accepted",
    currentGameId: "",
    currentGameTitle: "",
    lastOnline: 0,
    favorite: false,
    nickname: "",
    lastInteract: 0,
    ...over,
  };
}

function withFriends(friends: Friend[]): SocialState {
  return applyFriendList({ ...initialSocialState, selfId: 42 }, friends);
}

describe("displayName", () => {
  it("prefers a non-empty nickname over username", () => {
    expect(displayName(friend({ username: "alice", nickname: "Al" }))).toBe("Al");
    expect(displayName(friend({ username: "bob", nickname: "  " }))).toBe("bob");
  });
});

describe("sortedFriends", () => {
  it("pins favorites, then orders by presence, recency, name", () => {
    const s = withFriends([
      friend({ accountId: 1, username: "zoe", presence: "offline" }),
      friend({ accountId: 2, username: "amy", presence: "online" }),
      friend({ accountId: 3, username: "fav", presence: "offline", favorite: true }),
      friend({ accountId: 4, username: "gamer", presence: "ingame" }),
    ]);
    expect(sortedFriends(s).map((f) => f.accountId)).toEqual([3, 4, 2, 1]);
  });

  it("breaks an online tie by most recent interaction", () => {
    const s = withFriends([
      friend({ accountId: 1, username: "a", presence: "online", lastInteract: 100 }),
      friend({ accountId: 2, username: "b", presence: "online", lastInteract: 500 }),
    ]);
    expect(sortedFriends(s).map((f) => f.accountId)).toEqual([2, 1]);
  });

  it("excludes non-accepted relations", () => {
    const s = withFriends([
      friend({ accountId: 1, username: "a", relation: "accepted" }),
      friend({ accountId: 2, username: "b", relation: "request_received" }),
    ]);
    expect(sortedFriends(s).map((f) => f.accountId)).toEqual([1]);
  });
});

describe("requests + counts", () => {
  it("incomingRequests lists request_received only", () => {
    const s = withFriends([
      friend({ accountId: 1, relation: "accepted" }),
      friend({ accountId: 2, relation: "request_received", username: "pat" }),
    ]);
    expect(incomingRequests(s).map((f) => f.accountId)).toEqual([2]);
  });

  it("onlineCount counts reachable accepted friends", () => {
    const s = withFriends([
      friend({ accountId: 1, presence: "online" }),
      friend({ accountId: 2, presence: "invisible" }),
      friend({ accountId: 3, presence: "ingame" }),
      friend({ accountId: 4, presence: "offline" }),
    ]);
    expect(onlineCount(s)).toBe(2);
  });

  it("totalUnread sums conversation unread counts", () => {
    let s = withFriends([friend({ accountId: 2 }), friend({ accountId: 3 })]);
    s = applyInbound(s, { type: "chat", messageId: 1, senderId: 2, receiverId: 42, text: "a", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = applyInbound(s, { type: "chat", messageId: 2, senderId: 3, receiverId: 42, text: "b", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = applyInbound(s, { type: "chat", messageId: 3, senderId: 3, receiverId: 42, text: "c", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    expect(totalUnread(s)).toBe(3);
  });
});
