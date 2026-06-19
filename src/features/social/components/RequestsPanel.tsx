// Pending friend-requests panel: incoming requests (Accept / Decline / Ignore)
// and outgoing requests I've sent (Cancel). Pure presentation — every action is
// a respondToRequest callback supplied by useSocial, which POSTs to the server
// and re-pulls the roster. Surfaced as the roster's "Requests" tab; the count
// drives the tab badge.

import { displayName } from "../selectors";
import type { Friend } from "../types";
import type { FriendAction } from "../api";
import { PresenceDot } from "./PresenceDot";

interface Props {
  incoming: Friend[];
  outgoing: Friend[];
  onRespond: (userId: number, action: FriendAction) => void;
}

export function RequestsPanel({ incoming, outgoing, onRespond }: Props) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return <p className="social__empty">No pending friend requests.</p>;
  }

  return (
    <div className="requests">
      {incoming.length > 0 && (
        <div className="requests__section">
          <div className="requests__heading">Incoming ({incoming.length})</div>
          <ul className="requests__items">
            {incoming.map((f) => (
              <li key={f.accountId} className="requests__row">
                <PresenceDot presence={f.presence} />
                <span className="requests__name">{displayName(f)}</span>
                <div className="requests__actions">
                  <button
                    className="requests__accept"
                    onClick={() => onRespond(f.accountId, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="requests__decline"
                    onClick={() => onRespond(f.accountId, "decline")}
                  >
                    Decline
                  </button>
                  <button
                    className="requests__ignore"
                    title="Silently drop this request (the sender isn't told)"
                    onClick={() => onRespond(f.accountId, "ignore")}
                  >
                    Ignore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="requests__section">
          <div className="requests__heading">Sent ({outgoing.length})</div>
          <ul className="requests__items">
            {outgoing.map((f) => (
              <li key={f.accountId} className="requests__row">
                <PresenceDot presence={f.presence} />
                <span className="requests__name">{displayName(f)}</span>
                <span className="requests__pendinglabel">Pending</span>
                <div className="requests__actions">
                  <button
                    className="requests__decline"
                    onClick={() => onRespond(f.accountId, "cancel")}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
