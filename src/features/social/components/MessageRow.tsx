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
  /** My own account id, so we can tell which reactions are mine. */
  selfId: number;
  /** Save an edit to this message (absent → no edit affordance). */
  onEdit?: (msgId: number, text: string) => void;
  /** Delete this message (absent → no delete affordance). */
  onDelete?: (msgId: number) => void;
  /** Toggle my reaction with `emoji` on this message (absent → no react UI). */
  onReact?: (msgId: number, emoji: string) => void;
  /** Start a reply to this message (absent → no reply affordance). */
  onReply?: (msgId: number) => void;
  /** Snippet of the message this one replies to (absent → no quote shown). */
  replyPreview?: string;
}

function clockTime(epochSecs: number): string {
  if (!epochSecs) return "";
  return new Date(epochSecs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The small fixed palette offered by the "＋" reaction picker. */
const REACTION_PALETTE = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

/** Group a message's reactions into { emoji, count, mine } for chip rendering. */
function groupReactions(message: ChatMessage, selfId: number) {
  const order: string[] = [];
  const by = new Map<string, { count: number; mine: boolean }>();
  for (const r of message.reactions) {
    let e = by.get(r.emoji);
    if (!e) {
      e = { count: 0, mine: false };
      by.set(r.emoji, e);
      order.push(r.emoji);
    }
    e.count += 1;
    if (r.userId === selfId) e.mine = true;
  }
  return order.map((emoji) => ({ emoji, ...by.get(emoji)! }));
}

export function MessageRow({ message, mine, read, selfId, onEdit, onDelete, onReact, onReply, replyPreview }: Props) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(message.text);

  const cls = `msg${mine ? " msg--mine" : ""}${message.pending ? " msg--pending" : ""}`;
  // Only my own saved (id != 0), non-deleted messages can be mutated.
  const canMutate = mine && !message.pending && !message.deleted && message.messageId !== 0;
  // Any saved, non-deleted message can be reacted to / replied to (mine or peer's).
  const reactable = !!onReact && !message.pending && !message.deleted && message.messageId !== 0;
  const replyable = !!onReply && !message.pending && !message.deleted && message.messageId !== 0;
  const chips = groupReactions(message, selfId);

  const react = (emoji: string) => {
    onReact?.(message.messageId, emoji);
    setPicking(false);
  };

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
        {message.replyTo > 0 && !message.deleted && (
          <div className="msg__quote">{replyPreview ?? "replying to a message"}</div>
        )}
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
        {!editing && (canMutate || reactable || replyable) && (
          <span className="msg__actions">
            {reactable && (
              <button className="msg__action" onClick={() => setPicking((p) => !p)} aria-label="Add reaction">
                ＋
              </button>
            )}
            {replyable && (
              <button className="msg__action" onClick={() => onReply!(message.messageId)} aria-label="Reply">
                ↩
              </button>
            )}
            {canMutate && onEdit && (
              <button className="msg__action" onClick={startEdit} aria-label="Edit message">
                ✎
              </button>
            )}
            {canMutate && onDelete && (
              <button className="msg__action" onClick={() => onDelete(message.messageId)} aria-label="Delete message">
                🗑
              </button>
            )}
            {picking && (
              <span className="msg__picker">
                {REACTION_PALETTE.map((emoji) => (
                  <button key={emoji} className="msg__picker-emoji" onClick={() => react(emoji)} aria-label={`React ${emoji}`}>
                    {emoji}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="msg__reactions">
          {chips.map((c) => (
            <button
              key={c.emoji}
              className={`msg__chip${c.mine ? " msg__chip--mine" : ""}`}
              onClick={() => onReact?.(message.messageId, c.emoji)}
              disabled={!onReact}
              aria-label={`${c.emoji} ${c.count}`}
            >
              <span className="msg__chip-emoji">{c.emoji}</span>
              <span className="msg__chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="msg__meta">
        <span className="msg__time">{clockTime(message.timestamp)}</span>
        {message.pending && <span className="msg__status">sending…</span>}
        {mine && !message.pending && read && <span className="msg__status">Read</span>}
      </div>
    </div>
  );
}
