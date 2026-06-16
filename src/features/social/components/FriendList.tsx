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

interface Props {
  friends: Friend[];
  selectedPeer: number | null;
  onSelect: (peerId: number) => void;
  meta?: FriendMetaApi;
}

function subline(f: Friend): { text: string; game: boolean } {
  const game = f.presence === "ingame" && !!f.currentGameTitle;
  return { text: game ? f.currentGameTitle! : presenceLabel[f.presence], game };
}

function FriendRow({
  f,
  selected,
  onSelect,
  meta,
  fmeta,
}: {
  f: Friend;
  selected: boolean;
  onSelect: (id: number) => void;
  meta?: FriendMetaApi;
  fmeta: FriendMeta;
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
          <button className="friendmeta__pin" onClick={() => meta.togglePin(f.accountId)}>
            {fmeta.pinned ? "📌 Unpin" : "📌 Pin"}
          </button>
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

export function FriendList({ friends, selectedPeer, onSelect, meta }: Props) {
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
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
