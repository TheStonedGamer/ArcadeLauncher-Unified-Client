import { describe, expect, it } from "vitest";
import {
  applyVote,
  isOpen,
  parseBoard,
  parseRequest,
  sortRequests,
  statusLabel,
  voteLabel,
  type MobileRequest,
} from "./requests";

const req = (over: Partial<MobileRequest> & { id: number }): MobileRequest => ({
  title: "",
  platform: "",
  coverUrl: "",
  requestedBy: "",
  note: "",
  status: "",
  votes: 0,
  createdAt: 0,
  votedByMe: false,
  ...over,
});

describe("parseRequest", () => {
  it("keeps the fields the companion renders", () => {
    expect(parseRequest({ id: 7, title: "Zelda", votes: 3, votedByMe: true, status: "OPEN" })).toMatchObject({
      id: 7,
      title: "Zelda",
      votes: 3,
      votedByMe: true,
      status: "open",
    });
  });

  it("defaults missing fields instead of failing the row", () => {
    expect(parseRequest({ id: 1 })).toMatchObject({ title: "", votes: 0, votedByMe: false });
  });

  it("rejects rows with no usable id", () => {
    for (const bad of [null, 7, {}, { id: 0 }, { id: -1 }, { id: "7" }]) {
      expect(parseRequest(bad)).toBeNull();
    }
  });
});

describe("parseBoard", () => {
  it("reads the envelope including the admin flag", () => {
    const board = parseBoard({ requests: [{ id: 1 }, { id: 2 }], isAdmin: true });
    expect(board.requests.map((r) => r.id)).toEqual([1, 2]);
    expect(board.isAdmin).toBe(true);
  });

  it("accepts a bare array, with isAdmin false", () => {
    expect(parseBoard([{ id: 1 }])).toEqual({ requests: [req({ id: 1 })], isAdmin: false });
  });

  it("returns an empty board for anything unusable", () => {
    for (const bad of [null, "", 7, {}, { requests: "nope" }]) {
      expect(parseBoard(bad)).toEqual({ requests: [], isAdmin: false });
    }
  });
});

describe("statusLabel / isOpen", () => {
  it("maps the server's vocabulary onto plain words", () => {
    expect(statusLabel("open")).toBe("Open");
    expect(statusLabel("PENDING")).toBe("Open");
    expect(statusLabel("fulfilled")).toBe("Added");
    expect(statusLabel("rejected")).toBe("Declined");
  });

  it("passes an unknown status through capitalised", () => {
    expect(statusLabel("queued")).toBe("Queued");
  });

  it("treats a blank status as open", () => {
    expect(statusLabel("")).toBe("Open");
    expect(isOpen(req({ id: 1, status: "" }))).toBe(true);
  });

  it("closes only resolved requests", () => {
    expect(isOpen(req({ id: 1, status: "installing" }))).toBe(true);
    expect(isOpen(req({ id: 1, status: "fulfilled" }))).toBe(false);
    expect(isOpen(req({ id: 1, status: "declined" }))).toBe(false);
  });
});

describe("sortRequests", () => {
  it("puts open requests above resolved ones", () => {
    const rows = [req({ id: 1, status: "added", votes: 99 }), req({ id: 2, status: "open", votes: 1 })];
    expect(sortRequests(rows).map((r) => r.id)).toEqual([2, 1]);
  });

  it("orders by votes then recency within a group", () => {
    const rows = [
      req({ id: 1, votes: 2, createdAt: 10 }),
      req({ id: 2, votes: 5, createdAt: 1 }),
      req({ id: 3, votes: 2, createdAt: 50 }),
    ];
    expect(sortRequests(rows).map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the input", () => {
    const rows = [req({ id: 1, votes: 1 }), req({ id: 2, votes: 9 })];
    sortRequests(rows);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("applyVote / voteLabel", () => {
  it("adds and removes a vote", () => {
    const base = req({ id: 1, votes: 3 });
    const up = applyVote(base, true);
    expect(up).toMatchObject({ votes: 4, votedByMe: true });
    expect(applyVote(up, false)).toMatchObject({ votes: 3, votedByMe: false });
  });

  it("is idempotent — a repeated vote does not inflate the count", () => {
    const up = applyVote(req({ id: 1, votes: 3 }), true);
    expect(applyVote(up, true)).toBe(up);
  });

  it("never drives the count negative", () => {
    expect(applyVote(req({ id: 1, votes: 0, votedByMe: true }), false).votes).toBe(0);
  });

  it("labels the button by vote state", () => {
    expect(voteLabel(req({ id: 1, votes: 2 }))).toBe("△ 2");
    expect(voteLabel(req({ id: 1, votes: 3, votedByMe: true }))).toBe("▲ 3");
  });
});
