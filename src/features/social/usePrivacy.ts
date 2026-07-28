// Hook for DM/friend privacy + persistent ignores (ROADMAP T9f). Loads the
// caller's policies and ignore set, and exposes optimistic mutations. Thin
// React/IPC glue over api.ts; the option model + coercion live in privacy.ts
// (unit-tested). Needs a live session — without one everything is inert.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPrivacy,
  updatePrivacy,
  fetchIgnores,
  setIgnore,
  fetchBlocks,
  setBlock,
  type BlockedUser,
} from "./api";
import { DEFAULT_PRIVACY, friendPolicyFromWire, dmPolicyFromWire, type FriendPolicy, type DmPolicy, type Privacy } from "./privacy";
import type { SocialAuth } from "./useSocial";

export interface PrivacyApi {
  privacy: Privacy;
  loading: boolean;
  error: string;
  setFriendPolicy: (p: FriendPolicy) => void;
  setDmPolicy: (p: DmPolicy) => void;
  /** Whether `userId` is currently ignored. */
  isIgnored: (userId: number) => boolean;
  /** Add/remove a persistent ignore on `userId`. */
  toggleIgnore: (userId: number) => void;
  /** Accounts the caller has blocked, newest first. */
  blocked: BlockedUser[];
  /** Whether `userId` is on the block list. */
  isBlocked: (userId: number) => boolean;
  /**
   * Block someone. Unlike ignore this is not reversible into the old state:
   * the server drops the friendship, so unblocking leaves them a stranger.
   * `username` is only for the list entry until the next refresh.
   */
  block: (userId: number, username: string) => void;
  unblock: (userId: number) => void;
  /** Settings overlay open state. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function usePrivacy(auth: SocialAuth | null): PrivacyApi {
  const [privacy, setPrivacy] = useState<Privacy>(DEFAULT_PRIVACY);
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!auth) {
      setPrivacy(DEFAULT_PRIVACY);
      setIgnored(new Set());
      setBlocked([]);
      return;
    }
    let live = true;
    setLoading(true);
    Promise.all([
      fetchPrivacy(auth.host, auth.token),
      fetchIgnores(auth.host, auth.token),
      // An older server has no /blocks route; an empty list is the right
      // reading of "this server cannot tell us", not an error worth showing.
      fetchBlocks(auth.host, auth.token).catch(() => [] as BlockedUser[]),
    ])
      .then(([p, ids, blocks]) => {
        if (!live) return;
        setPrivacy({ friendPolicy: friendPolicyFromWire(p.friendPolicy), dmPolicy: dmPolicyFromWire(p.dmPolicy) });
        setIgnored(new Set(ids));
        setBlocked(blocks);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [auth]);

  const setFriendPolicy = useCallback(
    (p: FriendPolicy) => {
      setPrivacy((cur) => ({ ...cur, friendPolicy: p }));
      if (auth) updatePrivacy(auth.host, auth.token, { friendPolicy: p }).catch((e) => setError(String(e)));
    },
    [auth],
  );

  const setDmPolicy = useCallback(
    (p: DmPolicy) => {
      setPrivacy((cur) => ({ ...cur, dmPolicy: p }));
      if (auth) updatePrivacy(auth.host, auth.token, { dmPolicy: p }).catch((e) => setError(String(e)));
    },
    [auth],
  );

  const isIgnored = useCallback((userId: number) => ignored.has(userId), [ignored]);

  const toggleIgnore = useCallback(
    (userId: number) => {
      if (!auth || !userId) return;
      const next = !ignored.has(userId);
      setIgnored((s) => {
        const copy = new Set(s);
        if (next) copy.add(userId);
        else copy.delete(userId);
        return copy;
      });
      setIgnore(auth.host, auth.token, userId, next).catch((e) => setError(String(e)));
    },
    [auth, ignored],
  );

  const isBlocked = useCallback(
    (userId: number) => blocked.some((b) => b.userId === userId),
    [blocked],
  );

  const block = useCallback(
    (userId: number, username: string) => {
      if (!auth || !userId || blocked.some((b) => b.userId === userId)) return;
      // Optimistic, with `since` stamped locally so the row sorts correctly
      // before the next refresh replaces it with the server's value.
      setBlocked((cur) => [{ userId, username, since: Math.floor(Date.now() / 1000) }, ...cur]);
      setBlock(auth.host, auth.token, userId, true).catch((e) => {
        setError(String(e));
        setBlocked((cur) => cur.filter((b) => b.userId !== userId));
      });
    },
    [auth, blocked],
  );

  const unblock = useCallback(
    (userId: number) => {
      if (!auth || !userId) return;
      const previous = blocked;
      setBlocked((cur) => cur.filter((b) => b.userId !== userId));
      setBlock(auth.host, auth.token, userId, false).catch((e) => {
        setError(String(e));
        setBlocked(previous);
      });
    },
    [auth, blocked],
  );

  return useMemo(
    () => ({
      privacy,
      loading,
      error,
      setFriendPolicy,
      setDmPolicy,
      isIgnored,
      toggleIgnore,
      blocked,
      isBlocked,
      block,
      unblock,
      open,
      setOpen,
    }),
    [
      privacy,
      loading,
      error,
      setFriendPolicy,
      setDmPolicy,
      isIgnored,
      toggleIgnore,
      blocked,
      isBlocked,
      block,
      unblock,
      open,
    ],
  );
}
