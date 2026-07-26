import { useCallback, useEffect, useState } from "react";
import { checkAppUpdate, type AvailableUpdate } from "./api";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Quietly check now, every 15 minutes, and whenever the window regains focus. */
export function useBackgroundUpdate(): AvailableUpdate | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  const check = useCallback(() => {
    void checkAppUpdate()
      .then(setUpdate)
      .catch(() => {
        // Offline/update-service failures never interrupt normal launcher use.
      });
  }, []);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [check]);

  return update;
}
