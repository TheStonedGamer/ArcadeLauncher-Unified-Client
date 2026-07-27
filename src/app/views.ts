// Pure view-tab model for the app shell. The ordered list drives both the
// header tabs and controller tab-cycling (LB/RB), so they can't drift apart.
// Kept DOM-free and unit-tested independently of AppShell rendering.

// Settings is deliberately absent: it is no longer a tab. It opens as a modal
// window from the account dropdown (Steam-style), so it takes part in neither
// the header strip nor the controller cycle.
export type View =
  | "store"
  | "library"
  | "steam"
  | "epic"
  | "friends"
  | "requests"
  | "downloads";

/** Tab order, left to right — also the controller cycle order. Store leads, then
 *  Library (owned games), mirroring Steam's STORE | LIBRARY ordering. */
export const VIEW_ORDER: View[] = [
  "store",
  "library",
  "steam",
  "epic",
  "friends",
  "requests",
  "downloads",
];

/** Cycle to the previous/next view, wrapping around the ends. Wrapping (rather
 *  than clamping) feels right for a small fixed tab strip on a controller. */
export function cycleView(current: View, dir: "prev" | "next"): View {
  const i = VIEW_ORDER.indexOf(current);
  if (i < 0) return current;
  const n = VIEW_ORDER.length;
  const next = dir === "next" ? (i + 1) % n : (i - 1 + n) % n;
  return VIEW_ORDER[next];
}
