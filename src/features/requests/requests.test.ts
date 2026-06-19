import { describe, it, expect } from "vitest";
import {
  type GameRequest,
  type SearchHit,
  STATUSES,
  statusLabel,
  statusRank,
  sortBoard,
  filterByStatus,
  statusCounts,
  applyVote,
  applyStatus,
  releaseYear,
  requestSubtitle,
  alreadyRequested,
} from "./requests";

function req(p: Partial<GameRequest> & { id: number }): GameRequest {
  return {
    igdbId: 0,
    title: "",
    platform: "",
    coverUrl: "",
    releaseDate: 0,
    summary: "",
    requestedBy: "",
    note: "",
    status: "pending",
    votes: 0,
    createdAt: 0,
    votedByMe: false,
    ...p,
  };
}

describe("status helpers", () => {
  it("labels known statuses and passes through unknown", () => {
    expect(statusLabel("fulfilled")).toBe("Fulfilled");
    expect(statusLabel("weird")).toBe("weird");
  });

  it("ranks statuses in board order, unknown last", () => {
    expect(statusRank("pending")).toBe(0);
    expect(statusRank("declined")).toBe(3);
    expect(statusRank("nope")).toBe(STATUSES.length);
  });
});

describe("sortBoard", () => {
  it("orders by status, then votes desc, then createdAt asc", () => {
    const board = [
      req({ id: 1, status: "fulfilled", votes: 99, createdAt: 1 }),
      req({ id: 2, status: "pending", votes: 3, createdAt: 50 }),
      req({ id: 3, status: "pending", votes: 10, createdAt: 5 }),
      req({ id: 4, status: "pending", votes: 10, createdAt: 2 }),
    ];
    expect(sortBoard(board).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });

  it("does not mutate the input", () => {
    const board = [req({ id: 1, votes: 1 }), req({ id: 2, votes: 2 })];
    const snapshot = board.map((r) => r.id);
    sortBoard(board);
    expect(board.map((r) => r.id)).toEqual(snapshot);
  });
});

describe("filterByStatus + statusCounts", () => {
  const board = [
    req({ id: 1, status: "pending" }),
    req({ id: 2, status: "pending" }),
    req({ id: 3, status: "fulfilled" }),
  ];

  it("returns all when status is null", () => {
    expect(filterByStatus(board, null)).toHaveLength(3);
  });

  it("filters to a single status", () => {
    expect(filterByStatus(board, "pending").map((r) => r.id)).toEqual([1, 2]);
  });

  it("counts every status key, including zeros", () => {
    expect(statusCounts(board)).toEqual({ pending: 2, approved: 0, fulfilled: 1, declined: 0 });
  });
});

describe("applyVote", () => {
  it("bumps votes + flags votedByMe and re-sorts the row up", () => {
    const board = [
      req({ id: 1, votes: 5, createdAt: 1 }),
      req({ id: 2, votes: 5, createdAt: 2 }),
    ];
    const next = applyVote(board, 2);
    const r2 = next.find((r) => r.id === 2)!;
    expect(r2.votes).toBe(6);
    expect(r2.votedByMe).toBe(true);
    // 6 votes now outranks id 1's 5.
    expect(next[0].id).toBe(2);
  });

  it("is idempotent for a row already voted", () => {
    const board = [req({ id: 1, votes: 5, votedByMe: true })];
    const next = applyVote(board, 1);
    expect(next[0].votes).toBe(5);
    expect(next[0].votedByMe).toBe(true);
  });

  it("ignores an unknown id and does not mutate input", () => {
    const board = [req({ id: 1, votes: 5 })];
    const next = applyVote(board, 99);
    expect(next[0].votes).toBe(5);
    expect(board[0].votedByMe).toBe(false);
  });
});

describe("applyStatus", () => {
  it("changes a row's status and re-sorts", () => {
    const board = [
      req({ id: 1, status: "pending", votes: 1, createdAt: 1 }),
      req({ id: 2, status: "pending", votes: 1, createdAt: 2 }),
    ];
    const next = applyStatus(board, 1, "declined");
    expect(next.find((r) => r.id === 1)!.status).toBe("declined");
    // Declined sinks below the still-pending row.
    expect(next.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("display helpers", () => {
  it("formats release year, blank for unknown", () => {
    expect(releaseYear(760579200)).toBe("1994"); // 1994-06-06 UTC
    expect(releaseYear(0)).toBe("");
  });

  it("builds a subtitle, omitting blank parts", () => {
    expect(requestSubtitle(req({ id: 1, platform: "PC", releaseDate: 760579200, requestedBy: "bob" }))).toBe(
      "PC · 1994 · by bob",
    );
    expect(requestSubtitle(req({ id: 1 }))).toBe("");
  });
});

describe("alreadyRequested", () => {
  const board = [req({ id: 1, igdbId: 42 })];
  const hit = (igdbId: number): SearchHit => ({
    igdbId,
    name: "x",
    summary: "",
    platforms: "",
    coverUrl: "",
    releaseDate: 0,
  });

  it("matches an existing board row by IGDB id", () => {
    expect(alreadyRequested(hit(42), board)?.id).toBe(1);
  });

  it("returns undefined for a new game or free-text (igdbId 0)", () => {
    expect(alreadyRequested(hit(7), board)).toBeUndefined();
    expect(alreadyRequested(hit(0), board)).toBeUndefined();
  });
});
