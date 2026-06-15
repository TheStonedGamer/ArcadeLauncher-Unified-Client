// Friend roster: presence dot, display name, and current game / status line.
// Pure presentation — ordering comes from the `sortedFriends` selector.

import { displayName } from "../selectors";
import type { Friend } from "../types";
import { PresenceDot, presenceLabel } from "./PresenceDot";

interface Props {
  friends: Friend[];
  selectedPeer: number | null;
  onSelect: (peerId: number) => void;
}

export function FriendList({ friends, selectedPeer, onSelect }: Props) {
  if (friends.length === 0) {
    return <p className="social__empty">No friends yet.</p>;
  }
  return (
    <ul className="friendlist">
      {friends.map((f) => {
        const sub =
          f.presence === "ingame" && f.currentGameTitle
            ? f.currentGameTitle
            : presenceLabel[f.presence];
        return (
          <li key={f.accountId}>
            <button
              className={`friendlist__row${f.accountId === selectedPeer ? " friendlist__row--active" : ""}`}
              onClick={() => onSelect(f.accountId)}
            >
              <PresenceDot presence={f.presence} />
              <span className="friendlist__name">
                {f.favorite && <span className="friendlist__star">★</span>}
                {displayName(f)}
              </span>
              <span className={`friendlist__sub${f.presence === "ingame" ? " friendlist__sub--game" : ""}`}>
                {sub}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
