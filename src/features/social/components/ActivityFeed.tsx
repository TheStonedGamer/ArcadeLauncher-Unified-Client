// Friends activity feed panel: a newest-first list of what the caller and their
// friends have been doing (played a game, posted a review, shared a screenshot).
// Pure presentation over the useActivity hook; unknown event kinds render
// generically so a newer server never breaks an older client.

import type { ActivityApi } from "../useActivity";
import type { ActivityItem } from "../activity";

/** Compact relative time ("3m", "2h", "5d") from a unix-seconds timestamp. */
function ago(unixSeconds: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** Read a numeric field off the kind-specific payload, defensively. */
function num(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Human sentence describing one event. `gameId` is the catalog id (best we
 *  have without a title lookup) — shown in a chip. */
function describe(item: ActivityItem): { verb: string; detail: string } {
  switch (item.kind) {
    case "played": {
      const secs = num(item.payload, "secs");
      const mins = secs ? Math.round(secs / 60) : 0;
      return { verb: "played", detail: mins ? `for ${mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`}` : "" };
    }
    case "review": {
      const rating = num(item.payload, "rating");
      return { verb: "reviewed", detail: rating ? `★ ${rating}` : "" };
    }
    case "screenshot":
      return { verb: "shared a screenshot of", detail: "" };
    default:
      return { verb: item.kind, detail: "" };
  }
}

/** Collapse a raw IPC/transport error into a short, non-scary line. The full
 *  detail stays available on hover (title attr) for debugging. */
function friendlyError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("error sending request") || r.includes("connect") || r.includes("timed out") || r.includes("dns")) {
    return "Couldn't reach the activity service.";
  }
  if (r.includes("http 401") || r.includes("unauthorized")) return "Session expired — reconnect to see activity.";
  if (r.includes("http 404")) return "Activity isn't available on this server yet.";
  if (r.includes("http 5")) return "The activity service is having trouble. Try again shortly.";
  return "Couldn't load activity right now.";
}

export function ActivityFeed({ activity }: { activity: ActivityApi }) {
  const { items, loading, error, refresh } = activity;

  return (
    <div className="social__activity">
      <div className="social__activity-head">
        <span>Activity</span>
        <button className="social__activity-refresh" onClick={refresh} disabled={loading}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      {error && (
        <div className="social__activity-error" title={error}>
          <span>{friendlyError(error)}</span>
          <button className="social__activity-retry" onClick={refresh} disabled={loading}>
            Retry
          </button>
        </div>
      )}
      {!error && !loading && items.length === 0 && (
        <div className="social__activity-empty">No recent activity from you or your friends yet.</div>
      )}

      <ul className="social__activity-list">
        {items.map((item) => {
          const { verb, detail } = describe(item);
          return (
            <li key={item.id} className="social__activity-item">
              <span className="social__activity-user">{item.username || `user ${item.userId}`}</span>{" "}
              <span className="social__activity-verb">{verb}</span>
              {item.gameId && <span className="social__activity-game"> {item.gameId}</span>}
              {detail && <span className="social__activity-detail"> {detail}</span>}
              <span className="social__activity-time">{ago(item.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
