// Pure gamepad-input core. No DOM, no timers — given two consecutive gamepad
// snapshots it produces the discrete navigation intents to act on this frame.
// This is the testable heart of controller navigation; the `useGamepad` hook
// only polls `navigator.getGamepads()` and feeds snapshots through here.

/** Discrete navigation intents the UI acts on. */
export type NavIntent =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
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
  Y: 3,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Left-stick deflection past this counts as a directional press. */
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
export function stickDirection(axes: number[]): "" | "up" | "down" | "left" | "right" {
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < STICK_THRESHOLD && ay < STICK_THRESHOLD) return "";
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
export function diffIntents(curr: PadSnapshot, prev: PadSnapshot = EMPTY): NavIntent[] {
  const out: NavIntent[] = [];

  // Directional: D-pad edges OR the stick crossing into a direction this frame.
  const dirNow = stickDirection(curr.axes);
  const dirPrev = stickDirection(prev.axes);
  const stickEdge = dirNow !== "" && dirNow !== dirPrev;

  if (edge(curr, prev, BTN.DPAD_UP) || (stickEdge && dirNow === "up")) out.push("up");
  if (edge(curr, prev, BTN.DPAD_DOWN) || (stickEdge && dirNow === "down")) out.push("down");
  if (edge(curr, prev, BTN.DPAD_LEFT) || (stickEdge && dirNow === "left")) out.push("left");
  if (edge(curr, prev, BTN.DPAD_RIGHT) || (stickEdge && dirNow === "right")) out.push("right");

  if (edge(curr, prev, BTN.A)) out.push("select");
  if (edge(curr, prev, BTN.B)) out.push("back");
  if (edge(curr, prev, BTN.Y)) out.push("bigpicture");

  return out;
}
