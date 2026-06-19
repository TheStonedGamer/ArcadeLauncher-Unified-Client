import { describe, expect, it } from "vitest";
import type { RaSummary, RaUnlock } from "./api";
import { pointsToLevel, summaryHeadline, topUnlocks, unlockLabel, unlockPoints } from "./ra";

function unlock(over: Partial<RaUnlock>): RaUnlock {
  return {
    title: "Ach",
    description: "",
    points: 0,
    gameTitle: "",
    date: "2026-06-19 10:00:00",
    hardcore: false,
    ...over,
  };
}

describe("pointsToLevel", () => {
  it("maps RA points onto the shared level curve (floor(sqrt(p/100)))", () => {
    expect(pointsToLevel(0)).toBe(0);
    expect(pointsToLevel(100)).toBe(1);
    expect(pointsToLevel(400)).toBe(2);
    expect(pointsToLevel(2500)).toBe(5);
    expect(pointsToLevel(-50)).toBe(0);
  });
});

describe("unlockPoints", () => {
  it("sums the points of a set of unlocks", () => {
    expect(unlockPoints([unlock({ points: 5 }), unlock({ points: 25 }), unlock({ points: 10 })])).toBe(40);
    expect(unlockPoints([])).toBe(0);
  });
});

describe("topUnlocks", () => {
  it("returns the newest n unlocks, newest first", () => {
    const list = [
      unlock({ title: "old", date: "2026-06-17 10:00:00" }),
      unlock({ title: "new", date: "2026-06-19 10:00:00" }),
      unlock({ title: "mid", date: "2026-06-18 10:00:00" }),
    ];
    expect(topUnlocks(list, 2).map((u) => u.title)).toEqual(["new", "mid"]);
    expect(topUnlocks(list, 0)).toEqual([]);
  });
});

describe("unlockLabel", () => {
  it("joins title, game, points and marks hardcore", () => {
    expect(unlockLabel(unlock({ title: "First Blood", gameTitle: "DOOM", points: 5, hardcore: true }))).toBe(
      "First Blood · DOOM · 5pts ★",
    );
    expect(unlockLabel(unlock({ title: "Solo", points: 10 }))).toBe("Solo · 10pts");
  });
});

describe("summaryHeadline", () => {
  it("formats points and rank, omitting rank when zero", () => {
    const base: RaSummary = { username: "me", score: 12345, rank: 678, totalRanked: 90000, recent: [] };
    expect(summaryHeadline(base)).toBe("12,345 pts · Rank #678");
    expect(summaryHeadline({ ...base, rank: 0 })).toBe("12,345 pts");
  });
});
