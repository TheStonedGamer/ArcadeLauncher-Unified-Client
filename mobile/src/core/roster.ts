// Folding gateway frames into the state the screens render.
//
// A fifth pure core, for the same reason as the others: this is where the real
// decisions live (which conversation a message belongs to, whether a device is
// still there, whether a sign-in push is still worth showing), and none of them
// need a socket to check. `../gateway.ts` owns the WebSocket and does nothing
// but hand frames to `applyFrame`.

import type { DeviceEntry, Frame } from "./social";

export interface Message {
  id: number;
  /** The other person in the conversation, never this phone's own id. */
  peerId: number;
  /** True when this phone sent it. */
  mine: boolean;
  text: string;
  attachmentId: number;
  timestamp: number;
}

export interface GuardPrompt {
  requestId: string;
  prompt: string;
  deviceName: string;
  ip: string;
  /** Absolute epoch-seconds deadline, not the relative window off the wire. */
  expiresAt: number;
}

export interface InstallNotice {
  deviceId: string;
  gameId: string;
  /** "sent" | "refused" | a server-supplied progress word such as "done". */
  status: string;
  message: string;
}

export interface RosterState {
  selfId: number;
  /** userId -> presence word ("online", "offline", "in-game", ...). */
  presence: Record<number, string>;
  /** userId -> what they are playing, when the server says. */
  playing: Record<number, string>;
  /** peer userId -> that conversation's messages, oldest first. */
  conversations: Record<number, Message[]>;
  devices: DeviceEntry[];
  /** The sign-in push awaiting an answer, if any. Only one at a time: a second
   *  request supersedes the first, because the older one is the stale attempt. */
  guard: GuardPrompt | null;
  install: InstallNotice | null;
}

export function emptyRoster(): RosterState {
  return {
    selfId: 0,
    presence: {},
    playing: {},
    conversations: {},
    devices: [],
    guard: null,
    install: null,
  };
}

/** Fold one frame into the state. Returns the same object when nothing changed,
 *  so React can skip a render on the frames that only confirm what we knew. */
export function applyFrame(state: RosterState, frame: Frame, now: number): RosterState {
  switch (frame.type) {
    case "hello":
      return { ...state, selfId: frame.selfId };

    case "presence": {
      if (state.presence[frame.userId] === frame.state && state.playing[frame.userId] === frame.gameTitle) {
        return state;
      }
      return {
        ...state,
        presence: { ...state.presence, [frame.userId]: frame.state },
        playing: { ...state.playing, [frame.userId]: frame.gameTitle },
      };
    }

    case "chat": {
      // The peer is whoever is not us. Working it out here rather than at the
      // socket means an echo of our own sent message files under the same
      // conversation as the reply to it.
      const mine = frame.senderId === state.selfId;
      const peerId = mine ? frame.receiverId : frame.senderId;
      if (peerId === 0) return state;
      const existing = state.conversations[peerId] ?? [];
      // The server replays after a reconnect, so the same id can arrive twice.
      if (frame.messageId > 0 && existing.some((m) => m.id === frame.messageId)) return state;
      const message: Message = {
        id: frame.messageId,
        peerId,
        mine,
        text: frame.text,
        attachmentId: frame.attachmentId,
        timestamp: frame.timestamp || now,
      };
      return {
        ...state,
        conversations: { ...state.conversations, [peerId]: insertByTime(existing, message) },
      };
    }

    case "devices":
      return { ...state, devices: frame.devices };

    case "remote_install_ack":
      return {
        ...state,
        install: {
          deviceId: frame.deviceId,
          gameId: frame.gameId,
          status: frame.ok ? "sent" : "refused",
          message: frame.message || (frame.ok ? "Sent to your PC." : "Your PC would not take it."),
        },
      };

    case "remote_install_result":
      return {
        ...state,
        install: {
          deviceId: frame.deviceId ?? "",
          gameId: frame.gameId,
          status: frame.status,
          message: frame.message,
        },
      };

    case "guard_request":
      return {
        ...state,
        guard: {
          requestId: frame.requestId,
          prompt: frame.prompt,
          deviceName: frame.deviceName,
          ip: frame.ip,
          // Stored absolute so a prompt that arrived while the screen was off
          // is judged against the clock, not against when we happened to look.
          expiresAt: now + (frame.expiresIn > 0 ? frame.expiresIn : 0),
        },
      };

    // Calls are their own machine (core/call.ts) and hold no roster state.
    case "voice_signal":
    case "unknown":
      return state;
  }
  return state;
}

/** Keep a conversation in time order without re-sorting the whole list: replayed
 *  history arrives out of order, but the common case is a message that belongs
 *  on the end. */
function insertByTime(list: Message[], message: Message): Message[] {
  if (list.length === 0 || message.timestamp >= list[list.length - 1].timestamp) {
    return [...list, message];
  }
  const next = [...list, message];
  next.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  return next;
}

/** The guard prompt still worth showing. An expired one is dropped rather than
 *  shown greyed out: answering it would fail, and the sign-in has already
 *  degraded to "type your code". */
export function liveGuard(state: RosterState, now: number): GuardPrompt | null {
  if (!state.guard) return null;
  return state.guard.expiresAt > now ? state.guard : null;
}

/** Seconds left on a prompt, floored at zero for display. */
export function secondsLeft(prompt: GuardPrompt, now: number): number {
  return Math.max(0, Math.floor(prompt.expiresAt - now));
}

/** Everyone with a conversation, most recently active first — the chat list. */
export function conversationOrder(state: RosterState): number[] {
  return Object.keys(state.conversations)
    .map(Number)
    .filter((id) => (state.conversations[id] ?? []).length > 0)
    .sort((a, b) => lastAt(state, b) - lastAt(state, a) || a - b);
}

function lastAt(state: RosterState, peerId: number): number {
  const list = state.conversations[peerId] ?? [];
  return list.length ? list[list.length - 1].timestamp : 0;
}

/** Whether a friend counts as reachable for a call. Anything the server has not
 *  told us about reads as offline: offering a call that cannot connect is worse
 *  than not offering one. */
export function isOnline(state: RosterState, userId: number): boolean {
  const p = state.presence[userId];
  return !!p && p !== "offline";
}
