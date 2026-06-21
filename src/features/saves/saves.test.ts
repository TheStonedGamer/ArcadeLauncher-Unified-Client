import { describe, it, expect } from "vitest";
import type { SaveVersion } from "./api";
import {
  DEFAULT_AUTO_SYNC,
  clampKeep,
  parseAutoSync,
  shouldAutoSync,
  shouldRunAutoSync,
  autoSyncPolicy,
  formatBytes,
  versionLabel,
  sortVersions,
  formatVersionTime,
} from "./saves";

const v = (id: string, createdAt: number, fileCount = 1, totalBytes = 1): SaveVersion => ({
  id,
  createdAt,
  fileCount,
  totalBytes,
});

describe("clampKeep", () => {
  it("bounds to [1,100] and truncates", () => {
    expect(clampKeep(0)).toBe(1);
    expect(clampKeep(1)).toBe(1);
    expect(clampKeep(10.7)).toBe(10);
    expect(clampKeep(500)).toBe(100);
  });
  it("falls back to default on non-finite", () => {
    expect(clampKeep(NaN)).toBe(DEFAULT_AUTO_SYNC.keepVersions);
    expect(clampKeep(Infinity)).toBe(DEFAULT_AUTO_SYNC.keepVersions);
  });
});

describe("parseAutoSync", () => {
  it("returns defaults for garbage", () => {
    expect(parseAutoSync(null)).toEqual(DEFAULT_AUTO_SYNC);
    expect(parseAutoSync("nope")).toEqual(DEFAULT_AUTO_SYNC);
    expect(parseAutoSync(42)).toEqual(DEFAULT_AUTO_SYNC);
  });
  it("merges per field and clamps keepVersions", () => {
    expect(parseAutoSync({ syncOnLaunch: false, keepVersions: 999 })).toEqual({
      syncOnLaunch: false,
      syncOnExit: true,
      keepVersions: 100,
    });
  });
  it("ignores wrong-typed fields", () => {
    expect(parseAutoSync({ syncOnExit: "yes", keepVersions: "5" })).toEqual(DEFAULT_AUTO_SYNC);
  });
});

describe("shouldAutoSync", () => {
  it("keys off the matching flag", () => {
    const s = { syncOnLaunch: true, syncOnExit: false, keepVersions: 10 };
    expect(shouldAutoSync(s, "launch")).toBe(true);
    expect(shouldAutoSync(s, "exit")).toBe(false);
  });
});

describe("shouldRunAutoSync", () => {
  const settings = { syncOnLaunch: true, syncOnExit: true, keepVersions: 10 };
  it("requires signed-in, server-backed, and the event toggle", () => {
    expect(shouldRunAutoSync({ signedIn: true, serverBacked: true, settings }, "launch")).toBe(true);
    expect(shouldRunAutoSync({ signedIn: true, serverBacked: true, settings }, "exit")).toBe(true);
  });
  it("is false when signed out", () => {
    expect(shouldRunAutoSync({ signedIn: false, serverBacked: true, settings }, "launch")).toBe(false);
  });
  it("is false for non-server-backed games", () => {
    expect(shouldRunAutoSync({ signedIn: true, serverBacked: false, settings }, "exit")).toBe(false);
  });
  it("respects the per-event toggle", () => {
    const off = { syncOnLaunch: false, syncOnExit: true, keepVersions: 10 };
    expect(shouldRunAutoSync({ signedIn: true, serverBacked: true, settings: off }, "launch")).toBe(false);
    expect(shouldRunAutoSync({ signedIn: true, serverBacked: true, settings: off }, "exit")).toBe(true);
  });
});

describe("autoSyncPolicy", () => {
  it("prefers remote before play and local after", () => {
    expect(autoSyncPolicy("launch")).toBe("preferRemote");
    expect(autoSyncPolicy("exit")).toBe("preferLocal");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });
});

describe("versionLabel", () => {
  it("pluralizes files and shows size", () => {
    expect(versionLabel(v("a", 1, 1, 1024))).toBe("1 file · 1 KB");
    expect(versionLabel(v("b", 1, 3, 2048))).toBe("3 files · 2 KB");
  });
});

describe("sortVersions", () => {
  it("newest first, stable on ties by id desc", () => {
    const out = sortVersions([v("a", 100), v("b", 300), v("c", 200)]);
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate input", () => {
    const input = [v("a", 100), v("b", 200)];
    sortVersions(input);
    expect(input.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("formatVersionTime", () => {
  it("renders a deterministic UTC label", () => {
    // 2026-06-20 19:40:00 UTC = 1781984400
    expect(formatVersionTime(1781984400)).toBe("2026-06-20 19:40 UTC");
  });
  it("zero-pads month/day/time", () => {
    // 2021-01-02 03:04:05 UTC = 1609556645
    expect(formatVersionTime(1609556645)).toBe("2021-01-02 03:04 UTC");
  });
  it("returns a dash for invalid input", () => {
    expect(formatVersionTime(0)).toBe("—");
    expect(formatVersionTime(NaN)).toBe("—");
    expect(formatVersionTime(-5)).toBe("—");
  });
});
