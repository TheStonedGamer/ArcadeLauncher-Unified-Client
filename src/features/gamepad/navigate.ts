// Pure grid-navigation math. Given the focused tile index, a directional
// intent, the total tile count and the column count, it returns the next index.
// No DOM — the hook measures the live column count and feeds it in. Kept here so
// wrap/clamp behaviour is unit-tested independently of any rendering.

import type { NavIntent } from "./input";

/** Move the focus index for a directional intent over a `columns`-wide grid of
 *  `total` tiles. Non-directional intents leave the index unchanged. Movement
 *  clamps at edges (no wrap), which feels right for a 2-D library grid. */
export function nextIndex(
  current: number,
  intent: NavIntent,
  total: number,
  columns: number,
): number {
  if (total <= 0) return 0;
  const cols = Math.max(1, columns);
  const i = Math.min(Math.max(current, 0), total - 1);

  switch (intent) {
    case "left":
      // Don't cross a row boundary going left.
      return i % cols === 0 ? i : i - 1;
    case "right":
      return i % cols === cols - 1 || i === total - 1 ? i : i + 1;
    case "up":
      return i - cols >= 0 ? i - cols : i;
    case "down": {
      const down = i + cols;
      return down < total ? down : i;
    }
    default:
      return i;
  }
}
