import { describe, it, expect } from "vitest";
import { resolveTheme, coerceThemePrefs, DEFAULT_THEME, ACCENTS, MODES } from "./theme";

describe("resolveTheme", () => {
  it("applies the dark palette and blue accent by default", () => {
    const { vars, colorScheme } = resolveTheme(DEFAULT_THEME);
    expect(colorScheme).toBe("dark");
    expect(vars["--bg"]).toBe("#0d1117");
    expect(vars["--accent"]).toBe("#58a6ff");
    expect(vars["--selected"]).toBe("#388bfd");
  });

  it("overrides accent vars while keeping the mode palette", () => {
    const { vars } = resolveTheme({ mode: "light", accent: "green" });
    expect(vars["--bg"]).toBe("#ffffff"); // light palette
    expect(vars["--accent"]).toBe("#3fb950"); // green accent
  });

  it("reports the matching color-scheme for light mode", () => {
    expect(resolveTheme({ mode: "light", accent: "blue" }).colorScheme).toBe("light");
  });

  it("falls back to the first preset for unknown ids", () => {
    const { vars, colorScheme } = resolveTheme({ mode: "bogus" as never, accent: "bogus" });
    expect(colorScheme).toBe(MODES[0].colorScheme);
    expect(vars["--accent"]).toBe(ACCENTS[0].accent);
  });
});

describe("coerceThemePrefs", () => {
  it("passes through valid prefs", () => {
    expect(coerceThemePrefs({ mode: "midnight", accent: "purple" })).toEqual({
      mode: "midnight",
      accent: "purple",
    });
  });

  it("repairs garbage to defaults", () => {
    expect(coerceThemePrefs(null)).toEqual(DEFAULT_THEME);
    expect(coerceThemePrefs({ mode: "x", accent: 7 })).toEqual(DEFAULT_THEME);
    expect(coerceThemePrefs("nope")).toEqual(DEFAULT_THEME);
  });

  it("keeps a valid field even when the other is bad", () => {
    expect(coerceThemePrefs({ mode: "light", accent: "nope" })).toEqual({
      mode: "light",
      accent: DEFAULT_THEME.accent,
    });
  });
});
