// Hook for DM/friend privacy + persistent ignores (ROADMAP T9f). Loads the
// caller's policies and ignore set, and exposes optimistic mutations. Thin
// React/IPC glue over api.ts; the option model + coercion live in privacy.ts
// (unit-tested). Needs a live session — without one everything is inert.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPrivacy, updatePrivacy, fetchIgnores, setIgnore } from "./api";
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
  /** Settings overlay open state. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function usePrivacy(auth: SocialAuth | null): PrivacyApi {
  const [privacy, setPrivacy] = useState<Privacy>(DEFAULT_PRIVACY);
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!auth) {
      setPrivacy(DEFAULT_PRIVACY);
      setIgnored(new Set());
      return;
    }
    let live = true;
    setLoading(true);
    Promise.all([fetchPrivacy(auth.host, auth.token), fetchIgnores(auth.host, auth.token)])
      .then(([p, ids]) => {
        if (!live) return;
        setPrivacy({ friendPolicy: friendPolicyFromWire(p.friendPolicy), dmPolicy: dmPolicyFromWire(p.dmPolicy) });
        setIgnored(new Set(ids));
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

  return useMemo(
    () => ({ privacy, loading, error, setFriendPolicy, setDmPolicy, isIgnored, toggleIgnore, open, setOpen }),
    [privacy, loading, error, setFriendPolicy, setDmPolicy, isIgnored, toggleIgnore, open],
  );
}
