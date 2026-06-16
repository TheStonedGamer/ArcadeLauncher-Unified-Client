// A single game tile: cover art (or a titled placeholder) with a favorite star
// and install-state dot. Pure presentation — click handling is passed in.

import { forwardRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";

interface Props {
  game: Game;
  /** Number of ROM dumps collapsed under this tile (1 = no variants). */
  variantCount?: number;
  /** Highlighted by gamepad/keyboard navigation. */
  focused?: boolean;
  onOpen: (game: Game) => void;
}

export const GameCard = forwardRef<HTMLButtonElement, Props>(function GameCard(
  { game, variantCount = 1, focused = false, onOpen },
  ref,
) {
  const cover = game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl;
  const installed = game.installState === "installed";

  return (
    <button
      ref={ref}
      className={`game-card${focused ? " game-card--focused" : ""}`}
      onClick={() => onOpen(game)}
      title={game.title}
    >
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
        {variantCount > 1 && (
          <span className="game-card__variants" title={`${variantCount} versions`}>
            ×{variantCount}
          </span>
        )}
      </div>
      <div className="game-card__title">{game.title}</div>
      {game.platform && <div className="game-card__platform">{game.platform}</div>}
    </button>
  );
});
