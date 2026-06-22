// Chats tab (the first roster tab): active DM threads, newest message on top.
// Each row shows the peer, a one-line preview of the last message, its time, and
// an unread badge. Selecting a row opens that conversation. The ordering + last
// message come from the `chatSummaries` selector (unit-tested); this is
// presentation only.

import { displayName } from "../selectors";
import type { ChatSummary } from "../selectors";
import { PresenceDot } from "./PresenceDot";

interface Props {
  chats: ChatSummary[];
  selfId: number;
  selectedPeer: number | null;
  onSelect: (peerId: number) => void;
}

/** Short timestamp: clock time for today, else a compact date. */
function chatTime(epochSecs: number): string {
  if (!epochSecs) return "";
  const d = new Date(epochSecs * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One-line preview of the thread's last message, prefixed "You: " when mine. */
function preview(chat: ChatSummary, selfId: number): string {
  const m = chat.lastMessage;
  let body: string;
  if (m.deleted) body = "Message deleted";
  else if (!m.text && m.attachmentName) body = `📎 ${m.attachmentName}`;
  else if (!m.text && m.attachmentId) body = "📎 Attachment";
  else body = m.text;
  return m.senderId === selfId ? `You: ${body}` : body;
}

export function ChatList({ chats, selfId, selectedPeer, onSelect }: Props) {
  if (chats.length === 0) {
    return <p className="social__empty">No conversations yet.</p>;
  }
  return (
    <ul className="chatlist">
      {chats.map((chat) => {
        const name = chat.friend ? displayName(chat.friend) : `User ${chat.peerId}`;
        const selected = chat.peerId === selectedPeer;
        return (
          <li key={chat.peerId}>
            <button
              className={`chatlist__row${selected ? " chatlist__row--active" : ""}`}
              onClick={() => onSelect(chat.peerId)}
            >
              <PresenceDot presence={chat.friend?.presence ?? "offline"} />
              <div className="chatlist__body">
                <div className="chatlist__top">
                  <span className="chatlist__name">{name}</span>
                  <span className="chatlist__time">{chatTime(chat.lastActivity)}</span>
                </div>
                <div className="chatlist__bottom">
                  <span className={`chatlist__preview${chat.unread > 0 ? " chatlist__preview--unread" : ""}`}>
                    {preview(chat, selfId)}
                  </span>
                  {chat.unread > 0 && <span className="chatlist__badge">{chat.unread}</span>}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
