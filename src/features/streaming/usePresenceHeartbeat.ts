// App-wide "My PCs" presence keep-alive.
//
// A PC is shown "online" to the account's other devices only while its `last_seen`
// is fresh (server window: PRESENCE_STALE_SECS = 70s; it's stamped by the REST
// register / WS announce paths). The host you want to STREAM TO is, by definition,
// not sitting on its own "My PCs" tab — so if the keep-alive only ran inside
// MyPcsView (where useMyPcs mounts), that host went stale after ~70s and showed
// offline even though its published library stayed browsable. That was the
// "I can see the games but it says host offline" bug.
//
// This hook lifts the self-register heartbeat to the app root (AppShell), so a
// signed-in PC stays online for the whole session regardless of the active view.
// The upsert is idempotent, so registering on a steady cadence is safe.

import { useEffect } from "react";
import type { Session } from "../session/types";
import { myPcsRegister } from "./api";

/** Comfortably under the server's 70s staleness window so this PC never flickers
 *  offline between beats. */
const HEARTBEAT_MS = 30_000;

/** Keep this device "online" for the whole session. Mount once at the app root.
 *  No-op when signed out. */
export function usePresenceHeartbeat(session: Session | null): void {
  const host = session?.host ?? null;
  const token = session?.token ?? null;

  useEffect(() => {
    if (!host || !token) return;
    // Beat immediately so presence is fresh the moment we sign in, then on cadence.
    void myPcsRegister(host, token).catch(() => {});
    const id = window.setInterval(() => {
      void myPcsRegister(host, token).catch(() => {});
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [host, token]);
}
