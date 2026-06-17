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
import { loadInstallRecords } from "./api";
import { applyInstallStatus, type InstallStateMap } from "./installState";
import type { StatusEvent } from "./types";

const STATUS_EVENT = "download://status";

export function useInstallOverlay(): InstallStateMap {
  const [map, setMap] = useState<InstallStateMap>({});

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

  return map;
}
