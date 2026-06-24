// Pure, IO-free streaming-settings core. Mirrors the Rust `StreamSettings`
// (src-tauri/src/streaming/settings.rs) — same fields, same clamp bounds — so
// the UI validates locally and hands the stream engine a well-formed config. Keep
// the bounds in lockstep with the Rust `sanitized()`.

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

/** Whether a failed Play / stream-start was rejected because the engine has no
 *  pairing for the host. The engine surfaces the code in the error string as
 *  `"… (not_paired)"` (Rust `IpcError` Display is `"{message} ({code})"`); we also
 *  tolerate the plain "not paired" phrasing. Lets the My PCs Play turn a dead,
 *  window-flashing failure into an actionable "pair this PC first" prompt. Pure. */
export function isNotPairedError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("(not_paired)") || m.includes("not paired");
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

/** The minimal scanned-storefront game shape the host-sync mapping needs (subset
 *  of the stores feature's `StoreGame`), so this core stays feature-free. */
export interface StoreGameLike {
  id: string;
  name: string;
  /** Protocol URI that launches via the storefront (steam:// , com.epicgames.launcher:// ). */
  launchUri: string;
  coverUrl: string;
  /** "steam" | "epic" — namespaces the id so it can't collide with a catalog game. */
  source: string;
}

/** Map an auto-detected Steam/Epic game to the engine `host.syncApps` app shape. The launch command
 *  is the storefront URI; the engine wraps it in the host OS opener so Sunshine can run it (a bare
 *  URI isn't executable). The id is namespaced by source so it stays distinct from catalog games.
 *  Pure. */
export function storeGameToHostGame(g: StoreGameLike): ReturnType<typeof toHostGame> {
  return {
    id: `${g.source}:${g.id}`,
    name: g.name,
    coverPath: g.coverUrl,
    launchCmd: g.launchUri.trim(),
  };
}

/** Detected storefront games (already filtered to installed by the scan) mapped to host apps.
 *  Drops any with no launch URI. Pure. */
export function storeGamesToHostGames(
  games: StoreGameLike[],
): ReturnType<typeof toHostGame>[] {
  return games.filter((g) => g.launchUri.trim() !== "").map(storeGameToHostGame);
}

/** One-line summary of this PC's hosting status for the settings UI. Pure. */
export function hostStatusSummary(s: {
  installed: boolean;
  running: boolean;
  configured: boolean;
  gpuCapable: boolean;
  appsCount: number;
  /** True only when the launcher itself started the host. `running && !managed` ⇒ we adopted a
   *  Sunshine the user already had running, which we report but never stop. */
  managed?: boolean;
}): string {
  if (!s.installed) return "Streaming host not installed on this PC.";
  if (!s.gpuCapable) return "This PC's GPU can't encode a stream.";
  const adopted = s.running && s.managed === false;
  const state = adopted
    ? "Hosting — using the Sunshine already running on this PC"
    : s.running
      ? "Hosting — this PC can be streamed"
      : "Installed, not hosting";
  return `${state} · ${s.appsCount} game${s.appsCount === 1 ? "" : "s"} published`;
}

/** Whether the app-root cert pre-authorization upkeep should act for THIS PC this beat.
 *  Pure so the guard is unit-tested apart from the IPC it drives.
 *
 *  The host whose server cert we must publish is the one that's *hosting* (`running`). It needs
 *  publishing precisely when hosting came up WITHOUT the cert dance — i.e. the v0.13.6 boot
 *  auto-restore path, which enables Sunshine in Rust and never runs `publishHostServerCert`. We
 *  retry every heartbeat until it lands (Sunshine mints its cert.pem a little after start), then
 *  stop once `alreadyPublished`. Not hosting ⇒ nothing to publish. */
export function hostPreauthAction(
  status: { running: boolean } | null | undefined,
  alreadyPublished: boolean,
): "skip" | "run" {
  if (alreadyPublished) return "skip";
  if (!status?.running) return "skip";
  return "run";
}
