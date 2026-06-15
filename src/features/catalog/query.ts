// Pure catalog query logic: search matching, sorting, and sidebar filtering.
// No React, no Tauri — just data in, data out — so it's unit-testable (see
// query.test.ts) and mirrors the C++ client's gamesearch/gamesort/gamefilter.

import type { Game } from "./types";

export type SortMode = "title" | "platform" | "rating" | "playtime" | "recent";

export const SORT_LABELS: Record<SortMode, string> = {
  title: "Title",
  platform: "Platform",
  rating: "Rating",
  playtime: "Playtime",
  recent: "Recently played",
};

// A sidebar selection: a built-in scope, a platform, or a collection.
export type Filter =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "platform"; value: string }
  | { kind: "collection"; value: string };

export interface Query {
  search: string;
  sort: SortMode;
  filter: Filter;
}

export const DEFAULT_QUERY: Query = {
  search: "",
  sort: "title",
  filter: { kind: "all" },
};

/** Year (UTC) from a unix-seconds timestamp, or "" when unknown. */
export function yearOf(releaseDate: number): string {
  if (!releaseDate) return "";
  return String(new Date(releaseDate * 1000).getUTCFullYear());
}

/** Split a newline-joined collections string into trimmed names. */
export function collectionsOf(game: Game): string[] {
  return game.collections
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Case-insensitive substring match across the searchable fields. */
export function matchesSearch(game: Game, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    game.title,
    game.platform,
    game.developer,
    game.publisher,
    game.franchise,
    game.genres,
    yearOf(game.releaseDate),
  ]
    .join("\n")
    .toLowerCase();
  // Every whitespace-separated term must appear (AND semantics).
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

function matchesFilter(game: Game, filter: Filter): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "favorites":
      return game.favorite;
    case "platform":
      return game.platform === filter.value;
    case "collection":
      return collectionsOf(game).includes(filter.value);
  }
}

function comparator(mode: SortMode): (a: Game, b: Game) => number {
  const byTitle = (a: Game, b: Game) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  switch (mode) {
    case "title":
      return byTitle;
    case "platform":
      return (a, b) => a.platform.localeCompare(b.platform) || byTitle(a, b);
    case "rating":
      return (a, b) => b.igdbRating - a.igdbRating || byTitle(a, b);
    case "playtime":
      return (a, b) => b.playtimeSeconds - a.playtimeSeconds || byTitle(a, b);
    case "recent":
      return (a, b) => b.lastPlayed - a.lastPlayed || byTitle(a, b);
  }
}

/** Apply search + filter + sort. Hidden games are always excluded. */
export function applyQuery(games: Game[], query: Query): Game[] {
  return games
    .filter((g) => !g.hidden)
    .filter((g) => matchesFilter(g, query.filter))
    .filter((g) => matchesSearch(g, query.search))
    .sort(comparator(query.sort));
}

export interface SidebarEntry {
  id: string;
  label: string;
  filter: Filter;
  count: number;
}

/** Build the sidebar: All, Favorites, then platforms and collections present
 *  in the (non-hidden) library, each with a count. */
export function buildSidebar(games: Game[]): SidebarEntry[] {
  const visible = games.filter((g) => !g.hidden);
  const platforms = new Map<string, number>();
  const collections = new Map<string, number>();
  let favorites = 0;

  for (const g of visible) {
    if (g.favorite) favorites++;
    if (g.platform) platforms.set(g.platform, (platforms.get(g.platform) ?? 0) + 1);
    for (const c of collectionsOf(g)) {
      collections.set(c, (collections.get(c) ?? 0) + 1);
    }
  }

  const entries: SidebarEntry[] = [
    { id: "all", label: "All Games", filter: { kind: "all" }, count: visible.length },
    { id: "favorites", label: "Favorites", filter: { kind: "favorites" }, count: favorites },
  ];
  for (const [value, count] of [...platforms].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.push({ id: `platform:${value}`, label: value, filter: { kind: "platform", value }, count });
  }
  for (const [value, count] of [...collections].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.push({ id: `collection:${value}`, label: value, filter: { kind: "collection", value }, count });
  }
  return entries;
}
