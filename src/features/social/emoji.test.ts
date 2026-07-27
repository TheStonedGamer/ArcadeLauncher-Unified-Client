import { describe, expect, it } from "vitest";
import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  MAX_RECENT,
  parseRecent,
  pushRecent,
  searchEmoji,
} from "./emoji";

describe("the bundled set", () => {
  it("has no duplicate glyphs across groups", () => {
    const seen = new Set(ALL_EMOJI.map((e) => e.glyph));
    expect(seen.size).toBe(ALL_EMOJI.length);
  });

  it("gives every group something to show", () => {
    for (const g of EMOJI_GROUPS) expect(g.emoji.length).toBeGreaterThan(0);
  });
});

describe("searchEmoji", () => {
  it("finds by name and by keyword", () => {
    expect(searchEmoji("fire")[0].glyph).toBe("🔥");
    expect(searchEmoji("lol").map((e) => e.glyph)).toContain("😂");
    expect(searchEmoji("gg").map((e) => e.glyph)).toContain("👍");
  });

  it("ranks a prefix match above a mid-word one", () => {
    // "smile" starts 😄's name; 😅 only contains it.
    const order = searchEmoji("smile").map((e) => e.glyph);
    expect(order.indexOf("😄")).toBeLessThan(order.indexOf("😅"));
  });

  it("finds a pasted glyph", () => {
    expect(searchEmoji("🎮")[0].glyph).toBe("🎮");
  });

  it("returns nothing for a blank query — the picker browses instead", () => {
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchEmoji("a", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("recents", () => {
  it("moves a repeat pick back to the front without duplicating it", () => {
    expect(pushRecent(["😀", "🔥"], "🔥")).toEqual(["🔥", "😀"]);
  });

  it("caps the list", () => {
    const many = ALL_EMOJI.slice(0, MAX_RECENT).map((e) => e.glyph);
    expect(pushRecent(many, "💯")).toHaveLength(MAX_RECENT);
  });

  it("drops stored glyphs that are no longer in the set", () => {
    expect(parseRecent(["🔥", "🫥", 7, null])).toEqual(["🔥"]);
    expect(parseRecent("nope")).toEqual([]);
  });
});
