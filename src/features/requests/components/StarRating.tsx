// A 1–5 star control. Read-only shows the community average (filled to the nearest
// half is overkill here — we fill whole stars up to round(avg)); interactive lets
// the signed-in user click a star to set their own rating. The caller owns state;
// this is presentation + a click callback.

import { useState } from "react";

interface StarRatingProps {
  /** The value to render filled (the user's own rating, or the average). */
  value: number;
  /** When set, the control is interactive and calls back with 1–5 on click. */
  onRate?: (stars: number) => void;
  /** Small caption after the stars, e.g. "★ 4.5 (8)" or "Your rating". */
  caption?: string;
  /** Disable interaction (e.g. signed out). */
  disabled?: boolean;
}

export function StarRating({ value, onRate, caption, disabled }: StarRatingProps) {
  const [hover, setHover] = useState(0);
  const interactive = !!onRate && !disabled;
  const shown = hover || Math.round(value);

  return (
    <span className="stars" role={interactive ? "radiogroup" : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`stars__star${n <= shown ? " stars__star--on" : ""}${
            interactive ? " stars__star--interactive" : ""
          }`}
          disabled={!interactive}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          aria-checked={interactive ? n === Math.round(value) : undefined}
          role={interactive ? "radio" : undefined}
          onMouseEnter={() => interactive && setHover(n)}
          onMouseLeave={() => interactive && setHover(0)}
          onClick={() => interactive && onRate?.(n)}
        >
          ★
        </button>
      ))}
      {caption && <span className="stars__caption">{caption}</span>}
    </span>
  );
}
