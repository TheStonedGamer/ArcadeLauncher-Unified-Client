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
}

export function ChatPane({ peer, conversation, selfId, connected, onSend, onTyping, onEdit, onDelete, onReact }: Props) {
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

  return (
    <div className="chatpane">
      <header className="chatpane__head">
        <PresenceDot presence={peer.presence} />
        <span className="chatpane__name">{displayName(peer)}</span>
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
            />
          ))
        )}
        {conversation.peerTyping && (
          <div className="chatpane__typing">{displayName(peer)} is typing…</div>
        )}
        <div ref={endRef} />
      </div>

      <Composer
        disabled={!connected}
        placeholder={connected ? `Message ${displayName(peer)}` : "Offline — gateway connects in T3b"}
        onSend={onSend}
        onTyping={onTyping}
      />
    </div>
  );
}
