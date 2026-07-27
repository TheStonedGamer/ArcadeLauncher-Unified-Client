// "Featured & Recommended" hero: a wide cover banner with a right info rail
// carrying title, rating and the green library CTA. Matches the "store-featured"
// Claude Design card. Purely a highlight — the grid below is the real browse.

import { useState } from "react";
import type { Game } from "../catalog/types";
import { coverSrc, ratingBadge } from "./cover";
import { LibraryToggle } from "./LibraryToggle";
import { InstalledNotOwnedBadge } from "../catalog/components/InstalledNotOwnedBadge";

interface Props {
  game: Game;
  owned: boolean;
  canModify: boolean;
  onOpen: () => void;
  onToggle: () => void;
  installedNotOwned?: boolean;
  /** How many picks the hero rotates through (1 = no rotation controls). */
  count?: number;
  /** Which pick is showing, for the dot indicator. */
  index?: number;
  /** Jump straight to a pick; the caller re-uses this as the rotation tick. */
  onSelect?: (index: number) => void;
  /** The shortlist came from tracked playtime rather than the rating fallback. */
  personalized?: boolean;
}

export function StoreFeatured({
  game,
  owned,
  canModify,
  onOpen,
  onToggle,
  installedNotOwned = false,
  count = 1,
  index = 0,
  onSelect,
  personalized = false,
}: Props) {
  // Re-keyed off the game id: the hero swaps games in place as it rotates, and
  // without this the previous cover would stay until the new one decoded.
  const [src, setSrc] = useState(coverSrc(game));
  const [shownFor, setShownFor] = useState(game.id);
  if (shownFor !== game.id) {
    setShownFor(game.id);
    setSrc(coverSrc(game));
  }
  const score = ratingBadge(game);
  return (
    <section className="featured">
      <div className="featured__head">
        <h2 className="astore__heading">Featured &amp; Recommended</h2>
        {personalized && (
          <span className="featured__why" title="Picked from the games you play most">
            Based on your playtime
          </span>
        )}
        {count > 1 && (
          <div className="featured__dots" role="tablist" aria-label="Recommendations">
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === index}
                aria-label={`Recommendation ${i + 1} of ${count}`}
                className={`featured__dot${i === index ? " featured__dot--active" : ""}`}
                onClick={() => onSelect?.(i)}
              />
            ))}
          </div>
        )}
      </div>
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
          {installedNotOwned && <InstalledNotOwnedBadge />}
          <div className="featured__cta">
            <LibraryToggle owned={owned} canModify={canModify} onToggle={onToggle} size="lg" />
            <span className="featured__price">Free</span>
          </div>
        </div>
      </div>
    </section>
  );
}
