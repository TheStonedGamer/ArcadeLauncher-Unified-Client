// Catalog-prefs hook: loads the user's favorite/hidden/collection overrides on
// mount and persists every change. The merge + toggle logic is the pure,
// unit-tested code in prefs.ts; this hook is just load/save glue (mirrors
// useSettings). Outside a Tauri runtime the load/save calls no-op, so the UI
// still works against the empty prefs.

import { useCallback, useEffect, useState } from "react";
import { loadCatalogPrefs, saveCatalogPrefs } from "./api";
import {
  addToCollection,
  emptyPrefs,
  removeFromCollection,
  toggleFavorite,
  toggleHidden,
  type CatalogPrefs,
} from "./prefs";
import type { Game } from "./types";

export interface CatalogPrefsApi {
  prefs: CatalogPrefs;
  toggleFavorite: (game: Game) => void;
  toggleHidden: (game: Game) => void;
  addToCollection: (game: Game, name: string) => void;
  removeFromCollection: (game: Game, name: string) => void;
}

export function useCatalogPrefs(): CatalogPrefsApi {
  const [prefs, setPrefs] = useState<CatalogPrefs>(emptyPrefs);

  useEffect(() => {
    loadCatalogPrefs()
      .then(setPrefs)
      .catch(() => {
        /* no Tauri runtime (plain browser/preview) — keep empty prefs */
      });
  }, []);

  // Apply a pure transform, then persist the result. Uses the functional
  // updater so rapid toggles compose without stale-closure races.
  const mutate = useCallback((fn: (p: CatalogPrefs) => CatalogPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      if (next !== prev) void saveCatalogPrefs(next).catch(() => {});
      return next;
    });
  }, []);

  return {
    prefs,
    toggleFavorite: (game) => mutate((p) => toggleFavorite(p, game)),
    toggleHidden: (game) => mutate((p) => toggleHidden(p, game)),
    addToCollection: (game, name) => mutate((p) => addToCollection(p, game, name)),
    removeFromCollection: (game, name) => mutate((p) => removeFromCollection(p, game, name)),
  };
}
