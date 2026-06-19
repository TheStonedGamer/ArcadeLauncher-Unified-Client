// Game Requests board hook: owns the board state, loads it from the service, and
// exposes the optimistic actions (vote / rate / status / search / create). The
// pure board logic (sort/filter/optimistic edits) lives in requests.ts and is
// unit-tested; this is the thin React/transport glue, mirroring useDownloads.
//
// host+token come from useSession; with no session the hook stays idle and the
// view shows a "sign in" prompt. All mutations apply optimistically, then trust
// the server's authoritative reply (rating avg/count) or roll back on error.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBodyFromHit,
  createRequest,
  fetchBoard,
  rateRequest,
  searchRequests,
  setRequestStatus,
  voteRequest,
} from "./api";
import {
  applyRating,
  applyStatus,
  applyVote,
  boardPlatforms,
  filterByPlatform,
  filterByStatus,
  sortBoard,
  statusCounts,
  type GameRequest,
  type RequestStatus,
  type SearchHit,
} from "./requests";

export interface RequestsAuth {
  host: string;
  token: string;
}

export interface RequestsApi {
  /** The full board, sorted (status → votes → age). */
  board: GameRequest[];
  /** The board after the active status/platform filters, for rendering. */
  visible: GameRequest[];
  isAdmin: boolean;
  loading: boolean;
  /** Last error message (load or mutation), or null. */
  error: string | null;

  statusFilter: RequestStatus | null;
  setStatusFilter: (s: RequestStatus | null) => void;
  platformFilter: string | null;
  setPlatformFilter: (p: string | null) => void;
  /** Per-status counts + the distinct platforms, for the filter chips. */
  counts: Record<RequestStatus, number>;
  platforms: string[];

  reload: () => void;
  vote: (id: number) => void;
  rate: (id: number, stars: number) => void;
  setStatus: (id: number, status: RequestStatus) => void;

  /** Search IGDB for a release to request (returns hits; does not mutate state). */
  search: (query: string, platform?: string) => Promise<SearchHit[]>;
  /** Create a request from a chosen hit + note; reloads the board on success. */
  request: (hit: SearchHit, note: string) => Promise<void>;
}

export function useRequests(auth: RequestsAuth | null): RequestsApi {
  const [board, setBoard] = useState<GameRequest[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequestStatus | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);

  // Keep the latest board in a ref so optimistic mutations can roll back to the
  // pre-mutation snapshot on a server error without stale closures.
  const boardRef = useRef(board);
  boardRef.current = board;

  const reload = useCallback(() => {
    if (!auth) {
      setBoard([]);
      setIsAdmin(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchBoard(auth.host, auth.token)
      .then((b) => {
        setBoard(sortBoard(b.requests));
        setIsAdmin(b.isAdmin);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [auth?.host, auth?.token]);

  // Load (and clear on sign-out) whenever the session changes.
  useEffect(() => {
    reload();
  }, [reload]);

  const vote = useCallback(
    (id: number) => {
      if (!auth) return;
      const before = boardRef.current;
      setBoard((b) => applyVote(b, id)); // idempotent: no-op if already voted
      voteRequest(auth.host, auth.token, id).catch((e) => {
        setError(String(e));
        setBoard(before);
      });
    },
    [auth?.host, auth?.token],
  );

  const rate = useCallback(
    (id: number, stars: number) => {
      if (!auth) return;
      const before = boardRef.current;
      // Optimistic: bump myRating immediately; the count/avg get corrected by the
      // server's authoritative reply below.
      setBoard((b) => applyRating(b, id, stars, b.find((r) => r.id === id)?.ratingAvg ?? 0,
        b.find((r) => r.id === id)?.ratingCount ?? 0));
      rateRequest(auth.host, auth.token, id, stars)
        .then((res) => setBoard((b) => applyRating(b, id, res.myRating, res.ratingAvg, res.ratingCount)))
        .catch((e) => {
          setError(String(e));
          setBoard(before);
        });
    },
    [auth?.host, auth?.token],
  );

  const setStatus = useCallback(
    (id: number, status: RequestStatus) => {
      if (!auth) return;
      const before = boardRef.current;
      setBoard((b) => applyStatus(b, id, status));
      setRequestStatus(auth.host, auth.token, id, status).catch((e) => {
        setError(String(e));
        setBoard(before);
      });
    },
    [auth?.host, auth?.token],
  );

  const search = useCallback(
    (query: string, platform = ""): Promise<SearchHit[]> => {
      if (!auth || !query.trim()) return Promise.resolve([]);
      return searchRequests(auth.host, auth.token, query.trim(), platform);
    },
    [auth?.host, auth?.token],
  );

  const request = useCallback(
    async (hit: SearchHit, note: string): Promise<void> => {
      if (!auth) return;
      await createRequest(auth.host, auth.token, createBodyFromHit(hit, note));
      reload(); // pull the authoritative new/updated row (and its vote/dedupe state)
    },
    [auth?.host, auth?.token, reload],
  );

  const counts = useMemo(() => statusCounts(board), [board]);
  const platforms = useMemo(() => boardPlatforms(board), [board]);
  const visible = useMemo(
    () => filterByPlatform(filterByStatus(board, statusFilter), platformFilter),
    [board, statusFilter, platformFilter],
  );

  return {
    board,
    visible,
    isAdmin,
    loading,
    error,
    statusFilter,
    setStatusFilter,
    platformFilter,
    setPlatformFilter,
    counts,
    platforms,
    reload,
    vote,
    rate,
    setStatus,
    search,
    request,
  };
}
