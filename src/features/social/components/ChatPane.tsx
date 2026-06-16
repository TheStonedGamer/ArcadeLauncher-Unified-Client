// The conversation pane: header (peer name + presence), scrollable message list
// with a typing indicator, and the composer. Auto-scrolls to the newest message.

import { useEffect, useRef } from "react";
import { displayName } from "../selectors";
import type { Conversation, Friend } from "../types";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { PresenceDot, presenceLabel } from "./PresenceDot";

interface Props {
  peer: Friend | null;
  conversation: Conversation | null;
  selfId: number;
  connected: boolean;
  onSend: (text: string) => void;
  onTyping: () => void;
  onEdit: (msgId: number, text: string) => void;
  onDelete: (msgId: number) => void;
  onReact: (msgId: number, emoji: string) => void;
  onReply: (msgId: number) => void;
  /** The message currently being replied to (0 = none). */
  replyTo: number;
  /** Cancel the pending reply. */
  onCancelReply: () => void;
  /** Pick + send a file attachment (absent → no paperclip). */
  onAttach?: () => void;
  /** Open an attachment by id (absent → attachment chips are inert). */
  onOpenAttachment?: (attachmentId: number) => void;
  /** View an account's profile (absent → peer name is not clickable). */
  onViewProfile?: (userId: number) => void;
}

/** Shorten a parent message to a one-line reply quote. */
function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

export function ChatPane({
  peer, conversation, selfId, connected, onSend, onTyping, onEdit, onDelete, onReact, onReply, replyTo, onCancelReply,
  onAttach, onOpenAttachment, onViewProfile,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const msgCount = conversation?.messages.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgCount, peer?.accountId]);

  if (!peer || !conversation) {
    return (
      <div className="chatpane chatpane--empty">
        <p className="social__empty">Select a friend to start chatting.</p>
      </div>
    );
  }

  // messageId → snippet, so a reply can quote its parent inline.
  const textById = new Map<number, string>();
  for (const m of conversation.messages) {
    if (m.messageId !== 0 && !m.deleted) textById.set(m.messageId, snippet(m.text));
  }
  const replyParent = replyTo > 0 ? textById.get(replyTo) ?? "a message" : "";

  return (
    <div className="chatpane">
      <header className="chatpane__head">
        <PresenceDot presence={peer.presence} />
        {onViewProfile ? (
          <button className="chatpane__name chatpane__name--link" onClick={() => onViewProfile(peer.accountId)} title="View profile">
            {displayName(peer)}
          </button>
        ) : (
          <span className="chatpane__name">{displayName(peer)}</span>
        )}
        <span className="chatpane__sub">
          {peer.presence === "ingame" && peer.currentGameTitle
            ? peer.currentGameTitle
            : presenceLabel[peer.presence]}
        </span>
      </header>

      <div className="chatpane__messages">
        {conversation.messages.length === 0 ? (
          <p className="social__empty">No messages yet — say hello.</p>
        ) : (
          conversation.messages.map((m, i) => (
            <MessageRow
              key={m.messageId !== 0 ? `m${m.messageId}` : `p${i}`}
              message={m}
              mine={m.senderId === selfId}
              read={m.messageId !== 0 && m.messageId <= conversation.readUpTo}
              selfId={selfId}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              onReply={onReply}
              replyPreview={m.replyTo > 0 ? textById.get(m.replyTo) : undefined}
              onOpenAttachment={onOpenAttachment}
            />
          ))
        )}
        {conversation.peerTyping && (
          <div className="chatpane__typing">{displayName(peer)} is typing…</div>
        )}
        <div ref={endRef} />
      </div>

      {replyTo > 0 && (
        <div className="chatpane__replybar">
          <span className="chatpane__replybar-text">Replying to: {replyParent}</span>
          <button className="chatpane__replybar-cancel" onClick={onCancelReply} aria-label="Cancel reply">
            ✕
          </button>
        </div>
      )}

      <Composer
        disabled={!connected}
        placeholder={connected ? `Message ${displayName(peer)}` : "Offline — gateway connects in T3b"}
        onSend={onSend}
        onTyping={onTyping}
        onAttach={onAttach}
      />
    </div>
  );
}
