// The catalog screen: sidebar (Steam-style game list), a toolbar (search +
// sort), the filtered/sorted grid, and a detail modal. The library.json is
// resolved in Rust (per-user default) and auto-loaded on mount — there is no
// path bar. Query state lives here; the actual filtering/sorting is the pure
// applyQuery from query.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
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
import { WeeklyRecapPanel } from "./components/WeeklyRecapPanel";
import { recentlyPlayed } from "./stats";
import { CardContextMenu, type CardMenuTarget } from "./components/CardContextMenu";
import { Sidebar } from "./components/Sidebar";
import { GameDetail } from "./components/GameDetail";
import {
  applyQuery,
  buildSidebar,
  DEFAULT_QUERY,
  filterFromId,
  SORT_LABELS,
  type Query,
  type SortMode,
} from "./query";
import { groupVariants, type VariantGroup } from "./variants";
import { useCatalogPrefs } from "./useCatalogPrefs";
import { applyPrefs } from "./prefs";
import { useSession } from "../session/SessionContext";
import { useSettings } from "../settings/useSettings";
import { searchArtwork, applyCover } from "./api";
import {
  installGame,
  updateGame,
  verifyGame,
  openInstallDir,
  uninstallGame,
} from "../download/api";
import { useInstallOverlay } from "../download/useInstallOverlay";
import { effectiveInstallState } from "../download/installState";
import { listLibraryFolders, moveInstall } from "../library/api";
import { useMoveProgress } from "../library/useMoveProgress";
import { InstallLocationModal } from "../library/InstallLocationModal";
import { MoveLocationModal } from "../library/MoveLocationModal";
import type { LibraryFolderInfo } from "../library/types";
import {
  syncSaves,
  listSaveVersions,
  snapshotSaves,
  restoreSaveVersion,
  defaultSavePath,
  type ConflictPolicy,
  type SyncReport,
} from "../saves/api";
import type { CardProgress } from "../download/selectors";
import type { Game } from "./types";
import {
  isInstalledWithoutOwnership,
  shouldShowInLibrary,
} from "./ownershipDisplay";

/** How the scope dropdown is sectioned. Order matters: built-ins first, then
 *  platforms, then the user's collections. */
const SCOPE_GROUPS: { label: string; match: (s: { id: string }) => boolean }[] = [
  { label: "", match: (s) => !s.id.includes(":") },
  { label: "Platforms", match: (s) => s.id.startsWith("platform:") },
  { label: "Collections", match: (s) => s.id.startsWith("collection:") },
];

interface CatalogViewProps {
  /** Live per-game install progress, keyed by game id (from the download hook).
   *  Threaded down to the grid so in-flight tiles show a progress bar. */
  downloadProgress?: Record<string, CardProgress>;
  /** The signed-in account's owned game ids. When provided (signed in and the
   *  library has loaded), the Library tab shows ONLY these — everything else
   *  lives in the Store tab, Steam-style. Undefined = show the whole catalog
   *  (signed out, or ownership not yet resolved). */
  ownedIds?: Set<string>;
  onRemoveFromLibrary?: (id: string) => Promise<void>;
}

export function CatalogView({
  downloadProgress = {},
  ownedIds,
  onRemoveFromLibrary,
}: CatalogViewProps) {
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
  const { states: installOverlay, setGameState: setInstallState } =
    useInstallOverlay(session);
  const { moves, clear: clearMove } = useMoveProgress();

  // Steam-style install-location prompt: only shown when more than one library
  // folder exists. `installPrompt` holds the game + the folder list while open.
  const [installPrompt, setInstallPrompt] = useState<{ game: Game; folders: LibraryFolderInfo[] } | null>(null);
  // Move prompt: the game whose files we're relocating + the target folder list.
  const [movePrompt, setMovePrompt] = useState<{ game: Game; folders: LibraryFolderInfo[] } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState("");

  // Fire the engine for a given install root (undefined → server's default
  // library folder, decided in Rust).
  const runInstall = useCallback(
    async (game: Game, installRoot?: string) => {
      if (!session) throw new Error("sign in to install");
      await installGame(session.host, session.token, game.id, installRoot);
    },
    [session],
  );

  // Install trigger (T4d-3): start the engine for a server game using the
  // signed-in session's host + token. With more than one library folder, prompt
  // for which one (Steam-style); with one (or none on error) install straight in.
  const startInstall = useCallback(
    async (game: Game) => {
      if (!session) throw new Error("sign in to install");
      let folders: LibraryFolderInfo[] = [];
      try {
        folders = await listLibraryFolders();
      } catch {
        // Library listing failed — fall back to the default-root install.
      }
      if (folders.length > 1) {
        setInstallPrompt({ game, folders });
        return;
      }
      await runInstall(game);
    },
    [session, runInstall],
  );

  // Open the move prompt for an installed game (offers every library folder; the
  // Rust side rejects a no-op move into the folder it already lives in).
  const startMove = useCallback(async (game: Game) => {
    setMoveError("");
    let folders: LibraryFolderInfo[] = [];
    try {
      folders = await listLibraryFolders();
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : String(e));
    }
    setMovePrompt({ game, folders });
  }, []);

  // Run the relocation: the progress bar is driven by `library://move-progress`
  // (via useMoveProgress); the promise resolves once the record is rewritten.
  const confirmMove = useCallback(
    async (targetPath: string) => {
      if (!movePrompt) return;
      const id = movePrompt.game.id;
      setMoveBusy(true);
      setMoveError("");
      try {
        await moveInstall(id, targetPath);
        clearMove(id);
        setMovePrompt(null);
      } catch (e) {
        setMoveError(e instanceof Error ? e.message : String(e));
        clearMove(id);
      } finally {
        setMoveBusy(false);
      }
    },
    [movePrompt, clearMove],
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

  // Open the game's install folder in the OS file manager. The Rust side
  // resolves the recorded install dir (clean-title path), so this just needs the
  // game id; surfaces a clear error if it isn't on disk.
  const openFolder = useCallback(async (game: Game) => {
    await openInstallDir(game.id);
  }, []);

  const uninstall = useCallback(
    async (game: Game) => {
      const approved = await confirm(
        `Uninstall ${game.title}?\n\nThis permanently deletes its local game files. The game will remain in your library and can be installed again later.`,
        { title: `Uninstall ${game.title}`, kind: "warning" },
      );
      if (!approved) return;
      try {
        await uninstallGame(game.id);
        setInstallState(game.id, "notInstalled");
      } catch (e) {
        await message(e instanceof Error ? e.message : String(e), {
          title: "Uninstall failed",
          kind: "error",
        });
      }
    },
    [setInstallState],
  );

  const removeOwnedGame = useCallback(
    async (game: Game) => {
      if (!onRemoveFromLibrary) return;
      const onDisk =
        game.installState === "installed" ||
        game.installState === "updateAvailable";
      const approved = await confirm(
        `Remove ${game.title} from your library?${onDisk ? "\n\nIts installed files will remain on this PC. Uninstall it first if you also want to delete them." : ""}`,
        { title: "Remove from Library", kind: "warning" },
      );
      if (!approved) return;
      try {
        await onRemoveFromLibrary(game.id);
      } catch (e) {
        await message(e instanceof Error ? e.message : String(e), {
          title: "Remove from Library failed",
          kind: "error",
        });
      }
    },
    [onRemoveFromLibrary],
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

  // Fill in each installed game's real save location once, so cloud saves cover
  // the files the emulator (or the game) actually writes rather than the empty
  // managed folder. Detection only ever returns a path that exists, the result is
  // stored as an ordinary override the user can see and change, and a game that
  // already has one is skipped — so this never silently redirects a sync the user
  // has configured. Installed games only: detection stats the disk, and an
  // uninstalled game has nothing to sync.
  const detectedFor = useRef(new Set<string>());
  useEffect(() => {
    const pending = games.filter(
      (g) =>
        (g.installState === "installed" || g.installState === "updateAvailable") &&
        !prefs.prefs.savePaths[g.id] &&
        !detectedFor.current.has(g.id),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const game of pending) {
        detectedFor.current.add(game.id);
        const found = await defaultSavePath(game.id, game.platform, game.title).catch(() => null);
        if (cancelled) return;
        if (found) prefs.setSavePath(game, found);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [games, prefs]);

  // Point cloud saves at a real location. "folder" and "file" open the native
  // picker (a file for emulators that keep a single memory-card image); "default"
  // clears the override so the detected location — or the managed folder, when
  // nothing is detected — takes over again. Cancelling the picker changes nothing.
  const setSaveLocation = useCallback(
    async (game: Game, pick: "folder" | "file" | "default") => {
      if (pick === "default") {
        prefs.setSavePath(game, "");
        return;
      }
      const current = prefs.prefs.savePaths[game.id] ?? "";
      const detected = current || (await defaultSavePath(game.id, game.platform, game.title).catch(() => null));
      const chosen = await open({
        directory: pick === "folder",
        multiple: false,
        title: pick === "folder" ? `Cloud save folder for ${game.title}` : `Cloud save file for ${game.title}`,
        defaultPath: detected || undefined,
      });
      if (typeof chosen === "string") prefs.setSavePath(game, chosen);
    },
    [prefs],
  );

  // Save version-history (T12i): snapshots live under a managed per-game folder,
  // so these don't need the session — but they honor the configured save path.
  const listVersions = useCallback((game: Game) => listSaveVersions(game.id), []);
  const snapshotNow = useCallback(
    (game: Game) => snapshotSaves(game.id, prefs.prefs.savePaths[game.id] ?? ""),
    [prefs],
  );
  const restoreVersion = useCallback(
    (game: Game, versionId: string) =>
      restoreSaveVersion(game.id, versionId, prefs.prefs.savePaths[game.id] ?? ""),
    [prefs],
  );

  // Overlay the user's favorite/hidden/collection overrides onto the read-only
  // catalog before any querying; downstream code never sees raw library.json.
  // The install overlay then layers live install state (from records + download
  // events) on top so the Install button reflects what's on disk without a reload.
  const merged = useMemo(() => {
    const withPrefs = applyPrefs(games, prefs.prefs);
    const withInstallState = withPrefs.map((g) => {
      const state = effectiveInstallState(g.id, g.installState, installOverlay);
      return state === g.installState ? g : { ...g, installState: state };
    });
    return withInstallState.filter((g) => shouldShowInLibrary(g, ownedIds));
  }, [games, prefs.prefs, installOverlay, ownedIds]);

  // Restore the last sort and scope so both survive a relaunch. A restored scope
  // is safe now that the toolbar exposes a control for it: it is resolved
  // through filterFromId against the scopes that actually exist, so a collection
  // the user has since emptied falls back to All Games instead of showing an
  // empty library with no obvious way out. Search text is intentionally not
  // persisted — a stale query on startup is confusing.
  const [query, setQuery] = useState<Query>(() => {
    try {
      const saved = localStorage.getItem("catalog.query");
      if (saved) {
        const p = JSON.parse(saved) as { sort?: SortMode };
        // `filter` is restored separately, as an id — see scopeId below.
        return { ...DEFAULT_QUERY, sort: p.sort ?? DEFAULT_QUERY.sort };
      }
    } catch {
      // ignore malformed/absent storage
    }
    return DEFAULT_QUERY;
  });
  // The scope id the user picked, kept separately from the resolved Filter so an
  // id that isn't valid *yet* (the catalog is still loading) isn't discarded.
  const [scopeId, setScopeId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("catalog.query");
      if (saved) return (JSON.parse(saved) as { filter?: string }).filter ?? "all";
    } catch {
      // ignore malformed/absent storage
    }
    return "all";
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "catalog.query",
        JSON.stringify({ sort: query.sort, filter: scopeId }),
      );
    } catch {
      // storage may be unavailable; persistence is best-effort
    }
  }, [query.sort, scopeId]);
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

  // Every scope the library can be narrowed to, with counts: All / Installed /
  // Favorites / Hidden, then each platform, then each of the user's own
  // collections. Built from the prefs-overlaid catalog so collection membership
  // and favorites are already applied.
  const scopes = useMemo(() => buildSidebar(merged), [merged]);
  const effectiveQuery = useMemo(
    () => ({ ...query, filter: filterFromId(scopes, scopeId) }),
    [query, scopes, scopeId],
  );
  const groups = useMemo(
    () => groupVariants(applyQuery(merged, effectiveQuery)),
    [merged, effectiveQuery],
  );

  // "Continue Playing" strip: only when there's no active search, so it doesn't
  // fight a searched result set. Recomputed from the prefs-overlaid catalog
  // (hidden games excluded inside recentlyPlayed).
  const showContinue = query.search.trim() === "";
  const continueGames = useMemo(
    () => (showContinue ? recentlyPlayed(merged) : []),
    [showContinue, merged],
  );
  const totalPlaytimeSeconds = useMemo(
    () => merged.reduce((sum, g) => sum + Math.max(0, g.playtimeSeconds), 0),
    [merged],
  );

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
        <Sidebar groups={groups} selectedId={selected?.representative.id ?? null} onOpen={setSelected} />

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
            {/* Scope: "only show installed", a platform, or one of the user's
                collections. Grouped the way Steam groups its library filters. */}
            <label className="catalog__sort">
              Show
              <select
                value={scopes.some((s) => s.id === scopeId) ? scopeId : "all"}
                onChange={(e) => setScopeId(e.target.value)}
              >
                {SCOPE_GROUPS.map(({ label, match }) => {
                  const entries = scopes.filter(match);
                  if (entries.length === 0) return null;
                  const options = entries.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.count})
                    </option>
                  ));
                  // The built-in scopes sit at the top level, like Steam's; the
                  // platform and collection lists get their own headings.
                  return label ? (
                    <optgroup key={label} label={label}>
                      {options}
                    </optgroup>
                  ) : (
                    options
                  );
                })}
              </select>
            </label>
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

          {/* Total playtime changes exactly when a game exits, so it doubles as
              the signal to re-read the session log. */}
          {showContinue && <WeeklyRecapPanel refreshKey={totalPlaytimeSeconds} />}

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
            installedNotOwned={(group) =>
              group.members.some((g) => isInstalledWithoutOwnership(g, ownedIds)) &&
              !group.members.some((g) => ownedIds?.has(g.id))
            }
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
          onOpenFolder={(g) => void openFolder(g)}
          onMove={(g) => void startMove(g)}
          onSetSaveLocation={(g, pick) => void setSaveLocation(g, pick)}
          saveLocation={prefs.prefs.savePaths[cardMenu.game.id] ?? ""}
          onUninstall={(g) => void uninstall(g)}
          onRemoveFromLibrary={
            onRemoveFromLibrary && ownedIds?.has(cardMenu.game.id)
              ? (g) => void removeOwnedGame(g)
              : undefined
          }
          onToggleFavorite={prefs.toggleFavorite}
          onToggleHidden={prefs.toggleHidden}
          onClose={() => setCardMenu(null)}
        />
      )}

      {installPrompt && (
        <InstallLocationModal
          gameTitle={installPrompt.game.title}
          folders={installPrompt.folders}
          onConfirm={(path) => {
            const game = installPrompt.game;
            setInstallPrompt(null);
            void runInstall(game, path);
          }}
          onCancel={() => setInstallPrompt(null)}
        />
      )}

      {movePrompt && (
        <MoveLocationModal
          gameTitle={movePrompt.game.title}
          folders={movePrompt.folders}
          progress={moves[movePrompt.game.id]}
          error={moveError}
          busy={moveBusy}
          onConfirm={(path) => void confirmMove(path)}
          onCancel={() => {
            setMovePrompt(null);
            setMoveError("");
          }}
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
          onListVersions={listVersions}
          onSnapshotSaves={snapshotNow}
          onRestoreVersion={restoreVersion}
          onFindArtwork={apiKey ? findArtwork : undefined}
          onPickArtwork={apiKey ? pickArtwork : undefined}
          installedNotOwned={
            selected.members.some((g) => isInstalledWithoutOwnership(g, ownedIds)) &&
            !selected.members.some((g) => ownedIds?.has(g.id))
          }
        />
      )}

      <ControllerHints context={selected ? "detail" : "grid"} />
    </section>
  );
}
