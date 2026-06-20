// Tracks whether the first-run tour has been completed for the signed-in user
// (client-local, per-user flag). The tour is gated on a user's FIRST LOGIN, not
// on app first-run: with no user it reports done=true so the overlay stays
// hidden until someone signs in. finish() persists completion for that user;
// once set it never shows again for them.

import { useCallback, useEffect, useState } from "react";
import { isOnboardingComplete, onboardingDoneKey } from "./onboarding";

function readDone(user: string | null | undefined): boolean {
  try {
    return isOnboardingComplete(user, (k) => localStorage.getItem(k));
  } catch {
    // storage unavailable → don't nag with the overlay
    return true;
  }
}

export function useOnboarding(user?: string | null) {
  const [done, setDone] = useState<boolean>(() => readDone(user));

  // Re-evaluate when the signed-in user changes (login happens after mount, or
  // accounts switch) so each user sees the tour on their own first login.
  useEffect(() => {
    setDone(readDone(user));
  }, [user]);

  const finish = useCallback(() => {
    if (user) {
      try {
        localStorage.setItem(onboardingDoneKey(user), "1");
      } catch {
        // best-effort; still dismiss for this session
      }
    }
    setDone(true);
  }, [user]);

  return { done, finish };
}
