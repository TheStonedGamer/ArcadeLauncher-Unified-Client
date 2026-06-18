// Catalog IPC: the typed command calls this feature owns. Components and hooks
// import from here, never from the raw ipc layer.

import { call } from "../../lib/ipc";
import type { Game } from "./types";
import type { CatalogPrefs } from "./prefs";

/** Load the user's client-local catalog prefs (favorites/hidden/collections). */
export function loadCatalogPrefs(): Promise<CatalogPrefs> {
  return call<CatalogPrefs>("load_catalog_prefs");
}

/** Persist the whole prefs object. */
export function saveCatalogPrefs(prefs: CatalogPrefs): Promise<void> {
  return call("save_catalog_prefs", { prefs });
}

/** Load games. The library.json path is resolved in Rust (per-user default);
 *  pass an explicit path only for special cases. */
export function loadCatalog(path?: string): Promise<Game[]> {
  return call<Game[]>("load_catalog", { path: path ?? null });
}

/** Sync the catalog from the server (Bearer-authed), caching it to the per-user
 *  library.json behind the scenes, and return the games. */
export function fetchCatalog(host: string, token: string): Promise<Game[]> {
  return call<Game[]>("fetch_catalog", { host, token });
}

/** Launch a game; resolves to the spawned process id. */
export function launchGame(game: Game): Promise<number> {
  return call<number>("launch_game", { game });
}

/** A game needs a cover when it has neither a local path nor a URL (mirrors the
 *  Rust `art::needs_art` predicate). */
export function needsArt(game: Game): boolean {
  return game.coverArtPath.trim() === "" && game.coverArtUrl.trim() === "";
}
