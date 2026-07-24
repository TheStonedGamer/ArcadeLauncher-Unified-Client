// Store detail overlay: a game's page in the Store — hero cover, summary, meta,
// and the green library CTA. Installing/launching happens in the Library tab, so
// this intentionally has no Install button; adding here makes it appear there.
// Matches the "game-detail" Claude Design card.

import { useState } from "react";
import type { Game } from "../catalog/types";
import { coverSrc, ratingBadge } from "./cover";
import { LibraryToggle } from "./LibraryToggle";

interface Props {
  game: Game;
  owned: boolean;
  canModify: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function splitGenres(raw: string): string[] {
  return raw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function StoreDetail({ game, owned, canModify, onToggle, onClose }: Props) {
  const [src, setSrc] = useState(coverSrc(game));
  const score = ratingBadge(game);
  const genres = splitGenres(game.genres);

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="sdetail" onClick={(e) => e.stopPropagation()}>
        <button className="sdetail__close" onClick={onClose} aria-label="Close">×</button>
        <div className="sdetail__banner">
          <h1 className="sdetail__title">{game.title}</h1>
          <div className="sdetail__sub">
            {game.platform}
            {game.developer ? ` · ${game.developer}` : ""}
          </div>
        </div>
        <div className="sdetail__body">
          <div className="sdetail__media">
            <div className="sdetail__shot">
              {src ? (
                <img src={src} alt={game.title} onError={() => setSrc("")} />
              ) : (
                <span className="capsule__placeholder">{game.title}</span>
              )}
            </div>
            {game.summary && <p className="sdetail__summary">{game.summary}</p>}
          </div>
          <aside className="sdetail__panel">
            <div className="sdetail__cta">
              <LibraryToggle owned={owned} canModify={canModify} onToggle={onToggle} size="lg" stop={false} />
              <div className="sdetail__free">
                {owned ? "In your library · install from the Library tab" : "Free · adds to your library"}
              </div>
            </div>
            <div className="sdetail__meta">
              {score != null && (
                <div><span className="sdetail__k">Critic score</span> {score}/100</div>
              )}
              {game.developer && <div><span className="sdetail__k">Developer</span> {game.developer}</div>}
              {game.publisher && <div><span className="sdetail__k">Publisher</span> {game.publisher}</div>}
              {game.franchise && <div><span className="sdetail__k">Franchise</span> {game.franchise}</div>}
              <div><span className="sdetail__k">Platform</span> {game.platform}</div>
            </div>
            {genres.length > 0 && (
              <div className="sdetail__tags">
                {genres.map((t) => (
                  <span className="sdetail__tag" key={t}>{t}</span>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
