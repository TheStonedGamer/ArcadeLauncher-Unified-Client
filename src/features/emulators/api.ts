// Emulator runtime staging. The server hosts emulator runtimes; the client
// mirrors them locally and reports which are "ready" (fully present on disk).

import { call } from "../../lib/ipc";

export interface EmulatorStatus {
  id: string;
  name: string;
  /** "emulator" or "firmware". */
  kind: string;
  totalBytes: number;
  fileCount: number;
  /** All files present locally with a matching size. */
  ready: boolean;
  /** Bytes already staged locally. */
  localBytes: number;
}

/** Live download progress for an emulator being staged. */
export interface EmulatorProgress {
  id: string;
  downloadedBytes: number;
  totalBytes: number;
  done: boolean;
  error: string | null;
}

export async function listEmulators(host: string, token: string): Promise<EmulatorStatus[]> {
  return call<EmulatorStatus[]>("list_emulators", { host, token });
}

export async function downloadEmulator(host: string, token: string, id: string): Promise<void> {
  return call("download_emulator", { host, token, id });
}
