// Tracks whether the first-run tour has been completed (client-local flag). The
// overlay calls finish() on Skip/Get-started; once set it never shows again.

import { useCallback, useState } from "react";

const KEY = "onboarding.done";

export function useOnboarding() {
  const [done, setDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      // storage unavailable → don't nag with the overlay
      return true;
    }
  });

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // best-effort; still dismiss for this session
    }
    setDone(true);
  }, []);

  return { done, finish };
}
