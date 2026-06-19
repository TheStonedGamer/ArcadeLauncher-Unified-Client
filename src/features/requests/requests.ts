// Pure display + reducer helpers for the in-client Game Requests board (T12h).
// The board itself is the standalone ArcadeLauncher-Requests service; this is the
// deterministic, IO-free core (sort/filter/optimistic-vote/labels) unit-tested in
// requests.test.ts. Transport (the Tauri commands) and UI sit on top.

/** A row on the request board. Mirrors the Rust `GameRequest` (camelCase wire). */
export interface GameRequest {
  id: number;
  igdbId: number;
  title: string;
  platform: string;
  coverUrl: string;
  /** First release date, Unix seconds (0 when unknown). */
  releaseDate: number;
  summary: string;
  requestedBy: string;
  note: string;
  status: RequestStatus;
  votes: number;
  /** Unix seconds the request was created. */
  createdAt: number;
  votedByMe: boolean;
}

/** One IGDB search hit when composing a new request. Mirrors Rust `SearchHit`. */
export interface SearchHit {
  igdbId: number;
  name: string;
  summary: string;
  platforms: string;
  coverUrl: string;
  releaseDate: number;
}

export type RequestStatus = "pending" | "approved" | "fulfilled" | "declined";

/** The four statuses in the service's display/sort order. */
export const STATUSES: RequestStatus[] = ["pending", "approved", "fulfilled", "declined"];

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  fulfilled: "Fulfilled",
  declined: "Declined",
};

/** Human label for a status chip. Falls back to the raw value if unknown. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as RequestStatus] ?? status;
}

/** Sort rank for a status (lower = higher on the board), matching the server's
 *  `FIELD(status,'pending','approved','fulfilled','declined')` ordering. Unknown
 *  statuses sort after the known ones. */
export function statusRank(status: string): number {
  const i = STATUSES.indexOf(status as RequestStatus);
  return i < 0 ? STATUSES.length : i;
}

/** Order the board exactly as the server does: by status, then votes desc, then
 *  oldest-first. Pure + stable so optimistic local edits re-sort identically to a
 *  fresh server fetch. Does not mutate the input. */
export function sortBoard(requests: GameRequest[]): GameRequest[] {
  return [...requests].sort((a, b) => {
    const s = statusRank(a.status) - statusRank(b.status);
    if (s !== 0) return s;
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.createdAt - b.createdAt;
  });
}

/** Show only rows with the given status, or all rows when `status` is null. */
export function filterByStatus(requests: GameRequest[], status: RequestStatus | null): GameRequest[] {
  if (!status) return requests;
  return requests.filter((r) => r.status === status);
}

/** Per-status counts for the filter chips (always includes every status key). */
export function statusCounts(requests: GameRequest[]): Record<RequestStatus, number> {
  const counts: Record<RequestStatus, number> = {
    pending: 0,
    approved: 0,
    fulfilled: 0,
    declined: 0,
  };
  for (const r of requests) {
    if (r.status in counts) counts[r.status as RequestStatus] += 1;
  }
  return counts;
}

/** Optimistically apply an upvote to request `id`. The service only ever counts a
 *  user's first vote (votes can't be retracted), so this is idempotent: a row the
 *  user already voted on is returned unchanged. Re-sorts the board so the bumped
 *  row floats up immediately. Does not mutate the input. */
export function applyVote(requests: GameRequest[], id: number): GameRequest[] {
  const next = requests.map((r) =>
    r.id === id && !r.votedByMe ? { ...r, votes: r.votes + 1, votedByMe: true } : r,
  );
  return sortBoard(next);
}

/** Optimistically set a row's status (admin triage), then re-sort. */
export function applyStatus(requests: GameRequest[], id: number, status: RequestStatus): GameRequest[] {
  const next = requests.map((r) => (r.id === id ? { ...r, status } : r));
  return sortBoard(next);
}

/** Release year for display, or "" when the date is unknown (0). */
export function releaseYear(releaseDate: number): string {
  if (!releaseDate) return "";
  return String(new Date(releaseDate * 1000).getUTCFullYear());
}

/** A one-line subtitle for a board row, e.g. "PC · 2016 · by bob". Omits the
 *  parts that are blank. */
export function requestSubtitle(r: GameRequest): string {
  const parts: string[] = [];
  if (r.platform) parts.push(r.platform);
  const year = releaseYear(r.releaseDate);
  if (year) parts.push(year);
  if (r.requestedBy) parts.push(`by ${r.requestedBy}`);
  return parts.join(" · ");
}

/** True when this search hit is already on the board (same IGDB id), so the UI
 *  can show "Upvote" instead of "Request". igdbId 0 (free-text) never matches. */
export function alreadyRequested(hit: SearchHit, board: GameRequest[]): GameRequest | undefined {
  if (!hit.igdbId) return undefined;
  return board.find((r) => r.igdbId === hit.igdbId);
}
