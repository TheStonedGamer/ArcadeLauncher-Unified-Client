// Typed IPC wrappers for the cloud-save commands (src-tauri/src/saves/
// commands.rs). The Rust side lists the server's saves, scans the per-user save
// folder, diffs them, and uploads/downloads as needed — all authed with the
// session token. The pure decision logic is unit-tested in Rust; these wrappers
// are the thin frontend seam.

import { call } from "../../lib/ipc";

/** Per-action counts for a would-be sync, for a pre-flight summary. */
export interface SyncSummary {
  upload: number;
  download: number;
  inSync: number;
  conflict: number;
}

/** What a completed sync did. `conflicts` lists paths left unresolved (only when
 *  the chosen policy was "skip"); `errors` lists per-file failures. */
export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
  errors: string[];
}

/** How to settle same-time/different-size conflicts. */
export type ConflictPolicy = "skip" | "preferLocal" | "preferRemote";

/** Preview the sync (no transfer): how many files would upload/download/conflict.
 *  `savePath` is the configured local save folder (blank → managed folder). */
export function planSaves(host: string, token: string, gameId: string, savePath = ""): Promise<SyncSummary> {
  return call("saves_plan", { host, token, gameId, savePath: savePath || null });
}

/** Run the sync. `policy` decides conflict handling (defaults to "skip");
 *  `savePath` is the configured local save folder (blank → managed folder). */
export function syncSaves(
  host: string,
  token: string,
  gameId: string,
  policy: ConflictPolicy = "skip",
  savePath = "",
): Promise<SyncReport> {
  return call("saves_sync", { host, token, gameId, policy, savePath: savePath || null });
}

/** One restorable snapshot of a game's save folder (version history, T12i). */
export interface SaveVersion {
  id: string;
  createdAt: number;
  fileCount: number;
  totalBytes: number;
}

/** List a game's restorable save snapshots, newest first. */
export function listSaveVersions(gameId: string): Promise<SaveVersion[]> {
  return call("saves_versions", { gameId });
}

/** Snapshot the current save folder into a new restorable version, pruning to
 *  the newest `keep` (default server-side). Returns the kept versions. */
export function snapshotSaves(gameId: string, savePath = "", keep?: number): Promise<SaveVersion[]> {
  return call("saves_snapshot", { gameId, keep: keep ?? null, savePath: savePath || null });
}

/** Restore a stored snapshot back into the live save folder (the current state
 *  is snapshotted first, so a restore is itself undoable). */
export function restoreSaveVersion(gameId: string, versionId: string, savePath = ""): Promise<boolean> {
  return call("saves_restore_version", { gameId, versionId, savePath: savePath || null });
}
