// Thin typed wrapper around Tauri's `invoke`. Every Rust command the app calls
// gets a single typed function here, so feature code never touches raw command
// names or `any`. Keeps the IPC surface auditable in one place.

import { invoke } from "@tauri-apps/api/core";

export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}
