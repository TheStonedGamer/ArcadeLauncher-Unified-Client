// The catalog screen: library path bar, sidebar (filters), a toolbar (search +
// sort), the filtered/sorted grid, and a detail modal. Query state lives here;
// the actual filtering/sorting is the pure applyQuery from query.ts.

import { useMemo, useState } from "react";
import { useCatalog } from "./useCatalog";
import { CatalogGrid } from "./components/CatalogGrid";
import { Sidebar } from "./components/Sidebar";
import { GameDetail } from "./components/GameDetail";
import { fetchCoverArt } from "./api";
import { applyQuery, buildSidebar, DEFAULT_QUERY, SORT_LABELS, type Filter, type Query, type SortMode } from "./query";
import { groupVariants, type VariantGroup } from "./variants";
import { useSettings } from "../settings/useSettings";
import type { Game } from "./types";

export function CatalogView() {
  const { games, loading, error, status, load, launch, setCover } = useCatalog();
  const { draft: settings } = useSettings();
  const hasIgdbCreds = settings.igdbClientId.trim() !== "" && settings.igdbClientSecret.trim() !== "";

  const fetchCover = async (game: Game): Promise<string | null> => {
    const path = await fetchCoverArt(game, settings.igdbClientId, settings.igdbClientSecret);
    if (path) setCover(game.id, path);
    return path;
  };
  const [path, setPath] = useState("");
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [selected, setSelected] = useState<VariantGroup | null>(null);

  const sidebar = useMemo(() => buildSidebar(games), [games]);
  const groups = useMemo(() => groupVariants(applyQuery(games, query)), [games, query]);

  const setFilter = (filter: Filter) => setQuery((q) => ({ ...q, filter }));

  return (
    <section className="catalog">
      <form
        className="catalog__bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) load(path.trim());
        }}
      >
        <input
          className="catalog__path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Path to library.json"
          spellCheck={false}
        />
        <button className="catalog__load" type="submit" disabled={loading || !path.trim()}>
          {loading ? "Loading…" : "Load catalog"}
        </button>
      </form>

      {error && <p className="catalog__error">{error}</p>}
      {!error && status && <p className="catalog__status">{status}</p>}

      <div className="catalog__layout">
        <Sidebar entries={sidebar} active={query.filter} onSelect={setFilter} />

        <div className="catalog__content">
          <div className="catalog__toolbar">
            <input
              className="catalog__search"
              value={query.search}
              onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))}
              placeholder="Search title, platform, dev, genre, year…"
              spellCheck={false}
            />
            <label className="catalog__sort">
              Sort
              <select
                value={query.sort}
                onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value as SortMode }))}
              >
                {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                  <option key={m} value={m}>
                    {SORT_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <span className="catalog__count">{groups.length}</span>
          </div>

          <CatalogGrid groups={groups} onOpen={setSelected} />
        </div>
      </div>

      {selected && (
        <GameDetail
          group={selected}
          onLaunch={(g) => {
            launch(g);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
          onFetchCover={hasIgdbCreds ? fetchCover : undefined}
        />
      )}
    </section>
  );
}
