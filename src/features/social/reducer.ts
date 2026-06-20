// Pure social state reducer. All gateway-driven state transitions live here as
// referentially-transparent functions over `SocialState`, ported from the C++
// SocialManager's frame handlers (HandleGatewayFrame). Keeping this free of any
// transport/IO means the whole chat+presence model is exhaustively unit-testable
// — the same KAT discipline the catalog query/variants logic follows.

import type { Inbound } from "./protocol";
import {
  presenceFromWire,
  type ChatMessage,
  type Conversation,
  type Friend,
} from "./types";

export interface SocialState {
  /** Our own account id, learned from the `hello` frame (0 until then). */
  selfId: number;
  friends: Friend[];
  /** Keyed by peer account id. */
  conversations: Record<number, Conversation>;
}

export const initialSocialState: SocialState = {
  selfId: 0,
  friends: [],
  conversations: {},
};

function emptyConversation(peerId: number): Conversation {
  return { peerId, messages: [], unread: 0, peerTyping: false, peerTypingUntil: 0, readUpTo: 0 };
}

/** Return the conversation for `peerId`, creating an empty one if absent. */
function convOf(state: SocialState, peerId: number): Conversation {
  return state.conversations[peerId] ?? emptyConversation(peerId);
}

/** Immutably replace one conversation. */
function withConv(state: SocialState, conv: Conversation): SocialState {
  return { ...state, conversations: { ...state.conversations, [conv.peerId]: conv } };
}

/** Map over a friend by id, leaving others untouched. */
function mapFriend(state: SocialState, id: number, fn: (f: Friend) => Friend): SocialState {
  let changed = false;
  const friends = state.friends.map((f) => {
    if (f.accountId !== id) return f;
    changed = true;
    return fn(f);
  });
  return changed ? { ...state, friends } : state;
}

/**
 * Merge an authoritative friend list from `/api/social/friends`, preserving the
 * client-local prefs (favorite/nickname/lastInteract) the server never sees.
 */
export function applyFriendList(state: SocialState, incoming: Friend[]): SocialState {
  const prev = new Map(state.friends.map((f) => [f.accountId, f]));
  const friends = incoming.map((f) => {
    const old = prev.get(f.accountId);
    return old
      ? { ...f, favorite: old.favorite, nickname: old.nickname, lastInteract: old.lastInteract }
      : f;
  });
  return { ...state, friends };
}

export function setFavorite(state: SocialState, id: number, favorite: boolean): SocialState {
  return mapFriend(state, id, (f) => ({ ...f, favorite }));
}

export function setNickname(state: SocialState, id: number, nickname: string): SocialState {
  return mapFriend(state, id, (f) => ({ ...f, nickname }));
}

/**
 * Optimistically append a locally-sent message as `pending`. The matching inbound
 * `chat` frame later resolves it (see the chat branch in `applyInbound`). Returns
 * the new state and the echo so callers can scroll to it.
 */
export function localEcho(
  state: SocialState,
  peerId: number,
  text: string,
  now: number,
  replyTo = 0,
  attachmentId = 0,
  attachmentName = "",
): { state: SocialState; message: ChatMessage } {
  const message: ChatMessage = {
    messageId: 0,
    senderId: state.selfId,
    receiverId: peerId,
    text,
    timestamp: Math.floor(now / 1000),
    isRead: true,
    pending: true,
    editedAt: 0,
    deleted: false,
    attachmentId,
    attachmentName,
    reactions: [],
    replyTo,
  };
  const c = convOf(state, peerId);
  const conv = { ...c, messages: [...c.messages, message], peerTyping: false };
  return { state: withConv(state, conv), message };
}

/** Clear a conversation's unread count (user opened/focused it). */
export function markConversationRead(state: SocialState, peerId: number): SocialState {
  const c = state.conversations[peerId];
  if (!c || c.unread === 0) return state;
  return withConv(state, { ...c, unread: 0 });
}

/** Edit a message by id wherever it lives, returning a possibly-new state. */
function editMessage(
  state: SocialState,
  msgId: number,
  fn: (m: ChatMessage) => ChatMessage,
): SocialState {
  let touched = false;
  const conversations: Record<number, Conversation> = {};
  for (const [k, c] of Object.entries(state.conversations)) {
    let convChanged = false;
    const messages = c.messages.map((m) => {
      if (m.messageId !== msgId || msgId === 0) return m;
      convChanged = true;
      touched = true;
      return fn(m);
    });
    conversations[Number(k)] = convChanged ? { ...c, messages } : c;
  }
  return touched ? { ...state, conversations } : state;
}

/**
 * Optimistically apply a local edit of my own message before the server's
 * `chat_edit` echo arrives, so the UI updates instantly. The echo (handled in
 * `applyInbound`) later reconciles with the authoritative `editedAt`.
 */
export function optimisticEdit(state: SocialState, msgId: number, text: string, now: number): SocialState {
  const trimmed = text.trim();
  if (msgId === 0 || trimmed === "") return state;
  return editMessage(state, msgId, (m) => ({ ...m, text: trimmed, editedAt: Math.floor(now / 1000), deleted: false }));
}

/** Optimistically tombstone my own message before the `chat_delete` echo. */
export function optimisticDelete(state: SocialState, msgId: number): SocialState {
  if (msgId === 0) return state;
  return editMessage(state, msgId, (m) => ({ ...m, deleted: true }));
}

/**
 * Toggle one (emoji,user) reaction on a message. `on` true adds it (idempotent —
 * a duplicate is ignored), `on` false removes it. Used both for the server's
 * authoritative `reaction` frame and for optimistic local echoes; replaying the
 * same frame is a no-op so the two can't fight. Returns a possibly-new state.
 */
export function applyReaction(
  state: SocialState,
  msgId: number,
  userId: number,
  emoji: string,
  on: boolean,
): SocialState {
  if (msgId === 0 || emoji === "") return state;
  return editMessage(state, msgId, (m) => {
    const has = m.reactions.some((r) => r.userId === userId && r.emoji === emoji);
    if (on) {
      return has ? m : { ...m, reactions: [...m.reactions, { emoji, userId }] };
    }
    return has
      ? { ...m, reactions: m.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji)) }
      : m;
  });
}

/**
 * Apply one inbound gateway frame, returning the next state. Pure: identical
 * input always yields identical output. `now` is injected (epoch ms) so typing
 * timeouts are deterministic in tests.
 */
export function applyInbound(state: SocialState, msg: Inbound, now: number): SocialState {
  switch (msg.type) {
    case "hello":
      return { ...state, selfId: msg.selfId };

    case "presence":
      return mapFriend(state, msg.userId, (f) => ({
        ...f,
        presence: presenceFromWire(msg.state),
        currentGameId: msg.gameId,
        currentGameTitle: msg.gameTitle,
        statusText: msg.statusText,
        lastOnline: msg.state !== "offline" ? Math.floor(now / 1000) : f.lastOnline,
      }));

    case "typing": {
      const c = convOf(state, msg.fromId);
      return withConv(state, { ...c, peerTyping: true, peerTypingUntil: now + 6000 });
    }

    case "chat": {
      const self = state.selfId;
      const peer = msg.senderId === self ? msg.receiverId : msg.senderId;
      const incoming: ChatMessage = {
        messageId: msg.messageId,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        text: msg.text,
        timestamp: msg.timestamp,
        isRead: msg.senderId === self,
        pending: false,
        editedAt: 0,
        deleted: false,
        attachmentId: msg.attachmentId,
        attachmentName: "",
        reactions: [],
        replyTo: msg.replyTo,
      };
      const c = convOf(state, peer);
      // Resolve a pending echo (matched on sender+text+attachment) if present,
      // else append. Only a genuinely new inbound message bumps unread.
      let replaced = false;
      const messages = c.messages.map((m) => {
        if (
          !replaced &&
          m.pending &&
          m.senderId === incoming.senderId &&
          m.text === incoming.text &&
          m.attachmentId === incoming.attachmentId
        ) {
          replaced = true;
          return { ...incoming, attachmentName: m.attachmentName || incoming.attachmentName, reactions: m.reactions };
        }
        return m;
      });
      let unread = c.unread;
      if (!replaced) {
        messages.push(incoming);
        if (msg.senderId !== self) unread += 1;
      }
      return withConv(state, { ...c, messages, unread, peerTyping: false });
    }

    case "read": {
      const self = state.selfId;
      const c = convOf(state, msg.readerId);
      const readUpTo = Math.max(c.readUpTo, msg.upToId);
      const messages = c.messages.map((m) =>
        m.senderId === self && m.messageId !== 0 && m.messageId <= msg.upToId && !m.isRead
          ? { ...m, isRead: true }
          : m,
      );
      return withConv(state, { ...c, readUpTo, messages });
    }

    case "chat_edit":
      return editMessage(state, msg.messageId, (m) => ({
        ...m,
        text: msg.text,
        editedAt: msg.editedAt || Math.floor(now / 1000),
        deleted: false,
      }));

    case "chat_delete":
      return editMessage(state, msg.messageId, (m) => ({ ...m, deleted: true }));

    case "reaction":
      return applyReaction(state, msg.messageId, msg.userId, msg.emoji, msg.on);

    // friend_* frames mean "re-pull /api/social/friends" — the hook handles the
    // REST refresh; the pure reducer has nothing to mutate. pong/unknown carry no
    // T3a state. All no-ops:
    case "friend_request":
    case "friend_accepted":
    case "friend_removed":
    case "voice_signal": // handled by useVoice, not chat state
    case "game_invite": // handled by the invites reducer, not chat state
    case "game_invite_cancel":
    case "room_created": // handled by the rooms reducer, not chat state
    case "room_renamed":
    case "room_member_added":
    case "room_member_removed":
    case "room_deleted":
    case "pong":
    case "unknown":
      return state;
  }
}
