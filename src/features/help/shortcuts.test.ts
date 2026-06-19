import { describe, it, expect } from "vitest";
import { isHelpHotkey, isEditableTag, SHORTCUT_GROUPS } from "./shortcuts";

describe("isEditableTag", () => {
  it("flags text-entry elements", () => {
    expect(isEditableTag("INPUT")).toBe(true);
    expect(isEditableTag("textarea")).toBe(true);
    expect(isEditableTag("select")).toBe(true);
  });
  it("ignores everything else", () => {
    expect(isEditableTag("DIV")).toBe(false);
    expect(isEditableTag(undefined)).toBe(false);
  });
});

describe("isHelpHotkey", () => {
  it("opens on ? when not typing", () => {
    expect(isHelpHotkey("?", false)).toBe(true);
  });
  it("does not fire while typing in a field", () => {
    expect(isHelpHotkey("?", true)).toBe(false);
  });
  it("ignores other keys", () => {
    expect(isHelpHotkey("a", false)).toBe(false);
  });
});

describe("SHORTCUT_GROUPS", () => {
  it("every group has a title and at least one shortcut", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.shortcuts.length).toBeGreaterThan(0);
    }
  });
});
