// Pure group-room chat state (T12f-2). 1:1 DMs live in reducer.ts keyed by peer;
// room chat is the same idea keyed by roomId. This module is the IO-free core:
// an immutable per-room message log with optimistic local echo and inbound
// reconciliation, unit-tested in roomChat.test.ts. The gateway/UI glue (useRooms)
// plugs in on top and rides the `room_chat`/`room_message` frames (protocol.ts).

/** One message in a room. `messageId` is 0 for an un-acked local echo; the
 *  server `room_message` echo carries the real id and reconciles the echo. */
export interface RoomMessage {
  messageId: number;
  senderId: number;
  text: string;
  timestamp: number;
  /** True until the server echoes this message back (local echo only). */
  pending: boolean;
}

/** Per-room message logs keyed by roomId. */
export type RoomChats = Record<number, RoomMessage[]>;

function logFor(state: RoomChats, roomId: number): RoomMessage[] {
  return state[roomId] ?? [];
}

function replaceLog(state: RoomChats, roomId: number, log: RoomMessage[]): RoomChats {
  return { ...state, [roomId]: log };
}

/** Append an optimistic local echo (no server id yet) for a message I just sent. */
export function localEchoRoom(
  state: RoomChats,
  roomId: number,
  senderId: number,
  text: string,
  timestamp: number,
): RoomChats {
  const echo: RoomMessage = { messageId: 0, senderId, text, timestamp, pending: true };
  return replaceLog(state, roomId, [...logFor(state, roomId), echo]);
}

/** Apply an inbound `room_message`. If it matches a pending local echo from the
 *  same sender with the same text, that echo is reconciled (gets the real id)
 *  rather than duplicated. A message id we've already seen is ignored (idempotent
 *  against resend/resume). */
export function applyRoomMessage(
  state: RoomChats,
  roomId: number,
  msg: { messageId: number; senderId: number; text: string; timestamp: number },
): RoomChats {
  const log = logFor(state, roomId);
  if (msg.messageId > 0 && log.some((m) => m.messageId === msg.messageId)) return state;
  const echoIdx = log.findIndex(
    (m) => m.pending && m.senderId === msg.senderId && m.text === msg.text,
  );
  const settled: RoomMessage = {
    messageId: msg.messageId,
    senderId: msg.senderId,
    text: msg.text,
    timestamp: msg.timestamp,
    pending: false,
  };
  if (echoIdx >= 0) {
    const next = log.slice();
    next[echoIdx] = settled;
    return replaceLog(state, roomId, next);
  }
  return replaceLog(state, roomId, [...log, settled]);
}

/** Drop a room's whole log (e.g. when we leave / it's deleted). */
export function clearRoomChat(state: RoomChats, roomId: number): RoomChats {
  if (!(roomId in state)) return state;
  const next = { ...state };
  delete next[roomId];
  return next;
}

/** A room's messages, oldest-first (stable on equal timestamps by id). */
export function roomMessages(state: RoomChats, roomId: number): RoomMessage[] {
  return [...logFor(state, roomId)].sort((a, b) => a.timestamp - b.timestamp || a.messageId - b.messageId);
}
