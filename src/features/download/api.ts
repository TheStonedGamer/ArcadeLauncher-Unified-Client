// Typed IPC wrappers for the download commands (src-tauri/src/download/
// commands.rs). `installGame` is the high-level trigger: the Rust side fetches
// the manifest with the session token, resolves the per-user install dir, and
// runs the engine. The queue controls below work against any active install.

import { call } from "../../lib/ipc";
import type { InstallStateMap } from "./installState";

/** Load the client-local install records as a `gameId → installState` overlay,
 *  so the catalog can reflect what's on disk without reloading library.json. */
export function loadInstallRecords(): Promise<InstallStateMap> {
  return call<InstallStateMap>("load_install_records");
}

/** Start installing a game using the signed-in session's host + token. Progress
 *  arrives via the `download://progress`/`status` events the Downloads tab listens
 *  to. Rejects if the manifest fetch fails (e.g. not signed in / not found). */
export function installGame(host: string, token: string, gameId: string): Promise<void> {
  return call("download_install", { host, token, gameId });
}

/** Validate & repair an installed game (the card right-click "Verify files"
 *  action). Re-checks every manifest file already on disk by size + SHA-256 and
 *  re-downloads only the missing/corrupt ones. Same progress/status events as a
 *  normal install. Rejects if the manifest fetch fails. */
export function verifyGame(host: string, token: string, gameId: string): Promise<void> {
  return call("download_verify", { host, token, gameId });
}

/** Check installed games for available updates against the server's current
 *  manifest versions, flipping records to `updateAvailable`/`installed`. Returns
 *  the refreshed overlay so the catalog reflects updates without a reload. */
export function checkUpdates(host: string, token: string): Promise<InstallStateMap> {
  return call<InstallStateMap>("check_updates", { host, token });
}

/** Apply an available update by re-pulling only the changed files. This is the
 *  same engine pass as `verifyGame` (re-hash on-disk files vs the new manifest,
 *  download mismatches), which finalizes the record at the new version — clearing
 *  the `updateAvailable` flag. Same progress/status events as a normal install. */
export function updateGame(host: string, token: string, gameId: string): Promise<void> {
  return call("download_verify", { host, token, gameId });
}

export function pauseDownload(gameId: string): Promise<void> {
  return call("download_pause", { gameId });
}

export function resumeDownload(gameId: string): Promise<void> {
  return call("download_resume", { gameId });
}

export function cancelDownload(gameId: string): Promise<void> {
  return call("download_cancel", { gameId });
}
