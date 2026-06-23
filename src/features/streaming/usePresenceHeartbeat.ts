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
import { listen } from "@tauri-apps/api/event";
import type { Session } from "../session/types";
import { hostStatus, myPcsRegister } from "./api";
import { publishOwnClientCert, seedAccountClientCerts } from "./certAuth";

/** Comfortably under the server's 70s staleness window so this PC never flickers
 *  offline between beats. */
const HEARTBEAT_MS = 30_000;

/** Raw inbound social frame event (mirrors src-tauri social FRAME_EVENT). */
const SOCIAL_FRAME_EVENT = "social://frame";

/** Keep this device "online" for the whole session, and own the app-wide cert
 *  pre-authorization upkeep (zero-PIN auto-pair, fix A). Mount once at the app root.
 *  No-op when signed out. */
export function usePresenceHeartbeat(session: Session | null): void {
  const host = session?.host ?? null;
  const token = session?.token ?? null;

  useEffect(() => {
    if (!host || !token) return;
    // Beat immediately so presence is fresh the moment we sign in, then on cadence.
    void myPcsRegister(host, token).catch(() => {});
    // Publish this device's streaming-client cert once on sign-in so every host on the account can
    // pre-authorize it (best-effort; falls back to PIN pairing if the engine has no identity yet).
    void publishOwnClientCert(host, token);
    const id = window.setInterval(() => {
      void myPcsRegister(host, token).catch(() => {});
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [host, token]);

  // When another device registers a new client cert, the server pushes `client_cert_update`. If
  // this PC is currently hosting, seed the new cert into its Sunshine trust store so that device
  // auto-pairs. We deliberately DON'T restart Sunshine to apply it immediately — that would kill any
  // in-progress stream; the cert is written to the state file and loads on the next natural restart,
  // and the new device falls back to the inline PIN prompt (fix B) until then.
  useEffect(() => {
    if (!host || !token) return;
    const un = listen<string>(SOCIAL_FRAME_EVENT, (e) => {
      try {
        const frame = JSON.parse(e.payload);
        if (!frame || frame.type !== "client_cert_update") return;
      } catch {
        return; // non-JSON / unrelated frame
      }
      void hostStatus()
        .then((s) => {
          if (s.running) return seedAccountClientCerts(host, token);
        })
        .catch(() => {});
    });
    return () => {
      void un.then((u) => u());
    };
  }, [host, token]);
}
