// The phone's half of blocking. Loads the account's block list once per session
// and exposes optimistic block/unblock; the rules themselves are the server's
// (blocking also removes the friendship and ends a live call), so this is only
// state plus the two calls.
//
// An older server has no /api/social/blocks route. That reads as an empty list
// rather than an error: "this server cannot tell us" is not something worth
// putting in front of the user, and blocking itself still works.

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchBlocks, setBlock, type BlockedUser } from "./api";
import type { MobileSession } from "./core/session";

export interface BlocksApi {
  /** Accounts this session has blocked, newest first. */
  blocked: BlockedUser[];
  isBlocked: (userId: number) => boolean;
  /** `username` is only used for the row until the next refresh. */
  block: (userId: number, username: string) => void;
  unblock: (userId: number) => void;
  /** Last failure, for display; cleared by the next successful change. */
  error: string;
}

export function useBlocks(session: MobileSession | null): BlocksApi {
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      setBlocked([]);
      return;
    }
    let live = true;
    void fetchBlocks(session)
      .then((rows) => live && setBlocked(rows))
      .catch(() => live && setBlocked([]));
    return () => {
      live = false;
    };
  }, [session]);

  const isBlocked = useCallback(
    (userId: number) => blocked.some((b) => b.userId === userId),
    [blocked],
  );

  const block = useCallback(
    (userId: number, username: string) => {
      if (!session || !userId || blocked.some((b) => b.userId === userId)) return;
      const previous = blocked;
      setError("");
      setBlocked((cur) => [
        { userId, username, since: Math.floor(Date.now() / 1000) },
        ...cur,
      ]);
      setBlock(session, userId, true).catch((e) => {
        setError(String(e));
        setBlocked(previous);
      });
    },
    [session, blocked],
  );

  const unblock = useCallback(
    (userId: number) => {
      if (!session || !userId) return;
      const previous = blocked;
      setError("");
      setBlocked((cur) => cur.filter((b) => b.userId !== userId));
      setBlock(session, userId, false).catch((e) => {
        setError(String(e));
        setBlocked(previous);
      });
    },
    [session, blocked],
  );

  return useMemo(
    () => ({ blocked, isBlocked, block, unblock, error }),
    [blocked, isBlocked, block, unblock, error],
  );
}
