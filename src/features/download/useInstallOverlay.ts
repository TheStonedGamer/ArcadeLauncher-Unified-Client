// Install-state overlay hook: loads the persisted install records once, then
// keeps the overlay live from the engine's `download://status` events. The
// catalog lays the returned map on top of the read-only library so the Install
// button flips to "Installed" the moment an install finishes — no reload. Thin
// transport glue over the pure `installState` core (which is unit-tested).
//
// In a plain browser (no Tauri runtime) the load + listeners are no-ops, so the
// overlay stays empty and the catalog shows library.json's own install state.

import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { checkUpdates, loadInstallRecords } from "./api";
import { applyInstallStatus, mergeUpdateCheck, type InstallStateMap } from "./installState";
import type { StatusEvent } from "./types";

const STATUS_EVENT = "download://status";

/** Loads the install overlay and, when a `session` is supplied, runs a one-shot
 *  update check (T12c) that flips on-disk records to `updateAvailable` when the
 *  server advertises a newer build. The check re-runs whenever the session
 *  identity changes (sign-in/out). */
export function useInstallOverlay(session?: { host: string; token: string } | null): InstallStateMap {
  const [map, setMap] = useState<InstallStateMap>({});
  const host = session?.host ?? null;
  const token = session?.token ?? null;

  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | undefined;

    // Seed from the persisted records, then merge live status events on top.
    loadInstallRecords()
      .then((records) => {
        if (alive) setMap((m) => ({ ...records, ...m }));
      })
      .catch(() => {
        /* no Tauri runtime / no records yet — leave the overlay empty */
      });

    listen<StatusEvent>(STATUS_EVENT, (e) => setMap((m) => applyInstallStatus(m, e.payload)))
      .then((u) => {
        if (!alive) u();
        else unlisten = u;
      })
      .catch(() => {});

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // One-shot update check once we have a session. Records already overlaid by
  // live download events win (spread first), so an in-flight install isn't
  // clobbered by a stale `installed`/`updateAvailable` from the check.
  useEffect(() => {
    if (!host || !token) return;
    let alive = true;
    checkUpdates(host, token)
      .then((refreshed) => {
        if (alive) setMap((m) => mergeUpdateCheck(m, refreshed));
      })
      .catch(() => {
        /* offline / no Tauri runtime — keep the existing overlay */
      });
    return () => {
      alive = false;
    };
  }, [host, token]);

  return map;
}
