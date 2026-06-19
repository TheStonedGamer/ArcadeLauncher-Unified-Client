// Thin theme glue: load the saved ThemePrefs, write the resolved CSS vars onto
// :root, and persist changes. The pure resolution lives in theme.ts. Prefs are
// client-local (localStorage, like catalog.query) so there's no Rust/server hop.

import { useCallback, useState } from "react";
import { coerceThemePrefs, resolveTheme, DEFAULT_THEME, type ThemePrefs } from "./theme";

const KEY = "theme.prefs";

function applyTheme(prefs: ThemePrefs): void {
  if (typeof document === "undefined") return;
  const { vars, colorScheme } = resolveTheme(prefs);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = colorScheme;
}

function loadPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return coerceThemePrefs(JSON.parse(raw));
  } catch {
    // malformed/absent storage → defaults
  }
  return DEFAULT_THEME;
}

/** Apply the persisted theme once at startup (before React renders) so there's no
 *  flash of the default palette. Safe to call with no stored prefs. */
export function applyStoredTheme(): void {
  applyTheme(loadPrefs());
}

/** Theme state for the Settings UI: current prefs + an updater that persists and
 *  live-applies the change immediately. */
export function useTheme() {
  const [prefs, setPrefs] = useState<ThemePrefs>(loadPrefs);

  const update = useCallback((patch: Partial<ThemePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // best-effort persistence
      }
      applyTheme(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
