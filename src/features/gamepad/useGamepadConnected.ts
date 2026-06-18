// Tracks whether at least one gamepad is connected, via the browser's
// gamepadconnected/gamepaddisconnected events (plus an initial poll so a pad
// already plugged in at mount is detected). Drives the on-screen controller
// hint bar — hints only show when a controller is actually present.

import { useEffect, useState } from "react";

function anyPadConnected(): boolean {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  return Array.from(navigator.getGamepads()).some((p) => p != null);
}

export function useGamepadConnected(): boolean {
  const [connected, setConnected] = useState<boolean>(() => anyPadConnected());

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Re-poll on either event: a disconnect of one pad may leave others.
    const recheck = () => setConnected(anyPadConnected());
    window.addEventListener("gamepadconnected", recheck);
    window.addEventListener("gamepaddisconnected", recheck);
    return () => {
      window.removeEventListener("gamepadconnected", recheck);
      window.removeEventListener("gamepaddisconnected", recheck);
    };
  }, []);

  return connected;
}
