import { describe, expect, it } from "vitest";
import { buildTitleMap, displayName, unknownIds } from "./titles";

describe("buildTitleMap", () => {
  it("maps id to title", () => {
    expect(buildTitleMap([{ id: "pc-abc123", title: "Halo" }])).toEqual({ "pc-abc123": "Halo" });
  });

  it("trims surrounding whitespace off titles", () => {
    expect(buildTitleMap([{ id: "a", title: "  Doom  " }])).toEqual({ a: "Doom" });
  });

  it("skips blank titles so the row falls back to the id instead of rendering empty", () => {
    expect(buildTitleMap([{ id: "a", title: "" }, { id: "b", title: "   " }])).toEqual({});
  });

  it("skips entries with a blank id", () => {
    expect(buildTitleMap([{ id: "", title: "Nameless" }])).toEqual({});
  });

  it("is empty for an empty catalog", () => {
    expect(buildTitleMap([])).toEqual({});
  });

  it("last entry wins on duplicate ids", () => {
    expect(buildTitleMap([{ id: "a", title: "Old" }, { id: "a", title: "New" }])).toEqual({ a: "New" });
  });
});

describe("displayName", () => {
  it("returns the catalog title when known", () => {
    expect(displayName("pc-abc123", { "pc-abc123": "Halo" })).toBe("Halo");
  });

  it("falls back to the raw id when the catalog has no entry", () => {
    expect(displayName("pc-abc123", { other: "Doom" })).toBe("pc-abc123");
  });

  it("falls back when the map is undefined", () => {
    expect(displayName("pc-abc123", undefined)).toBe("pc-abc123");
  });

  it("falls back when the mapped title is blank", () => {
    expect(displayName("a", { a: "   " })).toBe("a");
  });

  it("trims the returned title", () => {
    expect(displayName("a", { a: " Myst " })).toBe("Myst");
  });
});

describe("unknownIds", () => {
  it("lists ids with no title", () => {
    expect(unknownIds(["a", "b"], { a: "Halo" })).toEqual(["b"]);
  });

  it("is empty when every id is named", () => {
    expect(unknownIds(["a", "b"], { a: "Halo", b: "Doom" })).toEqual([]);
  });

  it("treats a blank title as unknown", () => {
    expect(unknownIds(["a"], { a: "  " })).toEqual(["a"]);
  });

  it("treats a missing map as all-unknown", () => {
    expect(unknownIds(["b", "a"], undefined)).toEqual(["a", "b"]);
  });

  it("dedupes and sorts so the result is stable across renders", () => {
    expect(unknownIds(["c", "a", "c"], {})).toEqual(["a", "c"]);
  });

  it("is empty for an empty queue", () => {
    expect(unknownIds([], {})).toEqual([]);
  });
});
