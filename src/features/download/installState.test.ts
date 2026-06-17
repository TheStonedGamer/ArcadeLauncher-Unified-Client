import { describe, expect, it } from "vitest";
import {
  applyInstallStatus,
  effectiveInstallState,
  isInstalled,
  mapDownloadStatus,
  type InstallStateMap,
} from "./installState";
import type { DownloadStatus } from "./types";

describe("mapDownloadStatus", () => {
  it("collapses in-flight phases to installing", () => {
    for (const s of ["queued", "downloading", "verifying", "extracting"] as DownloadStatus[]) {
      expect(mapDownloadStatus(s)).toBe("installing");
    }
  });
  it("maps terminal states to catalog vocabulary", () => {
    expect(mapDownloadStatus("done")).toBe("installed");
    expect(mapDownloadStatus("failed")).toBe("failed");
    expect(mapDownloadStatus("paused")).toBe("paused");
  });
});

describe("applyInstallStatus", () => {
  it("adds a new entry without mutating the input", () => {
    const base: InstallStateMap = { halo: "installed" };
    const next = applyInstallStatus(base, { gameId: "doom", status: "downloading" });
    expect(next).toEqual({ halo: "installed", doom: "installing" });
    expect(base).toEqual({ halo: "installed" });
  });
  it("overwrites an existing entry as the install progresses", () => {
    let m: InstallStateMap = {};
    m = applyInstallStatus(m, { gameId: "doom", status: "downloading" });
    expect(m.doom).toBe("installing");
    m = applyInstallStatus(m, { gameId: "doom", status: "done" });
    expect(m.doom).toBe("installed");
  });
});

describe("effectiveInstallState", () => {
  it("prefers the overlay over the catalog value", () => {
    expect(effectiveInstallState("doom", "notInstalled", { doom: "installing" })).toBe("installing");
  });
  it("falls back to the catalog value, then to notInstalled", () => {
    expect(effectiveInstallState("doom", "installed", {})).toBe("installed");
    expect(effectiveInstallState("doom", "", {})).toBe("notInstalled");
  });
});

describe("isInstalled", () => {
  it("treats installed and updateAvailable as on-disk", () => {
    expect(isInstalled("installed")).toBe(true);
    expect(isInstalled("updateAvailable")).toBe(true);
    expect(isInstalled("installing")).toBe(false);
    expect(isInstalled("notInstalled")).toBe(false);
  });
});
