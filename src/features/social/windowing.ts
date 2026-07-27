// Geometry for the floating Friends and chat windows. Pure and unit-tested —
// FloatingWindow is then just a titlebar, a drag listener, and these functions.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/**
 * Keep a window on screen. A dragged window may not leave more than its own
 * width/height off any edge, and never covers less than `EDGE` px of itself —
 * otherwise a window flicked at the corner becomes unreachable, since the
 * titlebar is the only drag handle.
 */
export const EDGE = 48;

export function clamp(pos: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.min(Math.max(pos.x, EDGE - size.w), viewport.w - EDGE),
    y: Math.min(Math.max(pos.y, 0), viewport.h - EDGE),
  };
}
