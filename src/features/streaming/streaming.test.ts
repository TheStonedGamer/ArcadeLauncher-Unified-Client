import { describe, expect, it } from "vitest";
import {
  DEFAULT_STREAM_SETTINGS,
  DISPLAY_MODES,
  hostGamesFromLibrary,
  hostStateLabel,
  hostStatusSummary,
  isHostableGame,
  isValidPin,
  parseStoredSettings,
  sanitizeSettings,
  toHostGame,
  type LibraryGameLike,
  type StreamSettings,
} from "./streaming";

describe("sanitizeSettings", () => {
  it("passes valid settings through unchanged", () => {
    expect(sanitizeSettings(DEFAULT_STREAM_SETTINGS)).toEqual(DEFAULT_STREAM_SETTINGS);
  });

  it("clamps out-of-range numeric fields to the Rust bounds", () => {
    const bad: StreamSettings = {
      width: 0,
      height: 99999,
      fps: 5,
      bitrateKbps: 10,
      displayMode: "windowed",
      hdr: true,
    };
    const s = sanitizeSettings(bad);
    expect(s.width).toBe(640);
    expect(s.height).toBe(4320);
    expect(s.fps).toBe(30);
    expect(s.bitrateKbps).toBe(500);
    // Non-numeric fields pass through.
    expect(s.displayMode).toBe("windowed");
    expect(s.hdr).toBe(true);
  });

  it("clamps above-max numeric fields", () => {
    const s = sanitizeSettings({
      width: 999999,
      height: 999999,
      fps: 999,
      bitrateKbps: 999999,
      displayMode: "fullscreen",
      hdr: false,
    });
    expect(s.width).toBe(7680);
    expect(s.height).toBe(4320);
    expect(s.fps).toBe(240);
    expect(s.bitrateKbps).toBe(150000);
  });

  it("coerces non-finite / fractional values", () => {
    const s = sanitizeSettings({
      width: NaN,
      height: 1080.9,
      fps: Infinity,
      bitrateKbps: 20000.5,
      displayMode: "borderless",
      hdr: false,
    });
    expect(s.width).toBe(640); // NaN -> lower bound
    expect(s.height).toBe(1080); // truncated, in range
    expect(s.fps).toBe(240); // Infinity -> upper bound
    expect(s.bitrateKbps).toBe(20000); // truncated
  });
});

describe("isValidPin", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("1234")).toBe(true);
  });

  it("rejects wrong length or non-digits", () => {
    expect(isValidPin("")).toBe(false);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin(" 1234")).toBe(false);
  });
});

describe("hostStateLabel", () => {
  it("maps known states and falls back to Unknown", () => {
    expect(hostStateLabel("online")).toBe("Online");
    expect(hostStateLabel("offline")).toBe("Offline");
    expect(hostStateLabel("unknown")).toBe("Unknown");
    expect(hostStateLabel("garbage")).toBe("Unknown");
  });
});

describe("parseStoredSettings", () => {
  it("returns defaults for null/empty/garbage", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(parseStoredSettings("")).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(parseStoredSettings("{not json")).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(parseStoredSettings("123")).toEqual(DEFAULT_STREAM_SETTINGS);
    expect(parseStoredSettings("null")).toEqual(DEFAULT_STREAM_SETTINGS);
  });

  it("round-trips and clamps stored settings", () => {
    const stored: StreamSettings = {
      width: 2560,
      height: 1440,
      fps: 120,
      bitrateKbps: 40000,
      displayMode: "borderless",
      hdr: true,
    };
    expect(parseStoredSettings(JSON.stringify(stored))).toEqual(stored);
    // Out-of-range values in the store are clamped on read.
    expect(parseStoredSettings(JSON.stringify({ ...stored, width: 1 })).width).toBe(640);
  });

  it("falls back per-field for missing or bad displayMode", () => {
    const s = parseStoredSettings(JSON.stringify({ width: 1280, height: 720 }));
    expect(s.width).toBe(1280);
    expect(s.height).toBe(720);
    expect(s.fps).toBe(DEFAULT_STREAM_SETTINGS.fps);
    expect(s.displayMode).toBe("fullscreen");
    const bad = parseStoredSettings(JSON.stringify({ displayMode: "tiny" }));
    expect(bad.displayMode).toBe("fullscreen");
  });
});

describe("DISPLAY_MODES", () => {
  it("covers all three modes in order", () => {
    expect(DISPLAY_MODES.map((m) => m.value)).toEqual(["fullscreen", "borderless", "windowed"]);
  });
});

describe("host-mode library publishing", () => {
  const mk = (over: Partial<LibraryGameLike>): LibraryGameLike => ({
    id: "g1",
    title: "Game One",
    installState: "installed",
    coverArtPath: "C:/covers/g1.png",
    exePath: "C:/games/g1.exe",
    launchUri: "",
    ...over,
  });

  it("treats installed + updateAvailable as hostable, skips notInstalled", () => {
    expect(isHostableGame({ installState: "installed" })).toBe(true);
    expect(isHostableGame({ installState: "updateAvailable" })).toBe(true);
    expect(isHostableGame({ installState: "notInstalled" })).toBe(false);
  });

  it("maps a game to the host app shape, preferring exe over launchUri", () => {
    expect(toHostGame(mk({}))).toEqual({
      id: "g1",
      name: "Game One",
      coverPath: "C:/covers/g1.png",
      launchCmd: "C:/games/g1.exe",
    });
    expect(toHostGame(mk({ exePath: "", launchUri: "steam://run/1" })).launchCmd).toBe(
      "steam://run/1",
    );
  });

  it("publishes only hostable games", () => {
    const games = [
      mk({ id: "a", installState: "installed" }),
      mk({ id: "b", installState: "notInstalled" }),
      mk({ id: "c", installState: "updateAvailable" }),
    ];
    expect(hostGamesFromLibrary(games).map((g) => g.id)).toEqual(["a", "c"]);
  });
});

describe("hostStatusSummary", () => {
  const base = { installed: true, running: false, configured: true, gpuCapable: true, appsCount: 0 };
  it("flags a missing host install", () => {
    expect(hostStatusSummary({ ...base, installed: false })).toMatch(/not installed/i);
  });
  it("flags a GPU that can't encode", () => {
    expect(hostStatusSummary({ ...base, gpuCapable: false })).toMatch(/GPU/);
  });
  it("reports running state and pluralizes the app count", () => {
    expect(hostStatusSummary({ ...base, running: true, appsCount: 1 })).toMatch(
      /Hosting.*1 game published/,
    );
    expect(hostStatusSummary({ ...base, running: false, appsCount: 3 })).toMatch(
      /not hosting.*3 games published/i,
    );
  });
});
