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

/** Preview the sync (no transfer): how many files would upload/download/conflict. */
export function planSaves(host: string, token: string, gameId: string): Promise<SyncSummary> {
  return call("saves_plan", { host, token, gameId });
}

/** Run the sync. `policy` decides conflict handling (defaults to "skip"). */
export function syncSaves(
  host: string,
  token: string,
  gameId: string,
  policy: ConflictPolicy = "skip",
): Promise<SyncReport> {
  return call("saves_sync", { host, token, gameId, policy });
}
