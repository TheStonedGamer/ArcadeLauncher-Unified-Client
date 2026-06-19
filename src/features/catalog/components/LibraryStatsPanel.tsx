// Library stats dashboard: headline numbers (games, played, total playtime) plus
// a "Most Played" bar chart. Shown collapsed by default atop the catalog when
// browsing All Games with no search. Pure presentation — all figures come from
// the tested stats.ts core; the games list is passed in already prefs-overlaid.

import { useState } from "react";
import type { Game } from "../types";
import { libraryStats, playtimeBars, formatDuration } from "../stats";

interface Props {
  games: Game[];
}

export function LibraryStatsPanel({ games }: Props) {
  const [open, setOpen] = useState(false);
  const stats = libraryStats(games);
  const bars = playtimeBars(games);

  // Nothing to say until at least one game has been played.
  if (stats.playedGames === 0) return null;

  return (
    <section className="stats-panel" aria-label="Library stats">
      <button
        type="button"
        className="stats-panel__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="stats-panel__toggle-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        Library stats
        <span className="stats-panel__toggle-summary">
          {stats.playedGames}/{stats.totalGames} played ·{" "}
          {formatDuration(stats.totalPlaytimeSeconds)} total
        </span>
      </button>

      {open && (
        <div className="stats-panel__body">
          <div className="stats-panel__figures">
            <div className="stats-figure">
              <span className="stats-figure__value">{stats.totalGames}</span>
              <span className="stats-figure__label">Games</span>
            </div>
            <div className="stats-figure">
              <span className="stats-figure__value">{stats.playedGames}</span>
              <span className="stats-figure__label">Played</span>
            </div>
            <div className="stats-figure">
              <span className="stats-figure__value">
                {formatDuration(stats.totalPlaytimeSeconds)}
              </span>
              <span className="stats-figure__label">Total time</span>
            </div>
          </div>

          {bars.length > 0 && (
            <div className="stats-panel__chart">
              <h3 className="stats-panel__chart-heading">Most played</h3>
              <ul className="stats-bars">
                {bars.map(({ game, fraction }) => (
                  <li key={game.id} className="stats-bar">
                    <span className="stats-bar__title" title={game.title}>
                      {game.title}
                    </span>
                    <span className="stats-bar__track">
                      <span
                        className="stats-bar__fill"
                        style={{ width: `${Math.round(fraction * 100)}%` }}
                      />
                    </span>
                    <span className="stats-bar__value">
                      {formatDuration(game.playtimeSeconds)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
