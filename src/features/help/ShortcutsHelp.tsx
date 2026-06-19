// Keyboard-shortcuts cheat-sheet modal. Opened with "?" (or the header button)
// and closed with Esc / the backdrop / the close button. Pure presentation over
// SHORTCUT_GROUPS.

import { useEffect } from "react";
import { SHORTCUT_GROUPS } from "./shortcuts";

interface Props {
  onClose: () => void;
}

export function ShortcutsHelp({ onClose }: Props) {
  // Esc closes; bound here so it works regardless of focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="shortcuts__card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts__head">
          <h2 className="shortcuts__title">Keyboard &amp; controller shortcuts</h2>
          <button type="button" className="shortcuts__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="shortcuts__groups">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts__group">
              <h3 className="shortcuts__group-title">{group.title}</h3>
              <ul className="shortcuts__list">
                {group.shortcuts.map((s) => (
                  <li key={s.keys} className="shortcuts__row">
                    <kbd className="shortcuts__keys">{s.keys}</kbd>
                    <span className="shortcuts__desc">{s.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
