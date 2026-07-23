// Weekly recap (ROADMAP T12j): what you actually played this week, from the
// per-session play history Rust writes on game exit. Pure presentation — every
// figure comes from the tested recap.ts core, and the clock is read once here so
// the core stays deterministic.

import { useEffect, useState } from "react";
import { loadPlaySessions } from "../api";
import { formatDuration } from "../stats";
import {
  DAY_NAMES,
  formatRange,
  newlyPlayed,
  recapFor,
  recapHeadline,
  weekOverWeek,
  weekRange,
  type PlaySession,
} from "../recap";

/** Re-read the log whenever `refreshKey` changes (the catalog bumps it when a
 *  game exits) so the recap updates without a restart. */
export function WeeklyRecapPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [sessions, setSessions] = useState<PlaySession[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void loadPlaySessions()
      .then((s) => live && setSessions(s))
      .catch(() => live && setSessions([])); // no history yet is not an error
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!sessions) return null;

  const now = Date.now();
  const thisWeek = recapFor(sessions, weekRange(now));
  const lastWeek = recapFor(sessions, weekRange(now, 1));

  // Nothing played this week or last → nothing worth a panel.
  if (thisWeek.totalSeconds === 0 && lastWeek.totalSeconds === 0) return null;

  const change = weekOverWeek(thisWeek, lastWeek);
  const fresh = newlyPlayed(thisWeek, lastWeek);
  const peak = Math.max(...thisWeek.perDay, 1);

  return (
    <section className="recap" aria-label="Weekly recap">
      <button
        type="button"
        className="stats-panel__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="stats-panel__toggle-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        Your week
        <span className="stats-panel__toggle-summary">
          {recapHeadline(thisWeek, formatDuration)}
          {change !== null && (
            <span className={`recap__delta recap__delta--${change >= 0 ? "up" : "down"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs last week
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="stats-panel__body">
          <div className="recap__range">{formatRange(weekRange(now))}</div>

          <div className="stats-panel__figures">
            <div className="stats-figure">
              <span className="stats-figure__value">{formatDuration(thisWeek.totalSeconds)}</span>
              <span className="stats-figure__label">Played</span>
            </div>
            <div className="stats-figure">
              <span className="stats-figure__value">{thisWeek.sessionCount}</span>
              <span className="stats-figure__label">Sessions</span>
            </div>
            <div className="stats-figure">
              <span className="stats-figure__value">
                {thisWeek.busiestDay >= 0 ? DAY_NAMES[thisWeek.busiestDay].slice(0, 3) : "—"}
              </span>
              <span className="stats-figure__label">Busiest day</span>
            </div>
            <div className="stats-figure">
              <span className="stats-figure__value">
                {formatDuration(thisWeek.longestSession?.seconds ?? 0)}
              </span>
              <span className="stats-figure__label">Longest session</span>
            </div>
          </div>

          <div className="recap__days" role="img" aria-label="Playtime by day">
            {thisWeek.perDay.map((seconds, day) => (
              <div key={day} className="recap__day" title={`${DAY_NAMES[day]}: ${formatDuration(seconds)}`}>
                <span className="recap__day-track">
                  <span
                    className="recap__day-fill"
                    style={{ height: `${Math.round((seconds / peak) * 100)}%` }}
                  />
                </span>
                <span className="recap__day-label">{DAY_NAMES[day][0]}</span>
              </div>
            ))}
          </div>

          {thisWeek.byGame.length > 0 && (
            <div className="stats-panel__chart">
              <h3 className="stats-panel__chart-heading">This week's games</h3>
              <ul className="stats-bars">
                {thisWeek.byGame.slice(0, 5).map((g) => (
                  <li key={g.id} className="stats-bar">
                    <span className="stats-bar__title" title={g.title}>{g.title}</span>
                    <span className="stats-bar__track">
                      <span
                        className="stats-bar__fill"
                        style={{ width: `${Math.round((g.seconds / thisWeek.byGame[0].seconds) * 100)}%` }}
                      />
                    </span>
                    <span className="stats-bar__value">{formatDuration(g.seconds)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fresh.length > 0 && (
            <p className="recap__new">
              New this week: {fresh.slice(0, 4).map((g) => g.title).join(", ")}
              {fresh.length > 4 ? ` +${fresh.length - 4} more` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
