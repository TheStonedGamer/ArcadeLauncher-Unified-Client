// Catalog IPC: the typed command calls this feature owns. Components and hooks
// import from here, never from the raw ipc layer.

import { appCacheDir, join } from "@tauri-apps/api/path";
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

/** Load games from a library.json path. */
export function loadCatalog(path: string): Promise<Game[]> {
  return call<Game[]>("load_catalog", { path });
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

/**
 * Fetch a cover for `game` from IGDB into the per-user cache, returning the
 * local image path (or null when there are no credentials / no match). The
 * cache dir is resolved here so callers only pass the credentials.
 */
export async function fetchCoverArt(
  game: Game,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const cacheDir = await join(await appCacheDir(), "covers");
  return call<string | null>("fetch_cover_art", {
    gameId: game.id,
    title: game.title,
    clientId,
    clientSecret,
    cacheDir,
  });
}
