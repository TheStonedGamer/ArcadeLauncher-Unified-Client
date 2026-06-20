// Pure cloud-save helpers (T12i). Auto-sync preferences and version-history
// display formatting live here as IO-free, unit-tested logic; the React hooks
// and the Rust commands plug in on top.

import type { SaveVersion } from "./api";

/** Per-device auto-sync preferences. */
export interface AutoSyncSettings {
  /** Pull the latest cloud save before a game launches. */
  syncOnLaunch: boolean;
  /** Snapshot + push the local save when a game exits. */
  syncOnExit: boolean;
  /** How many restorable versions to keep per game. */
  keepVersions: number;
}

export const DEFAULT_AUTO_SYNC: AutoSyncSettings = {
  syncOnLaunch: true,
  syncOnExit: true,
  keepVersions: 10,
};

/** Clamp a requested retention count to the same [1,100] range Rust enforces. */
export function clampKeep(keep: number): number {
  if (!Number.isFinite(keep)) return DEFAULT_AUTO_SYNC.keepVersions;
  return Math.min(100, Math.max(1, Math.trunc(keep)));
}

/** Tolerant parse of stored auto-sync settings (any field may be missing or
 *  malformed); unknown input falls back to defaults field by field. */
export function parseAutoSync(raw: unknown): AutoSyncSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    syncOnLaunch: typeof o.syncOnLaunch === "boolean" ? o.syncOnLaunch : DEFAULT_AUTO_SYNC.syncOnLaunch,
    syncOnExit: typeof o.syncOnExit === "boolean" ? o.syncOnExit : DEFAULT_AUTO_SYNC.syncOnExit,
    keepVersions: typeof o.keepVersions === "number" ? clampKeep(o.keepVersions) : DEFAULT_AUTO_SYNC.keepVersions,
  };
}

/** Whether a given lifecycle event should trigger an auto-sync. */
export function shouldAutoSync(settings: AutoSyncSettings, event: "launch" | "exit"): boolean {
  return event === "launch" ? settings.syncOnLaunch : settings.syncOnExit;
}

/** Human-readable byte size for a version's footprint. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** One-line label for a save version in the history list. */
export function versionLabel(v: SaveVersion): string {
  const files = `${v.fileCount} file${v.fileCount === 1 ? "" : "s"}`;
  return `${files} · ${formatBytes(v.totalBytes)}`;
}

/** Sort a version list newest-first (defensive — the backend already does, but
 *  the UI shouldn't assume order). */
export function sortVersions(versions: SaveVersion[]): SaveVersion[] {
  return [...versions].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
