// Typed IPC wrapper for the friends activity feed (server: GET
// /api/social/activity, ROADMAP 3.7). The Rust command (social/commands.rs:
// social_activity_fetch) makes the bearer-authed REST call so the token stays
// out of the renderer; this is the thin frontend seam.

import { call } from "../../lib/ipc";

/** Event type for an activity entry. Open-ended: the server may add kinds, so
 *  the UI renders unknown kinds generically. */
export type ActivityKind = "played" | "review" | "screenshot" | (string & {});

/** One entry in the feed. `payload` is kind-specific raw JSON (e.g. for
 *  "played": `{ secs }`; "review": `{ rating, body }`). `gameId` is set for
 *  game-scoped events. `createdAt` is unix seconds. */
export interface ActivityItem {
  id: number;
  userId: number;
  username: string;
  kind: ActivityKind;
  gameId: string | null;
  payload: unknown;
  createdAt: number;
}

/** Fetch the caller's friends activity feed (self + accepted friends, newest
 *  first, capped at 100 by the server). */
export function fetchActivity(host: string, token: string): Promise<ActivityItem[]> {
  return call<ActivityItem[]>("social_activity_fetch", { host, token });
}
