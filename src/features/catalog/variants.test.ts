import { describe, it, expect } from "vitest";
import type { Game } from "./types";
import { fileStem, variantLabel, variantScore, groupVariants } from "./variants";

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

describe("fileStem", () => {
  it("strips dir and extension", () => {
    expect(fileStem("/roms/nes/Crystalis (U) [!].nes", "X")).toBe("Crystalis (U) [!]");
    expect(fileStem("C:\\roms\\SMB3.nes", "X")).toBe("SMB3");
  });
  it("falls back to title when empty", () => {
    expect(fileStem("", "Fallback")).toBe("Fallback");
  });
});

describe("variantLabel", () => {
  it("labels verified, alt, prototype, prg, patch", () => {
    expect(variantLabel(game({ contentPath: "Crystalis (U) [!].nes" }))).toBe("Verified");
    expect(variantLabel(game({ contentPath: "Crystalis (U) [a1].nes" }))).toBe("Alt 1");
    expect(variantLabel(game({ contentPath: "Star Wars (Prototype).nes" }))).toBe("Prototype");
    expect(variantLabel(game({ contentPath: "SMB3 (PRG 1).nes" }))).toBe("PRG 1");
    expect(variantLabel(game({ contentPath: "Game [T-En].nes" }))).toBe("Eng patch");
    expect(variantLabel(game({ contentPath: "Plain.nes" }))).toBe("");
  });
});

describe("variantScore", () => {
  it("verified beats plain beats alt beats bad", () => {
    const verified = variantScore(game({ contentPath: "G (U) [!].nes" }));
    const plain = variantScore(game({ contentPath: "G (U).nes" }));
    const alt = variantScore(game({ contentPath: "G (U) [a1].nes" }));
    const bad = variantScore(game({ contentPath: "G (U) [b1].nes" }));
    expect(verified).toBeLessThan(plain);
    expect(plain).toBeLessThan(alt);
    expect(alt).toBeLessThan(bad);
  });
  it("installed server copy wins outright", () => {
    const server = variantScore(game({ serverBacked: true, installState: "installed", title: "G" }));
    expect(server).toBeLessThan(0);
  });
});

describe("groupVariants", () => {
  it("collapses dumps and picks the best representative", () => {
    const games = [
      game({ id: "alt", title: "Crystalis", platform: "NES", contentPath: "Crystalis (U) [a1].nes" }),
      game({ id: "good", title: "Crystalis", platform: "NES", contentPath: "Crystalis (U) [!].nes" }),
      game({ id: "halo", title: "Halo", platform: "Xbox", contentPath: "halo.iso" }),
    ];
    const groups = groupVariants(games);
    expect(groups.length).toBe(2);
    const crystalis = groups.find((g) => g.key === "NES|crystalis")!;
    expect(crystalis.members.length).toBe(2);
    expect(crystalis.representative.id).toBe("good"); // verified scores best
  });
  it("preserves first-appearance order of groups", () => {
    const games = [
      game({ id: "1", title: "Zelda", platform: "NES" }),
      game({ id: "2", title: "Crystalis", platform: "NES" }),
    ];
    expect(groupVariants(games).map((g) => g.representative.id)).toEqual(["1", "2"]);
  });
});
