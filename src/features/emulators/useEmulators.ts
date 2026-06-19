// Emulator readiness hook: loads the server's emulator runtimes with local
// readiness, drives a download (staging) per emulator, and tracks live progress
// from the `emulator://progress` event. Used by the Settings "Emulators" section.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  downloadAllEmulators,
  downloadEmulator,
  firmwareStatus,
  listEmulators,
  type EmulatorProgress,
  type EmulatorStatus,
  type FirmwareStatus,
} from "./api";

const PROGRESS_EVENT = "emulator://progress";

export interface EmulatorsApi {
  emulators: EmulatorStatus[];
  /** Per-console firmware/BIOS deployment status (read-only). */
  firmware: FirmwareStatus[];
  loading: boolean;
  error: string | null;
  /** Live progress per emulator id while staging. */
  progress: Record<string, EmulatorProgress>;
  refresh: () => void;
  download: (id: string) => void;
  /** Stage every emulator/firmware not already present locally. */
  downloadAll: () => void;
}

export function useEmulators(host: string | null, token: string | null): EmulatorsApi {
  const [emulators, setEmulators] = useState<EmulatorStatus[]>([]);
  const [firmware, setFirmware] = useState<FirmwareStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, EmulatorProgress>>({});
  const reloadRef = useRef(0);

  const refresh = useCallback(() => {
    reloadRef.current += 1;
    const seq = reloadRef.current;
    // Firmware deployment status is purely local — load it regardless of session.
    firmwareStatus()
      .then((fw) => {
        if (seq === reloadRef.current) setFirmware(fw);
      })
      .catch(() => {
        /* no Tauri runtime (e.g. browser preview) — leave empty */
      });
    if (!host || !token) {
      setEmulators([]);
      return;
    }
    setLoading(true);
    setError(null);
    listEmulators(host, token)
      .then((list) => {
        if (seq === reloadRef.current) setEmulators(list);
      })
      .catch((e) => {
        if (seq === reloadRef.current) setError(String(e));
      })
      .finally(() => {
        if (seq === reloadRef.current) setLoading(false);
      });
  }, [host, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to staging progress. When an emulator finishes, refresh the list
  // so its readiness badge flips to "Ready".
  useEffect(() => {
    let alive = true;
    let un: UnlistenFn | undefined;
    listen<EmulatorProgress>(PROGRESS_EVENT, (e) => {
      setProgress((p) => ({ ...p, [e.payload.id]: e.payload }));
      if (e.payload.done) refresh();
    })
      .then((u) => {
        if (!alive) u();
        else un = u;
      })
      .catch(() => {
        /* no Tauri runtime — no-op */
      });
    return () => {
      alive = false;
      un?.();
    };
  }, [refresh]);

  const download = useCallback(
    (id: string) => {
      if (!host || !token) return;
      setProgress((p) => ({
        ...p,
        [id]: { id, downloadedBytes: 0, totalBytes: 0, done: false, error: null },
      }));
      void downloadEmulator(host, token, id).catch((e) =>
        setProgress((p) => ({
          ...p,
          [id]: { id, downloadedBytes: 0, totalBytes: 0, done: true, error: String(e) },
        })),
      );
    },
    [host, token],
  );

  const downloadAll = useCallback(() => {
    if (!host || !token) return;
    // Seed optimistic progress for every not-yet-ready emulator so the UI shows
    // activity immediately; real per-file progress events overwrite these.
    setProgress((p) => {
      const next = { ...p };
      for (const e of emulators) {
        if (!e.ready) {
          next[e.id] = { id: e.id, downloadedBytes: 0, totalBytes: e.totalBytes, done: false, error: null };
        }
      }
      return next;
    });
    void downloadAllEmulators(host, token).catch(() => {
      /* per-emulator errors arrive via progress events; ignore the aggregate */
    });
  }, [host, token, emulators]);

  return { emulators, firmware, loading, error, progress, refresh, download, downloadAll };
}
