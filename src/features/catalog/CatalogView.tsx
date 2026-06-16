// The catalog screen: library path bar, sidebar (filters), a toolbar (search +
// sort), the filtered/sorted grid, and a detail modal. Query state lives here;
// the actual filtering/sorting is the pure applyQuery from query.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "./useCatalog";
import { useGamepad } from "../gamepad/useGamepad";
import { nextIndex } from "../gamepad/navigate";
import { setFullscreen } from "../gamepad/api";
import type { NavIntent } from "../gamepad/input";
import { CatalogGrid } from "./components/CatalogGrid";
import { Sidebar } from "./components/Sidebar";
import { GameDetail } from "./components/GameDetail";
import { fetchCoverArt } from "./api";
import { applyQuery, buildSidebar, DEFAULT_QUERY, SORT_LABELS, type Filter, type Query, type SortMode } from "./query";
import { groupVariants, type VariantGroup } from "./variants";
import { useSettings } from "../settings/useSettings";
import { useCatalogPrefs } from "./useCatalogPrefs";
import { applyPrefs } from "./prefs";
import { useSession } from "../session/SessionContext";
import { installGame } from "../download/api";
import type { Game } from "./types";

export function CatalogView() {
  const { games, loading, error, status, load, launch, setCover } = useCatalog();
  const { draft: settings } = useSettings();
  const prefs = useCatalogPrefs();
  const { session } = useSession();
  const hasIgdbCreds = settings.igdbClientId.trim() !== "" && settings.igdbClientSecret.trim() !== "";

  // Install trigger (T4d-3): start the engine for a server game using the
  // signed-in session's host + token. Disabled in the UI when no session.
  const startInstall = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to install");
      await installGame(session.host, session.token, game.id);
    },
    [session],
  );

  // Overlay the user's favorite/hidden/collection overrides onto the read-only
  // catalog before any querying; downstream code never sees raw library.json.
  const merged = useMemo(() => applyPrefs(games, prefs.prefs), [games, prefs.prefs]);

  const fetchCover = async (game: Game): Promise<string | null> => {
    const path = await fetchCoverArt(game, settings.igdbClientId, settings.igdbClientSecret);
    if (path) setCover(game.id, path);
    return path;
  };
  const [path, setPath] = useState("");
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [selected, setSelected] = useState<VariantGroup | null>(null);

  const sidebar = useMemo(() => buildSidebar(merged), [merged]);
  const groups = useMemo(() => groupVariants(applyQuery(merged, query)), [merged, query]);

  const setFilter = (filter: Filter) => setQuery((q) => ({ ...q, filter }));

  // --- Controller / Big Picture navigation (T7c) ---
  const [focusIndex, setFocusIndex] = useState(-1);
  const [bigPicture, setBigPicture] = useState(false);
  const columns = useRef(1);
  // Keep focus in range as the result set changes.
  useEffect(() => {
    setFocusIndex((i) => (groups.length === 0 ? -1 : Math.min(Math.max(i, 0), groups.length - 1)));
  }, [groups.length]);

  const toggleBigPicture = useCallback(() => {
    setBigPicture((on) => {
      const next = !on;
      void setFullscreen(next).catch(() => {});
      return next;
    });
  }, []);

  const onIntent = useCallback(
    (intent: NavIntent) => {
      // A detail modal is open → A launches, B closes, Y still toggles BP.
      if (selected) {
        if (intent === "select") {
          launch(selected.representative);
          setSelected(null);
        } else if (intent === "back") {
          setSelected(null);
        } else if (intent === "bigpicture") {
          toggleBigPicture();
        }
        return;
      }
      switch (intent) {
        case "up":
        case "down":
        case "left":
        case "right":
          setFocusIndex((i) => nextIndex(i < 0 ? 0 : i, intent, groups.length, columns.current));
          break;
        case "select":
          if (focusIndex >= 0 && groups[focusIndex]) setSelected(groups[focusIndex]);
          break;
        case "back":
          if (bigPicture) toggleBigPicture();
          break;
        case "bigpicture":
          toggleBigPicture();
          break;
      }
    },
    [selected, groups, focusIndex, bigPicture, launch, toggleBigPicture],
  );

  useGamepad(onIntent);

  return (
    <section className={`catalog${bigPicture ? " catalog--bigpicture" : ""}`}>
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
            <button
              type="button"
              className="catalog__bigpicture"
              onClick={toggleBigPicture}
              title="Big Picture mode (gamepad Y)"
              aria-pressed={bigPicture}
            >
              {bigPicture ? "Exit Big Picture" : "Big Picture"}
            </button>
          </div>

          <CatalogGrid
            groups={groups}
            onOpen={setSelected}
            focusIndex={focusIndex}
            onColumns={(c) => (columns.current = c)}
          />
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
          onToggleFavorite={prefs.toggleFavorite}
          onToggleHidden={prefs.toggleHidden}
          onAddCollection={prefs.addToCollection}
          onRemoveCollection={prefs.removeFromCollection}
          onInstall={startInstall}
          canInstall={!!session}
        />
      )}
    </section>
  );
}
