// Polls the browser Gamepad API each animation frame and forwards discrete
// navigation intents (computed by the pure `diffIntents` core) to a callback.
// The webview exposes navigator.getGamepads(), so no native plugin is needed.
// A no-op when gamepads are unavailable (plain browser without a controller).

import { useEffect, useRef } from "react";
import { diffIntents, type NavIntent, type PadSnapshot } from "./input";
import { useWindowFocused } from "./useWindowFocused";

export function useGamepad(onIntent: (intent: NavIntent) => void, enabled = true): void {
  const prev = useRef<PadSnapshot>({ buttons: [], axes: [] });
  const cb = useRef(onIntent);
  cb.current = onIntent;
  // CRITICAL focus gate: only act on controller input while we're the
  // foreground window (alt-tab / minimize / a launched game in front → ignore).
  const focused = useWindowFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;

    let raf = 0;
    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      // Use the first connected pad.
      const gp = Array.from(pads).find((p): p is Gamepad => p != null);
      if (gp) {
        const snap: PadSnapshot = {
          buttons: gp.buttons.map((b) => b.pressed),
          axes: Array.from(gp.axes),
        };
        // While unfocused we still sync `prev` to the live state but emit
        // nothing — so a button held across the blur isn't seen as a fresh
        // press (edge) the instant focus returns.
        if (focusedRef.current) {
          for (const intent of diffIntents(snap, prev.current)) cb.current(intent);
        }
        prev.current = snap;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
