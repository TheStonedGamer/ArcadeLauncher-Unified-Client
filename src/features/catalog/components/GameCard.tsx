// A single game tile: cover art (or a titled placeholder) with a favorite star
// and install-state dot. Pure presentation — click handling is passed in.

import { forwardRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";
import type { CardProgress } from "../../download/selectors";

interface Props {
  game: Game;
  /** Number of ROM dumps collapsed under this tile (1 = no variants). */
  variantCount?: number;
  /** Highlighted by gamepad/keyboard navigation. */
  focused?: boolean;
  /** Live install progress while this game is downloading (absent = not in-flight). */
  progress?: CardProgress;
  onOpen: (game: Game) => void;
  /** Right-click on the tile (for the per-game context menu). */
  onContextMenu?: (game: Game, e: React.MouseEvent) => void;
}

/** Short label for the in-flight phase shown next to the bar. */
function phaseLabel(p: CardProgress): string {
  switch (p.status) {
    case "queued":
      return "Queued";
    case "verifying":
      return "Verifying…";
    case "extracting":
      return "Extracting…";
    case "paused":
      return "Paused";
    default:
      return `${p.percent}%`;
  }
}

export const GameCard = forwardRef<HTMLButtonElement, Props>(function GameCard(
  { game, variantCount = 1, focused = false, progress, onOpen, onContextMenu },
  ref,
) {
  const cover = game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl;
  const installed = game.installState === "installed";
  // A bar fills proportionally while downloading; queued/verifying/extracting
  // show an indeterminate-ish full-width tint with a label instead of a number.
  const determinate = progress?.status === "downloading" || progress?.status === "paused";

  return (
    <button
      ref={ref}
      className={`game-card${focused ? " game-card--focused" : ""}`}
      onClick={() => onOpen(game)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(game, e) : undefined}
      title={game.title}
    >
      <div className="game-card__art">
        {progress && (
          <div className="game-card__progress" role="progressbar" aria-valuenow={progress.percent}>
            <div
              className={`game-card__progress-fill${determinate ? "" : " game-card__progress-fill--pulse"}`}
              style={{ width: determinate ? `${progress.percent}%` : "100%" }}
            />
            <span className="game-card__progress-label">{phaseLabel(progress)}</span>
          </div>
        )}
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
