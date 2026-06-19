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

/** Whether an installed game has a newer build on the server. Mirrors the Rust
 *  `update_available`: a non-empty server version that differs from the installed
 *  one. Used by the detail panel to offer an "Update" action. */
export function hasUpdate(state: string): boolean {
  return state === "updateAvailable";
}

/** Whether the server advertises a different, non-empty content version than
 *  what's installed (the pure decision behind the `updateAvailable` state).
 *  Kept in lockstep with the Rust `update_available` so client and core agree. */
export function updateAvailable(installedVersion: string, serverVersion: string): boolean {
  const server = serverVersion.trim();
  return server !== "" && server !== installedVersion.trim();
}

/** Transient, in-flight states a live `download://` event owns; an update check
 *  must never overwrite these with a disk-snapshot state. */
const IN_FLIGHT = new Set(["installing", "paused", "failed"]);

/** Merge a fresh update-check result onto the current overlay. The check is
 *  newer than the original disk seed, so it overrides `installed`↔`updateAvailable`;
 *  but any in-flight state set by a live download event (this session's own
 *  install/verify) is preserved, since those are fresher still. */
export function mergeUpdateCheck(
  current: InstallStateMap,
  refreshed: InstallStateMap,
): InstallStateMap {
  const next: InstallStateMap = { ...current, ...refreshed };
  for (const [id, state] of Object.entries(current)) {
    if (IN_FLIGHT.has(state)) next[id] = state;
  }
  return next;
}
