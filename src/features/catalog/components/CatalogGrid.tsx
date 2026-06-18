// Responsive grid of variant groups: one tile per logical game (dumps collapsed).
// Supports a focused tile (gamepad/keyboard nav): it scrolls the focused card
// into view and reports the live column count up so the navigation math knows
// the grid width.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { VariantGroup } from "../variants";
import type { CardProgress } from "../../download/selectors";
import { GameCard } from "./GameCard";

interface Props {
  groups: VariantGroup[];
  onOpen: (group: VariantGroup) => void;
  /** Index of the tile highlighted by controller/keyboard nav, or -1 for none. */
  focusIndex?: number;
  /** Reports the measured column count whenever it changes (for nav math). */
  onColumns?: (columns: number) => void;
  /** Live install progress keyed by game id; a group shows a bar if any of its
   *  members is in-flight. */
  progress?: Record<string, CardProgress>;
}

/** Progress for a variant group: the first member with an in-flight install. */
function groupProgress(
  grp: VariantGroup,
  progress: Record<string, CardProgress>,
): CardProgress | undefined {
  for (const m of grp.members) {
    const p = progress[m.id];
    if (p) return p;
  }
  return undefined;
}

/** Count grid columns from the computed `grid-template-columns` track list. */
function measureColumns(el: HTMLElement): number {
  const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);
  return Math.max(1, tracks.length);
}

export function CatalogGrid({ groups, onOpen, focusIndex = -1, onColumns, progress = {} }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLButtonElement>(null);

  // Report column count on mount and whenever the grid resizes.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || !onColumns) return;
    const report = () => onColumns(measureColumns(el));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onColumns, groups.length]);

  // Keep the focused tile visible as nav moves.
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  if (groups.length === 0) {
    return <p className="catalog__empty">No games match.</p>;
  }
  return (
    <div className="catalog-grid" ref={gridRef}>
      {groups.map((grp, i) => (
        <GameCard
          key={grp.key}
          ref={i === focusIndex ? focusedRef : undefined}
          game={grp.representative}
          variantCount={grp.members.length}
          focused={i === focusIndex}
          onOpen={() => onOpen(grp)}
          progress={groupProgress(grp, progress)}
        />
      ))}
    </div>
  );
}
