// A single game tile: cover art (or a titled placeholder) with a favorite star
// and install-state dot. Pure presentation — click handling is passed in.

import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";

interface Props {
  game: Game;
  onLaunch: (game: Game) => void;
}

export function GameCard({ game, onLaunch }: Props) {
  const cover = game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl;
  const installed = game.installState === "installed";

  return (
    <button className="game-card" onClick={() => onLaunch(game)} title={`Launch ${game.title}`}>
      <div className="game-card__art">
        {cover ? (
          <img src={cover} alt={game.title} loading="lazy" />
        ) : (
          <span className="game-card__placeholder">{game.title}</span>
        )}
        {game.favorite && <span className="game-card__star" aria-label="favorite">★</span>}
        <span
          className={`game-card__state game-card__state--${installed ? "on" : "off"}`}
          aria-label={installed ? "installed" : "not installed"}
        />
      </div>
      <div className="game-card__title">{game.title}</div>
      {game.platform && <div className="game-card__platform">{game.platform}</div>}
    </button>
  );
}
