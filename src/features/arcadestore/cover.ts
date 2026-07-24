// Shared cover-art resolution for store components: prefer the locally cached
// path (served through Tauri's asset protocol), else the remote URL, else "".
// Mirrors the catalog GameCard so the Store and Library show identical art.

import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../catalog/types";

export function coverSrc(game: Game): string {
  if (game.coverArtPath) return convertFileSrc(game.coverArtPath);
  return game.coverArtUrl || "";
}

/** Star rating shown on capsules, or null when the game has no IGDB rating. */
export function ratingBadge(game: Game): number | null {
  return game.igdbRating > 0 ? Math.round(game.igdbRating) : null;
}
