import { describe, it, expect } from "vitest";
import {
  parseGroups,
  serializeGroups,
  normalizeMeta,
  addGroup,
  removeGroup,
  toggleGroup,
  allGroups,
  defaultMeta,
  organizeFriends,
  type FriendMeta,
} from "./friendMeta";

describe("parseGroups", () => {
  it("splits, trims, drops empties", () => {
    expect(parseGroups(" a, b ,, c ")).toEqual(["a", "b", "c"]);
  });
  it("dedupes case-insensitively keeping first spelling", () => {
    expect(parseGroups("Pals,pals,PALS,Squad")).toEqual(["Pals", "Squad"]);
  });
  it("handles null/empty", () => {
    expect(parseGroups(null)).toEqual([]);
    expect(parseGroups("")).toEqual([]);
    expect(parseGroups("   ")).toEqual([]);
  });
});

describe("serializeGroups", () => {
  it("round-trips through parseGroups", () => {
    expect(serializeGroups(parseGroups("a, b, c"))).toBe("a,b,c");
  });
});

describe("normalizeMeta", () => {
  it("maps nulls to defaults and parses groups", () => {
    expect(normalizeMeta({ userId: 7, note: null, groups: "x, y", pinned: true })).toEqual({
      userId: 7,
      note: "",
      groups: ["x", "y"],
      pinned: true,
    });
  });
});

describe("add/remove/toggleGroup", () => {
  it("adds when absent, no-ops when present", () => {
    expect(addGroup(["a"], "b")).toEqual(["a", "b"]);
    expect(addGroup(["a"], "A")).toEqual(["a"]);
    expect(addGroup(["a"], "  ")).toEqual(["a"]);
  });
  it("removes case-insensitively", () => {
    expect(removeGroup(["a", "B"], "b")).toEqual(["a"]);
  });
  it("toggles", () => {
    expect(toggleGroup(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleGroup(["a", "b"], "A")).toEqual(["b"]);
  });
});

describe("allGroups", () => {
  it("collects distinct names sorted case-insensitively", () => {
    const metas: FriendMeta[] = [
      { userId: 1, note: "", groups: ["Zeta", "alpha"], pinned: false },
      { userId: 2, note: "", groups: ["ALPHA", "beta"], pinned: false },
    ];
    expect(allGroups(metas)).toEqual(["alpha", "beta", "Zeta"]);
  });
});

describe("organizeFriends", () => {
  interface F { id: number; name: string; }
  const friends: F[] = [
    { id: 1, name: "ann" },
    { id: 2, name: "bob" },
    { id: 3, name: "cy" },
    { id: 4, name: "dee" },
  ];
  const idOf = (f: F) => f.id;
  const metas: Record<number, FriendMeta> = {
    1: { userId: 1, note: "", groups: ["Squad"], pinned: true },
    2: { userId: 2, note: "", groups: ["Squad", "Work"], pinned: false },
    3: { userId: 3, note: "", groups: [], pinned: false },
    // 4 has no meta → default (ungrouped, unpinned)
  };
  const metaOf = (id: number) => metas[id];

  it("sections: pinned first, groups alphabetical, ungrouped last", () => {
    const sections = organizeFriends(friends, idOf, metaOf);
    expect(sections.map((s) => s.title)).toEqual(["Pinned", "Squad", "Work", "Ungrouped"]);
    // Pinned holds ann (and only ann; she does not also appear under Squad).
    expect(sections[0].items.map((w) => w.friend.id)).toEqual([1]);
    expect(sections[1].items.map((w) => w.friend.id)).toEqual([2]); // Squad: bob (ann excluded, pinned)
    expect(sections[2].items.map((w) => w.friend.id)).toEqual([2]); // Work: bob
    expect(sections[3].items.map((w) => w.friend.id)).toEqual([3, 4]); // Ungrouped: cy, dee
  });

  it("defaults a friend with no meta row", () => {
    const sections = organizeFriends(friends, idOf, () => undefined);
    expect(sections.map((s) => s.title)).toEqual(["Ungrouped"]);
    expect(sections[0].items.every((w) => w.meta.groups.length === 0)).toBe(true);
  });

  it("groupFilter yields a single flat section", () => {
    const sections = organizeFriends(friends, idOf, metaOf, "squad");
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("squad");
    // Both ann and bob are in Squad; the filter ignores pinned grouping.
    expect(sections[0].items.map((w) => w.friend.id)).toEqual([1, 2]);
  });

  it("groupFilter with no matches yields no sections", () => {
    expect(organizeFriends(friends, idOf, metaOf, "nope")).toEqual([]);
  });
});

describe("defaultMeta", () => {
  it("is empty and unpinned", () => {
    expect(defaultMeta(9)).toEqual({ userId: 9, note: "", groups: [], pinned: false });
  });
});
