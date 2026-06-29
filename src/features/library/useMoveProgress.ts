// Live cross-drive move progress, keyed by game id, from the engine's
// `library://move-progress` events. Mirrors useInstallOverlay's transport glue:
// in a plain browser (no Tauri runtime) the listener is a no-op and the map
// stays empty. A `done` event clears that game's entry after a short beat so the
// UI can show "moved" briefly before the row reverts.

import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MoveProgressEvent } from "./types";

const MOVE_EVENT = "library://move-progress";

/** A live view of one in-flight move. */
export interface MoveProgress {
  copiedBytes: number;
  totalBytes: number;
  done: boolean;
}

export function useMoveProgress(): {
  moves: Record<string, MoveProgress>;
  clear: (gameId: string) => void;
} {
  const [moves, setMoves] = useState<Record<string, MoveProgress>>({});

  const clear = useCallback((gameId: string) => {
    setMoves((m) => {
      if (!(gameId in m)) return m;
      const next = { ...m };
      delete next[gameId];
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | undefined;

    listen<MoveProgressEvent>(MOVE_EVENT, (e) => {
      const p = e.payload;
      setMoves((m) => ({
        ...m,
        [p.gameId]: { copiedBytes: p.copiedBytes, totalBytes: p.totalBytes, done: p.done },
      }));
    })
      .then((u) => {
        if (!alive) u();
        else unlisten = u;
      })
      .catch(() => {
        /* no Tauri runtime — moves stay empty */
      });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return { moves, clear };
}
