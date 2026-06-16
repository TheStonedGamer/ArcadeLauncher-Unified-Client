import { describe, expect, it } from "vitest";
import {
  addToCollection,
  applyPrefs,
  effectiveCollections,
  emptyPrefs,
  removeFromCollection,
  toggleFavorite,
  toggleHidden,
  type CatalogPrefs,
} from "./prefs";
import type { Game } from "./types";

function game(p: Partial<Game> & { id: string }): Game {
  return {
    title: p.id,
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

describe("catalog prefs overlay", () => {
  it("falls back to catalog values when no override is set", () => {
    const g = game({ id: "a", favorite: true, hidden: false, collections: "RPGs" });
    const [merged] = applyPrefs([g], emptyPrefs);
    expect(merged.favorite).toBe(true);
    expect(merged.hidden).toBe(false);
    expect(merged.collections).toBe("RPGs");
    // No override → same object reference (cheap no-op).
    expect(merged).toBe(g);
  });

  it("overrides favorite and hidden when set", () => {
    const g = game({ id: "a", favorite: false, hidden: false });
    const prefs: CatalogPrefs = { favorites: { a: true }, hidden: { a: true }, collections: {} };
    const [merged] = applyPrefs([g], prefs);
    expect(merged.favorite).toBe(true);
    expect(merged.hidden).toBe(true);
  });

  it("toggleFavorite flips the effective value and persists the override", () => {
    const g = game({ id: "a", favorite: true });
    // First toggle off the catalog-true value.
    let prefs = toggleFavorite(emptyPrefs, g);
    expect(prefs.favorites["a"]).toBe(false);
    // Toggling again flips it back on.
    prefs = toggleFavorite(prefs, g);
    expect(prefs.favorites["a"]).toBe(true);
  });

  it("toggleHidden flips effective hidden", () => {
    const g = game({ id: "a", hidden: false });
    const prefs = toggleHidden(emptyPrefs, g);
    expect(prefs.hidden["a"]).toBe(true);
  });

  it("add/remove collection are idempotent and seed from catalog collections", () => {
    const g = game({ id: "a", collections: "RPGs" });
    let prefs = addToCollection(emptyPrefs, g, "Favorites");
    expect(effectiveCollections(prefs, g)).toEqual(["RPGs", "Favorites"]);
    // Adding an existing one is a no-op (same reference).
    expect(addToCollection(prefs, g, "RPGs")).toBe(prefs);
    // Blank is ignored.
    expect(addToCollection(prefs, g, "  ")).toBe(prefs);
    prefs = removeFromCollection(prefs, g, "RPGs");
    expect(effectiveCollections(prefs, g)).toEqual(["Favorites"]);
    // Removing an absent one is a no-op.
    expect(removeFromCollection(prefs, g, "Nope")).toBe(prefs);
  });

  it("applyPrefs replaces the collections string from the override list", () => {
    const g = game({ id: "a", collections: "RPGs" });
    const prefs = addToCollection(emptyPrefs, g, "Co-op");
    const [merged] = applyPrefs([g], prefs);
    expect(merged.collections).toBe("RPGs\nCo-op");
  });
});
