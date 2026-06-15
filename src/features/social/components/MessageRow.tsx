// One chat message line. Renders deleted tombstones, an "(edited)" marker, the
// pending (un-acked) state, and a "Read" marker for my own messages the peer has
// seen (messageId <= conversation.readUpTo).

import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  mine: boolean;
  read: boolean;
}

function clockTime(epochSecs: number): string {
  if (!epochSecs) return "";
  return new Date(epochSecs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageRow({ message, mine, read }: Props) {
  const cls = `msg${mine ? " msg--mine" : ""}${message.pending ? " msg--pending" : ""}`;
  return (
    <div className={cls}>
      <div className="msg__bubble">
        {message.deleted ? (
          <span className="msg__deleted">message deleted</span>
        ) : (
          <span className="msg__text">{message.text}</span>
        )}
        {message.editedAt > 0 && !message.deleted && <span className="msg__edited">(edited)</span>}
      </div>
      <div className="msg__meta">
        <span className="msg__time">{clockTime(message.timestamp)}</span>
        {message.pending && <span className="msg__status">sending…</span>}
        {mine && !message.pending && read && <span className="msg__status">Read</span>}
      </div>
    </div>
  );
}
