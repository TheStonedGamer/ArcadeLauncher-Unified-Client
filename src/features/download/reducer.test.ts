import { describe, expect, it } from "vitest";
import {
  applyProgress,
  applyStatus,
  clearCompleted,
  initialDownloadState,
  removeItem,
  type DownloadState,
} from "./reducer";
import type { ProgressEvent, StatusEvent } from "./types";

function progress(p: Partial<ProgressEvent> & { gameId: string }): ProgressEvent {
  return { status: "downloading", downloadedBytes: 0, totalBytes: 1000, ...p };
}

describe("download reducer", () => {
  it("creates an item from the first progress sample", () => {
    const s = applyProgress(initialDownloadState, progress({ gameId: "g", downloadedBytes: 100 }), 1000);
    const it = s.items["g"];
    expect(it.status).toBe("downloading");
    expect(it.downloadedBytes).toBe(100);
    expect(it.totalBytes).toBe(1000);
  });

  it("estimates speed from the byte delta between samples", () => {
    let s = applyProgress(initialDownloadState, progress({ gameId: "g", downloadedBytes: 0 }), 0);
    // 100 KB transferred over 1s → ~100 KB/s on the first (un-smoothed) sample.
    s = applyProgress(s, progress({ gameId: "g", downloadedBytes: 102_400 }), 1000);
    expect(s.items["g"].speedBps).toBeCloseTo(102_400, 0);
  });

  it("does not divide by zero when two samples share a timestamp", () => {
    let s = applyProgress(initialDownloadState, progress({ gameId: "g", downloadedBytes: 10 }), 500);
    s = applyProgress(s, progress({ gameId: "g", downloadedBytes: 20 }), 500);
    expect(Number.isFinite(s.items["g"].speedBps)).toBe(true);
  });

  it("zeroes speed when a status sample is not downloading", () => {
    let s = applyProgress(initialDownloadState, progress({ gameId: "g", downloadedBytes: 50 }), 0);
    s = applyProgress(s, progress({ gameId: "g", status: "verifying", downloadedBytes: 1000 }), 1000);
    expect(s.items["g"].speedBps).toBe(0);
    expect(s.items["g"].status).toBe("verifying");
  });

  it("records an error on failed status and clears it otherwise", () => {
    const fail: StatusEvent = { gameId: "g", status: "failed", error: "sha256 mismatch" };
    let s = applyStatus(initialDownloadState, fail, 0);
    expect(s.items["g"].status).toBe("failed");
    expect(s.items["g"].error).toBe("sha256 mismatch");
    s = applyStatus(s, { gameId: "g", status: "queued" }, 1);
    expect(s.items["g"].error).toBeUndefined();
  });

  it("preserves totalBytes when a status event omits it", () => {
    let s = applyProgress(initialDownloadState, progress({ gameId: "g", totalBytes: 4096 }), 0);
    s = applyStatus(s, { gameId: "g", status: "paused" }, 1);
    expect(s.items["g"].totalBytes).toBe(4096);
    expect(s.items["g"].status).toBe("paused");
    expect(s.items["g"].speedBps).toBe(0);
  });

  it("removeItem and clearCompleted prune as expected", () => {
    let s: DownloadState = initialDownloadState;
    s = applyStatus(s, { gameId: "a", status: "done" }, 0);
    s = applyStatus(s, { gameId: "b", status: "downloading" }, 0);
    s = clearCompleted(s);
    expect(s.items["a"]).toBeUndefined();
    expect(s.items["b"]).toBeDefined();
    s = removeItem(s, "b");
    expect(s.items["b"]).toBeUndefined();
    // Idempotent on a missing id.
    expect(removeItem(s, "missing")).toBe(s);
  });
});
