import { describe, it, expect } from "vitest";
import type { Game } from "../catalog/types";
import { affinity, recommendations, rotate, taste } from "./recommend";

function game(p: Partial<Game>): Game {
  return {
    id: "", title: "", platform: "", installState: "", coverArtPath: "", coverArtUrl: "", heroArtUrl: "",
    developer: "", publisher: "", franchise: "", genres: "", contentPath: "",
    releaseDate: 0, playtimeSeconds: 0, lastPlayed: 0, igdbRating: 0, summary: "",
    serverBacked: false, favorite: false, hidden: false, collections: "",
    launchUri: "", exePath: "", emulatorPath: "", romPath: "", arguments: "",
    launchOptions: "", preLaunchCmd: "", postExitCmd: "",
    ...p,
  };
}

const HOUR = 3600;

describe("taste", () => {
  it("weights attributes by hours and normalizes to the leader", () => {
    const t = taste([
      game({ title: "A", platform: "Switch", genres: "RPG", playtimeSeconds: 10 * HOUR }),
      game({ title: "B", platform: "PC", genres: "Shooter", playtimeSeconds: 5 * HOUR }),
    ]);
    expect(t.platforms.get("switch")).toBe(1);
    expect(t.platforms.get("pc")).toBe(0.5);
    expect(t.totalSeconds).toBe(15 * HOUR);
  });

  it("ignores games with no tracked playtime", () => {
    const t = taste([game({ platform: "PC", playtimeSeconds: 0 })]);
    expect(t.totalSeconds).toBe(0);
    expect(t.platforms.size).toBe(0);
  });

  it("pools genres case-insensitively and splits on commas and pipes", () => {
    const t = taste([
      game({ genres: "Action, RPG", playtimeSeconds: HOUR }),
      game({ genres: "action|Puzzle", playtimeSeconds: HOUR }),
    ]);
    expect(t.genres.get("action")).toBe(1);
    expect(t.genres.get("rpg")).toBe(0.5);
  });
});

describe("affinity", () => {
  const profile = taste([
    game({ platform: "Switch", franchise: "Metroid", genres: "Action", playtimeSeconds: 10 * HOUR }),
  ]);

  it("ranks a franchise match above a genre match above a platform match", () => {
    const franchise = affinity(game({ franchise: "Metroid" }), profile);
    const genre = affinity(game({ genres: "Action" }), profile);
    const platform = affinity(game({ platform: "Switch" }), profile);
    expect(franchise).toBeGreaterThan(genre);
    expect(genre).toBeGreaterThan(platform);
  });

  it("scores an unrelated game at zero", () => {
    expect(affinity(game({ platform: "PC", genres: "Sports" }), profile)).toBe(0);
  });

  it("takes the best genre tag rather than summing them", () => {
    const many = affinity(game({ genres: "Action, Sports, Puzzle, Racing" }), profile);
    const one = affinity(game({ genres: "Action" }), profile);
    expect(many).toBe(one);
  });
});

describe("recommendations", () => {
  const played = game({
    id: "p", title: "Played", platform: "Switch", franchise: "Metroid",
    genres: "Action", playtimeSeconds: 20 * HOUR,
  });

  it("prefers games matching what you actually play", () => {
    const out = recommendations([
      played,
      game({ id: "match", title: "Metroid Dread", franchise: "Metroid", platform: "Switch" }),
      game({ id: "other", title: "Farm Sim", platform: "PC", genres: "Sports", igdbRating: 99 }),
    ]);
    expect(out[0].id).toBe("match");
  });

  it("never recommends something you have already played", () => {
    const out = recommendations([played, game({ id: "new", title: "New", platform: "Switch" })]);
    expect(out.map((g) => g.id)).not.toContain("p");
  });

  it("skips hidden games", () => {
    const out = recommendations([
      played,
      game({ id: "hid", title: "Hidden", platform: "Switch", hidden: true }),
    ]);
    expect(out.map((g) => g.id)).not.toContain("hid");
  });

  it("falls back to highest-rated when nothing has been played", () => {
    const out = recommendations([
      game({ id: "low", title: "Low", igdbRating: 40 }),
      game({ id: "high", title: "High", igdbRating: 95 }),
    ]);
    expect(out[0].id).toBe("high");
  });

  it("honors the limit and returns nothing for an empty catalog", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      game({ id: `g${i}`, title: `G${i}`, igdbRating: 50 + i }),
    );
    expect(recommendations(many, 3)).toHaveLength(3);
    expect(recommendations([], 3)).toEqual([]);
  });
});

describe("rotate", () => {
  it("wraps around the list", () => {
    expect(rotate(["a", "b", "c"], 0)).toBe("a");
    expect(rotate(["a", "b", "c"], 4)).toBe("b");
  });
  it("handles a negative tick", () => {
    expect(rotate(["a", "b", "c"], -1)).toBe("c");
  });
  it("returns null for an empty list", () => {
    expect(rotate([], 2)).toBeNull();
  });
});
