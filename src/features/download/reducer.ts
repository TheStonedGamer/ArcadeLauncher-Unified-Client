// Pure download-queue reducer. The `download://progress` / `download://status`
// events from the Rust engine drive a per-game item map through these
// referentially-transparent functions, so the whole queue model is exhaustively
// unit-testable without any IPC — the same KAT discipline the social reducer and
// catalog query follow. `now` (epoch ms) is injected so the speed estimate is
// deterministic in tests.

import type { DownloadItem, ProgressEvent, StatusEvent } from "./types";

export interface DownloadState {
  /** Keyed by game id. */
  items: Record<string, DownloadItem>;
}

export const initialDownloadState: DownloadState = { items: {} };

/** Weight for the exponential moving average of transfer speed (higher = more
 *  responsive, lower = smoother). 0.4 tracks changes without jitter. */
const SPEED_EMA_ALPHA = 0.4;

function blankItem(gameId: string, now: number): DownloadItem {
  return {
    gameId,
    status: "queued",
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    sampledAt: now,
    sampledBytes: 0,
  };
}

function itemOf(state: DownloadState, gameId: string, now: number): DownloadItem {
  return state.items[gameId] ?? blankItem(gameId, now);
}

function withItem(state: DownloadState, item: DownloadItem): DownloadState {
  return { ...state, items: { ...state.items, [item.gameId]: item } };
}

/**
 * Smoothed bytes/sec from the byte delta since the last sample. Returns the
 * previous estimate when no time has elapsed (avoids divide-by-zero), and never
 * goes negative (a resume can reset the byte counter downward).
 */
function nextSpeed(prev: DownloadItem, downloadedBytes: number, now: number): number {
  const dtMs = now - prev.sampledAt;
  if (dtMs <= 0) return prev.speedBps;
  const deltaBytes = downloadedBytes - prev.sampledBytes;
  if (deltaBytes <= 0) return prev.speedBps;
  const instant = (deltaBytes * 1000) / dtMs;
  return prev.speedBps === 0
    ? instant
    : SPEED_EMA_ALPHA * instant + (1 - SPEED_EMA_ALPHA) * prev.speedBps;
}

/** Apply a progress sample: update byte counts + the speed estimate. */
export function applyProgress(state: DownloadState, ev: ProgressEvent, now: number): DownloadState {
  const prev = itemOf(state, ev.gameId, now);
  const speedBps = ev.status === "downloading" ? nextSpeed(prev, ev.downloadedBytes, now) : 0;
  return withItem(state, {
    ...prev,
    status: ev.status,
    downloadedBytes: ev.downloadedBytes,
    totalBytes: ev.totalBytes || prev.totalBytes,
    speedBps,
    sampledAt: now,
    sampledBytes: ev.downloadedBytes,
  });
}

/** Apply a lifecycle change. Terminal/idle states zero the speed; `failed`
 *  records the error, other states clear it. */
export function applyStatus(state: DownloadState, ev: StatusEvent, now: number): DownloadState {
  const prev = itemOf(state, ev.gameId, now);
  const downloading = ev.status === "downloading";
  return withItem(state, {
    ...prev,
    status: ev.status,
    error: ev.status === "failed" ? ev.error : undefined,
    speedBps: downloading ? prev.speedBps : 0,
    sampledAt: now,
  });
}

/** Drop an item from the queue (e.g. user dismissed a finished/failed row). */
export function removeItem(state: DownloadState, gameId: string): DownloadState {
  if (!(gameId in state.items)) return state;
  const items = { ...state.items };
  delete items[gameId];
  return { ...state, items };
}

/** Drop every finished (`done`) item — e.g. a "clear completed" action. */
export function clearCompleted(state: DownloadState): DownloadState {
  const items: Record<string, DownloadItem> = {};
  let changed = false;
  for (const [id, it] of Object.entries(state.items)) {
    if (it.status === "done") changed = true;
    else items[id] = it;
  }
  return changed ? { ...state, items } : state;
}
