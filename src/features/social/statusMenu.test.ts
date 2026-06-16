import { describe, it, expect } from "vitest";
import {
  STATUS_OPTIONS,
  MAX_STATUS_TEXT,
  clampStatusText,
  statusLabel,
  presenceFrameInput,
} from "./statusMenu";

describe("STATUS_OPTIONS", () => {
  it("lists the four self-selectable states in order", () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(["online", "away", "busy", "invisible"]);
  });
  it("presents busy as Do Not Disturb", () => {
    expect(STATUS_OPTIONS.find((o) => o.value === "busy")?.label).toBe("Do Not Disturb");
  });
});

describe("clampStatusText", () => {
  it("trims surrounding whitespace", () => {
    expect(clampStatusText("  hi  ")).toBe("hi");
  });
  it("caps at MAX_STATUS_TEXT", () => {
    const long = "x".repeat(MAX_STATUS_TEXT + 50);
    expect(clampStatusText(long)).toHaveLength(MAX_STATUS_TEXT);
  });
  it("empty stays empty", () => {
    expect(clampStatusText("   ")).toBe("");
  });
});

describe("statusLabel", () => {
  it("maps known values", () => {
    expect(statusLabel("away")).toBe("Away");
    expect(statusLabel("busy")).toBe("Do Not Disturb");
  });
  it("falls back to the raw token", () => {
    expect(statusLabel("ingame")).toBe("ingame");
  });
});

describe("presenceFrameInput", () => {
  it("sets dnd only for busy", () => {
    expect(presenceFrameInput("busy", "heads down")).toEqual({
      state: "busy",
      statusText: "heads down",
      dnd: true,
    });
    expect(presenceFrameInput("online", "  hi  ")).toEqual({
      state: "online",
      statusText: "hi",
      dnd: false,
    });
  });
  it("clamps the status text", () => {
    expect(presenceFrameInput("away", "y".repeat(200)).statusText).toHaveLength(MAX_STATUS_TEXT);
  });
});
