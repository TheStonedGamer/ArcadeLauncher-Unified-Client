// Pure selectors + formatting over DownloadState. Derived views the queue UI
// renders; kept out of the reducer and out of React so they are unit-tested
// directly, like the social selectors.

import type { DownloadState } from "./reducer";
import type { DownloadItem, DownloadStatus } from "./types";

/** Statuses that occupy a download slot (drive the active-count badge). */
const ACTIVE: ReadonlySet<DownloadStatus> = new Set(["downloading", "verifying", "extracting"]);

/** Statuses still in the queue (not finished and not failed-out). */
const PENDING: ReadonlySet<DownloadStatus> = new Set([
  "queued",
  "downloading",
  "verifying",
  "extracting",
  "paused",
]);

/** Integer percent in [0,100]; 0 total → 0 (mirrors the Rust `percent`). */
export function percent(item: DownloadItem): number {
  if (item.totalBytes <= 0) return 0;
  const done = Math.min(item.downloadedBytes, item.totalBytes);
  return Math.floor((done * 100) / item.totalBytes);
}

/** Count of installs actively transferring/verifying/extracting. */
export function activeCount(state: DownloadState): number {
  return Object.values(state.items).filter((i) => ACTIVE.has(i.status)).length;
}

/** All items, stably ordered: in-flight first (queued→active→paused), then
 *  failed, then done; ties broken by game id so the list never reshuffles. */
export function queueList(state: DownloadState): DownloadItem[] {
  const rank = (s: DownloadStatus): number => {
    if (PENDING.has(s)) return 0;
    if (s === "failed") return 1;
    return 2; // done
  };
  return Object.values(state.items).sort(
    (a, b) => rank(a.status) - rank(b.status) || a.gameId.localeCompare(b.gameId),
  );
}

/** Whether anything is still pending (drives "downloads in progress" UI). */
export function hasPending(state: DownloadState): boolean {
  return Object.values(state.items).some((i) => PENDING.has(i.status));
}

/** Human-readable transfer rate, e.g. "1.4 MB/s". Blank when not moving. */
export function formatSpeed(bps: number): string {
  if (bps <= 0) return "";
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Human-readable byte size, e.g. "3.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
