import { describe, expect, it } from "vitest";
import type { Game } from "./types";
import {
  isInstalledWithoutOwnership,
  shouldShowInLibrary,
} from "./ownershipDisplay";

function game(installState: string): Game {
  return {
    id: "game-1",
    title: "Game",
    platform: "PC",
    installState,
    coverArtPath: "",
    coverArtUrl: "",
    favorite: false,
    hidden: false,
    developer: "",
    publisher: "",
    franchise: "",
    genres: "",
    contentPath: "",
    releaseDate: 0,
    summary: "",
    igdbRating: 0,
    playtimeSeconds: 0,
    lastPlayed: 0,
    serverBacked: true,
    collections: "",
    launchUri: "",
    exePath: "",
    emulatorPath: "",
    romPath: "",
    arguments: "",
    launchOptions: "",
    preLaunchCmd: "",
    postExitCmd: "",
  };
}

describe("library ownership display", () => {
  const noneOwned = new Set<string>();

  it("keeps an installed unowned game visible and marks it", () => {
    const installed = game("installed");
    expect(shouldShowInLibrary(installed, noneOwned)).toBe(true);
    expect(isInstalledWithoutOwnership(installed, noneOwned)).toBe(true);
  });

  it("does not keep an absent unowned game in Library", () => {
    const absent = game("notInstalled");
    expect(shouldShowInLibrary(absent, noneOwned)).toBe(false);
    expect(isInstalledWithoutOwnership(absent, noneOwned)).toBe(false);
  });

  it("does not claim missing ownership before ownership has loaded", () => {
    expect(isInstalledWithoutOwnership(game("installed"), undefined)).toBe(false);
  });
});
