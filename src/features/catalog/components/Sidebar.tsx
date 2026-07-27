// Left navigation: the Steam-style library list. A "Search by Name" box filters
// the rows, and the rows themselves are grouped into collapsible collections
// (Favorites / Installed / All Games) with a count in each header, matching the
// Steam client's library sidebar. Each row is a small square icon plus the
// title. Clicking a row opens that game.
//
// The search box here is intentionally *local*: it narrows this list only, and
// leaves the grid's own query alone, exactly as Steam's does.

import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { VariantGroup } from "../variants";

interface Props {
  groups: VariantGroup[];
  selectedId: string | null;
  onOpen: (group: VariantGroup) => void;
}

interface Collection {
  id: string;
  label: string;
  groups: VariantGroup[];
}

/** Split the list into Steam-like collections. A game can appear in more than
 *  one (Favorites also lists under All Games), which is how Steam behaves. */
export function collections(groups: VariantGroup[]): Collection[] {
  const favorites = groups.filter((g) => g.representative.favorite);
  const installed = groups.filter((g) =>
    g.members.some((m) => m.installState === "installed"),
  );
  const all: Collection[] = [];
  if (favorites.length) all.push({ id: "favorites", label: "Favorites", groups: favorites });
  if (installed.length) all.push({ id: "installed", label: "Installed", groups: installed });
  all.push({ id: "all", label: "All Games", groups });
  return all;
}

/** Cover art for a row icon, falling back to the remote URL then to nothing. */
function iconSrc(group: VariantGroup): string {
  const game = group.representative;
  return game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl || "";
}

export function Sidebar({ groups, selectedId, onOpen }: Props) {
  const [filter, setFilter] = useState("");
  // Collapsed section ids. Everything starts expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? groups.filter((g) => g.representative.title.toLowerCase().includes(needle))
      : groups;
    return collections(matched);
  }, [groups, filter]);

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <nav className="sidebar">
      <div className="sidebar__search-wrap">
        <input
          className="sidebar__search"
          type="search"
          value={filter}
          placeholder="Search by Name"
          aria-label="Search library by name"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="sidebar__list">
        {groups.length === 0 && <p className="sidebar__empty">No games</p>}
        {groups.length > 0 && sections.every((s) => s.groups.length === 0) && (
          <p className="sidebar__empty">No games match.</p>
        )}
        {sections.map((section) => {
          const shut = !!collapsed[section.id];
          return (
            <section className="sidebar__section" key={section.id}>
              <button
                type="button"
                className="sidebar__header"
                onClick={() => toggle(section.id)}
                aria-expanded={!shut}
              >
                <span className="sidebar__caret" aria-hidden>
                  {shut ? "▸" : "▾"}
                </span>
                <span className="sidebar__header-label">{section.label}</span>
                <span className="sidebar__header-count">({section.groups.length})</span>
              </button>
              {!shut &&
                section.groups.map((g) => {
                  const game = g.representative;
                  const active = game.id === selectedId;
                  const icon = iconSrc(g);
                  return (
                    <button
                      key={`${section.id}-${game.id}`}
                      className={`sidebar__item${active ? " sidebar__item--active" : ""}`}
                      onClick={() => onOpen(g)}
                      title={game.title}
                    >
                      <span className="sidebar__icon" aria-hidden>
                        {icon ? (
                          <img src={icon} alt="" loading="lazy" />
                        ) : (
                          game.title.trim()[0]?.toUpperCase() ?? "?"
                        )}
                      </span>
                      <span className="sidebar__label">{game.title}</span>
                    </button>
                  );
                })}
            </section>
          );
        })}
      </div>
    </nav>
  );
}
