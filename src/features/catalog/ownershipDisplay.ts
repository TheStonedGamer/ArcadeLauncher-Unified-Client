import type { Game } from "./types";
import { isInstalled } from "./query";

/** Keep owned games and local installs visible in the Library. */
export function shouldShowInLibrary(game: Game, ownedIds?: Set<string>): boolean {
  return ownedIds === undefined || ownedIds.has(game.id) || isInstalled(game);
}

/** A local install whose account ownership has been resolved and is absent. */
export function isInstalledWithoutOwnership(
  game: Game,
  ownedIds?: Set<string>,
): boolean {
  return ownedIds !== undefined && isInstalled(game) && !ownedIds.has(game.id);
}
