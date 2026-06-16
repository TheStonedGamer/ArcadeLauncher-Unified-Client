import { describe, expect, it } from "vitest";
import { applyProgress, applyStatus, initialDownloadState, type DownloadState } from "./reducer";
import { activeCount, formatBytes, formatSpeed, hasPending, percent, queueList } from "./selectors";
import type { DownloadItem } from "./types";

function item(p: Partial<DownloadItem> & { gameId: string }): DownloadItem {
  return {
    status: "downloading",
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    sampledAt: 0,
    sampledBytes: 0,
    ...p,
  };
}

function stateOf(items: DownloadItem[]): DownloadState {
  return { items: Object.fromEntries(items.map((i) => [i.gameId, i])) };
}

describe("download selectors", () => {
  it("percent clamps to [0,100] and handles zero total", () => {
    expect(percent(item({ gameId: "g", downloadedBytes: 0, totalBytes: 0 }))).toBe(0);
    expect(percent(item({ gameId: "g", downloadedBytes: 50, totalBytes: 200 }))).toBe(25);
    expect(percent(item({ gameId: "g", downloadedBytes: 999, totalBytes: 200 }))).toBe(100);
  });

  it("activeCount counts only transferring/verifying/extracting", () => {
    const s = stateOf([
      item({ gameId: "a", status: "downloading" }),
      item({ gameId: "b", status: "verifying" }),
      item({ gameId: "c", status: "extracting" }),
      item({ gameId: "d", status: "queued" }),
      item({ gameId: "e", status: "paused" }),
      item({ gameId: "f", status: "done" }),
    ]);
    expect(activeCount(s)).toBe(3);
    expect(hasPending(s)).toBe(true);
  });

  it("queueList orders pending → failed → done, then by id", () => {
    const s = stateOf([
      item({ gameId: "zeta", status: "done" }),
      item({ gameId: "alpha", status: "failed" }),
      item({ gameId: "beta", status: "downloading" }),
      item({ gameId: "gamma", status: "queued" }),
    ]);
    expect(queueList(s).map((i) => i.gameId)).toEqual(["beta", "gamma", "alpha", "zeta"]);
  });

  it("hasPending is false once everything is done/failed", () => {
    const s = stateOf([
      item({ gameId: "a", status: "done" }),
      item({ gameId: "b", status: "failed" }),
    ]);
    expect(hasPending(s)).toBe(false);
  });

  it("formatSpeed and formatBytes are human-readable", () => {
    expect(formatSpeed(0)).toBe("");
    expect(formatSpeed(512)).toBe("512 B/s");
    expect(formatSpeed(102_400)).toBe("100.0 KB/s");
    expect(formatSpeed(5 * 1024 * 1024)).toBe("5.0 MB/s");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("integrates with the reducer end-to-end", () => {
    let s = initialDownloadState;
    s = applyStatus(s, { gameId: "g", status: "queued" }, 0);
    s = applyProgress(s, { gameId: "g", status: "downloading", downloadedBytes: 256, totalBytes: 1024 }, 100);
    expect(activeCount(s)).toBe(1);
    expect(percent(s.items["g"])).toBe(25);
  });
});
