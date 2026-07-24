// The friend roster, as the phone reads it from `GET /api/social/friends`.
//
// Pure and IO-free like the other cores: the shapes here are covered by the
// repo-root vitest run, so the field names/casing stay pinned to the server's
// `/friends` payload (src-tauri/src/social/model.rs — the `Friend` struct) on
// both CI legs without a live gateway. The fetch itself lives in ../api.ts.
//
// Why this exists: presence over the gateway is a stream of *changes*. A friend
// already online when the phone connects never sends a fresh frame, so without
// this authoritative snapshot the DMs list would show nobody signed in even
// when they are. The desktop client loads the very same list on connect.

export interface Friend {
  /** Server account id. */
  id: number;
  username: string;
  /** Wire presence token: "online" | "offline" | "away" | "busy" | "ingame" |
   *  "invisible". Unknown tokens are kept as-is; the UI treats anything that is
   *  not clearly offline as reachable. */
  presence: string;
  /** What they are playing, when the server says. */
  gameTitle: string;
  /** Custom status text; empty when unset. */
  statusText: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Parse a `/api/social/friends` body into accepted friends only. Pending
 *  requests and blocked rows are dropped: the DMs list is people you can
 *  actually message, not the relationship inbox (which lives on the desktop). */
export function parseFriends(body: unknown): Friend[] {
  if (!body || typeof body !== "object") return [];
  const rows = (body as Record<string, unknown>).friends;
  if (!Array.isArray(rows)) return [];
  const out: Friend[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    // The server only ever omits `relation` for legacy rows, which were always
    // accepted friends; a present value must equal "accepted" to count.
    if (r.relation !== undefined && r.relation !== "accepted") continue;
    const id = num(r.accountId);
    if (id <= 0) continue;
    out.push({
      id,
      username: str(r.username) || `User ${id}`,
      presence: str(r.presence) || "offline",
      gameTitle: str(r.currentGameTitle),
      statusText: str(r.statusText),
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

/** userId -> display name, for callers (App) that only need names. */
export function friendNames(list: Friend[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const f of list) map[f.id] = f.username;
  return map;
}

/** userId -> presence token, the REST snapshot the gateway's live frames then
 *  refine. Merge as `{ ...friendPresence(list), ...roster.presence }` so a live
 *  frame always wins over the snapshot it updates. */
export function friendPresence(list: Friend[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const f of list) map[f.id] = f.presence;
  return map;
}

/** Whether a presence token counts as signed in. Anything not clearly offline
 *  or invisible reads as reachable — the same rule as roster.isOnline. */
export function presenceOnline(state: string | undefined): boolean {
  return !!state && state !== "offline" && state !== "invisible";
}
