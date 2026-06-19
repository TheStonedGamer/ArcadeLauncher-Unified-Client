// Pure theming: resolve a small set of CSS custom properties from a saved theme
// preference (color mode + accent). The whole app re-skins by writing these vars
// onto :root (see useTheme.applyTheme — the thin DOM glue). No React/DOM here, so
// resolution/validation is unit-testable (theme.test.ts). Mode palettes mirror the
// GitHub-derived tokens in global.css :root; accents override --accent/--selected.

export type ThemeMode = "dark" | "midnight" | "light";

export interface AccentPreset {
  id: string;
  label: string;
  accent: string;
  selected: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "blue", label: "Blue", accent: "#58a6ff", selected: "#388bfd" },
  { id: "green", label: "Green", accent: "#3fb950", selected: "#2ea043" },
  { id: "purple", label: "Purple", accent: "#bc8cff", selected: "#a371f7" },
  { id: "orange", label: "Orange", accent: "#f0883e", selected: "#db6d28" },
  { id: "pink", label: "Pink", accent: "#f778ba", selected: "#db61a2" },
  { id: "red", label: "Red", accent: "#ff7b72", selected: "#f85149" },
];

export interface ModePreset {
  id: ThemeMode;
  label: string;
  colorScheme: "dark" | "light";
  vars: Record<string, string>;
}

export const MODES: ModePreset[] = [
  {
    id: "dark",
    label: "Dark",
    colorScheme: "dark",
    vars: {
      "--bg": "#0d1117", "--panel": "#161b22", "--sidebar": "#13181e",
      "--panel-2": "#21262d", "--card-hover": "#30363d", "--border": "#30363d",
      "--text": "#c9d1d9", "--muted": "#8b949e",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    colorScheme: "dark",
    vars: {
      "--bg": "#010409", "--panel": "#0d1117", "--sidebar": "#010409",
      "--panel-2": "#161b22", "--card-hover": "#21262d", "--border": "#21262d",
      "--text": "#c9d1d9", "--muted": "#7d8590",
    },
  },
  {
    id: "light",
    label: "Light",
    colorScheme: "light",
    vars: {
      "--bg": "#ffffff", "--panel": "#f6f8fa", "--sidebar": "#f0f3f6",
      "--panel-2": "#ffffff", "--card-hover": "#eaeef2", "--border": "#d0d7de",
      "--text": "#1f2328", "--muted": "#656d76",
    },
  },
];

export interface ThemePrefs {
  mode: ThemeMode;
  accent: string;
}

export const DEFAULT_THEME: ThemePrefs = { mode: "dark", accent: "blue" };

/** Validate/repair arbitrary stored JSON into a known-good ThemePrefs, falling
 *  back to defaults for unknown mode/accent ids. */
export function coerceThemePrefs(raw: unknown): ThemePrefs {
  const r = (raw ?? {}) as Partial<ThemePrefs>;
  const mode = MODES.some((m) => m.id === r.mode) ? (r.mode as ThemeMode) : DEFAULT_THEME.mode;
  const accent = ACCENTS.some((a) => a.id === r.accent) ? (r.accent as string) : DEFAULT_THEME.accent;
  return { mode, accent };
}

export interface ResolvedTheme {
  vars: Record<string, string>;
  colorScheme: "dark" | "light";
}

/** The CSS variables (mode palette + accent overrides) to apply to :root, plus
 *  the matching `color-scheme`. Unknown ids fall back to the first preset. */
export function resolveTheme(prefs: ThemePrefs): ResolvedTheme {
  const mode = MODES.find((m) => m.id === prefs.mode) ?? MODES[0];
  const accent = ACCENTS.find((a) => a.id === prefs.accent) ?? ACCENTS[0];
  return {
    vars: { ...mode.vars, "--accent": accent.accent, "--selected": accent.selected },
    colorScheme: mode.colorScheme,
  };
}
