// Responsive grid of game cards. Hidden games are filtered out here so the
// view stays declarative.

import type { Game } from "../types";
import { GameCard } from "./GameCard";

interface Props {
  games: Game[];
  onLaunch: (game: Game) => void;
}

export function CatalogGrid({ games, onLaunch }: Props) {
  const visible = games.filter((g) => !g.hidden);
  if (visible.length === 0) {
    return <p className="catalog__empty">No games to show yet.</p>;
  }
  return (
    <div className="catalog-grid">
      {visible.map((g) => (
        <GameCard key={g.id || g.title} game={g} onLaunch={onLaunch} />
      ))}
    </div>
  );
}
