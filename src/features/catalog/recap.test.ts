import { describe, expect, it } from "vitest";
import {
  formatRange,
  newlyPlayed,
  parseSession,
  parseSessions,
  recapFor,
  recapHeadline,
  sessionsIn,
  weekOverWeek,
  weekRange,
  type PlaySession,
} from "./recap";
import { formatDuration } from "./stats";

// Wednesday 2026-07-22 14:00 local. Every test derives its stamps from the
// week window rather than hard-coding UTC seconds, so these pass in any zone.
const NOW = new Date(2026, 6, 22, 14, 0, 0).getTime();
const HOUR = 3600;

const session = (id: string, startedAt: number, seconds: number, title = id.toUpperCase()): PlaySession => ({
  id,
  title,
  startedAt,
  seconds,
});

describe("parseSession", () => {
  it("accepts a well-formed record", () => {
    expect(parseSession({ id: "z", title: "Zelda", startedAt: 100, seconds: 60 })).toEqual({
      id: "z",
      title: "Zelda",
      startedAt: 100,
      seconds: 60,
    });
  });

  it("falls back to the id when the title is missing", () => {
    expect(parseSession({ id: "z", startedAt: 100, seconds: 60 })?.title).toBe("z");
  });

  it("floors fractional stamps", () => {
    expect(parseSession({ id: "z", startedAt: 100.9, seconds: 60.7 })).toMatchObject({
      startedAt: 100,
      seconds: 60,
    });
  });

  it("rejects unusable records", () => {
    for (const bad of [
      null,
      "nope",
      {},
      { id: "", startedAt: 1, seconds: 1 },
      { id: "z", startedAt: 1 },
      { id: "z", startedAt: 1, seconds: 0 },
      { id: "z", startedAt: 1, seconds: -5 },
      { id: "z", startedAt: 0, seconds: 5 },
      { id: "z", startedAt: "1", seconds: 5 },
    ]) {
      expect(parseSession(bad)).toBeNull();
    }
  });

  it("parseSessions drops the bad records and keeps the good ones", () => {
    expect(parseSessions([{ id: "a", startedAt: 1, seconds: 1 }, null, 7, { id: "b", startedAt: 2, seconds: 2 }]))
      .toHaveLength(2);
    expect(parseSessions("not an array")).toEqual([]);
  });
});

describe("weekRange", () => {
  it("starts on the local Sunday at midnight and spans exactly 7 days", () => {
    const r = weekRange(NOW);
    const start = new Date(r.start * 1000);
    expect(start.getDay()).toBe(0);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(new Date(r.end * 1000).getDay()).toBe(0);
  });

  it("contains now, half-open at the end", () => {
    const r = weekRange(NOW);
    const nowSec = Math.floor(NOW / 1000);
    expect(nowSec).toBeGreaterThanOrEqual(r.start);
    expect(nowSec).toBeLessThan(r.end);
  });

  it("walks back whole weeks that abut each other", () => {
    const now = weekRange(NOW);
    const prev = weekRange(NOW, 1);
    expect(prev.end).toBe(now.start);
    expect(weekRange(NOW, 2).end).toBe(prev.start);
  });

  it("is stable anywhere inside the same week", () => {
    const sunday = weekRange(NOW).start * 1000;
    expect(weekRange(sunday)).toEqual(weekRange(NOW));
    expect(weekRange(sunday + 6 * 86_400_000 + 1000)).toEqual(weekRange(NOW));
  });
});

describe("sessionsIn", () => {
  const week = weekRange(NOW);

  it("includes the first second and excludes the last", () => {
    const list = [session("a", week.start, 60), session("b", week.end, 60), session("c", week.start - 1, 60)];
    expect(sessionsIn(list, week).map((s) => s.id)).toEqual(["a"]);
  });

  it("returns oldest first regardless of input order", () => {
    const list = [session("c", week.start + 3 * HOUR, 60), session("a", week.start + HOUR, 60)];
    expect(sessionsIn(list, week).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("recapFor", () => {
  const week = weekRange(NOW);
  const at = (dayOffset: number, hour: number) => week.start + dayOffset * 86_400 + hour * HOUR;

  const list = [
    session("zelda", at(1, 20), 2 * HOUR, "Zelda"), // Monday
    session("zelda", at(3, 21), 1 * HOUR, "Zelda"), // Wednesday
    session("metroid", at(3, 10), 90 * 60, "Metroid"), // Wednesday
    session("old", weekRange(NOW, 1).start + HOUR, 10 * HOUR, "Last Week"),
  ];

  it("totals only the sessions inside the window", () => {
    const r = recapFor(list, week);
    expect(r.totalSeconds).toBe(2 * HOUR + HOUR + 90 * 60);
    expect(r.sessionCount).toBe(3);
    expect(r.gameCount).toBe(2);
  });

  it("groups per game, longest first, counting sessions", () => {
    const r = recapFor(list, week);
    expect(r.byGame.map((g) => g.id)).toEqual(["zelda", "metroid"]);
    expect(r.byGame[0]).toMatchObject({ seconds: 3 * HOUR, sessions: 2 });
    expect(r.byGame[1]).toMatchObject({ seconds: 90 * 60, sessions: 1 });
  });

  it("breaks per-game ties by title so the order is stable", () => {
    const tied = [session("b", at(1, 1), HOUR, "Beta"), session("a", at(2, 1), HOUR, "Alpha")];
    expect(recapFor(tied, week).byGame.map((g) => g.title)).toEqual(["Alpha", "Beta"]);
  });

  it("buckets playtime by weekday and names the busiest", () => {
    const r = recapFor(list, week);
    expect(r.perDay).toHaveLength(7);
    expect(r.perDay[1]).toBe(2 * HOUR); // Monday
    expect(r.perDay[3]).toBe(HOUR + 90 * 60); // Wednesday
    expect(r.perDay[0]).toBe(0);
    expect(r.busiestDay).toBe(3);
  });

  it("finds the longest single session", () => {
    expect(recapFor(list, week).longestSession).toMatchObject({ id: "zelda", seconds: 2 * HOUR });
  });

  it("is empty and blame-free for a week with no play", () => {
    const r = recapFor(list, weekRange(NOW, 5));
    expect(r).toMatchObject({ totalSeconds: 0, sessionCount: 0, gameCount: 0, busiestDay: -1, longestSession: null });
    expect(r.perDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.byGame).toEqual([]);
  });

  it("uses the most recent title when a game was renamed mid-week", () => {
    const renamed = [session("g", at(1, 1), HOUR, "Old Name"), session("g", at(2, 1), HOUR, "New Name")];
    expect(recapFor(renamed, week).byGame[0].title).toBe("New Name");
  });
});

describe("weekOverWeek", () => {
  const week = weekRange(NOW);
  const prevWeek = weekRange(NOW, 1);
  const mk = (range: { start: number; end: number }, seconds: number) =>
    recapFor(seconds > 0 ? [session("g", range.start + HOUR, seconds)] : [], range);

  it("reports the percentage change in both directions", () => {
    expect(weekOverWeek(mk(week, 3 * HOUR), mk(prevWeek, 2 * HOUR))).toBe(50);
    expect(weekOverWeek(mk(week, HOUR), mk(prevWeek, 2 * HOUR))).toBe(-50);
    expect(weekOverWeek(mk(week, 2 * HOUR), mk(prevWeek, 2 * HOUR))).toBe(0);
  });

  it("has nothing to compare against when the previous week was empty", () => {
    expect(weekOverWeek(mk(week, HOUR), mk(prevWeek, 0))).toBeNull();
  });
});

describe("newlyPlayed", () => {
  const week = weekRange(NOW);
  const prevWeek = weekRange(NOW, 1);

  it("lists only games absent from the previous week", () => {
    const current = recapFor(
      [session("kept", week.start + HOUR, HOUR), session("fresh", week.start + 2 * HOUR, HOUR)],
      week,
    );
    const previous = recapFor([session("kept", prevWeek.start + HOUR, HOUR)], prevWeek);
    expect(newlyPlayed(current, previous).map((g) => g.id)).toEqual(["fresh"]);
  });

  it("treats everything as new when there is no history", () => {
    const current = recapFor([session("a", week.start + HOUR, HOUR)], week);
    expect(newlyPlayed(current, recapFor([], prevWeek))).toHaveLength(1);
  });
});

describe("formatRange / recapHeadline", () => {
  it("renders an inclusive-looking day span", () => {
    const text = formatRange(weekRange(NOW), "en-US");
    expect(text).toMatch(/^\w+ \d+ – \w+ \d+$/);
    // The end is exclusive, so the label must stop on Saturday, not the next Sunday.
    const saturday = new Date((weekRange(NOW).end - 1) * 1000);
    expect(text.endsWith(String(saturday.getDate()))).toBe(true);
  });

  it("summarizes the week in one line", () => {
    const week = weekRange(NOW);
    const r = recapFor([session("a", week.start + HOUR, 2 * HOUR), session("b", week.start + 5 * HOUR, HOUR)], week);
    expect(recapHeadline(r, formatDuration)).toBe("3h across 2 games");
  });

  it("uses the singular for a single game", () => {
    const week = weekRange(NOW);
    const r = recapFor([session("a", week.start + HOUR, HOUR)], week);
    expect(recapHeadline(r, formatDuration)).toBe("1h across 1 game");
  });

  it("says so plainly when nothing was played", () => {
    expect(recapHeadline(recapFor([], weekRange(NOW)), formatDuration)).toBe("No games played this week");
  });
});
