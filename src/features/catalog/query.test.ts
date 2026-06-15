import { describe, it, expect } from "vitest";
import type { Game } from "./types";
import {
  applyQuery,
  buildSidebar,
  matchesSearch,
  collectionsOf,
  yearOf,
  DEFAULT_QUERY,
} from "./query";

function game(p: Partial<Game>): Game {
  return {
    id: "",
    title: "",
    platform: "",
    installState: "",
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

describe("yearOf / collectionsOf", () => {
  it("derives the UTC year", () => {
    expect(yearOf(0)).toBe("");
    // 2000-01-01T00:00:00Z = 946684800
    expect(yearOf(946684800)).toBe("2000");
  });
  it("splits newline-joined collections", () => {
    expect(collectionsOf(game({ collections: "RPGs\nFavorites \n\n Co-op" }))).toEqual([
      "RPGs",
      "Favorites",
      "Co-op",
    ]);
  });
});

describe("matchesSearch", () => {
  const g = game({
    title: "Crystalis",
    platform: "NES",
    developer: "SNK",
    genres: "Action RPG",
    releaseDate: 694224000, // 1992
  });
  it("empty query matches", () => expect(matchesSearch(g, "  ")).toBe(true));
  it("matches title case-insensitively", () => expect(matchesSearch(g, "cryst")).toBe(true));
  it("matches developer and genre across fields (AND terms)", () => {
    expect(matchesSearch(g, "snk rpg")).toBe(true);
    expect(matchesSearch(g, "snk shooter")).toBe(false);
  });
  it("matches year", () => expect(matchesSearch(g, "1992")).toBe(true));
});

describe("applyQuery", () => {
  const games = [
    game({ id: "1", title: "Zelda", platform: "NES", favorite: true, igdbRating: 95, playtimeSeconds: 100, lastPlayed: 50 }),
    game({ id: "2", title: "Crystalis", platform: "NES", igdbRating: 88, playtimeSeconds: 300, lastPlayed: 10 }),
    game({ id: "3", title: "Halo", platform: "Xbox", igdbRating: 90, playtimeSeconds: 50, lastPlayed: 90 }),
    game({ id: "4", title: "Secret", platform: "NES", hidden: true }),
  ];

  it("excludes hidden games always", () => {
    const out = applyQuery(games, DEFAULT_QUERY);
    expect(out.find((g) => g.id === "4")).toBeUndefined();
  });
  it("sorts by title by default", () => {
    expect(applyQuery(games, DEFAULT_QUERY).map((g) => g.title)).toEqual(["Crystalis", "Halo", "Zelda"]);
  });
  it("filters by platform", () => {
    const out = applyQuery(games, { ...DEFAULT_QUERY, filter: { kind: "platform", value: "NES" } });
    expect(out.map((g) => g.id)).toEqual(["2", "1"]);
  });
  it("filters by favorites", () => {
    const out = applyQuery(games, { ...DEFAULT_QUERY, filter: { kind: "favorites" } });
    expect(out.map((g) => g.id)).toEqual(["1"]);
  });
  it("sorts by rating desc", () => {
    expect(applyQuery(games, { ...DEFAULT_QUERY, sort: "rating" }).map((g) => g.id)).toEqual(["1", "3", "2"]);
  });
  it("sorts by playtime desc", () => {
    expect(applyQuery(games, { ...DEFAULT_QUERY, sort: "playtime" }).map((g) => g.id)).toEqual(["2", "1", "3"]);
  });
  it("sorts by recent desc", () => {
    expect(applyQuery(games, { ...DEFAULT_QUERY, sort: "recent" }).map((g) => g.id)).toEqual(["3", "1", "2"]);
  });
});

describe("buildSidebar", () => {
  const games = [
    game({ title: "A", platform: "NES", favorite: true, collections: "RPGs" }),
    game({ title: "B", platform: "NES", collections: "RPGs\nShmups" }),
    game({ title: "C", platform: "Xbox" }),
    game({ title: "H", platform: "NES", hidden: true }),
  ];
  it("lists All + Favorites first with counts, excluding hidden", () => {
    const sb = buildSidebar(games);
    expect(sb[0]).toMatchObject({ id: "all", count: 3 });
    expect(sb[1]).toMatchObject({ id: "favorites", count: 1 });
  });
  it("includes platforms and collections with counts", () => {
    const sb = buildSidebar(games);
    expect(sb.find((e) => e.id === "platform:NES")?.count).toBe(2);
    expect(sb.find((e) => e.id === "platform:Xbox")?.count).toBe(1);
    expect(sb.find((e) => e.id === "collection:RPGs")?.count).toBe(2);
    expect(sb.find((e) => e.id === "collection:Shmups")?.count).toBe(1);
  });
});
