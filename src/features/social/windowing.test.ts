import { describe, expect, it } from "vitest";
import { clamp, EDGE } from "./windowing";

const VIEW = { w: 1000, h: 800 };

describe("clamp", () => {
  it("leaves a window where it is when it fits", () => {
    expect(clamp({ x: 100, y: 100 }, { w: 340, h: 500 }, VIEW)).toEqual({ x: 100, y: 100 });
  });

  it("keeps a sliver on screen at every edge", () => {
    const size = { w: 340, h: 500 };
    expect(clamp({ x: -9999, y: -9999 }, size, VIEW).x).toBe(EDGE - size.w);
    expect(clamp({ x: -9999, y: -9999 }, size, VIEW).y).toBe(0);
    expect(clamp({ x: 9999, y: 9999 }, size, VIEW)).toEqual({
      x: VIEW.w - EDGE,
      y: VIEW.h - EDGE,
    });
  });
});
