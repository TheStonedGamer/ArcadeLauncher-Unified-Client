// Pure playtime/“continue playing” logic: pick recently-played games, sum
// playtime, and format durations / last-played timestamps for display. No React,
// no Tauri — data in, data out — so it's unit-testable (see stats.test.ts). Reads
// the `playtimeSeconds` / `lastPlayed` fields the catalog already carries.

import type { Game } from "./types";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** Games the user has actually launched (have a `lastPlayed` stamp), most
 *  recent first, excluding hidden games. Capped to `limit` (default 8). Ties on
 *  `lastPlayed` fall back to title so the order is stable. */
export function recentlyPlayed(games: Game[], limit = 8): Game[] {
  return games
    .filter((g) => !g.hidden && g.lastPlayed > 0)
    .sort(
      (a, b) =>
        b.lastPlayed - a.lastPlayed ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    )
    .slice(0, Math.max(0, limit));
}

/** Games with recorded playtime, longest first, excluding hidden. */
export function mostPlayed(games: Game[], limit = 8): Game[] {
  return games
    .filter((g) => !g.hidden && g.playtimeSeconds > 0)
    .sort(
      (a, b) =>
        b.playtimeSeconds - a.playtimeSeconds ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    )
    .slice(0, Math.max(0, limit));
}

export interface LibraryStats {
  totalGames: number;
  playedGames: number;
  totalPlaytimeSeconds: number;
}

/** Aggregate headline numbers for the (non-hidden) library. */
export function libraryStats(games: Game[]): LibraryStats {
  const visible = games.filter((g) => !g.hidden);
  return {
    totalGames: visible.length,
    playedGames: visible.filter((g) => g.lastPlayed > 0 || g.playtimeSeconds > 0).length,
    totalPlaytimeSeconds: visible.reduce((sum, g) => sum + Math.max(0, g.playtimeSeconds), 0),
  };
}

/** Human-readable duration: "—" for none, "45m" under an hour, else "12h 30m"
 *  (minutes dropped when zero). Negative/NaN treated as none. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < MINUTE) return "—";
  const totalMinutes = Math.floor(seconds / MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Relative last-played label from a unix-seconds stamp, given the current time
 *  in ms (injected so it's deterministic in tests). "" when never played. */
export function formatLastPlayed(lastPlayed: number, nowMs: number): string {
  if (!lastPlayed || lastPlayed <= 0) return "";
  const deltaSec = Math.floor(nowMs / 1000) - lastPlayed;
  if (deltaSec < 0) return "Just now";
  if (deltaSec < HOUR) {
    const mins = Math.floor(deltaSec / MINUTE);
    return mins <= 0 ? "Just now" : `${mins}m ago`;
  }
  if (deltaSec < DAY) {
    const hours = Math.floor(deltaSec / HOUR);
    return `${hours}h ago`;
  }
  const days = Math.floor(deltaSec / DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "Last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)}y ago`;
}
