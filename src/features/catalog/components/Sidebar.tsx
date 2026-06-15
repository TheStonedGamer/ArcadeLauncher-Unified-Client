// Left navigation: All / Favorites / platforms / collections, each with a count.
// Built from the loaded games via buildSidebar; selection drives the active
// filter. Pure presentation.

import type { Filter, SidebarEntry } from "../query";

interface Props {
  entries: SidebarEntry[];
  active: Filter;
  onSelect: (filter: Filter) => void;
}

function sameFilter(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false;
  if ("value" in a && "value" in b) return a.value === b.value;
  return true;
}

export function Sidebar({ entries, active, onSelect }: Props) {
  return (
    <nav className="sidebar">
      {entries.map((e) => (
        <button
          key={e.id}
          className={`sidebar__item${sameFilter(e.filter, active) ? " sidebar__item--active" : ""}`}
          onClick={() => onSelect(e.filter)}
        >
          <span className="sidebar__label">{e.label}</span>
          <span className="sidebar__count">{e.count}</span>
        </button>
      ))}
    </nav>
  );
}
