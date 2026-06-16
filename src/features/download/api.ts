// Typed IPC wrappers for the download commands (src-tauri/src/download/
// commands.rs). The install trigger (download_start) needs a manifest + session
// host/token, which the session/auth layer will supply (T4d-3); the queue
// controls below work against any active install the engine is running.

import { call } from "../../lib/ipc";

export function pauseDownload(gameId: string): Promise<void> {
  return call("download_pause", { gameId });
}

export function resumeDownload(gameId: string): Promise<void> {
  return call("download_resume", { gameId });
}

export function cancelDownload(gameId: string): Promise<void> {
  return call("download_cancel", { gameId });
}
