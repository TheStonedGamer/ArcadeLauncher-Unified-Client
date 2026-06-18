import { describe, expect, it } from "vitest";
import { cycleView, VIEW_ORDER } from "./views";

describe("cycleView", () => {
  it("moves next through the tab order", () => {
    expect(cycleView("library", "next")).toBe("steam");
    expect(cycleView("steam", "next")).toBe("epic");
  });
  it("moves prev through the tab order", () => {
    expect(cycleView("steam", "prev")).toBe("library");
    expect(cycleView("epic", "prev")).toBe("steam");
  });
  it("wraps at both ends", () => {
    expect(cycleView(VIEW_ORDER[0], "prev")).toBe(VIEW_ORDER[VIEW_ORDER.length - 1]);
    expect(cycleView(VIEW_ORDER[VIEW_ORDER.length - 1], "next")).toBe(VIEW_ORDER[0]);
  });
});
