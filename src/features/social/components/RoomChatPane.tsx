// Group-room chat pane (T12f-2): the message thread + composer for the open
// room, plus owner controls (rename, add member, leave). Messages come from the
// tested roomChat log; this is composition + local input state only.

import { useMemo, useState } from "react";
import type { Room } from "../rooms";
import type { RoomMessage } from "../roomChat";
import type { Friend } from "../types";

interface Props {
  room: Room | null;
  messages: RoomMessage[];
  selfId: number;
  friends: Friend[];
  connected: boolean;
  onSend: (text: string) => void;
  onRename: (roomId: number, name: string) => void;
  onAddMember: (roomId: number, userId: number) => void;
  onLeave: (roomId: number) => void;
}

export function RoomChatPane({
  room,
  messages,
  selfId,
  friends,
  connected,
  onSend,
  onRename,
  onAddMember,
  onLeave,
}: Props) {
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  // Friends not already in the room are candidates to add.
  const addable = useMemo(
    () => (room ? friends.filter((f) => !room.members.includes(f.accountId)) : []),
    [room, friends],
  );
  const nameOf = (id: number): string => {
    if (id === selfId) return "You";
    const f = friends.find((x) => x.accountId === id);
    return f ? f.nickname || f.username : `User ${id}`;
  };

  if (!room) {
    return <div className="roomchat roomchat--empty">Select a room to start chatting.</div>;
  }

  const send = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  const isOwner = room.ownerId === selfId;

  return (
    <div className="roomchat">
      <header className="roomchat__head">
        {renaming && isOwner ? (
          <input
            className="settings__input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onRename(room.roomId, newName);
                setRenaming(false);
              }
              if (e.key === "Escape") setRenaming(false);
            }}
            placeholder={room.name}
            autoFocus
          />
        ) : (
          <h3 className="roomchat__title">{room.name || "Untitled room"}</h3>
        )}
        <div className="roomchat__actions">
          {isOwner && (
            <button
              className="roomchat__btn"
              onClick={() => {
                setNewName(room.name);
                setRenaming((r) => !r);
              }}
            >
              Rename
            </button>
          )}
          {isOwner && addable.length > 0 && (
            <select
              className="settings__input roomchat__add"
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) onAddMember(room.roomId, id);
                e.target.value = "";
              }}
            >
              <option value="">+ Add member…</option>
              {addable.map((f) => (
                <option key={f.accountId} value={f.accountId}>
                  {f.nickname || f.username}
                </option>
              ))}
            </select>
          )}
          <button className="roomchat__btn" onClick={() => onLeave(room.roomId)}>
            Leave
          </button>
        </div>
      </header>

      <div className="roomchat__members">
        {room.members.map((id) => (
          <span key={id} className="roomchat__member">
            {nameOf(id)}
          </span>
        ))}
      </div>

      <div className="roomchat__log">
        {messages.length === 0 && <div className="roomchat__empty-log">No messages yet — say hi.</div>}
        {messages.map((m, i) => (
          <div
            key={m.messageId || `echo-${i}`}
            className={`roomchat__msg${m.senderId === selfId ? " roomchat__msg--mine" : ""}${m.pending ? " roomchat__msg--pending" : ""}`}
          >
            <span className="roomchat__msg-author">{nameOf(m.senderId)}</span>
            <span className="roomchat__msg-text">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="roomchat__composer">
        <input
          className="settings__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={connected ? "Message the room…" : "Connecting…"}
          disabled={!connected}
          spellCheck
        />
        <button className="roomchat__send" onClick={send} disabled={!connected || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
