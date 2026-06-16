// Pure friend-organization helpers (ROADMAP T9e). The server stores one
// `social_friend_meta` row per (owner, friend): a free-text `note`, a `groups`
// string, and a `pinned` flag (GET/PUT /api/social/friendmeta). `groups` is a
// comma-separated list on the wire; the client works with a string[]. All logic
// here is deterministic and IO-free → unit-tested in friendMeta.test.ts. The IPC
// glue lives in api.ts and the React wiring in useFriendMeta.

/** One friend's organization metadata, normalized for the client. */
export interface FriendMeta {
  userId: number;
  /** Free-text private note about this friend, or "" when unset. */
  note: string;
  /** Group/tag names this friend belongs to (deduped, order-preserving). */
  groups: string[];
  pinned: boolean;
}

/** The wire shape from `GET /api/social/friendmeta` (groups is a raw string). */
export interface RawFriendMeta {
  userId: number;
  note: string | null;
  groups: string | null;
  pinned: boolean;
}

/** Split a comma-separated groups string into a clean, deduped name list.
 *  Trims each entry, drops empties, and removes case-insensitive duplicates
 *  (keeping the first spelling seen). */
export function parseGroups(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Serialize a group list back to the comma-separated wire string. */
export function serializeGroups(groups: string[]): string {
  return groups.join(",");
}

/** Normalize a raw server row into a client FriendMeta. */
export function normalizeMeta(raw: RawFriendMeta): FriendMeta {
  return {
    userId: raw.userId,
    note: raw.note ?? "",
    groups: parseGroups(raw.groups),
    pinned: raw.pinned,
  };
}

/** Add `group` to a list if not already present (case-insensitive). */
export function addGroup(groups: string[], group: string): string[] {
  const name = group.trim();
  if (!name) return groups;
  const exists = groups.some((g) => g.toLowerCase() === name.toLowerCase());
  return exists ? groups : [...groups, name];
}

/** Remove `group` from a list (case-insensitive). */
export function removeGroup(groups: string[], group: string): string[] {
  const key = group.trim().toLowerCase();
  return groups.filter((g) => g.toLowerCase() !== key);
}

/** Toggle membership of `group` in a list. */
export function toggleGroup(groups: string[], group: string): string[] {
  const key = group.trim().toLowerCase();
  return groups.some((g) => g.toLowerCase() === key)
    ? removeGroup(groups, group)
    : addGroup(groups, group);
}

/** The distinct group names across many friends, sorted case-insensitively. */
export function allGroups(metas: Iterable<FriendMeta>): string[] {
  const seen = new Map<string, string>();
  for (const m of metas) {
    for (const g of m.groups) {
      const key = g.toLowerCase();
      if (!seen.has(key)) seen.set(key, g);
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** A friend paired with its metadata, for list rendering. `meta` may be a
 *  default (empty) when the friend has no row yet. */
export interface FriendWithMeta<F> {
  friend: F;
  meta: FriendMeta;
}

/** A named section of the organized friend list. */
export interface FriendSection<F> {
  /** "Pinned", a group name, or "" for the ungrouped catch-all. */
  title: string;
  items: FriendWithMeta<F>[];
}

const DEFAULT_META: Omit<FriendMeta, "userId"> = { note: "", groups: [], pinned: false };

/** Build a default (empty) meta for a friend with no server row yet. */
export function defaultMeta(userId: number): FriendMeta {
  return { userId, ...DEFAULT_META };
}

/** Organize friends into display sections: a "Pinned" section first (any pinned
 *  friend, regardless of group), then one section per group (alphabetical), then
 *  an "Ungrouped" catch-all. A friend appears under every group it belongs to,
 *  but pinned friends appear ONLY under "Pinned" to avoid duplication at the top.
 *  `idOf` maps a friend to its user id; `metaOf` looks up its meta. Empty
 *  sections are omitted. Within a section, `order` is preserved (callers pass an
 *  already-sorted friend list). */
export function organizeFriends<F>(
  friends: F[],
  idOf: (f: F) => number,
  metaOf: (id: number) => FriendMeta | undefined,
  groupFilter = "",
): FriendSection<F>[] {
  const withMeta: FriendWithMeta<F>[] = friends.map((friend) => ({
    friend,
    meta: metaOf(idOf(friend)) ?? defaultMeta(idOf(friend)),
  }));

  // When a specific group is selected, show just that flat list.
  if (groupFilter) {
    const key = groupFilter.toLowerCase();
    const items = withMeta.filter((w) => w.meta.groups.some((g) => g.toLowerCase() === key));
    return items.length ? [{ title: groupFilter, items }] : [];
  }

  const sections: FriendSection<F>[] = [];
  const pinned = withMeta.filter((w) => w.meta.pinned);
  if (pinned.length) sections.push({ title: "Pinned", items: pinned });

  const rest = withMeta.filter((w) => !w.meta.pinned);
  const groups = allGroups(rest.map((w) => w.meta));
  for (const g of groups) {
    const key = g.toLowerCase();
    const items = rest.filter((w) => w.meta.groups.some((x) => x.toLowerCase() === key));
    if (items.length) sections.push({ title: g, items });
  }

  const ungrouped = rest.filter((w) => w.meta.groups.length === 0);
  if (ungrouped.length) sections.push({ title: "Ungrouped", items: ungrouped });

  return sections;
}
