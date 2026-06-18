// The catalog screen: sidebar (filters), a toolbar (search + sort), the
// filtered/sorted grid, and a detail modal. The library.json location is
// resolved in Rust (per-user default) and auto-loaded on mount — there is no
// path bar. Query state lives here; the actual filtering/sorting is the pure
// applyQuery from query.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "./useCatalog";
import { useGamepad } from "../gamepad/useGamepad";
import { nextIndex } from "../gamepad/navigate";
import { setFullscreen } from "../gamepad/api";
import type { NavIntent } from "../gamepad/input";
import { CatalogGrid } from "./components/CatalogGrid";
import { Sidebar } from "./components/Sidebar";
import { GameDetail } from "./components/GameDetail";
import { applyQuery, buildSidebar, DEFAULT_QUERY, SORT_LABELS, type Filter, type Query, type SortMode } from "./query";
import { groupVariants, type VariantGroup } from "./variants";
import { useCatalogPrefs } from "./useCatalogPrefs";
import { applyPrefs } from "./prefs";
import { useSession } from "../session/SessionContext";
import { installGame } from "../download/api";
import { useInstallOverlay } from "../download/useInstallOverlay";
import { effectiveInstallState } from "../download/installState";
import { syncSaves, type ConflictPolicy, type SyncReport } from "../saves/api";
import type { CardProgress } from "../download/selectors";
import type { Game } from "./types";

interface CatalogViewProps {
  /** Live per-game install progress, keyed by game id (from the download hook).
   *  Threaded down to the grid so in-flight tiles show a progress bar. */
  downloadProgress?: Record<string, CardProgress>;
}

export function CatalogView({ downloadProgress = {} }: CatalogViewProps) {
  const { games, loading, error, status, load, syncFromServer, launch } = useCatalog();
  const prefs = useCatalogPrefs();
  const installOverlay = useInstallOverlay();
  const { session } = useSession();

  // Install trigger (T4d-3): start the engine for a server game using the
  // signed-in session's host + token. Disabled in the UI when no session.
  const startInstall = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to install");
      await installGame(session.host, session.token, game.id);
    },
    [session],
  );

  // Cloud-save sync (T8): diff the per-user save folder against the server and
  // upload/download as needed, authed with the session token.
  const runSaveSync = useCallback(
    async (game: Game, policy: ConflictPolicy): Promise<SyncReport> => {
      if (!session) throw new Error("sign in to sync saves");
      const savePath = prefs.prefs.savePaths[game.id] ?? "";
      return syncSaves(session.host, session.token, game.id, policy, savePath);
    },
    [session, prefs],
  );

  // Overlay the user's favorite/hidden/collection overrides onto the read-only
  // catalog before any querying; downstream code never sees raw library.json.
  // The install overlay then layers live install state (from records + download
  // events) on top so the Install button reflects what's on disk without a reload.
  const merged = useMemo(() => {
    const withPrefs = applyPrefs(games, prefs.prefs);
    return withPrefs.map((g) => {
      const state = effectiveInstallState(g.id, g.installState, installOverlay);
      return state === g.installState ? g : { ...g, installState: state };
    });
  }, [games, prefs.prefs, installOverlay]);

  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const autoLoaded = useRef(false);
  const syncedFor = useRef<string | null>(null);

  // Show the locally cached catalog immediately on first mount (offline-friendly,
  // no path for the user to manage — it's resolved in Rust).
  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    void load();
  }, [load]);

  // Once signed in, refresh from the server (and re-cache library.json). Keyed
  // on the token so it runs once per session, not on every re-render.
  useEffect(() => {
    if (!session) return;
    if (syncedFor.current === session.token) return;
    syncedFor.current = session.token;
    void syncFromServer(session.host, session.token);
  }, [session, syncFromServer]);
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
      {loading && <p className="catalog__status">Loading catalog…</p>}
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
            progress={downloadProgress}
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
          onToggleFavorite={prefs.toggleFavorite}
          onToggleHidden={prefs.toggleHidden}
          onAddCollection={prefs.addToCollection}
          onRemoveCollection={prefs.removeFromCollection}
          onInstall={startInstall}
          canInstall={!!session}
          onSyncSaves={runSaveSync}
          canSync={!!session}
          onSetSavePath={prefs.setSavePath}
          savePathFor={(g) => prefs.prefs.savePaths[g.id] ?? ""}
        />
      )}
    </section>
  );
}
