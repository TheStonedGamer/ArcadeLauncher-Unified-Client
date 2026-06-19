// "Continue Playing" strip: a horizontal row of the most recently played games,
// shown atop the catalog when browsing All Games with no active search. Clicking
// a tile launches the game directly (Steam-style). Pure presentation — the data
// (recentlyPlayed) and launch handler are passed in.

import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";
import { formatDuration, formatLastPlayed } from "../stats";

interface Props {
  games: Game[];
  /** Current time in ms, for relative "last played" labels. */
  nowMs: number;
  onLaunch: (game: Game) => void;
}

export function ContinuePlayingRow({ games, nowMs, onLaunch }: Props) {
  if (games.length === 0) return null;

  return (
    <section className="continue-row" aria-label="Continue playing">
      <h2 className="continue-row__heading">Continue Playing</h2>
      <div className="continue-row__track">
        {games.map((game) => {
          const cover = game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl;
          const when = formatLastPlayed(game.lastPlayed, nowMs);
          const played = formatDuration(game.playtimeSeconds);
          return (
            <button
              key={game.id}
              type="button"
              className="continue-card"
              onClick={() => onLaunch(game)}
              title={`Play ${game.title}${when ? ` — last played ${when.toLowerCase()}` : ""}`}
            >
              <div className="continue-card__art">
                {cover ? (
                  <img src={cover} alt={game.title} loading="lazy" />
                ) : (
                  <span className="continue-card__placeholder">{game.title}</span>
                )}
                <span className="continue-card__play" aria-hidden="true">
                  ▶
                </span>
              </div>
              <div className="continue-card__title">{game.title}</div>
              <div className="continue-card__meta">
                {when || "—"}
                {played !== "—" ? ` · ${played}` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
