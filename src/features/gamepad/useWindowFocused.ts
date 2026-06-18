// Tracks whether the launcher window is the focused, foreground window. The
// roadmap's CRITICAL input-focus requirement: the launcher must ignore all
// controller/keyboard navigation when alt-tabbed, minimized, or while another
// app (or a launched game) is in the foreground — only act on input while we're
// actually in front. `window.focus`/`blur` covers alt-tab and app switching;
// `visibilitychange` covers minimize; the initial value seeds from
// `document.hasFocus()` so a cold start in the background is handled too.

import { useEffect, useState } from "react";

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    const onVisibility = () => setFocused(document.visibilityState === "visible" && document.hasFocus());

    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return focused;
}
