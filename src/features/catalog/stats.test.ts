import { describe, it, expect } from "vitest";
import {
  recentlyPlayed,
  mostPlayed,
  libraryStats,
  formatDuration,
  formatLastPlayed,
} from "./stats";
import type { Game } from "./types";

function game(p: Partial<Game> & { id: string; title: string }): Game {
  return {
    platform: "NES",
    installState: "installed",
    coverArtPath: "",
    coverArtUrl: "",
    developer: "",
    publisher: "",
    franchise: "",
    genres: "",
    contentPath: "",
    releaseDate: 0,
    playtimeSeconds: 0,
    lastPlayed: 0,
    igdbRating: 0,
    summary: "",
    serverBacked: false,
    favorite: false,
    hidden: false,
    collections: "",
    launchUri: "",
    exePath: "",
    emulatorPath: "",
    romPath: "",
    arguments: "",
    launchOptions: "",
    preLaunchCmd: "",
    postExitCmd: "",
    ...p,
  };
}

describe("recentlyPlayed", () => {
  it("returns only played games, newest first", () => {
    const games = [
      game({ id: "a", title: "Alpha", lastPlayed: 100 }),
      game({ id: "b", title: "Beta", lastPlayed: 300 }),
      game({ id: "c", title: "Gamma", lastPlayed: 0 }), // never played → excluded
      game({ id: "d", title: "Delta", lastPlayed: 200 }),
    ];
    expect(recentlyPlayed(games).map((g) => g.id)).toEqual(["b", "d", "a"]);
  });

  it("excludes hidden games", () => {
    const games = [
      game({ id: "a", title: "Alpha", lastPlayed: 100 }),
      game({ id: "b", title: "Beta", lastPlayed: 300, hidden: true }),
    ];
    expect(recentlyPlayed(games).map((g) => g.id)).toEqual(["a"]);
  });

  it("breaks lastPlayed ties by title and respects the limit", () => {
    const games = [
      game({ id: "z", title: "Zebra", lastPlayed: 500 }),
      game({ id: "a", title: "Apple", lastPlayed: 500 }),
      game({ id: "m", title: "Mango", lastPlayed: 400 }),
    ];
    expect(recentlyPlayed(games, 2).map((g) => g.id)).toEqual(["a", "z"]);
  });

  it("returns an empty list when nothing has been played", () => {
    expect(recentlyPlayed([game({ id: "a", title: "A" })])).toEqual([]);
  });
});

describe("mostPlayed", () => {
  it("orders by playtime desc, excludes zero-playtime and hidden", () => {
    const games = [
      game({ id: "a", title: "A", playtimeSeconds: 100 }),
      game({ id: "b", title: "B", playtimeSeconds: 5000 }),
      game({ id: "c", title: "C", playtimeSeconds: 0 }),
      game({ id: "d", title: "D", playtimeSeconds: 9999, hidden: true }),
    ];
    expect(mostPlayed(games).map((g) => g.id)).toEqual(["b", "a"]);
  });
});

describe("libraryStats", () => {
  it("sums playtime and counts played/visible games", () => {
    const games = [
      game({ id: "a", title: "A", playtimeSeconds: 3600, lastPlayed: 10 }),
      game({ id: "b", title: "B", playtimeSeconds: 1800 }),
      game({ id: "c", title: "C" }),
      game({ id: "d", title: "D", playtimeSeconds: 99999, hidden: true }),
    ];
    expect(libraryStats(games)).toEqual({
      totalGames: 3,
      playedGames: 2,
      totalPlaytimeSeconds: 5400,
    });
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(30)).toBe("—"); // under a minute
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 30 * 60)).toBe("1h 30m");
    expect(formatDuration(12 * 3600 + 5 * 60)).toBe("12h 5m");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("formatLastPlayed", () => {
  const now = 1_000_000_000_000; // fixed "now" in ms
  const nowSec = now / 1000;
  const ago = (sec: number) => nowSec - sec;

  it("returns empty for never-played", () => {
    expect(formatLastPlayed(0, now)).toBe("");
  });

  it("describes recent times relatively", () => {
    expect(formatLastPlayed(ago(30), now)).toBe("Just now");
    expect(formatLastPlayed(ago(5 * 60), now)).toBe("5m ago");
    expect(formatLastPlayed(ago(3 * 3600), now)).toBe("3h ago");
    expect(formatLastPlayed(ago(86_400), now)).toBe("Yesterday");
    expect(formatLastPlayed(ago(3 * 86_400), now)).toBe("3 days ago");
    expect(formatLastPlayed(ago(10 * 86_400), now)).toBe("Last week");
    expect(formatLastPlayed(ago(21 * 86_400), now)).toBe("3 weeks ago");
    expect(formatLastPlayed(ago(45 * 86_400), now)).toBe("Last month");
    expect(formatLastPlayed(ago(120 * 86_400), now)).toBe("4 months ago");
    expect(formatLastPlayed(ago(800 * 86_400), now)).toBe("2y ago");
  });

  it("clamps future stamps to 'Just now'", () => {
    expect(formatLastPlayed(nowSec + 500, now)).toBe("Just now");
  });
});
