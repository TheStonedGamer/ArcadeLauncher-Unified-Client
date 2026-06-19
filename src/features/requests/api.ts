// Typed IPC wrappers for the Game Requests board commands
// (src-tauri/src/requests/commands.rs). The Rust side talks to the standalone
// ArcadeLauncher-Requests service over `https://{host}/requests`, authed with the
// launcher's per-user bearer token. The pure board logic (sort/filter/optimistic
// edits) lives in requests.ts; these wrappers are the thin transport seam.

import { call } from "../../lib/ipc";
import type { GameRequest, RequestStatus, SearchHit } from "./requests";

/** `GET /api/requests` — the board plus whether the caller is an admin. */
export interface Board {
  requests: GameRequest[];
  isAdmin: boolean;
}

/** `POST /api/requests` result — the board row the request now lives on. */
export interface CreateResult {
  ok: boolean;
  id: number;
}

/** `POST /api/requests/:id/vote` result — `voted` is the fresh-upvote flag. */
export interface VoteResult {
  ok: boolean;
  id: number;
  voted: boolean;
}

/** `POST /api/requests/:id/rating` result — fresh average/count after the upsert. */
export interface RateResult {
  id: number;
  myRating: number;
  ratingAvg: number;
  ratingCount: number;
}

/** Outbound create body. Field names are snake_case to match the service's
 *  `CreateRequest` (the Rust command forwards them verbatim). */
export interface CreateBody {
  igdb_id: number;
  title: string;
  platform: string;
  cover_url: string;
  release_date: number;
  summary: string;
  note: string;
}

/** Build a create body from a chosen search hit plus the user's note. Mirrors the
 *  Rust `CreateBody::from_hit` (trims + caps the note at 500 chars). */
export function createBodyFromHit(hit: SearchHit, note: string): CreateBody {
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

export function fetchBoard(host: string, token: string): Promise<Board> {
  return call("requests_board", { host, token });
}

export function searchRequests(
  host: string,
  token: string,
  query: string,
  platform = "",
): Promise<SearchHit[]> {
  return call("requests_search", { host, token, query, platform });
}

export function createRequest(host: string, token: string, body: CreateBody): Promise<CreateResult> {
  return call("requests_create", { host, token, body });
}

export function voteRequest(host: string, token: string, id: number): Promise<VoteResult> {
  return call("requests_vote", { host, token, id });
}

export function rateRequest(host: string, token: string, id: number, stars: number): Promise<RateResult> {
  return call("requests_rate", { host, token, id, stars });
}

export function setRequestStatus(
  host: string,
  token: string,
  id: number,
  status: RequestStatus,
): Promise<boolean> {
  return call("requests_status", { host, token, id, status });
}
