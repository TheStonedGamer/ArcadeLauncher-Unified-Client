// Friend roster (ROADMAP T9e): organizes friends into Pinned / per-group /
// Ungrouped sections (or a single flat list when a group filter is active), each
// row expandable to edit its note, pin, and group tags. The sectioning + group
// math live in friendMeta.ts (unit-tested); this is presentation + local edit
// state. When no FriendMetaApi is supplied (signed out), it falls back to a flat
// unorganized list.

import { useState } from "react";
import { displayName } from "../selectors";
import type { Friend } from "../types";
import { organizeFriends, allGroups, type FriendMeta } from "../friendMeta";
import type { FriendMetaApi } from "../useFriendMeta";
import { PresenceDot, presenceLabel } from "./PresenceDot";

export interface IgnoreControl {
  isIgnored: (userId: number) => boolean;
  toggleIgnore: (userId: number) => void;
}

/** Blocking is destructive — it also ends the friendship — so it is a separate
 *  control from ignore, and the row asks before doing it. */
export interface BlockControl {
  block: (userId: number, username: string) => void;
}

interface Props {
  friends: Friend[];
  selectedPeer: number | null;
  onSelect: (peerId: number) => void;
  meta?: FriendMetaApi;
  ignore?: IgnoreControl;
  blocking?: BlockControl;
  /** Unread DM count per peer — clicking a row opens that conversation. */
  unread?: Map<number, number>;
  /** Start a voice call with this friend. Absent → calling is unavailable. */
  onCall?: (peerId: number) => void;
  /** Start a video call with this friend. */
  onVideoCall?: (peerId: number) => void;
  /** Why calling is unavailable, shown on the disabled buttons. Buttons stay
   *  visible rather than vanishing, so a dropped gateway reads as "offline"
   *  instead of as a missing feature. */
  callDisabledReason?: string;
}

function subline(f: Friend): { text: string; game: boolean } {
  const game = f.presence === "ingame" && !!f.currentGameTitle;
  if (game) return { text: f.currentGameTitle, game: true };
  // A custom status takes precedence over the generic presence label.
  if (f.statusText) return { text: f.statusText, game: false };
  return { text: presenceLabel[f.presence], game: false };
}

function FriendRow({
  f,
  selected,
  onSelect,
  meta,
  fmeta,
  ignore,
  blocking,
  unread,
  onCall,
  onVideoCall,
  callDisabledReason,
}: {
  f: Friend;
  selected: boolean;
  onSelect: (id: number) => void;
  meta?: FriendMetaApi;
  fmeta: FriendMeta;
  ignore?: IgnoreControl;
  blocking?: BlockControl;
  unread: number;
  onCall?: (peerId: number) => void;
  onVideoCall?: (peerId: number) => void;
  callDisabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(fmeta.note);
  const [group, setGroup] = useState("");
  const sub = subline(f);

  return (
    <li>
      <div className={`friendlist__row${selected ? " friendlist__row--active" : ""}`}>
        <button className="friendlist__main" onClick={() => onSelect(f.accountId)}>
          <PresenceDot presence={f.presence} />
          <span className="friendlist__name">
            {f.favorite && <span className="friendlist__star">★</span>}
            {fmeta.pinned && <span className="friendlist__pin" title="Pinned">📌</span>}
            {displayName(f)}
          </span>
          <span className={`friendlist__sub${sub.game ? " friendlist__sub--game" : ""}`}>{sub.text}</span>
          {unread > 0 && (
            <span className="friendlist__unread" aria-label={`${unread} unread messages`}>
              {unread}
            </span>
          )}
        </button>
        <button
          className="friendlist__call"
          title={callDisabledReason ?? `Call ${displayName(f)}`}
          aria-label={`Call ${displayName(f)}`}
          disabled={!onCall}
          onClick={() => onCall?.(f.accountId)}
        >
          📞
        </button>
        <button
          className="friendlist__call friendlist__call--video"
          title={callDisabledReason ?? `Video call ${displayName(f)}`}
          aria-label={`Video call ${displayName(f)}`}
          disabled={!onVideoCall}
          onClick={() => onVideoCall?.(f.accountId)}
        >
          📹
        </button>
        {meta && (
          <button
            className="friendlist__edit"
            title="Organize"
            aria-label="Organize friend"
            onClick={() => setOpen((o) => !o)}
          >
            ⋯
          </button>
        )}
      </div>

      {meta && open && (
        <div className="friendmeta">
          <div className="friendmeta__actions">
            <button className="friendmeta__pin" onClick={() => meta.togglePin(f.accountId)}>
              {fmeta.pinned ? "📌 Unpin" : "📌 Pin"}
            </button>
            {ignore && (
              <button
                className={`friendmeta__ignore${ignore.isIgnored(f.accountId) ? " friendmeta__ignore--on" : ""}`}
                onClick={() => ignore.toggleIgnore(f.accountId)}
              >
                {ignore.isIgnored(f.accountId) ? "🔔 Unignore" : "🔕 Ignore"}
              </button>
            )}
            {blocking && (
              <button
                className="friendmeta__block"
                onClick={() => {
                  // Blocking removes the friendship too, so confirm first: this
                  // is not something an unblock puts back.
                  const name = displayName(f);
                  if (
                    window.confirm(
                      `Block ${name}?\n\nThey won't be able to message, call or add you, and you'll stop being friends. Unblocking later won't restore the friendship.`,
                    )
                  ) {
                    blocking.block(f.accountId, name);
                  }
                }}
              >
                🚫 Block
              </button>
            )}
          </div>
          <label className="friendmeta__note">
            <span>Note</span>
            <input
              value={note}
              maxLength={512}
              placeholder="Private note (only you see this)"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== fmeta.note && meta.setNote(f.accountId, note)}
            />
          </label>
          <div className="friendmeta__groups">
            {fmeta.groups.map((g) => (
              <span key={g} className="friendmeta__chip">
                {g}
                <button aria-label={`Remove from ${g}`} onClick={() => meta.removeFromGroup(f.accountId, g)}>
                  ✕
                </button>
              </span>
            ))}
            <input
              className="friendmeta__add"
              value={group}
              placeholder="+ group"
              onChange={(e) => setGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && group.trim()) {
                  meta.addToGroup(f.accountId, group);
                  setGroup("");
                }
              }}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export function FriendList({
  friends,
  selectedPeer,
  onSelect,
  meta,
  ignore,
  blocking,
  unread,
  onCall,
  onVideoCall,
  callDisabledReason,
}: Props) {
  if (friends.length === 0) {
    return <p className="social__empty">No friends yet.</p>;
  }

  const metaOf = meta?.metaOf;
  const sections = organizeFriends(
    friends,
    (f) => f.accountId,
    (id) => metaOf?.(id),
    meta?.groupFilter ?? "",
  );
  const groupNames = meta ? allGroups(friends.map((f) => meta.metaOf(f.accountId))) : [];

  return (
    <div className="friendlist">
      {meta && groupNames.length > 0 && (
        <div className="friendlist__filter">
          <button
            className={`friendlist__tag${meta.groupFilter === "" ? " friendlist__tag--active" : ""}`}
            onClick={() => meta.setGroupFilter("")}
          >
            All
          </button>
          {groupNames.map((g) => (
            <button
              key={g}
              className={`friendlist__tag${meta.groupFilter.toLowerCase() === g.toLowerCase() ? " friendlist__tag--active" : ""}`}
              onClick={() => meta.setGroupFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {sections.map((section) => (
        <div key={section.title} className="friendlist__section">
          <div className="friendlist__heading">{section.title}</div>
          <ul className="friendlist__items">
            {section.items.map((w) => (
              <FriendRow
                key={w.friend.accountId}
                f={w.friend}
                selected={w.friend.accountId === selectedPeer}
                onSelect={onSelect}
                meta={meta}
                fmeta={w.meta}
                ignore={ignore}
                blocking={blocking}
                unread={unread?.get(w.friend.accountId) ?? 0}
                onCall={onCall}
                onVideoCall={onVideoCall}
                callDisabledReason={callDisabledReason}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
