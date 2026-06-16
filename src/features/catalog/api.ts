// Catalog IPC: the typed command calls this feature owns. Components and hooks
// import from here, never from the raw ipc layer.

import { appCacheDir, join } from "@tauri-apps/api/path";
import { call } from "../../lib/ipc";
import type { Game } from "./types";

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
