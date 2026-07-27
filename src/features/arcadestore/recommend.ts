// Store recommendations driven by tracked playtime. The "Featured & Recommended"
// hero used to be a fixed pick (whatever the catalog's highest-rated game was),
// so it never changed and had nothing to do with the player. It now builds a
// taste profile from `playtimeSeconds` — which platforms, genres and franchises
// you actually put hours into — scores the games you have *not* played against
// it, and rotates through the top few.
//
// Pure data in, data out: no React, no Tauri, no clock. The rotation index is
// passed in by the caller, so the ordering is deterministic and unit-testable.

import type { Game } from "../catalog/types";

/** Attribute → hours played, normalized so the strongest attribute is 1. */
export type Weights = Map<string, number>;

export interface Taste {
  platforms: Weights;
  genres: Weights;
  franchises: Weights;
  /** Total tracked seconds behind the profile; 0 means "nothing played yet". */
  totalSeconds: number;
}

/** Split the comma/pipe-separated `genres` field into trimmed, non-empty tags. */
export function splitGenres(raw: string): string[] {
  return raw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Case-insensitive key so "Action RPG" and "action rpg" pool together. */
function key(value: string): string {
  return value.trim().toLowerCase();
}

function add(into: Weights, value: string, seconds: number): void {
  const k = key(value);
  if (!k) return;
  into.set(k, (into.get(k) ?? 0) + seconds);
}

/** Scale a weight map so its largest entry is 1. An empty map stays empty. */
function normalize(raw: Weights): Weights {
  let max = 0;
  for (const v of raw.values()) max = Math.max(max, v);
  if (max <= 0) return new Map();
  const out: Weights = new Map();
  for (const [k, v] of raw) out.set(k, v / max);
  return out;
}

/** Build a taste profile from every game with recorded playtime. Hidden games
 *  still count — hiding a game from the library is not a statement of dislike. */
export function taste(games: Game[]): Taste {
  const platforms: Weights = new Map();
  const genres: Weights = new Map();
  const franchises: Weights = new Map();
  let totalSeconds = 0;

  for (const g of games) {
    const secs = g.playtimeSeconds;
    if (!secs || secs <= 0) continue;
    totalSeconds += secs;
    add(platforms, g.platform, secs);
    add(franchises, g.franchise, secs);
    for (const genre of splitGenres(g.genres)) add(genres, genre, secs);
  }

  return {
    platforms: normalize(platforms),
    genres: normalize(genres),
    franchises: normalize(franchises),
    totalSeconds,
  };
}

// A franchise match is the strongest signal (you played Metroid, here is another
// Metroid), then genre, then the platform you spend the most time on.
const FRANCHISE_WEIGHT = 3;
const GENRE_WEIGHT = 2;
const PLATFORM_WEIGHT = 1;
/** Critic score contribution, so a good game edges out a mediocre one at equal
 *  affinity without ever outweighing an affinity match. */
const RATING_WEIGHT = 0.5;

/** How well one candidate matches the profile. Higher is better; 0 means the
 *  candidate shares nothing with what the player has played. */
export function affinity(game: Game, profile: Taste): number {
  const franchise = profile.franchises.get(key(game.franchise)) ?? 0;
  const platform = profile.platforms.get(key(game.platform)) ?? 0;
  // Genres are multi-valued: take the best-matching tag rather than the sum, so
  // a game tagged with ten genres is not mechanically favoured over a focused one.
  let genre = 0;
  for (const tag of splitGenres(game.genres)) {
    genre = Math.max(genre, profile.genres.get(key(tag)) ?? 0);
  }
  return (
    franchise * FRANCHISE_WEIGHT + genre * GENRE_WEIGHT + platform * PLATFORM_WEIGHT
  );
}

/** Normalized 0..1 critic score; games without a rating contribute nothing. */
function rating(game: Game): number {
  return game.igdbRating > 0 ? Math.min(100, game.igdbRating) / 100 : 0;
}

/** Ranked recommendations: games the player has *not* played, ordered by how
 *  well they match tracked playtime, then by critic score, then by title so the
 *  ordering is stable across renders.
 *
 *  With no playtime recorded there is nothing to personalize against, so this
 *  degrades to the previous behaviour — the highest-rated games in the catalog. */
export function recommendations(games: Game[], limit = 6): Game[] {
  const profile = taste(games);
  const candidates = games.filter((g) => !g.hidden && g.playtimeSeconds <= 0);
  const scored = candidates.map((game) => ({
    game,
    score: affinity(game, profile) + rating(game) * RATING_WEIGHT,
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.game.igdbRating - a.game.igdbRating ||
      a.game.title.localeCompare(b.game.title, undefined, { sensitivity: "base" }),
  );
  return scored.slice(0, Math.max(0, limit)).map((s) => s.game);
}

/** The entry to show for a given rotation tick, wrapping around the list.
 *  Returns null for an empty list so the caller can hide the hero entirely. */
export function rotate<T>(items: T[], tick: number): T | null {
  if (items.length === 0) return null;
  const i = ((tick % items.length) + items.length) % items.length;
  return items[i];
}
