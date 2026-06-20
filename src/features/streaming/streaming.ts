// Pure, IO-free streaming-settings core. Mirrors the Rust `StreamSettings`
// (src-tauri/src/streaming/moonlight.rs) — same fields, same clamp bounds — so
// the UI validates locally and hands Moonlight a well-formed config. Keep the
// bounds in lockstep with the Rust `sanitized()`.

export type DisplayMode = "fullscreen" | "borderless" | "windowed";

export interface StreamSettings {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  displayMode: DisplayMode;
  hdr: boolean;
}

/** Safe defaults: 1080p60 @ 20 Mbps, fullscreen, SDR. */
export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateKbps: 20000,
  displayMode: "fullscreen",
  hdr: false,
};

/** The display modes, in UI order, with labels. */
export const DISPLAY_MODES: { value: DisplayMode; label: string }[] = [
  { value: "fullscreen", label: "Fullscreen" },
  { value: "borderless", label: "Borderless" },
  { value: "windowed", label: "Windowed" },
];

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  // ±Infinity falls through to the min/max below and lands on hi / lo.
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/** Clamp settings to the same bounds Rust enforces, so a bad form value can't
 *  produce a broken Moonlight command line. Pure. */
export function sanitizeSettings(s: StreamSettings): StreamSettings {
  return {
    width: clamp(s.width, 640, 7680),
    height: clamp(s.height, 480, 4320),
    fps: clamp(s.fps, 30, 240),
    bitrateKbps: clamp(s.bitrateKbps, 500, 150000),
    displayMode: s.displayMode,
    hdr: s.hdr,
  };
}

/** A 4-digit Sunshine PIN: exactly four ASCII digits. Mirrors Rust `is_valid_pin`. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/** Parse stored stream-quality defaults (e.g. from localStorage). Tolerates
 *  missing/garbage input by falling back to defaults, and always clamps the
 *  result so a tampered store can't yield a broken config. Pure. */
export function parseStoredSettings(raw: string | null | undefined): StreamSettings {
  if (!raw) return { ...DEFAULT_STREAM_SETTINGS };
  let parsed: Partial<StreamSettings>;
  try {
    parsed = JSON.parse(raw) as Partial<StreamSettings>;
  } catch {
    return { ...DEFAULT_STREAM_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_STREAM_SETTINGS };
  const mode = parsed.displayMode;
  return sanitizeSettings({
    width: Number(parsed.width ?? DEFAULT_STREAM_SETTINGS.width),
    height: Number(parsed.height ?? DEFAULT_STREAM_SETTINGS.height),
    fps: Number(parsed.fps ?? DEFAULT_STREAM_SETTINGS.fps),
    bitrateKbps: Number(parsed.bitrateKbps ?? DEFAULT_STREAM_SETTINGS.bitrateKbps),
    displayMode:
      mode === "fullscreen" || mode === "borderless" || mode === "windowed"
        ? mode
        : DEFAULT_STREAM_SETTINGS.displayMode,
    hdr: Boolean(parsed.hdr),
  });
}

/** Human-readable host state for the picker. */
export function hostStateLabel(state: string): string {
  switch (state) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    default:
      return "Unknown";
  }
}
