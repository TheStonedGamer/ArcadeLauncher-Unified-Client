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

/** Read-only firmware/BIOS deployment status for one console. */
export interface FirmwareStatus {
  /** Console label, e.g. "PlayStation 2". */
  console: string;
  /** Target emulator, e.g. "PCSX2". */
  emulator: string;
  /** The emulator runtime is unpacked locally. */
  installed: boolean;
  /** The firmware/BIOS blob is staged in the emulators data dir. */
  staged: boolean;
  /** The firmware/BIOS is deployed into the emulator and its config points at it. */
  deployed: boolean;
  /** Human-readable one-line summary of the current state. */
  detail: string;
}

/** Per-console firmware deployment status (whether the BIOS is actually usable). */
export async function firmwareStatus(): Promise<FirmwareStatus[]> {
  return call<FirmwareStatus[]>("firmware_status", {});
}

export async function listEmulators(host: string, token: string): Promise<EmulatorStatus[]> {
  return call<EmulatorStatus[]>("list_emulators", { host, token });
}

export async function downloadEmulator(host: string, token: string, id: string): Promise<void> {
  return call("download_emulator", { host, token, id });
}

/** Stage every emulator/firmware not already present locally. */
export async function downloadAllEmulators(host: string, token: string): Promise<void> {
  return call("download_all_emulators", { host, token });
}
