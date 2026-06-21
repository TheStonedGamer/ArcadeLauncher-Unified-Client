// Tracks whether the first-run tour has been completed for the signed-in account.
// The tour is gated on a user's FIRST LOGIN, not on app first-run: with no
// session it reports done=true so the overlay stays hidden until someone signs
// in.
//
// Completion is authoritative on the SERVER (per-account prefs blob) so the tour
// shows once per account — across devices and reinstalls — not once per device.
// localStorage is kept only as a fast, offline cache: it gates the overlay
// instantly on mount (no flash) while the server value is fetched, and lets a
// user who finished offline stay un-nagged until the next sync.

import { useCallback, useEffect, useState } from "react";
import { isOnboardingComplete, onboardingDoneKey } from "./onboarding";
import { fetchOnboardingComplete, markOnboardingComplete } from "./api";
import type { Session } from "../session/types";

function readDone(user: string | null | undefined): boolean {
  try {
    return isOnboardingComplete(user, (k) => localStorage.getItem(k));
  } catch {
    // storage unavailable → don't nag with the overlay
    return true;
  }
}

function cacheDone(user: string): void {
  try {
    localStorage.setItem(onboardingDoneKey(user), "1");
  } catch {
    // best-effort cache; the server flag remains the source of truth
  }
}

export function useOnboarding(session?: Session | null) {
  const user = session?.username ?? null;
  const [done, setDone] = useState<boolean>(() => readDone(user));

  // Re-evaluate when the signed-in account changes (login happens after mount,
  // or accounts switch). Seed from the local cache immediately to avoid a flash,
  // then reconcile with the server so the tour is gated once PER ACCOUNT rather
  // than once per device.
  useEffect(() => {
    const cached = readDone(user);
    setDone(cached);
    if (!session || cached) return; // hidden pre-login, or already cached as seen

    let cancelled = false;
    void (async () => {
      try {
        if (await fetchOnboardingComplete(session.host, session.token)) {
          if (cancelled) return;
          cacheDone(session.username); // mirror server truth locally
          setDone(true);
        }
        // Server says not seen → leave the overlay visible (done stays false).
      } catch {
        // Offline / server error → fall back to the local cache (already applied).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const finish = useCallback(() => {
    if (user) cacheDone(user);
    // Persist to the account so other devices/reinstalls don't show it again.
    if (session) void markOnboardingComplete(session.host, session.token).catch(() => {});
    setDone(true);
  }, [session, user]);

  return { done, finish };
}
