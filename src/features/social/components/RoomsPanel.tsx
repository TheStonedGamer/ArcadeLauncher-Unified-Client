// Group-rooms roster panel (T12f): the list of rooms I belong to plus a small
// "new room" creator that picks an initial member set from my friends. Pure
// composition over useSocial's room state + actions; the room reducer and chat
// log live in the tested cores (rooms.ts / roomChat.ts).

import { useState } from "react";
import type { Room } from "../rooms";
import type { Friend } from "../types";

interface Props {
  rooms: Room[];
  selectedRoom: number | null;
  friends: Friend[];
  onSelect: (roomId: number) => void;
  onCreateRoom: (name: string, memberIds: number[]) => void;
}

export function RoomsPanel({ rooms, selectedRoom, friends, onSelect, onCreateRoom }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const togglePick = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (!name.trim()) return;
    onCreateRoom(name, [...picked]);
    setName("");
    setPicked(new Set());
    setCreating(false);
  };

  return (
    <div className="rooms">
      <button className="rooms__new" onClick={() => setCreating((c) => !c)}>
        {creating ? "Cancel" : "+ New room"}
      </button>

      {creating && (
        <div className="rooms__create">
          <input
            className="settings__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Room name…"
            spellCheck={false}
            autoFocus
          />
          <div className="rooms__pick">
            {friends.length === 0 && <span className="detail__fetchmsg">Add friends to invite them.</span>}
            {friends.map((f) => (
              <label key={f.accountId} className="rooms__pickrow">
                <input
                  type="checkbox"
                  checked={picked.has(f.accountId)}
                  onChange={() => togglePick(f.accountId)}
                />
                <span>{f.nickname || f.username}</span>
              </label>
            ))}
          </div>
          <button className="rooms__create-btn" onClick={submit} disabled={!name.trim()}>
            Create room
          </button>
        </div>
      )}

      <div className="rooms__list">
        {rooms.length === 0 && !creating && <span className="detail__fetchmsg">No rooms yet.</span>}
        {rooms.map((r) => (
          <button
            key={r.roomId}
            className={`rooms__item${r.roomId === selectedRoom ? " rooms__item--active" : ""}`}
            onClick={() => onSelect(r.roomId)}
          >
            <span className="rooms__item-name">{r.name || "Untitled room"}</span>
            <span className="rooms__item-count">{r.members.length}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
