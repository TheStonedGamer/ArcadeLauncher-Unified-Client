import { describe, expect, it } from "vitest";
import {
  applyFriendList,
  applyInbound,
  applyReaction,
  initialSocialState,
  localEcho,
  markConversationRead,
  optimisticDelete,
  optimisticEdit,
  setFavorite,
  setNickname,
  type SocialState,
} from "./reducer";
import type { Friend } from "./types";

const NOW = 1_700_000_000_000;

function friend(over: Partial<Friend> = {}): Friend {
  return {
    accountId: 2,
    username: "alice",
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

/** A state where we are account 42 and alice (2) is an accepted friend. */
function baseState(): SocialState {
  return applyFriendList({ ...initialSocialState, selfId: 42 }, [friend()]);
}

describe("hello + friend list", () => {
  it("hello sets our own id", () => {
    const s = applyInbound(initialSocialState, { type: "hello", selfId: 42 }, NOW);
    expect(s.selfId).toBe(42);
  });

  it("applyFriendList preserves client-local prefs across a re-pull", () => {
    let s = baseState();
    s = setFavorite(s, 2, true);
    s = setNickname(s, 2, "Al");
    // Server re-pull carries no favorite/nickname; they must survive.
    s = applyFriendList(s, [friend({ presence: "online" })]);
    expect(s.friends[0]).toMatchObject({ favorite: true, nickname: "Al", presence: "online" });
  });
});

describe("presence", () => {
  it("updates a friend's presence + game and stamps lastOnline", () => {
    const s = applyInbound(baseState(), {
      type: "presence",
      userId: 2,
      state: "ingame",
      gameId: "g1",
      gameTitle: "Crystalis",
    }, NOW);
    expect(s.friends[0]).toMatchObject({
      presence: "ingame",
      currentGameId: "g1",
      currentGameTitle: "Crystalis",
      lastOnline: Math.floor(NOW / 1000),
    });
  });

  it("going offline does not bump lastOnline", () => {
    let s = applyInbound(baseState(), { type: "presence", userId: 2, state: "online", gameId: "", gameTitle: "" }, NOW);
    const onlineStamp = s.friends[0].lastOnline;
    s = applyInbound(s, { type: "presence", userId: 2, state: "offline", gameId: "", gameTitle: "" }, NOW + 5000);
    expect(s.friends[0].lastOnline).toBe(onlineStamp);
  });
});

describe("chat", () => {
  it("inbound message from a peer appends and bumps unread", () => {
    const s = applyInbound(baseState(), {
      type: "chat",
      messageId: 7,
      senderId: 2,
      receiverId: 42,
      text: "hi",
      attachmentId: 0,
      replyTo: 0,
      timestamp: 1,
    }, NOW);
    const conv = s.conversations[2];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ messageId: 7, text: "hi", isRead: false, pending: false });
    expect(conv.unread).toBe(1);
  });

  it("a local echo is resolved by its acked frame (no duplicate, no unread)", () => {
    const echo = localEcho(baseState(), 2, "yo", NOW);
    expect(echo.message.pending).toBe(true);
    const s = applyInbound(echo.state, {
      type: "chat",
      messageId: 8,
      senderId: 42,
      receiverId: 2,
      text: "yo",
      attachmentId: 0,
      replyTo: 0,
      timestamp: 1,
    }, NOW);
    const conv = s.conversations[2];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ messageId: 8, pending: false });
    expect(conv.unread).toBe(0);
  });

  it("an inbound chat clears the peer-typing indicator", () => {
    let s = applyInbound(baseState(), { type: "typing", fromId: 2 }, NOW);
    expect(s.conversations[2].peerTyping).toBe(true);
    s = applyInbound(s, { type: "chat", messageId: 9, senderId: 2, receiverId: 42, text: "x", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    expect(s.conversations[2].peerTyping).toBe(false);
  });

  it("inbound chat carries replyTo onto the message", () => {
    const s = applyInbound(baseState(), { type: "chat", messageId: 7, senderId: 2, receiverId: 42, text: "re", attachmentId: 0, replyTo: 3, timestamp: 1 }, NOW);
    expect(s.conversations[2].messages[0].replyTo).toBe(3);
  });

  it("localEcho stamps a reply target on the optimistic message", () => {
    const echo = localEcho(baseState(), 2, "yo", NOW, 5);
    expect(echo.message.replyTo).toBe(5);
  });

  it("localEcho defaults replyTo to 0 when omitted", () => {
    const echo = localEcho(baseState(), 2, "yo", NOW);
    expect(echo.message.replyTo).toBe(0);
  });

  it("localEcho stamps an attachment onto the optimistic message", () => {
    const echo = localEcho(baseState(), 2, "", NOW, 0, 88, "shot.png");
    expect(echo.message).toMatchObject({ attachmentId: 88, attachmentName: "shot.png" });
  });

  it("an acked attachment frame resolves its pending echo (no duplicate)", () => {
    const echo = localEcho(baseState(), 2, "", NOW, 0, 88, "shot.png");
    const s = applyInbound(echo.state, {
      type: "chat",
      messageId: 12,
      senderId: 42,
      receiverId: 2,
      text: "",
      attachmentId: 88,
      replyTo: 0,
      timestamp: 1,
    }, NOW);
    const conv = s.conversations[2];
    expect(conv.messages).toHaveLength(1);
    // The acked message keeps the locally-known filename and is no longer pending.
    expect(conv.messages[0]).toMatchObject({ messageId: 12, attachmentId: 88, attachmentName: "shot.png", pending: false });
  });

  it("markConversationRead clears unread", () => {
    let s = applyInbound(baseState(), { type: "chat", messageId: 7, senderId: 2, receiverId: 42, text: "hi", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = markConversationRead(s, 2);
    expect(s.conversations[2].unread).toBe(0);
  });
});

describe("read receipts", () => {
  it("advances readUpTo so the UI can mark outgoing messages read up to that id", () => {
    // Three acked outgoing messages (ids 8, 10, 12).
    let s = baseState();
    for (const id of [8, 10, 12]) {
      s = applyInbound(s, { type: "chat", messageId: id, senderId: 42, receiverId: 2, text: `m${id}`, attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    }
    // Peer read up to id 10 — the read marker is readUpTo (per the C++ client,
    // outgoing messages carry isRead=true from creation).
    s = applyInbound(s, { type: "read", readerId: 2, upToId: 10 }, NOW);
    const conv = s.conversations[2];
    expect(conv.readUpTo).toBe(10);
    expect(conv.messages.filter((m) => m.messageId <= conv.readUpTo)).toHaveLength(2);
    // A later, lower upTo never regresses the marker.
    s = applyInbound(s, { type: "read", readerId: 2, upToId: 5 }, NOW);
    expect(s.conversations[2].readUpTo).toBe(10);
  });
});

describe("edit + delete", () => {
  it("chat_edit rewrites text and stamps editedAt", () => {
    let s = applyInbound(baseState(), { type: "chat", messageId: 7, senderId: 2, receiverId: 42, text: "old", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = applyInbound(s, { type: "chat_edit", messageId: 7, text: "new", editedAt: 999 }, NOW);
    expect(s.conversations[2].messages[0]).toMatchObject({ text: "new", editedAt: 999 });
  });

  it("chat_delete tombstones the message", () => {
    let s = applyInbound(baseState(), { type: "chat", messageId: 7, senderId: 2, receiverId: 42, text: "secret", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = applyInbound(s, { type: "chat_delete", messageId: 7 }, NOW);
    expect(s.conversations[2].messages[0].deleted).toBe(true);
  });

  it("optimisticEdit updates my message text and stamps editedAt before the echo", () => {
    let s = applyInbound(baseState(), { type: "chat", messageId: 9, senderId: 42, receiverId: 2, text: "typo", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = optimisticEdit(s, 9, "  fixed  ", NOW);
    expect(s.conversations[2].messages[0]).toMatchObject({ text: "fixed", deleted: false });
    expect(s.conversations[2].messages[0].editedAt).toBeGreaterThan(0);
  });

  it("optimisticEdit ignores empty text and unsaved (id 0) messages", () => {
    const s = applyInbound(baseState(), { type: "chat", messageId: 9, senderId: 42, receiverId: 2, text: "keep", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    expect(optimisticEdit(s, 9, "   ", NOW)).toBe(s);
    expect(optimisticEdit(s, 0, "x", NOW)).toBe(s);
  });

  it("optimisticDelete tombstones my message before the echo", () => {
    let s = applyInbound(baseState(), { type: "chat", messageId: 9, senderId: 42, receiverId: 2, text: "oops", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
    s = optimisticDelete(s, 9);
    expect(s.conversations[2].messages[0].deleted).toBe(true);
  });
});

describe("reactions", () => {
  function withMsg(): SocialState {
    return applyInbound(baseState(), { type: "chat", messageId: 7, senderId: 2, receiverId: 42, text: "hi", attachmentId: 0, replyTo: 0, timestamp: 1 }, NOW);
  }

  it("a reaction frame adds an (emoji,user) entry", () => {
    const s = applyReaction(withMsg(), 7, 42, "👍", true);
    expect(s.conversations[2].messages[0].reactions).toEqual([{ emoji: "👍", userId: 42 }]);
  });

  it("toggling the same reaction on is idempotent", () => {
    let s = applyReaction(withMsg(), 7, 42, "👍", true);
    s = applyReaction(s, 7, 42, "👍", true);
    expect(s.conversations[2].messages[0].reactions).toHaveLength(1);
  });

  it("off removes only the matching (emoji,user)", () => {
    let s = applyReaction(withMsg(), 7, 42, "👍", true);
    s = applyReaction(s, 7, 2, "👍", true);
    s = applyReaction(s, 7, 42, "👍", false);
    expect(s.conversations[2].messages[0].reactions).toEqual([{ emoji: "👍", userId: 2 }]);
  });

  it("removing an absent reaction leaves the list empty", () => {
    const s = applyReaction(withMsg(), 7, 42, "❤️", false);
    expect(s.conversations[2].messages[0].reactions).toEqual([]);
  });

  it("ignores msgId 0 and empty emoji", () => {
    const s = withMsg();
    expect(applyReaction(s, 0, 42, "👍", true)).toBe(s);
    expect(applyReaction(s, 7, 42, "", true)).toBe(s);
  });

  it("the inbound reaction frame routes through applyReaction", () => {
    const s = applyInbound(withMsg(), { type: "reaction", messageId: 7, userId: 2, emoji: "🎉", on: true }, NOW);
    expect(s.conversations[2].messages[0].reactions).toEqual([{ emoji: "🎉", userId: 2 }]);
  });
});

describe("no-op frames", () => {
  it("friend_* / pong / unknown return the same state reference", () => {
    const s = baseState();
    for (const msg of [
      { type: "friend_request", userId: 5 },
      { type: "friend_accepted", userId: 5 },
      { type: "friend_removed", userId: 5 },
      { type: "pong" },
      { type: "unknown" },
    ] as const) {
      expect(applyInbound(s, msg, NOW)).toBe(s);
    }
  });
});
