// Game Requests board view: the search-and-request composer, status + platform
// filter chips, and the request list (cover, title/subtitle, community star
// rating, and upvote). Admin status triage now lives in the server admin UI
// (/admin/requests), not inline here. State + actions come from useRequests;
// this component is composition + presentation only.

import { useRequests } from "./useRequests";
import { RequestComposer } from "./components/RequestComposer";
import { StarRating } from "./components/StarRating";
import {
  formatRating,
  requestSubtitle,
  STATUSES,
  statusLabel,
  type GameRequest,
} from "./requests";
import { useSession } from "../session/SessionContext";

export function RequestsView() {
  const { session } = useSession();
  const auth = session ? { host: session.host, token: session.token } : null;
  const r = useRequests(auth);

  return (
    <div className="requests">
      <div className="requests__bar">
        <h2 className="requests__title">Game Requests</h2>
        <button className="requests__refresh" onClick={r.reload} disabled={r.loading || !auth}>
          {r.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <RequestComposer board={r.board} search={r.search} request={r.request} disabled={!auth} />

      {r.error && <p className="requests__error">{r.error}</p>}

      {/* Status filter chips */}
      <div className="requests__filters">
        <button
          className={`chip${r.statusFilter === null ? " chip--on" : ""}`}
          onClick={() => r.setStatusFilter(null)}
        >
          All ({r.board.length})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`chip${r.statusFilter === s ? " chip--on" : ""}`}
            onClick={() => r.setStatusFilter(r.statusFilter === s ? null : s)}
          >
            {statusLabel(s)} ({r.counts[s]})
          </button>
        ))}
      </div>

      {/* Platform filter chips (only when the board spans >1 platform) */}
      {r.platforms.length > 1 && (
        <div className="requests__filters">
          <button
            className={`chip chip--platform${r.platformFilter === null ? " chip--on" : ""}`}
            onClick={() => r.setPlatformFilter(null)}
          >
            Any platform
          </button>
          {r.platforms.map((p) => (
            <button
              key={p}
              className={`chip chip--platform${r.platformFilter === p ? " chip--on" : ""}`}
              onClick={() => r.setPlatformFilter(r.platformFilter === p ? null : p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Board */}
      {!auth ? (
        <p className="requests__empty">Sign in to view and vote on game requests.</p>
      ) : r.visible.length === 0 ? (
        <p className="requests__empty">
          {r.loading ? "Loading the board…" : "No requests match — be the first to request a game."}
        </p>
      ) : (
        <ul className="requests__list">
          {r.visible.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              onVote={() => r.vote(req.id)}
              onRate={(stars) => r.rate(req.id, stars)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RequestRowProps {
  req: GameRequest;
  onVote: () => void;
  onRate: (stars: number) => void;
}

function RequestRow({ req, onVote, onRate }: RequestRowProps) {
  return (
    <li className="reqrow">
      <button
        className={`reqrow__vote${req.votedByMe ? " reqrow__vote--on" : ""}`}
        onClick={onVote}
        disabled={req.votedByMe}
        title={req.votedByMe ? "You upvoted this" : "Upvote"}
      >
        <span className="reqrow__votearrow">▲</span>
        <span className="reqrow__votecount">{req.votes}</span>
      </button>

      {req.coverUrl && <img className="reqrow__cover" src={req.coverUrl} alt="" />}

      <div className="reqrow__main">
        <div className="reqrow__titleline">
          <span className="reqrow__title">{req.title}</span>
          <span className={`reqrow__status reqrow__status--${req.status}`}>{statusLabel(req.status)}</span>
        </div>
        <div className="reqrow__sub">{requestSubtitle(req)}</div>
        {req.note && <div className="reqrow__note">“{req.note}”</div>}
        <div className="reqrow__rating">
          <StarRating
            value={req.myRating || req.ratingAvg}
            onRate={onRate}
            caption={
              req.myRating
                ? `Your ${req.myRating}★ · ${formatRating(req)}`
                : formatRating(req)
            }
          />
        </div>
      </div>
    </li>
  );
}
