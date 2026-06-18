// Download-queue hook: owns the DownloadState, drives it from the Rust engine's
// `download://progress` / `download://status` events, and exposes the derived
// list + queue controls. The reducer and selectors do the real work (and are
// unit-tested); this hook is the thin React/transport glue, mirroring useSocial.
//
// In a plain browser (no Tauri runtime) the event listeners simply never fire,
// so the panel renders its empty state. `?downloads-demo` seeds a few items so
// the queue UI can be exercised without a backend.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { cancelDownload, pauseDownload, resumeDownload } from "./api";
import {
  applyProgress,
  applyStatus,
  clearCompleted,
  initialDownloadState,
  removeItem,
  type DownloadState,
} from "./reducer";
import { activeCount, progressByGame, queueList, type CardProgress } from "./selectors";
import type { DownloadItem, ProgressEvent, StatusEvent } from "./types";

const PROGRESS_EVENT = "download://progress";
const STATUS_EVENT = "download://status";

export interface DownloadApi {
  items: DownloadItem[];
  activeCount: number;
  /** Live per-game progress for in-flight installs, keyed by game id, so the
   *  catalog can overlay a progress bar on the matching tile. */
  progress: Record<string, CardProgress>;
  pause: (gameId: string) => void;
  resume: (gameId: string) => void;
  cancel: (gameId: string) => void;
  /** Remove a finished/failed row from the list (local only). */
  dismiss: (gameId: string) => void;
  /** Clear all completed rows (local only). */
  clearDone: () => void;
}

function seedDemo(): DownloadState {
  const now = Date.now();
  let s = initialDownloadState;
  s = applyProgress(s, { gameId: "halo", status: "downloading", downloadedBytes: 734_003_200, totalBytes: 1_610_612_736 }, now - 1000);
  s = applyProgress(s, { gameId: "halo", status: "downloading", downloadedBytes: 745_488_384, totalBytes: 1_610_612_736 }, now);
  s = applyStatus(s, { gameId: "doom", status: "queued" }, now);
  s = applyProgress(s, { gameId: "myst", status: "extracting", downloadedBytes: 524_288_000, totalBytes: 524_288_000 }, now);
  s = applyStatus(s, { gameId: "myst", status: "extracting" }, now);
  s = applyStatus(s, { gameId: "tetris", status: "paused" }, now);
  s = applyStatus(s, { gameId: "quake", status: "failed", error: "sha256 mismatch for data/pak0.pak" }, now);
  s = applyStatus(s, { gameId: "pong", status: "done" }, now);
  return s;
}

export function useDownloads(): DownloadApi {
  const [state, setState] = useState<DownloadState>(initialDownloadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const demo =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("downloads-demo");
    if (demo) {
      setState(seedDemo());
      return;
    }
    let alive = true;
    let uns: UnlistenFn[] = [];
    Promise.all([
      listen<ProgressEvent>(PROGRESS_EVENT, (e) =>
        setState((s) => applyProgress(s, e.payload, Date.now())),
      ),
      listen<StatusEvent>(STATUS_EVENT, (e) => setState((s) => applyStatus(s, e.payload, Date.now()))),
    ])
      .then((u) => {
        if (!alive) u.forEach((f) => f());
        else uns = u;
      })
      .catch(() => {
        /* no Tauri runtime (plain browser/preview) — listeners are a no-op */
      });
    return () => {
      alive = false;
      uns.forEach((f) => f());
    };
  }, []);

  const pause = useCallback((gameId: string) => void pauseDownload(gameId).catch(() => {}), []);
  const resume = useCallback((gameId: string) => void resumeDownload(gameId).catch(() => {}), []);
  const cancel = useCallback((gameId: string) => void cancelDownload(gameId).catch(() => {}), []);
  const dismiss = useCallback((gameId: string) => setState((s) => removeItem(s, gameId)), []);
  const clearDone = useCallback(() => setState((s) => clearCompleted(s)), []);

  const items = useMemo(() => queueList(state), [state]);
  const active = useMemo(() => activeCount(state), [state]);
  const progress = useMemo(() => progressByGame(state), [state]);

  return { items, activeCount: active, progress, pause, resume, cancel, dismiss, clearDone };
}
