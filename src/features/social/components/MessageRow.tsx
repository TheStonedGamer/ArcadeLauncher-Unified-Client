// One chat message line. Renders deleted tombstones, an "(edited)" marker, the
// pending (un-acked) state, and a "Read" marker for my own messages the peer has
// seen (messageId <= conversation.readUpTo). My own non-deleted, acked messages
// get hover Edit/Delete actions (T9a); Edit swaps the bubble for an inline input.

import { useState } from "react";
import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  mine: boolean;
  read: boolean;
  /** Save an edit to this message (absent → no edit affordance). */
  onEdit?: (msgId: number, text: string) => void;
  /** Delete this message (absent → no delete affordance). */
  onDelete?: (msgId: number) => void;
}

function clockTime(epochSecs: number): string {
  if (!epochSecs) return "";
  return new Date(epochSecs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageRow({ message, mine, read, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);

  const cls = `msg${mine ? " msg--mine" : ""}${message.pending ? " msg--pending" : ""}`;
  // Only my own saved (id != 0), non-deleted messages can be mutated.
  const canMutate = mine && !message.pending && !message.deleted && message.messageId !== 0;

  const startEdit = () => {
    setDraft(message.text);
    setEditing(true);
  };
  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== message.text) onEdit?.(message.messageId, trimmed);
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div className={cls}>
      <div className="msg__bubble">
        {message.deleted ? (
          <span className="msg__deleted">message deleted</span>
        ) : editing ? (
          <input
            className="msg__edit-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              else if (e.key === "Escape") cancelEdit();
            }}
            onBlur={cancelEdit}
            spellCheck={false}
          />
        ) : (
          <span className="msg__text">{message.text}</span>
        )}
        {message.editedAt > 0 && !message.deleted && !editing && <span className="msg__edited">(edited)</span>}
        {canMutate && !editing && (onEdit || onDelete) && (
          <span className="msg__actions">
            {onEdit && (
              <button className="msg__action" onClick={startEdit} aria-label="Edit message">
                ✎
              </button>
            )}
            {onDelete && (
              // onMouseDown so it fires before the input's onBlur in edit mode.
              <button className="msg__action" onClick={() => onDelete(message.messageId)} aria-label="Delete message">
                🗑
              </button>
            )}
          </span>
        )}
      </div>
      <div className="msg__meta">
        <span className="msg__time">{clockTime(message.timestamp)}</span>
        {message.pending && <span className="msg__status">sending…</span>}
        {mine && !message.pending && read && <span className="msg__status">Read</span>}
      </div>
    </div>
  );
}
