// Hook for the friends activity feed: fetches the feed for the live session and
// exposes loading/error plus a manual refresh. Thin React/IPC glue over
// fetchActivity (activity.ts); needs a live session (host+token).

import { useCallback, useEffect, useState } from "react";
import { fetchActivity, type ActivityItem } from "./activity";
import type { SocialAuth } from "./useSocial";

export interface ActivityApi {
  items: ActivityItem[];
  loading: boolean;
  error: string;
  /** Re-fetch the feed. */
  refresh: () => void;
}

export function useActivity(auth: SocialAuth | null): ActivityApi {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!auth) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    fetchActivity(auth.host, auth.token)
      .then((rows) => setItems(rows))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [auth]);

  // Load once when a session becomes available (and clear on sign-out).
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}
