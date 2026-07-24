// Catalog IPC: the typed command calls this feature owns. Components and hooks
// import from here, never from the raw ipc layer.

import { call } from "../../lib/ipc";
import type { Game } from "./types";
import type { CatalogPrefs } from "./prefs";
import { parseSessions, type PlaySession } from "./recap";

/** Load the user's client-local catalog prefs (favorites/hidden/collections). */
export function loadCatalogPrefs(): Promise<CatalogPrefs> {
  return call<CatalogPrefs>("load_catalog_prefs");
}

/** Persist the whole prefs object. */
export function saveCatalogPrefs(prefs: CatalogPrefs): Promise<void> {
  return call("save_catalog_prefs", { prefs });
}

/** Load the client-local per-session play history (oldest first). Written by
 *  Rust when a game exits; parsed defensively before use. */
export async function loadPlaySessions(): Promise<PlaySession[]> {
  return parseSessions(await call<unknown>("load_play_sessions"));
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

/** The game ids in the signed-in account's library (Bearer-authed). Drives the
 *  Library tab's owned-only filter and the Store tab's owned annotation. */
export function fetchOwnedIds(host: string, token: string): Promise<string[]> {
  return call<string[]>("fetch_owned_ids", { host, token });
}

/** Add a game to the account's library. */
export function addToLibrary(host: string, token: string, id: string): Promise<void> {
  return call("library_add", { host, token, id });
}

/** Remove a game from the account's library. */
export function removeFromLibrary(host: string, token: string, id: string): Promise<void> {
  return call("library_remove", { host, token, id });
}

/** Whether a game can run right now, and if not, a specific reason. Mirrors the
 *  Rust `launch::target::TargetStatus`. */
export interface TargetStatus {
  runnable: boolean;
  /** runnable | emulatorMissing | romMissing | executableMissing | noTarget */
  kind: string;
  message: string;
}

/** Diagnose a game's launch readiness without spawning it. Used by the detail
 *  panel to show a precise reason instead of a blanket "No Runnable Target". */
export function checkRunnable(game: Game): Promise<TargetStatus> {
  return call<TargetStatus>("check_runnable", { game });
}

/** A game needs a cover when it has neither a local path nor a URL (mirrors the
 *  Rust `art::needs_art` predicate). */
export function needsArt(game: Game): boolean {
  return game.coverArtPath.trim() === "" && game.coverArtUrl.trim() === "";
}

/** One SteamGridDB cover candidate (full image + thumbnail). Mirrors the Rust
 *  `art::ArtCandidate`. */
export interface ArtCandidate {
  url: string;
  thumb: string;
}

/** Search SteamGridDB for cover-art candidates for a game name (Bearer-authed
 *  with the user's API key). Rejects when the key is missing or the request
 *  fails; resolves to [] when nothing matches. */
export function searchArtwork(name: string, apiKey: string): Promise<ArtCandidate[]> {
  return call<ArtCandidate[]>("steamgriddb_search", { name, apiKey });
}

/** Download a chosen cover into the per-user art cache; resolves to its absolute
 *  local path (which the caller records as a cover override). */
export function applyCover(gameId: string, imageUrl: string): Promise<string> {
  return call<string>("apply_cover", { gameId, imageUrl });
}
