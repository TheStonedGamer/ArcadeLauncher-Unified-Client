// Draggable window chrome for the Friends roster and each open conversation,
// mirroring Steam: the friends list and every chat are their own small window
// floating over whatever you were doing, not a tab you switch to.
//
// Drag is pointer-based with capture, so a fast drag that outruns the cursor
// still tracks (mouse events would be lost to the element underneath). Geometry
// rules live in windowing.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clamp, type Point, type Size } from "../windowing";

interface Props {
  title: ReactNode;
  /** Small dimmed line under the title — presence, host, whatever fits. */
  subtitle?: string;
  initial: Point;
  size: Size;
  onClose: () => void;
  /** Raise this window above its siblings — called on any interaction. */
  onFocus?: () => void;
  z?: number;
  className?: string;
  children: ReactNode;
}

export function FloatingWindow({
  title,
  subtitle,
  initial,
  size,
  onClose,
  onFocus,
  z = 60,
  className = "",
  children,
}: Props) {
  const [pos, setPos] = useState<Point>(initial);
  const grab = useRef<Point | null>(null);

  // A window parked near the right/bottom edge would be stranded off-screen if
  // the app window shrank, so re-clamp on resize.
  useEffect(() => {
    const onResize = () =>
      setPos((p) =>
        clamp(p, size, { w: window.innerWidth, h: window.innerHeight }),
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size.w, size.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Let the close button (and anything else interactive in the bar) work.
    if ((e.target as HTMLElement).closest("button")) return;
    grab.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onFocus?.();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    setPos(
      clamp({ x: e.clientX - g.x, y: e.clientY - g.y }, size, {
        w: window.innerWidth,
        h: window.innerHeight,
      }),
    );
  };

  const endDrag = () => {
    grab.current = null;
  };

  return (
    <section
      className={`floatwin ${className}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: z,
      }}
      onPointerDown={() => onFocus?.()}
    >
      <header
        className="floatwin__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="floatwin__titles">
          <span className="floatwin__title">{title}</span>
          {subtitle && <span className="floatwin__subtitle">{subtitle}</span>}
        </div>
        <button
          className="floatwin__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="floatwin__body">{children}</div>
    </section>
  );
}
