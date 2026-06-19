// On-screen button-prompt bar shown when a controller is connected. Mirrors the
// diffIntents mapping so the hints never drift from the actual bindings. The
// `context` prop lets a screen swap in the prompts relevant to it (e.g. the grid
// vs an open detail modal).

import { useGamepadConnected } from "./useGamepadConnected";
import { useControllerConfig } from "./ControllerConfigContext";

export type HintContext = "grid" | "detail";

interface Hint {
  /** Button glyph (Xbox face/shoulder labels). */
  btn: string;
  label: string;
}

const GRID_HINTS: Hint[] = [
  { btn: "A", label: "Open" },
  { btn: "Y", label: "Search" },
  { btn: "LB/RB", label: "Tabs" },
  { btn: "LT/RT", label: "Page" },
  { btn: "Start", label: "Settings" },
  { btn: "Guide", label: "Big Picture" },
];

const DETAIL_HINTS: Hint[] = [
  { btn: "A", label: "Launch" },
  { btn: "B", label: "Back" },
  { btn: "Guide", label: "Big Picture" },
];

export function ControllerHints({ context = "grid" }: { context?: HintContext }) {
  const connected = useGamepadConnected();
  const { enabled } = useControllerConfig();
  // Hide the prompts when a controller is unplugged or navigation is turned off.
  if (!connected || !enabled) return null;
  const hints = context === "detail" ? DETAIL_HINTS : GRID_HINTS;
  return (
    <div className="cc-hints" role="presentation">
      {hints.map((h) => (
        <span key={h.btn} className="cc-hints__item">
          <span className="cc-hints__btn">{h.btn}</span>
          <span className="cc-hints__label">{h.label}</span>
        </span>
      ))}
    </div>
  );
}
