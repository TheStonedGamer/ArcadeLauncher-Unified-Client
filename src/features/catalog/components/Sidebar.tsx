// Left navigation: the Steam-style library list — one row per game (variants
// collapsed into their group), sorted/filtered by the active query just like the
// grid. Clicking a row opens that game. Pure presentation.

import type { VariantGroup } from "../variants";

interface Props {
  groups: VariantGroup[];
  selectedId: string | null;
  onOpen: (group: VariantGroup) => void;
}

export function Sidebar({ groups, selectedId, onOpen }: Props) {
  return (
    <nav className="sidebar">
      {groups.length === 0 && <p className="sidebar__empty">No games</p>}
      {groups.map((g) => {
        const game = g.representative;
        const active = game.id === selectedId;
        return (
          <button
            key={game.id}
            className={`sidebar__item${active ? " sidebar__item--active" : ""}`}
            onClick={() => onOpen(g)}
            title={game.title}
          >
            <span className="sidebar__label">{game.title}</span>
            {game.platform && <span className="sidebar__count">{game.platform}</span>}
          </button>
        );
      })}
    </nav>
  );
}
