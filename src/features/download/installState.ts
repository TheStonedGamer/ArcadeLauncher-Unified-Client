// Pure install-state overlay. The catalog (library.json) is read-only and its
// `installState` is only as fresh as the last load. Install records and live
// `download://status` events know better — this module merges those two
// sources into a `gameId → catalog state string` overlay the catalog UI lays
// on top of the library without ever reloading it. No IO; fully unit-tested.

import type { DownloadStatus, StatusEvent } from "./types";

/** game id → catalog `installState` string (matches the Rust `as_catalog_str`). */
export type InstallStateMap = Record<string, string>;

/** Map a live download lifecycle status onto the catalog's install-state
 *  vocabulary. In-flight phases all read as "installing"; terminal states map
 *  to their catalog equivalents. */
export function mapDownloadStatus(status: DownloadStatus): string {
  switch (status) {
    case "queued":
    case "downloading":
    case "verifying":
    case "extracting":
      return "installing";
    case "paused":
      return "paused";
    case "done":
      return "installed";
    case "failed":
      return "failed";
  }
}

/** Fold a `download://status` event into the overlay, returning a new map. */
export function applyInstallStatus(map: InstallStateMap, ev: StatusEvent): InstallStateMap {
  return { ...map, [ev.gameId]: mapDownloadStatus(ev.status) };
}

/** The effective install state for a game: the overlay wins when present,
 *  otherwise the catalog's own value (defaulting to "notInstalled"). */
export function effectiveInstallState(
  gameId: string,
  catalogState: string,
  map: InstallStateMap,
): string {
  return map[gameId] || catalogState || "notInstalled";
}

/** Whether a game is fully installed per the effective state. */
export function isInstalled(state: string): boolean {
  return state === "installed" || state === "updateAvailable";
}
