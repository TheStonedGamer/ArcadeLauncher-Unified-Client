import { describe, it, expect } from "vitest";
import type { Game } from "../types";
import { groupVariants } from "../variants";
import { collections } from "./Sidebar";

function game(p: Partial<Game>): Game {
  return {
    id: "", title: "", platform: "", installState: "", coverArtPath: "", coverArtUrl: "",
    developer: "", publisher: "", franchise: "", genres: "", contentPath: "",
    releaseDate: 0, playtimeSeconds: 0, lastPlayed: 0, igdbRating: 0, summary: "",
    serverBacked: false, favorite: false, hidden: false, collections: "",
    launchUri: "", exePath: "", emulatorPath: "", romPath: "", arguments: "",
    launchOptions: "", preLaunchCmd: "", postExitCmd: "",
    ...p,
  };
}

const groups = groupVariants([
  game({ id: "a", title: "Alpha", platform: "PC", favorite: true }),
  game({ id: "b", title: "Beta", platform: "PC", installState: "installed" }),
  game({ id: "c", title: "Gamma", platform: "PC" }),
]);

describe("collections", () => {
  it("always ends with All Games holding everything", () => {
    const secs = collections(groups);
    const last = secs[secs.length - 1];
    expect(last.id).toBe("all");
    expect(last.groups).toHaveLength(3);
  });

  it("lists favorites and installed ahead of All Games", () => {
    const secs = collections(groups);
    expect(secs.map((s) => s.id)).toEqual(["favorites", "installed", "all"]);
    expect(secs[0].groups[0].representative.title).toBe("Alpha");
    expect(secs[1].groups[0].representative.title).toBe("Beta");
  });

  it("omits empty collections rather than showing a zero count", () => {
    const plain = groupVariants([game({ id: "c", title: "Gamma", platform: "PC" })]);
    expect(collections(plain).map((s) => s.id)).toEqual(["all"]);
  });

  it("lists the user's own collections between the built-ins and All Games", () => {
    const secs = collections(
      groupVariants([
        game({ id: "a", title: "Alpha", platform: "PC", favorite: true, collections: "RPGs" }),
        game({ id: "b", title: "Beta", platform: "PC", collections: "Co-op\nRPGs" }),
      ]),
    );
    expect(secs.map((s) => s.id)).toEqual([
      "favorites",
      "collection:Co-op",
      "collection:RPGs",
      "all",
    ]);
    expect(secs[2].groups.map((g) => g.representative.title)).toEqual(["Alpha", "Beta"]);
  });

  it("handles an empty library", () => {
    expect(collections([])).toEqual([{ id: "all", label: "All Games", groups: [] }]);
  });
});
