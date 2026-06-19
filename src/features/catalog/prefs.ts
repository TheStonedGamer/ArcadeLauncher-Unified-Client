// Client-local catalog preferences: favorite / hidden overrides and per-game
// collection membership, overlaid onto the read-only catalog at display time so
// library.json is never rewritten. Mirrors the Rust `CatalogPrefs` model
// (src-tauri/src/catalog/prefs.rs). All the merge + toggle logic is pure and
// unit-tested here; the hook is just persistence glue.

import type { Game } from "./types";
import { collectionsOf } from "./query";

export interface CatalogPrefs {
  /** game id → favorite override (present only when toggled). */
  favorites: Record<string, boolean>;
  /** game id → hidden override (present only when toggled). */
  hidden: Record<string, boolean>;
  /** game id → full replacement collection list (present only when edited). */
  collections: Record<string, string[]>;
  /** game id → absolute local save folder for cloud-save sync (present only
   *  when set). Absent/empty means the managed app_data/saves/<id> folder. */
  savePaths: Record<string, string>;
  /** game id → absolute local cover-art path chosen by the user (SteamGridDB
   *  picker). Present only when overridden; overlaid onto coverArtPath. */
  coverOverrides: Record<string, string>;
}

export const emptyPrefs: CatalogPrefs = {
  favorites: {},
  hidden: {},
  collections: {},
  savePaths: {},
  coverOverrides: {},
};

/** Effective favorite for a game: the override if set, else the catalog value. */
export function effectiveFavorite(prefs: CatalogPrefs, game: Game): boolean {
  return prefs.favorites[game.id] ?? game.favorite;
}

/** Effective hidden for a game: the override if set, else the catalog value. */
export function effectiveHidden(prefs: CatalogPrefs, game: Game): boolean {
  return prefs.hidden[game.id] ?? game.hidden;
}

/** Effective collections for a game: the override list if set, else the
 *  catalog's. */
export function effectiveCollections(prefs: CatalogPrefs, game: Game): string[] {
  return prefs.collections[game.id] ?? collectionsOf(game);
}

/**
 * Overlay the prefs onto every game, returning new Game objects whose
 * favorite/hidden/collections reflect the user's overrides. Downstream code
 * (query, sidebar) then works on the merged catalog without knowing prefs exist.
 */
export function applyPrefs(games: Game[], prefs: CatalogPrefs): Game[] {
  return games.map((g) => {
    const favorite = effectiveFavorite(prefs, g);
    const hidden = effectiveHidden(prefs, g);
    const cols = prefs.collections[g.id];
    const cover = prefs.coverOverrides[g.id];
    if (favorite === g.favorite && hidden === g.hidden && cols === undefined && !cover) return g;
    return {
      ...g,
      favorite,
      hidden,
      collections: cols !== undefined ? cols.join("\n") : g.collections,
      // A chosen cover overrides the catalog's path (and wins over any URL,
      // which the detail/card render only when there's no local path).
      coverArtPath: cover || g.coverArtPath,
    };
  });
}

/** Effective save folder for a game: the override if set, else "" (meaning the
 *  managed folder is used). */
export function effectiveSavePath(prefs: CatalogPrefs, game: Game): string {
  return prefs.savePaths[game.id] ?? "";
}

/** Effective cover-art path for a game: the override if set, else the catalog's
 *  own path. */
export function effectiveCover(prefs: CatalogPrefs, game: Game): string {
  return prefs.coverOverrides[game.id] || game.coverArtPath;
}

/** Set (or clear, when blank) a game's cover-art override to an absolute local
 *  path (e.g. the file the SteamGridDB picker just downloaded). */
export function setCoverOverride(prefs: CatalogPrefs, gameId: string, path: string): CatalogPrefs {
  const trimmed = path.trim();
  const next = { ...prefs.coverOverrides };
  if (trimmed) next[gameId] = trimmed;
  else delete next[gameId];
  return { ...prefs, coverOverrides: next };
}

/** Set (or clear, when blank) a game's save-folder override. */
export function setSavePath(prefs: CatalogPrefs, game: Game, path: string): CatalogPrefs {
  const trimmed = path.trim();
  const next = { ...prefs.savePaths };
  if (trimmed) next[game.id] = trimmed;
  else delete next[game.id];
  return { ...prefs, savePaths: next };
}

/** Toggle a game's favorite override to the opposite of its effective value. */
export function toggleFavorite(prefs: CatalogPrefs, game: Game): CatalogPrefs {
  return { ...prefs, favorites: { ...prefs.favorites, [game.id]: !effectiveFavorite(prefs, game) } };
}

/** Toggle a game's hidden override to the opposite of its effective value. */
export function toggleHidden(prefs: CatalogPrefs, game: Game): CatalogPrefs {
  return { ...prefs, hidden: { ...prefs.hidden, [game.id]: !effectiveHidden(prefs, game) } };
}

/** Add `name` to a game's collections (no-op if already present). */
export function addToCollection(prefs: CatalogPrefs, game: Game, name: string): CatalogPrefs {
  const trimmed = name.trim();
  if (!trimmed) return prefs;
  const current = effectiveCollections(prefs, game);
  if (current.includes(trimmed)) return prefs;
  return { ...prefs, collections: { ...prefs.collections, [game.id]: [...current, trimmed] } };
}

/** Remove `name` from a game's collections (no-op if absent). */
export function removeFromCollection(prefs: CatalogPrefs, game: Game, name: string): CatalogPrefs {
  const current = effectiveCollections(prefs, game);
  if (!current.includes(name)) return prefs;
  return { ...prefs, collections: { ...prefs.collections, [game.id]: current.filter((c) => c !== name) } };
}
