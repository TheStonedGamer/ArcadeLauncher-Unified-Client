// The catalog screen: sidebar (filters), a toolbar (search + sort), the
// filtered/sorted grid, and a detail modal. The library.json location is
// resolved in Rust (per-user default) and auto-loaded on mount — there is no
// path bar. Query state lives here; the actual filtering/sorting is the pure
// applyQuery from query.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "./useCatalog";
import { useGamepad } from "../gamepad/useGamepad";
import { useControllerConfig } from "../gamepad/ControllerConfigContext";
import { nextIndex, pageIndex } from "../gamepad/navigate";
import { setFullscreen } from "../gamepad/api";
import type { NavIntent } from "../gamepad/input";
import { ControllerHints } from "../gamepad/ControllerHints";
import { CatalogGrid } from "./components/CatalogGrid";
import { ContinuePlayingRow } from "./components/ContinuePlayingRow";
import { LibraryStatsPanel } from "./components/LibraryStatsPanel";
import { recentlyPlayed } from "./stats";
import { CardContextMenu, type CardMenuTarget } from "./components/CardContextMenu";
import { Sidebar } from "./components/Sidebar";
import { GameDetail } from "./components/GameDetail";
import { applyQuery, buildSidebar, DEFAULT_QUERY, SORT_LABELS, type Filter, type Query, type SortMode } from "./query";
import { groupVariants, type VariantGroup } from "./variants";
import { useCatalogPrefs } from "./useCatalogPrefs";
import { applyPrefs } from "./prefs";
import { useSession } from "../session/SessionContext";
import { useSettings } from "../settings/useSettings";
import { searchArtwork, applyCover } from "./api";
import { installGame, updateGame, verifyGame } from "../download/api";
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
  const prefs = useCatalogPrefs();
  const { session } = useSession();
  const { draft: settings } = useSettings();
  // Wire cloud-save auto-sync (T12i) into the launch/exit lifecycle: pull before
  // launch, snapshot + push on exit, gated by the user's Settings toggles.
  const { games, loading, error, status, load, syncFromServer, launch } = useCatalog({
    session,
    autoSync: settings.autoSync,
    savePathById: (id) => prefs.prefs.savePaths[id] ?? "",
  });
  const installOverlay = useInstallOverlay(session);

  // Install trigger (T4d-3): start the engine for a server game using the
  // signed-in session's host + token. Disabled in the UI when no session.
  const startInstall = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to install");
      await installGame(session.host, session.token, game.id);
    },
    [session],
  );

  // Validate & repair: re-check every manifest file on disk by size + SHA-256
  // and re-download mismatches (mirrors the native launcher). Same download
  // progress/status events as a normal install.
  const startVerify = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to verify");
      await verifyGame(session.host, session.token, game.id);
    },
    [session],
  );

  // Apply an available update (T12c): re-pull only the changed files via the
  // verify engine pass, which finalizes the record at the new version.
  const startUpdate = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to update");
      await updateGame(session.host, session.token, game.id);
    },
    [session],
  );

  // Artwork picker (T12b): search SteamGridDB for covers (needs the user's API
  // key) and apply a chosen one — download it, then record the cover override so
  // the grid + detail panel show it without rewriting library.json.
  const apiKey = settings.steamgriddbApiKey?.trim() ?? "";
  const findArtwork = useCallback(
    (game: Game) => searchArtwork(game.title, apiKey),
    [apiKey],
  );
  const pickArtwork = useCallback(
    async (game: Game, url: string): Promise<string> => {
      const localPath = await applyCover(game.id, url);
      prefs.setCover(game.id, localPath);
      return localPath;
    },
    [prefs],
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

  // Restore the last sidebar filter + sort so the chosen scope (e.g. Installed)
  // survives a relaunch. Search text is intentionally not persisted — a stale
  // query on startup is confusing.
  const [query, setQuery] = useState<Query>(() => {
    try {
      const saved = localStorage.getItem("catalog.query");
      if (saved) {
        const p = JSON.parse(saved) as Partial<Query>;
        return { ...DEFAULT_QUERY, filter: p.filter ?? DEFAULT_QUERY.filter, sort: p.sort ?? DEFAULT_QUERY.sort };
      }
    } catch {
      // ignore malformed/absent storage
    }
    return DEFAULT_QUERY;
  });
  useEffect(() => {
    try {
      localStorage.setItem("catalog.query", JSON.stringify({ filter: query.filter, sort: query.sort }));
    } catch {
      // storage may be unavailable; persistence is best-effort
    }
  }, [query.filter, query.sort]);
  const autoLoaded = useRef(false);
  const syncedFor = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Clear the search box and keep the cursor in it, so the user can immediately
  // type a new query (used by the X button and the Esc key).
  const clearSearch = useCallback(() => {
    setQuery((q) => ({ ...q, search: "" }));
    searchRef.current?.focus();
  }, []);

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
  const [cardMenu, setCardMenu] = useState<CardMenuTarget | null>(null);

  const openCardMenu = useCallback((group: VariantGroup, e: React.MouseEvent) => {
    e.preventDefault();
    setCardMenu({ game: group.representative, x: e.clientX, y: e.clientY });
  }, []);

  const sidebar = useMemo(() => buildSidebar(merged), [merged]);
  const groups = useMemo(() => groupVariants(applyQuery(merged, query)), [merged, query]);

  // "Continue Playing" strip: only when browsing All Games with no active search,
  // so it doesn't fight a filtered/searched result set. Recomputed from the
  // prefs-overlaid catalog (hidden games excluded inside recentlyPlayed).
  const showContinue = query.filter.kind === "all" && query.search.trim() === "";
  const continueGames = useMemo(
    () => (showContinue ? recentlyPlayed(merged) : []),
    [showContinue, merged],
  );

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
      // A detail modal is open → A launches, B closes, Guide still toggles BP.
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
        case "pageUp":
        case "pageDown":
          setFocusIndex((i) => pageIndex(i < 0 ? 0 : i, intent, groups.length, columns.current));
          break;
        case "select":
        case "context":
          // A opens the focused tile; X (context) does the same — the detail
          // modal is where per-game actions live.
          if (focusIndex >= 0 && groups[focusIndex]) setSelected(groups[focusIndex]);
          break;
        case "search":
          searchRef.current?.focus();
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

  const controller = useControllerConfig();
  useGamepad(onIntent, { enabled: controller.enabled, deadZone: controller.deadZone });

  return (
    <section className={`catalog${bigPicture ? " catalog--bigpicture" : ""}`}>
      {loading && <p className="catalog__status">Loading catalog…</p>}
      {error && <p className="catalog__error">{error}</p>}
      {!error && status && <p className="catalog__status">{status}</p>}

      <div className="catalog__layout">
        <Sidebar entries={sidebar} active={query.filter} onSelect={setFilter} />

        <div className="catalog__content">
          <div className="catalog__toolbar">
            <div className="catalog__search-wrap">
              <input
                ref={searchRef}
                className="catalog__search"
                value={query.search}
                onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query.search) {
                    e.preventDefault();
                    clearSearch();
                  }
                }}
                placeholder="Search title, platform, dev, genre, year…"
                spellCheck={false}
              />
              {query.search && (
                <button
                  type="button"
                  className="catalog__search-clear"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                >
                  ×
                </button>
              )}
            </div>
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
              title="Big Picture mode (gamepad Guide)"
              aria-pressed={bigPicture}
            >
              {bigPicture ? "Exit Big Picture" : "Big Picture"}
            </button>
          </div>

          {showContinue && <LibraryStatsPanel games={merged} />}

          {continueGames.length > 0 && (
            <ContinuePlayingRow games={continueGames} nowMs={Date.now()} onLaunch={launch} />
          )}

          <CatalogGrid
            groups={groups}
            onOpen={setSelected}
            focusIndex={focusIndex}
            onColumns={(c) => (columns.current = c)}
            progress={downloadProgress}
            onContextMenu={openCardMenu}
          />
        </div>
      </div>

      {cardMenu && (
        <CardContextMenu
          target={cardMenu}
          canInstall={!!session}
          onLaunch={launch}
          onInstall={(g) => void startInstall(g)}
          onVerify={(g) => void startVerify(g)}
          onToggleFavorite={prefs.toggleFavorite}
          onToggleHidden={prefs.toggleHidden}
          onClose={() => setCardMenu(null)}
        />
      )}

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
          onUpdate={startUpdate}
          canInstall={!!session}
          onSyncSaves={runSaveSync}
          canSync={!!session}
          onSetSavePath={prefs.setSavePath}
          savePathFor={(g) => prefs.prefs.savePaths[g.id] ?? ""}
          onFindArtwork={apiKey ? findArtwork : undefined}
          onPickArtwork={apiKey ? pickArtwork : undefined}
        />
      )}

      <ControllerHints context={selected ? "detail" : "grid"} />
    </section>
  );
}
