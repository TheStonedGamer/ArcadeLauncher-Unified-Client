import { describe, expect, it } from "vitest";
import { levelForXp, levelProgress, xpForLevel } from "./profile";

describe("levelForXp", () => {
  it("mirrors the server's floor(sqrt(xp/100))", () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(50)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(399)).toBe(1);
    expect(levelForXp(400)).toBe(2);
    expect(levelForXp(900)).toBe(3);
  });

  it("clamps non-positive XP to level 0", () => {
    expect(levelForXp(-100)).toBe(0);
  });
});

describe("xpForLevel", () => {
  it("is the inverse threshold level²·100", () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(400);
    expect(xpForLevel(3)).toBe(900);
  });

  it("clamps non-positive levels to 0", () => {
    expect(xpForLevel(-2)).toBe(0);
  });
});

describe("levelProgress", () => {
  it("is empty at the start of a level", () => {
    expect(levelProgress(100)).toEqual({ level: 1, into: 0, span: 300, next: 400, pct: 0 });
  });

  it("reports the fraction through the current level", () => {
    // xp 250 → level 1 (base 100, next 400); 150 of a 300 span = 50%.
    expect(levelProgress(250)).toEqual({ level: 1, into: 150, span: 300, next: 400, pct: 50 });
  });

  it("level 0 spans 0→100 XP", () => {
    expect(levelProgress(0)).toEqual({ level: 0, into: 0, span: 100, next: 100, pct: 0 });
    expect(levelProgress(50)).toEqual({ level: 0, into: 50, span: 100, next: 100, pct: 50 });
  });
});
