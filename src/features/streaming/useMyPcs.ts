// Account-brokered "My PCs" hook (T12k-7 / T12k-9). Owns the list of *other*
// PCs signed into the same account (this device is excluded server-/Rust-side),
// keeps this device registered + "online", and refetches when the server pushes
// a `stream_host_update`.
//
// host+token come from useSession; with no session the hook stays idle. Discovery
// is push-driven: the server's `stream_host_update` arrives over the existing
// social WebSocket as a raw `social://frame` Tauri event, so we listen there and
// refetch — no coupling to the social hook's internals. A slow timer doubles as a
// safety net (and refreshes other devices' online dots, which the server derives
// from last-seen freshness at fetch time).

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSession } from "../session/SessionContext";
import { myPcs, myPcsRegister, type MyPc } from "./api";

/** Raw inbound social frame event (mirrors src-tauri social FRAME_EVENT). */
const SOCIAL_FRAME_EVENT = "social://frame";
/** Re-register + refresh cadence. Comfortably under the server's 70s staleness
 *  window so this PC never flickers offline and other devices' dots stay fresh. */
const HEARTBEAT_MS = 30_000;

export interface MyPcsApi {
  /** Other PCs on the account, online first then by name. */
  pcs: MyPc[];
  loading: boolean;
  error: string | null;
  /** Re-fetch the device list now. */
  reload: () => void;
}

/** Online devices first, then alphabetical by name — a stable display order. */
function sortPcs(list: MyPc[]): MyPc[] {
  return [...list].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function useMyPcs(): MyPcsApi {
  const { session } = useSession();
  const host = session?.host ?? null;
  const token = session?.token ?? null;

  const [pcs, setPcs] = useState<MyPc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!host || !token) {
      setPcs([]);
      return;
    }
    setLoading(true);
    setError(null);
    myPcs(host, token)
      .then((list) => setPcs(sortPcs(list)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [host, token]);

  // Keep reload current for the event listener / interval without re-subscribing.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // On sign-in: register this device (so it appears for others + notifies them),
  // then load the list. Clears on sign-out.
  useEffect(() => {
    if (!host || !token) {
      setPcs([]);
      return;
    }
    void myPcsRegister(host, token).catch(() => {
      /* best-effort; the heartbeat retries and the list still loads */
    });
    reloadRef.current();
  }, [host, token]);

  // Heartbeat: re-register to refresh this device's last_seen (keeps it online),
  // and refetch so other devices' online/offline state stays current.
  useEffect(() => {
    if (!host || !token) return;
    const id = window.setInterval(() => {
      void myPcsRegister(host, token).catch(() => {});
      reloadRef.current();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [host, token]);

  // Push: refetch whenever the server announces a device change. The frame is the
  // raw JSON string the gateway forwarded; we only care about its `type`.
  useEffect(() => {
    const un = listen<string>(SOCIAL_FRAME_EVENT, (e) => {
      try {
        const frame = JSON.parse(e.payload);
        if (frame && frame.type === "stream_host_update") reloadRef.current();
      } catch {
        /* non-JSON / unrelated frame — ignore */
      }
    });
    return () => {
      void un.then((u) => u());
    };
  }, []);

  return { pcs, loading, error, reload };
}
