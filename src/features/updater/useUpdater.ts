// Checks for an update on mount and reports a small status the shell can show.
// Download/install is gated behind an explicit user action (returned `install`).
// This proves the Steam-style admin-free update path end to end once signing
// keys + endpoints are configured.

import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [pending, setPending] = useState<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus({ kind: "checking" });
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          setPending(update);
          setStatus({ kind: "available", version: update.version });
        } else {
          setStatus({ kind: "none" });
        }
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!pending) return;
    setStatus({ kind: "installing" });
    try {
      await pending.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [pending]);

  return { status, install };
}
