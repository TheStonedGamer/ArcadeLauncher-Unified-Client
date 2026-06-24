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

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "../session/types";
import { hostEnable, hostStatus, myPcsRegister } from "./api";
import { publishHostServerCert, publishOwnClientCert, seedAccountClientCerts } from "./certAuth";
import { hostPreauthAction } from "./streaming";

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

  // Host pre-auth progress for THIS session. `seeded` gates the one-time trust-store
  // seed + Sunshine cycle (so we never re-cycle on every beat). `publishedCert` holds the
  // server cert PEM we last pushed to the registry; we re-publish whenever the host's current
  // cert differs from it, so a mid-session cert.pem regeneration propagates instead of leaving
  // clients pinned to a stale cert. Reset whenever the session changes.
  const hostPreauth = useRef({ seeded: false, publishedCert: "" });

  useEffect(() => {
    if (!host || !token) return;
    hostPreauth.current = { seeded: false, publishedCert: "" };

    // Beat immediately so presence is fresh the moment we sign in, then on cadence.
    void myPcsRegister(host, token).catch(() => {});
    // Publish this device's streaming-client cert once on sign-in so every host on the account can
    // pre-authorize it (best-effort; falls back to PIN pairing if the engine has no identity yet).
    void publishOwnClientCert(host, token);

    // App-wide host-side cert pre-authorization. The v0.13.6 boot auto-restore enables Sunshine in
    // Rust WITHOUT the cert dance, so an auto-restored host never publishes its server cert (clients
    // can't pin it → PIN prompt) and never seeds account client certs (host doesn't trust them).
    // setEnabled only covers a manual toggle; this covers auto-restore and sign-in-after-launch.
    // Runs on the heartbeat cadence and self-heals the start-up race (Sunshine mints cert.pem a bit
    // after it starts). Best-effort throughout — any failure just leaves the PIN fallback in place.
    const ensureHostPreauth = async () => {
      const st = hostPreauth.current;
      let status: { running: boolean } | null = null;
      try {
        status = await hostStatus();
      } catch {
        return; // engine unreachable this beat; try again next
      }
      if (hostPreauthAction(status) !== "run") return;

      if (!st.seeded) {
        st.seeded = true;
        try {
          // Seed account client certs into this host's trust store. When the host came up via
          // auto-restore, Sunshine is already running un-seeded, so the engine reports a restart is
          // needed to load them into named_devices — cycle hosting once to apply it. Safe here: this
          // runs at sign-in, before any stream is active (unlike the in-stream client_cert_update
          // path below, which must never restart and kill a live stream).
          const restartNeeded = await seedAccountClientCerts(host, token);
          if (restartNeeded) {
            await hostEnable(false);
            await hostEnable(true);
          }
        } catch {
          /* best-effort; seeded devices still load on the next natural Sunshine restart */
        }
      }

      // Re-publish whenever the current cert differs from what we last pushed (deduped inside the
      // helper). This self-heals a mid-session cert.pem regeneration — without it the registry
      // keeps the old cert and every client fails HTTPS serverinfo with a stale pin.
      const cert = await publishHostServerCert(host, token, st.publishedCert);
      if (cert) st.publishedCert = cert;
    };
    void ensureHostPreauth();

    const id = window.setInterval(() => {
      void myPcsRegister(host, token).catch(() => {});
      void ensureHostPreauth();
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
