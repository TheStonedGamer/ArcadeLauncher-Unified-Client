// "Featured & Recommended" hero: a wide cover banner with a right info rail
// carrying title, rating and the green library CTA. Matches the "store-featured"
// Claude Design card. Purely a highlight — the grid below is the real browse.

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

export function StoreFeatured({ game, owned, canModify, onOpen, onToggle }: Props) {
  const [src, setSrc] = useState(coverSrc(game));
  const score = ratingBadge(game);
  return (
    <section className="featured">
      <h2 className="astore__heading">Featured &amp; Recommended</h2>
      <div className="featured__body">
        <button className="featured__hero" onClick={onOpen} title={game.title}>
          {src ? (
            <img src={src} alt={game.title} onError={() => setSrc("")} />
          ) : (
            <span className="featured__logo">{game.title}</span>
          )}
        </button>
        <div className="featured__rail">
          <h3 className="featured__title">{game.title}</h3>
          <div className="featured__sub">
            {game.platform}
            {score != null ? ` · Critic score ${score}/100` : ""}
          </div>
          {game.summary && <p className="featured__summary">{game.summary}</p>}
          <div className="featured__cta">
            <LibraryToggle owned={owned} canModify={canModify} onToggle={onToggle} size="lg" />
            <span className="featured__price">Free</span>
          </div>
        </div>
      </div>
    </section>
  );
}
