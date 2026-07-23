// Pure request-board core for the mobile companion (ROADMAP T12l). Mirrors the
// desktop client's view of `GET /api/requests` (src-tauri/src/requests/api.rs)
// but only the fields a phone shows: title, who asked, status, votes.
//
// The companion can browse the board and upvote; it deliberately does *not*
// carry the admin triage controls or the IGDB-backed create flow — those stay
// on the desktop where the full metadata picker lives.

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
