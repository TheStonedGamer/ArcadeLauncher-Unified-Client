// Game-invite toast stack (ROADMAP T12d): a floating column of "join my game"
// invites a user has received. Each offers Join (accept → launch handoff) and
// Dismiss (decline). Presentation only; the invite list + actions come from
// useSocial (whose pure invite reducer is unit-tested). The launch-on-accept
// handoff is delegated to the caller via `onJoin(gameId)` so this component stays
// free of catalog/launch concerns.

import type { GameInvite } from "../invites";

export function GameInviteToasts({
  invites,
  nameOf,
  onJoin,
  onDismiss,
}: {
  invites: GameInvite[];
  /** Resolve a sender account id to a display name (falls back to "User <id>"). */
  nameOf: (fromId: number) => string;
  /** Accept invite: caller sends the response + does the launch handoff. */
  onJoin: (inviteId: number) => void;
  /** Decline/dismiss invite. */
  onDismiss: (inviteId: number) => void;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="invites">
      {invites.map((inv) => (
        <div key={inv.inviteId} className="invites__toast">
          <span className="invites__icon" aria-hidden>
            🎮
          </span>
          <div className="invites__body">
            <div className="invites__who">{nameOf(inv.fromId)}</div>
            <div className="invites__what">
              wants you to join <strong>{inv.gameTitle || inv.gameId}</strong>
            </div>
          </div>
          <div className="invites__actions">
            <button className="invites__join" onClick={() => onJoin(inv.inviteId)}>
              Join
            </button>
            <button className="invites__dismiss" onClick={() => onDismiss(inv.inviteId)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
