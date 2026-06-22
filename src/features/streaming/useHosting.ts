// React glue for host mode: let *this* PC be streamed. Drives the engine's
// `host.*` IPC (status / enable / publish library). Pure mapping (which games
// are hostable, the host-app shape, the status summary) lives in streaming.ts;
// this hook only orchestrates the IPC.
//
// The engine's host handlers are stubs until that milestone lands, so a failed
// call is expected — it's surfaced as `error` and the section degrades to a
// clear "hosting unavailable" message rather than throwing.

import { useCallback, useEffect, useState } from "react";
import { hostEnable, hostStatus, hostSyncApps, type HostGame, type HostStatus, type SyncResult } from "./api";

export interface Hosting {
  status: HostStatus | null;
  /** The last engine error (e.g. host mode unavailable), or null when healthy. */
  error: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Publish the given games to the host; resolves to the diff, or null on error. */
  sync: (games: HostGame[]) => Promise<SyncResult | null>;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useHosting(): Hosting {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await hostStatus());
      setError(null);
    } catch (e) {
      setStatus(null);
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        await hostEnable(on);
        await refresh();
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const sync = useCallback(
    async (games: HostGame[]): Promise<SyncResult | null> => {
      setBusy(true);
      try {
        const res = await hostSyncApps(games);
        await refresh();
        return res;
      } catch (e) {
        setError(message(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { status, error, busy, refresh, setEnabled, sync };
}
