// React glue for host mode: let *this* PC be streamed. Drives the engine's
// `host.*` IPC (status / enable / publish library). Pure mapping (which games
// are hostable, the host-app shape, the status summary) lives in streaming.ts;
// this hook only orchestrates the IPC.
//
// A failed call (engine missing/unreachable) is surfaced as `error` and the
// section degrades to a clear "hosting unavailable" message rather than throwing.

import { useCallback, useEffect, useState } from "react";
import {
  hostEnable,
  hostInstall,
  hostStatus,
  hostSyncApps,
  type HostGame,
  type HostStatus,
  type SyncResult,
} from "./api";
import { publishHostServerCert, seedAccountClientCerts } from "./certAuth";
import type { Session } from "../session/types";

export interface Hosting {
  status: HostStatus | null;
  /** The last engine error (e.g. host mode unavailable), or null when healthy. */
  error: string | null;
  busy: boolean;
  /** True while the Sunshine host sidecar is being downloaded on first enable. */
  installing: boolean;
  refresh: () => Promise<void>;
  /** Turn hosting on/off. When `session` is given and turning on, this also runs the cert
   *  pre-authorization dance (seed account client certs before enable, publish this PC's server
   *  cert after) so account devices stream with no PIN. */
  setEnabled: (on: boolean, session?: Session | null) => Promise<void>;
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
  const [installing, setInstalling] = useState(false);

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
    async (on: boolean, session?: Session | null) => {
      setBusy(true);
      try {
        // The Sunshine host sidecar isn't bundled in the installer (most users
        // only stream *from* other PCs). Only download it if the engine can't
        // already host: `installed` is true when it finds a system-installed
        // Sunshine, or one already running — in which case we adopt that and
        // skip the fetch. Otherwise fetch the sidecar (the engine picks it up
        // via ARCADE_SUNSHINE), then turn hosting on.
        if (on) {
          let canHost = false;
          try {
            canHost = (await hostStatus()).installed;
          } catch {
            canHost = false; // engine unreachable → try installing the sidecar
          }
          if (!canHost) {
            setInstalling(true);
            try {
              await hostInstall();
            } finally {
              setInstalling(false);
            }
          }
        }
        // Cert pre-authorization (zero-PIN auto-pair): seed the account's client certs into
        // Sunshine BEFORE it starts, so they load into named_devices at launch. Best-effort —
        // any device we can't pre-trust just falls back to PIN pairing.
        if (on && session) {
          await seedAccountClientCerts(session.host, session.token);
        }
        await hostEnable(on);
        // After Sunshine is up it has minted its server cert: publish it so clients can pin it.
        if (on && session) {
          await publishHostServerCert(session.host, session.token);
        }
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

  return { status, error, busy, installing, refresh, setEnabled, sync };
}
