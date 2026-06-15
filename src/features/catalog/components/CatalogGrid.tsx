// Responsive grid of variant groups: one tile per logical game (dumps collapsed).

import type { VariantGroup } from "../variants";
import { GameCard } from "./GameCard";

interface Props {
  groups: VariantGroup[];
  onOpen: (group: VariantGroup) => void;
}

export function CatalogGrid({ groups, onOpen }: Props) {
  if (groups.length === 0) {
    return <p className="catalog__empty">No games match.</p>;
  }
  return (
    <div className="catalog-grid">
      {groups.map((grp) => (
        <GameCard
          key={grp.key}
          game={grp.representative}
          variantCount={grp.members.length}
          onOpen={() => onOpen(grp)}
        />
      ))}
    </div>
  );
}
