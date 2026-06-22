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

// ---- In-engine playback state (engine `stream.state` events) ----------------
// The engine streams in its own window and reports progress as `stream://state`
// Tauri events carrying a raw `{phase, reason?}` payload. This pure core parses
// that payload and maps a phase to UI text + the "is the stream over" decision,
// kept in lockstep with the Rust `play::is_terminal_phase`.

/** A streaming phase the engine reports. Unknown strings are kept verbatim so a
 *  future engine phase still round-trips (and is treated as non-terminal). */
export type StreamPhase = string;

/** A parsed `stream.state` payload. */
export interface StreamState {
  phase: StreamPhase;
  /** Optional detail (e.g. an error reason); empty when absent. */
  reason: string;
}

/** Parse a raw engine `stream.state` payload (the Tauri event body). Tolerates
 *  missing/garbage input — a non-object or absent phase yields an empty phase.
 *  Pure. */
export function parseStreamState(raw: unknown): StreamState {
  if (typeof raw !== "object" || raw === null) return { phase: "", reason: "" };
  const o = raw as Record<string, unknown>;
  return {
    phase: typeof o.phase === "string" ? o.phase : "",
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

/** Whether a phase means the stream is over — the UI returns to idle. Mirrors the
 *  Rust `play::is_terminal_phase` (`ended`/`error`); unknown phases are NOT
 *  terminal so an unmodeled intermediate phase can't end the stream early. Pure. */
export function isStreamTerminal(phase: StreamPhase): boolean {
  return phase === "ended" || phase === "error";
}

/** Human-readable status text for a streaming phase, for the detail panel. Pure. */
export function streamPhaseLabel(state: StreamState): string {
  switch (state.phase) {
    case "connecting":
      return "Connecting to host…";
    case "window":
      return "Opening stream…";
    case "streaming":
      return "Streaming ✓";
    case "paused":
      return "Stream paused";
    case "ended":
      return "Stream ended";
    case "error":
      return state.reason ? `Stream error: ${state.reason}` : "Stream error";
    case "":
      return "Starting stream…";
    default:
      return `Stream: ${state.phase}`;
  }
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

// ---- Host mode: publishing the local library to the engine host -------------

/** The minimal library-game shape the host-sync mapping needs (subset of the
 *  catalog `Game`), so this core stays free of the catalog feature. */
export interface LibraryGameLike {
  id: string;
  title: string;
  installState: string;
  coverArtPath: string;
  exePath: string;
  launchUri: string;
}

/** A game is worth publishing to a host only when it's actually present on this
 *  machine — "installed" or "updateAvailable" (an update-available game still
 *  runs); "notInstalled" games are skipped. Pure. Mirrors the catalog's
 *  installed predicate. */
export function isHostableGame(g: { installState: string }): boolean {
  return g.installState === "installed" || g.installState === "updateAvailable";
}

/** Map a library game to the engine `host.syncApps` app shape. The host launch
 *  command prefers the native exe, falling back to the launch URI; the engine
 *  resolves the real host-side launch. Pure. */
export function toHostGame(g: LibraryGameLike): {
  id: string;
  name: string;
  coverPath: string;
  launchCmd: string;
} {
  return {
    id: g.id,
    name: g.title,
    coverPath: g.coverArtPath,
    launchCmd: (g.exePath || g.launchUri || "").trim(),
  };
}

/** The installed games mapped to host apps, ready for `host.syncApps`. Pure. */
export function hostGamesFromLibrary(games: LibraryGameLike[]): ReturnType<typeof toHostGame>[] {
  return games.filter(isHostableGame).map(toHostGame);
}

/** One-line summary of this PC's hosting status for the settings UI. Pure. */
export function hostStatusSummary(s: {
  installed: boolean;
  running: boolean;
  configured: boolean;
  gpuCapable: boolean;
  appsCount: number;
}): string {
  if (!s.installed) return "Streaming host not installed on this PC.";
  if (!s.gpuCapable) return "This PC's GPU can't encode a stream.";
  const state = s.running ? "Hosting — this PC can be streamed" : "Installed, not hosting";
  return `${state} · ${s.appsCount} game${s.appsCount === 1 ? "" : "s"} published`;
}
