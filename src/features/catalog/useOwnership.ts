// Ownership state: the set of game ids in the signed-in account's library.
// Shared by the Library tab (owned-only filter) and the Store tab (per-card
// owned annotation + Add/Remove). Add/remove are optimistic — the Set updates
// immediately and rolls back if the server call fails — so the grid feels
// instant. Admins own everything implicitly on the server, but here we still
// track the explicit library so the UI shows a real toggle state.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOwnedIds, addToLibrary, removeFromLibrary } from "./api";
import type { Session } from "../session/types";

export interface Ownership {
  /** Owned game ids. Empty while loading or signed out. */
  ownedIds: Set<string>;
  loading: boolean;
  /** Non-null when the last library call failed. */
  error: string | null;
  /** True once a real fetch has resolved — lets views distinguish "empty
   *  library" from "not loaded yet" (e.g. don't show an empty Library on boot). */
  loaded: boolean;
  isOwned: (id: string) => boolean;
  add: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Re-pull from the server (e.g. after the website added something). */
  refresh: () => Promise<void>;
}

export function useOwnership(session: Session | null): Ownership {
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setOwnedIds(new Set());
      setLoaded(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = await fetchOwnedIds(session.host, session.token);
      setOwnedIds(new Set(ids));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  // Pull once per session token (not on every render).
  useEffect(() => {
    if (!session) {
      setOwnedIds(new Set());
      setLoaded(false);
      fetchedFor.current = null;
      return;
    }
    if (fetchedFor.current === session.token) return;
    fetchedFor.current = session.token;
    void refresh();
  }, [session, refresh]);

  const isOwned = useCallback((id: string) => ownedIds.has(id), [ownedIds]);

  const add = useCallback(
    async (id: string) => {
      if (!session) throw new Error("sign in to add games to your library");
      setOwnedIds((prev) => new Set(prev).add(id));
      try {
        await addToLibrary(session.host, session.token, id);
      } catch (e) {
        setOwnedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        throw e;
      }
    },
    [session],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!session) throw new Error("sign in to manage your library");
      let existed = false;
      setOwnedIds((prev) => {
        existed = prev.has(id);
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        await removeFromLibrary(session.host, session.token, id);
      } catch (e) {
        if (existed) setOwnedIds((prev) => new Set(prev).add(id));
        throw e;
      }
    },
    [session],
  );

  return { ownedIds, loading, error, loaded, isOwned, add, remove, refresh };
}
