// Pure request-board core for the mobile companion (ROADMAP T12l). Mirrors the
// desktop client's view of `GET /api/requests` (src-tauri/src/requests/api.rs)
// but only the fields a phone shows: title, who asked, status, votes.
//
// The companion can browse the board, upvote, and file new requests off the
// server's IGDB search. It deliberately does *not* carry the admin triage
// controls — approving and status changes stay on the desktop.

export interface MobileRequest {
  id: number;
  title: string;
  platform: string;
  coverUrl: string;
  requestedBy: string;
  note: string;
  status: string;
  votes: number;
  createdAt: number;
  votedByMe: boolean;
}

export interface MobileBoard {
  requests: MobileRequest[];
  isAdmin: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** Narrow one board row. A row with no id can't be voted on, so it's dropped. */
export function parseRequest(value: unknown): MobileRequest | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = int(v.id);
  if (id <= 0) return null;
  return {
    id,
    title: str(v.title),
    platform: str(v.platform),
    coverUrl: str(v.coverUrl),
    requestedBy: str(v.requestedBy),
    note: str(v.note),
    status: str(v.status).toLowerCase(),
    votes: int(v.votes),
    createdAt: int(v.createdAt),
    votedByMe: v.votedByMe === true,
  };
}

/** Parse the `{ requests, isAdmin }` board body, tolerating a bare array. */
export function parseBoard(body: unknown): MobileBoard {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { requests?: unknown }).requests)
      ? (body as { requests: unknown[] }).requests
      : [];
  const isAdmin = !!body && typeof body === "object" && (body as { isAdmin?: unknown }).isAdmin === true;
  return { requests: rows.map(parseRequest).filter((r): r is MobileRequest => r !== null), isAdmin };
}

/** Human label for a board status. Unknown values pass through capitalised so a
 *  new server-side status still reads sensibly instead of vanishing. */
export function statusLabel(status: string): string {
  const s = status.trim().toLowerCase();
  const known: Record<string, string> = {
    open: "Open",
    pending: "Open",
    approved: "Approved",
    installing: "Installing",
    fulfilled: "Added",
    added: "Added",
    declined: "Declined",
    rejected: "Declined",
  };
  if (known[s]) return known[s];
  if (!s) return "Open";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A request is still live if it hasn't been resolved either way. */
export function isOpen(request: MobileRequest): boolean {
  const label = statusLabel(request.status);
  return label !== "Added" && label !== "Declined";
}

/** Board order: open requests first, then most-voted, then newest. */
export function sortRequests(requests: MobileRequest[]): MobileRequest[] {
  return [...requests].sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return b.createdAt - a.createdAt;
  });
}

/** Optimistic local vote so the row reacts before the round-trip lands. The
 *  server is the authority — the caller replaces this on the next refresh. */
export function applyVote(request: MobileRequest, voted: boolean): MobileRequest {
  if (request.votedByMe === voted) return request;
  return { ...request, votedByMe: voted, votes: Math.max(0, request.votes + (voted ? 1 : -1)) };
}

/** Vote-button caption. */
export function voteLabel(request: MobileRequest): string {
  return `${request.votedByMe ? "▲" : "△"} ${request.votes}`;
}

// ---- Search and create ----------------------------------------------------
//
// `GET /requests/api/search` is IGDB-backed and serializes `SearchResult`
// without a rename, so the wire fields are snake_case — unlike the board rows
// above, which are camelCase. Keep the two parsers separate rather than
// tolerating both shapes in one.

export interface RequestHit {
  igdbId: number;
  name: string;
  summary: string;
  platforms: string;
  coverUrl: string;
  releaseDate: number;
}

/** Body of `POST /requests/api/requests`, snake_case to match `CreateRequest`. */
export interface CreateRequestBody {
  igdb_id: number;
  title: string;
  platform: string;
  cover_url: string;
  release_date: number;
  summary: string;
  note: string;
}

/** The server ignores a query shorter than this and returns no results, so the
 *  client shouldn't spend a round-trip on one either. */
export const MIN_SEARCH_LEN = 2;

/** Is this query long enough for the server to act on? */
export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LEN;
}

/** Narrow one search hit. A hit with no igdb id can't be deduped server-side,
 *  and one with no name can't be created (the server 400s on an empty title). */
export function parseHit(value: unknown): RequestHit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const igdbId = int(v.igdb_id);
  const name = str(v.name).trim();
  if (igdbId <= 0 || !name) return null;
  return {
    igdbId,
    name,
    summary: str(v.summary),
    platforms: str(v.platforms),
    coverUrl: str(v.cover_url),
    releaseDate: int(v.release_date),
  };
}

/** Parse the `{ results }` search body, tolerating a bare array. */
export function parseHits(body: unknown): RequestHit[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results)
      ? (body as { results: unknown[] }).results
      : [];
  return rows.map(parseHit).filter((h): h is RequestHit => h !== null);
}

/** Release year for the subtitle. `release_date` is a unix timestamp; 0 means
 *  IGDB had no date, which reads better as nothing than as "1970". */
export function hitYear(hit: RequestHit): string {
  if (hit.releaseDate <= 0) return "";
  return String(new Date(hit.releaseDate * 1000).getUTCFullYear());
}

/** Subtitle line under a search result: year and platforms, whichever exist. */
export function hitSubtitle(hit: RequestHit): string {
  return [hitYear(hit), hit.platforms].filter(Boolean).join(" · ");
}

/** Build the create body. `note` is clamped to the 500 chars the server keeps,
 *  so what the user sees submitted is what gets stored. */
export function createBodyFromHit(hit: RequestHit, note: string): CreateRequestBody {
  return {
    igdb_id: hit.igdbId,
    title: hit.name,
    platform: hit.platforms,
    cover_url: hit.coverUrl,
    release_date: hit.releaseDate,
    summary: hit.summary,
    note: note.trim().slice(0, 500),
  };
}

/** What actually happened when a create came back.
 *
 *  A request for an igdb id already on the board is turned into an upvote
 *  server-side rather than a duplicate row, and that path answers with a
 *  `voted` flag the plain-create path doesn't have. So: no `voted` key means a
 *  new row; `voted: true` means it upvoted the existing one; `voted: false`
 *  means this account had already voted for it. */
export type CreateOutcome = "created" | "upvoted" | "already";

export function createOutcome(body: unknown): CreateOutcome {
  if (!body || typeof body !== "object" || !("voted" in body)) return "created";
  return (body as { voted?: unknown }).voted === true ? "upvoted" : "already";
}

/** Confirmation line for a create outcome. */
export function outcomeMessage(outcome: CreateOutcome, title: string): string {
  const name = title.trim() || "That game";
  if (outcome === "created") return `Requested ${name}.`;
  if (outcome === "upvoted") return `${name} was already requested — upvoted it.`;
  return `${name} is already on the board and you've already voted for it.`;
}
