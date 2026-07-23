// Pure weekly-recap core (ROADMAP T12j). Cumulative `playtimeSeconds` can't
// answer "what did I play this week", so the launcher now keeps one record per
// completed session (Rust: catalog/sessions.rs). This module turns that log into
// a recap. No React, no Tauri, no clock reads — `nowMs` is always injected, so
// every function here is deterministic and unit-tested in recap.test.ts.

/** One completed play session, as stored by the Rust session log. */
export interface PlaySession {
  id: string;
  title: string;
  /** Unix seconds. */
  startedAt: number;
  seconds: number;
}

/** A half-open [start, end) window in unix seconds. */
export interface Range {
  start: number;
  end: number;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Narrow one entry from the backend. Defensive: a hand-edited or truncated log
 *  shouldn't crash the panel. Returns null for anything unusable. */
export function parseSession(value: unknown): PlaySession | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const seconds = typeof v.seconds === "number" ? v.seconds : NaN;
  const startedAt = typeof v.startedAt === "number" ? v.startedAt : NaN;
  if (typeof v.id !== "string" || !v.id) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  return {
    id: v.id,
    title: typeof v.title === "string" && v.title ? v.title : v.id,
    startedAt: Math.floor(startedAt),
    seconds: Math.floor(seconds),
  };
}

export function parseSessions(value: unknown): PlaySession[] {
  return Array.isArray(value) ? value.map(parseSession).filter((s): s is PlaySession => s !== null) : [];
}

/** The local week containing `nowMs`, starting Sunday 00:00 local time.
 *  `weeksAgo` walks back whole weeks (1 = last week). Local, not UTC: "this
 *  week" has to mean the user's week, not the server's. */
export function weekRange(nowMs: number, weeksAgo = 0): Range {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - weeksAgo * 7);
  const start = Math.floor(d.getTime() / 1000);
  const endDate = new Date(d.getTime());
  endDate.setDate(endDate.getDate() + 7); // via Date, so a DST week is still 7 days
  return { start, end: Math.floor(endDate.getTime() / 1000) };
}

/** Sessions whose start falls inside the range, oldest first. A session is
 *  attributed to the week it *started* in — an overnight session counts once,
 *  where it began, instead of being split. */
export function sessionsIn(sessions: PlaySession[], range: Range): PlaySession[] {
  return sessions
    .filter((s) => s.startedAt >= range.start && s.startedAt < range.end)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export interface GameTotal {
  id: string;
  title: string;
  seconds: number;
  sessions: number;
}

export interface Recap {
  range: Range;
  totalSeconds: number;
  sessionCount: number;
  /** Distinct games played in the window. */
  gameCount: number;
  /** Per-game totals, longest first (ties broken by title for stability). */
  byGame: GameTotal[];
  /** Seconds played per weekday, index 0 = Sunday. Always 7 entries. */
  perDay: number[];
  /** Index of the day with the most playtime; -1 when nothing was played. */
  busiestDay: number;
  /** The single longest session in the window, or null. */
  longestSession: PlaySession | null;
}

/** Aggregate a window of sessions into a recap. */
export function recapFor(sessions: PlaySession[], range: Range): Recap {
  const window = sessionsIn(sessions, range);
  const totals = new Map<string, GameTotal>();
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let longest: PlaySession | null = null;

  for (const s of window) {
    const prev = totals.get(s.id);
    if (prev) {
      prev.seconds += s.seconds;
      prev.sessions += 1;
      prev.title = s.title; // most recent title wins
    } else {
      totals.set(s.id, { id: s.id, title: s.title, seconds: s.seconds, sessions: 1 });
    }
    perDay[new Date(s.startedAt * 1000).getDay()] += s.seconds;
    if (!longest || s.seconds > longest.seconds) longest = s;
  }

  const byGame = [...totals.values()].sort(
    (a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
  const totalSeconds = byGame.reduce((sum, g) => sum + g.seconds, 0);
  const busiestDay = totalSeconds > 0 ? perDay.indexOf(Math.max(...perDay)) : -1;

  return {
    range,
    totalSeconds,
    sessionCount: window.length,
    gameCount: byGame.length,
    byGame,
    perDay,
    busiestDay,
    longestSession: longest,
  };
}

/** Percentage change in total playtime vs the previous window, rounded. Null
 *  when there's no baseline to compare against (nothing played last week). */
export function weekOverWeek(current: Recap, previous: Recap): number | null {
  if (previous.totalSeconds <= 0) return null;
  return Math.round(((current.totalSeconds - previous.totalSeconds) / previous.totalSeconds) * 100);
}

/** Games in `current` that were not played in `previous` — "new this week". */
export function newlyPlayed(current: Recap, previous: Recap): GameTotal[] {
  const before = new Set(previous.byGame.map((g) => g.id));
  return current.byGame.filter((g) => !before.has(g.id));
}

/** "Jul 20 – Jul 26" for a range, in the user's locale. */
export function formatRange(range: Range, locale?: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const from = new Date(range.start * 1000).toLocaleDateString(locale, opts);
  // end is exclusive; the last *played* day is the second before it.
  const to = new Date((range.end - 1) * 1000).toLocaleDateString(locale, opts);
  return `${from} – ${to}`;
}

/** One-line headline for the recap, e.g. "6h 40m across 3 games". */
export function recapHeadline(recap: Recap, formatDuration: (s: number) => string): string {
  if (recap.totalSeconds <= 0) return "No games played this week";
  const games = `${recap.gameCount} game${recap.gameCount === 1 ? "" : "s"}`;
  return `${formatDuration(recap.totalSeconds)} across ${games}`;
}
