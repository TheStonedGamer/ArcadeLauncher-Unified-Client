import { describe, expect, it } from "vitest";
import {
  filterGames,
  formatSize,
  gameSubtitle,
  matchesSearch,
  parseCatalog,
  parseGame,
  platformsOf,
  releaseYear,
  type MobileGame,
} from "./catalog";

const game = (over: Partial<MobileGame> & { id: string; title: string }): MobileGame => ({
  platform: "",
  genres: "",
  developer: "",
  releaseDate: 0,
  coverArtUrl: "",
  summary: "",
  sizeBytes: 0,
  ...over,
});

describe("parseGame", () => {
  it("keeps the fields the companion renders", () => {
    expect(parseGame({ id: "z", title: "Zelda", platform: "NES", sizeBytes: 1024, junk: true })).toMatchObject({
      id: "z",
      title: "Zelda",
      platform: "NES",
      sizeBytes: 1024,
    });
  });

  it("defaults absent or wrongly-typed fields instead of failing", () => {
    expect(parseGame({ id: "z", title: "Zelda", platform: 7, releaseDate: "1986" })).toMatchObject({
      platform: "",
      releaseDate: 0,
    });
  });

  it("rejects rows with no id or no title", () => {
    for (const bad of [null, "z", {}, { id: "z" }, { title: "Zelda" }, { id: "", title: "Zelda" }]) {
      expect(parseGame(bad)).toBeNull();
    }
  });
});

describe("parseCatalog", () => {
  const rows = [{ id: "a", title: "A" }, { id: "b", title: "B" }];

  it("accepts a bare array and the wrapped envelope alike", () => {
    expect(parseCatalog(rows)).toHaveLength(2);
    expect(parseCatalog({ games: rows })).toHaveLength(2);
  });

  it("skips unusable rows rather than dropping the whole catalog", () => {
    expect(parseCatalog([rows[0], null, { title: "no id" }, rows[1]]).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("returns empty for anything that isn't a catalog", () => {
    for (const bad of [null, "", 7, {}, { games: "nope" }]) {
      expect(parseCatalog(bad)).toEqual([]);
    }
  });
});

describe("matchesSearch", () => {
  const g = game({ id: "z", title: "The Legend of Zelda", platform: "NES", genres: "Adventure", developer: "Nintendo" });

  it("matches any of title, platform, genre or developer, case-insensitively", () => {
    for (const q of ["zelda", "ZELDA", "legend", "nes", "adventure", "nintendo"]) {
      expect(matchesSearch(g, q)).toBe(true);
    }
  });

  it("does not match unrelated text", () => {
    expect(matchesSearch(g, "metroid")).toBe(false);
  });

  it("treats an empty or whitespace query as match-all", () => {
    expect(matchesSearch(g, "")).toBe(true);
    expect(matchesSearch(g, "   ")).toBe(true);
  });
});

describe("filterGames", () => {
  const games = [
    game({ id: "m", title: "Super Metroid", platform: "SNES" }),
    game({ id: "z", title: "Zelda", platform: "NES" }),
    game({ id: "c", title: "Contra", platform: "NES" }),
  ];

  it("sorts alphabetically regardless of input order", () => {
    expect(filterGames(games, "").map((g) => g.title)).toEqual(["Contra", "Super Metroid", "Zelda"]);
  });

  it("applies the platform filter", () => {
    expect(filterGames(games, "", "NES").map((g) => g.id)).toEqual(["c", "z"]);
  });

  it("combines search and platform", () => {
    expect(filterGames(games, "zel", "NES").map((g) => g.id)).toEqual(["z"]);
    expect(filterGames(games, "zel", "SNES")).toEqual([]);
  });

  it("does not mutate the input array's order", () => {
    const input = [...games];
    filterGames(input, "");
    expect(input.map((g) => g.id)).toEqual(["m", "z", "c"]);
  });
});

describe("platformsOf", () => {
  it("lists distinct platforms alphabetically, ignoring blanks", () => {
    const games = [
      game({ id: "1", title: "A", platform: "SNES" }),
      game({ id: "2", title: "B", platform: "NES" }),
      game({ id: "3", title: "C", platform: "NES" }),
      game({ id: "4", title: "D", platform: "" }),
    ];
    expect(platformsOf(games)).toEqual(["NES", "SNES"]);
  });

  it("is empty for an empty catalog", () => {
    expect(platformsOf([])).toEqual([]);
  });
});

describe("formatSize", () => {
  it("scales through the units", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(4.5 * 1024 ** 3)).toBe("4.5 GB");
  });

  it("drops the decimal once a value reaches double digits", () => {
    expect(formatSize(12.3 * 1024 ** 3)).toBe("12 GB");
  });

  it("rounds large values in a unit instead of showing a decimal", () => {
    expect(formatSize(500 * 1024 ** 3)).toBe("500 GB");
  });

  it("shows a dash when the size is unknown", () => {
    for (const bad of [0, -1, NaN, Infinity]) expect(formatSize(bad)).toBe("—");
  });
});

describe("releaseYear / gameSubtitle", () => {
  const stamp = Date.UTC(1986, 1, 21) / 1000;

  it("renders the release year from a unix stamp", () => {
    expect(releaseYear(game({ id: "z", title: "Z", releaseDate: stamp }))).toBe("1986");
  });

  it("is blank when the catalog has no date", () => {
    expect(releaseYear(game({ id: "z", title: "Z" }))).toBe("");
  });

  it("joins platform and year, omitting whichever is missing", () => {
    expect(gameSubtitle(game({ id: "z", title: "Z", platform: "NES", releaseDate: stamp }))).toBe("NES · 1986");
    expect(gameSubtitle(game({ id: "z", title: "Z", platform: "NES" }))).toBe("NES");
    expect(gameSubtitle(game({ id: "z", title: "Z", releaseDate: stamp }))).toBe("1986");
    expect(gameSubtitle(game({ id: "z", title: "Z" }))).toBe("");
  });
});
