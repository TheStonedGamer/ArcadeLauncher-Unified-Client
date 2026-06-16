// Hook for friend organization (ROADMAP T9e): loads the caller's friend-meta
// rows (notes/groups/pinned) and exposes optimistic edits that persist via the
// IPC layer. The pure parsing/sectioning logic lives in friendMeta.ts and is
// unit-tested; this is the thin React/IPC glue. Needs a live session — without
// one, the map stays empty and edits no-op.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFriendMeta, setFriendMeta } from "./api";
import {
  normalizeMeta,
  defaultMeta,
  serializeGroups,
  addGroup,
  removeGroup,
  type FriendMeta,
} from "./friendMeta";
import type { SocialAuth } from "./useSocial";

export interface FriendMetaApi {
  /** Look up one friend's meta (default empty when no row yet). */
  metaOf: (userId: number) => FriendMeta;
  /** Currently selected group filter ("" = show all sections). */
  groupFilter: string;
  setGroupFilter: (group: string) => void;
  /** Set (or clear) a friend's private note. */
  setNote: (userId: number, note: string) => void;
  /** Toggle a friend's pinned flag. */
  togglePin: (userId: number) => void;
  /** Add a group/tag to a friend. */
  addToGroup: (userId: number, group: string) => void;
  /** Remove a group/tag from a friend. */
  removeFromGroup: (userId: number, group: string) => void;
  error: string;
}

export function useFriendMeta(auth: SocialAuth | null): FriendMetaApi {
  const [metas, setMetas] = useState<Record<number, FriendMeta>>({});
  const [groupFilter, setGroupFilter] = useState("");
  const [error, setError] = useState("");

  // Load all rows whenever the session changes; clear when signed out.
  useEffect(() => {
    if (!auth) {
      setMetas({});
      return;
    }
    let live = true;
    fetchFriendMeta(auth.host, auth.token)
      .then((rows) => {
        if (!live) return;
        const next: Record<number, FriendMeta> = {};
        for (const raw of rows) next[raw.userId] = normalizeMeta(raw);
        setMetas(next);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [auth]);

  const metaOf = useCallback(
    (userId: number) => metas[userId] ?? defaultMeta(userId),
    [metas],
  );

  // Optimistically apply `next` locally, then persist the changed fields. On a
  // persist failure we surface the error but keep the optimistic state — the
  // next load reconciles with the server.
  const persist = useCallback(
    (next: FriendMeta, fields: { note?: string; groups?: string; pinned?: boolean }) => {
      setMetas((m) => ({ ...m, [next.userId]: next }));
      if (!auth) return;
      setFriendMeta(auth.host, auth.token, next.userId, fields).catch((e) => setError(String(e)));
    },
    [auth],
  );

  const setNote = useCallback(
    (userId: number, note: string) => {
      const cur = metas[userId] ?? defaultMeta(userId);
      persist({ ...cur, note }, { note });
    },
    [metas, persist],
  );

  const togglePin = useCallback(
    (userId: number) => {
      const cur = metas[userId] ?? defaultMeta(userId);
      const pinned = !cur.pinned;
      persist({ ...cur, pinned }, { pinned });
    },
    [metas, persist],
  );

  const addToGroup = useCallback(
    (userId: number, group: string) => {
      const cur = metas[userId] ?? defaultMeta(userId);
      const groups = addGroup(cur.groups, group);
      persist({ ...cur, groups }, { groups: serializeGroups(groups) });
    },
    [metas, persist],
  );

  const removeFromGroup = useCallback(
    (userId: number, group: string) => {
      const cur = metas[userId] ?? defaultMeta(userId);
      const groups = removeGroup(cur.groups, group);
      persist({ ...cur, groups }, { groups: serializeGroups(groups) });
    },
    [metas, persist],
  );

  return useMemo(
    () => ({
      metaOf,
      groupFilter,
      setGroupFilter,
      setNote,
      togglePin,
      addToGroup,
      removeFromGroup,
      error,
    }),
    [metaOf, groupFilter, setNote, togglePin, addToGroup, removeFromGroup, error],
  );
}
