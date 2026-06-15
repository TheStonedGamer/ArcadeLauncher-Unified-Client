// Catalog IPC: the typed command calls this feature owns. Components and hooks
// import from here, never from the raw ipc layer.

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
