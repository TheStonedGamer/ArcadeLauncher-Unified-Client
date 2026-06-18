import { describe, expect, it } from "vitest";
import { nextIndex, pageIndex, PAGE_ROWS } from "./navigate";

// A 3-column grid of 7 tiles:
//  0 1 2
//  3 4 5
//  6
describe("nextIndex (3 cols, 7 tiles)", () => {
  const N = (i: number, intent: Parameters<typeof nextIndex>[1]) => nextIndex(i, intent, 7, 3);

  it("moves right but stops at the row's right edge", () => {
    expect(N(0, "right")).toBe(1);
    expect(N(2, "right")).toBe(2); // right edge of row 0
  });
  it("moves left but stops at the row's left edge", () => {
    expect(N(4, "left")).toBe(3);
    expect(N(3, "left")).toBe(3); // left edge of row 1
  });
  it("moves down by a row, clamping when there's no tile below", () => {
    expect(N(0, "down")).toBe(3);
    expect(N(4, "down")).toBe(4); // 7 would be out of range
    expect(N(6, "down")).toBe(6);
  });
  it("moves up by a row, clamping at the top", () => {
    expect(N(3, "up")).toBe(0);
    expect(N(1, "up")).toBe(1);
  });
  it("stops at the last tile going right", () => {
    expect(N(6, "right")).toBe(6);
  });
  it("ignores non-directional intents", () => {
    expect(N(4, "select")).toBe(4);
    expect(N(4, "bigpicture")).toBe(4);
  });
  it("clamps an out-of-range current index", () => {
    // Clamped to 6, which is a row-start (6 % 3 === 0) → left stays put.
    expect(nextIndex(99, "left", 7, 3)).toBe(6);
    expect(nextIndex(99, "up", 7, 3)).toBe(3); // clamped to 6, then up a row
    expect(nextIndex(-5, "right", 7, 3)).toBe(1); // clamped to 0, then right
  });
  it("handles an empty grid", () => {
    expect(nextIndex(0, "down", 0, 3)).toBe(0);
  });
});

describe("pageIndex", () => {
  // 3 cols → a page is PAGE_ROWS*3 tiles.
  const step = PAGE_ROWS * 3;
  it("jumps down a page, clamping at the last tile", () => {
    expect(pageIndex(0, "pageDown", 100, 3)).toBe(step);
    expect(pageIndex(95, "pageDown", 100, 3)).toBe(99);
  });
  it("jumps up a page, clamping at zero", () => {
    expect(pageIndex(step, "pageUp", 100, 3)).toBe(0);
    expect(pageIndex(2, "pageUp", 100, 3)).toBe(0);
  });
  it("ignores non-page intents and empty grids", () => {
    expect(pageIndex(5, "select", 100, 3)).toBe(5);
    expect(pageIndex(0, "pageDown", 0, 3)).toBe(0);
  });
});
