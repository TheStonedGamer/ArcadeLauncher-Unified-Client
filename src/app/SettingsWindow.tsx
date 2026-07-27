// Settings as a floating window rather than a tab, mirroring Steam: opened from
// the account dropdown, dismissed with Escape, the backdrop, or the close button.
// Purely a shell — the form itself is unchanged `SettingsView`.

import { useEffect } from "react";
import { SettingsView } from "../features/settings/SettingsView";

interface Props {
  onClose: () => void;
}

export function SettingsWindow({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-window" onClick={onClose}>
      <div
        className="settings-window__frame"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        // The frame swallows clicks so only the backdrop dismisses.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-window__titlebar">
          <span className="settings-window__title">Settings</span>
          <button
            type="button"
            className="settings-window__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>
        <div className="settings-window__body">
          <SettingsView />
        </div>
      </div>
    </div>
  );
}
