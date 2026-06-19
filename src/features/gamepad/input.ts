// Pure gamepad-input core. No DOM, no timers — given two consecutive gamepad
// snapshots it produces the discrete navigation intents to act on this frame.
// This is the testable heart of controller navigation; the `useGamepad` hook
// only polls `navigator.getGamepads()` and feeds snapshots through here.

/** Discrete navigation intents the UI acts on. Buttons follow the roadmap's
 *  default Xbox mapping (A confirm, B back, X context, Y search, LB/RB tabs,
 *  LT/RT page scroll, Start settings); Big Picture moves to the Guide button. */
export type NavIntent =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "context"
  | "search"
  | "tabPrev"
  | "tabNext"
  | "pageUp"
  | "pageDown"
  | "settings"
  | "bigpicture";

/** A minimal, engine-agnostic snapshot of a gamepad for one frame. */
export interface PadSnapshot {
  /** Button pressed-states, indexed by the standard mapping. */
  buttons: boolean[];
  /** Axes in [-1, 1]; standard mapping: [lx, ly, rx, ry]. */
  axes: number[];
}

/** Standard-mapping button indices we care about. */
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16,
} as const;

/** Default left-stick deflection past which a deflection counts as a
 *  directional press. The user can override this in Settings → Controller
 *  (the "dead zone"); it's threaded through `stickDirection`/`diffIntents`. */
export const STICK_THRESHOLD = 0.6;

const EMPTY: PadSnapshot = { buttons: [], axes: [] };

function pressed(s: PadSnapshot, i: number): boolean {
  return s.buttons[i] === true;
}

/** A button counts as an edge when it's down now but was up last frame, so
 *  holding it yields a single intent rather than a stream. */
function edge(curr: PadSnapshot, prev: PadSnapshot, i: number): boolean {
  return pressed(curr, i) && !pressed(prev, i);
}

/** Quantize the left stick to a discrete direction, treating the dead zone and
 *  sub-threshold deflection as neutral. The dominant axis wins so a diagonal
 *  doesn't fire two intents. Returns "" for neutral. */
export function stickDirection(
  axes: number[],
  deadZone: number = STICK_THRESHOLD,
): "" | "up" | "down" | "left" | "right" {
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < deadZone && ay < deadZone) return "";
  if (ax >= ay) return x < 0 ? "left" : "right";
  // Standard mapping: +Y is down.
  return y < 0 ? "up" : "down";
}

/**
 * Compute the navigation intents triggered between `prev` and `curr`. Edge
 * detection on buttons and on the stick crossing its threshold means a single
 * physical action maps to exactly one intent. Order is stable so tests are
 * deterministic.
 */
export function diffIntents(
  curr: PadSnapshot,
  prev: PadSnapshot = EMPTY,
  deadZone: number = STICK_THRESHOLD,
): NavIntent[] {
  const out: NavIntent[] = [];

  // Directional: D-pad edges OR the stick crossing into a direction this frame.
  const dirNow = stickDirection(curr.axes, deadZone);
  const dirPrev = stickDirection(prev.axes, deadZone);
  const stickEdge = dirNow !== "" && dirNow !== dirPrev;

  if (edge(curr, prev, BTN.DPAD_UP) || (stickEdge && dirNow === "up")) out.push("up");
  if (edge(curr, prev, BTN.DPAD_DOWN) || (stickEdge && dirNow === "down")) out.push("down");
  if (edge(curr, prev, BTN.DPAD_LEFT) || (stickEdge && dirNow === "left")) out.push("left");
  if (edge(curr, prev, BTN.DPAD_RIGHT) || (stickEdge && dirNow === "right")) out.push("right");

  if (edge(curr, prev, BTN.A)) out.push("select");
  if (edge(curr, prev, BTN.B)) out.push("back");
  if (edge(curr, prev, BTN.X)) out.push("context");
  if (edge(curr, prev, BTN.Y)) out.push("search");
  if (edge(curr, prev, BTN.LB)) out.push("tabPrev");
  if (edge(curr, prev, BTN.RB)) out.push("tabNext");
  if (edge(curr, prev, BTN.LT)) out.push("pageUp");
  if (edge(curr, prev, BTN.RT)) out.push("pageDown");
  if (edge(curr, prev, BTN.START)) out.push("settings");
  if (edge(curr, prev, BTN.GUIDE)) out.push("bigpicture");

  return out;
}
