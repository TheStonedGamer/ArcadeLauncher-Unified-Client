// One store tile: portrait cover with a rating badge, title/platform, and the
// green library toggle. Matches the "store-capsules" Claude Design card.

import { useState } from "react";
import type { Game } from "../catalog/types";
import { coverSrc, ratingBadge } from "./cover";
import { LibraryToggle } from "./LibraryToggle";

interface Props {
  game: Game;
  owned: boolean;
  canModify: boolean;
  onOpen: () => void;
  onToggle: () => void;
}

export function StoreCapsule({ game, owned, canModify, onOpen, onToggle }: Props) {
  const [src, setSrc] = useState(coverSrc(game));
  const score = ratingBadge(game);
  return (
    <div className={`capsule${owned ? " capsule--owned" : ""}`}>
      <button className="capsule__art" onClick={onOpen} title={game.title}>
        {src ? (
          <img src={src} alt={game.title} loading="lazy" onError={() => setSrc("")} />
        ) : (
          <span className="capsule__placeholder">{game.title}</span>
        )}
        {score != null && <span className="capsule__score">{score}</span>}
      </button>
      <div className="capsule__body">
        <button className="capsule__title-btn" onClick={onOpen}>
          <div className="capsule__title" title={game.title}>{game.title}</div>
          {game.platform && <div className="capsule__platform">{game.platform}</div>}
        </button>
        <LibraryToggle owned={owned} canModify={canModify} onToggle={onToggle} />
      </div>
    </div>
  );
}
