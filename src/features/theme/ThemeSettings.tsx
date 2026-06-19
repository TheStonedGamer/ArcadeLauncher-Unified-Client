// Appearance settings: pick a color mode and an accent. Changes apply live (no
// Save needed) and persist to localStorage via useTheme. Pure presentation over
// the MODES/ACCENTS catalogs.

import { useTheme } from "./useTheme";
import { MODES, ACCENTS } from "./theme";

export function ThemeSettings() {
  const { prefs, update } = useTheme();

  return (
    <>
      <h2 className="settings__heading">Appearance</h2>
      <p className="catalog__status">Changes apply instantly and are saved per device.</p>

      <span className="settings__label">Theme</span>
      <div className="theme-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`theme-mode${prefs.mode === m.id ? " theme-mode--active" : ""}`}
            onClick={() => update({ mode: m.id })}
            aria-pressed={prefs.mode === m.id}
          >
            <span
              className="theme-mode__swatch"
              style={{ background: m.vars["--bg"], borderColor: m.vars["--border"] }}
            >
              <span className="theme-mode__bar" style={{ background: m.vars["--panel"] }} />
            </span>
            {m.label}
          </button>
        ))}
      </div>

      <span className="settings__label">Accent</span>
      <div className="theme-accents">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`theme-accent${prefs.accent === a.id ? " theme-accent--active" : ""}`}
            style={{ background: a.accent }}
            onClick={() => update({ accent: a.id })}
            aria-pressed={prefs.accent === a.id}
            title={a.label}
            aria-label={a.label}
          />
        ))}
      </div>
    </>
  );
}
