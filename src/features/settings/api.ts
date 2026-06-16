// Settings IPC wrappers.

import { call } from "../../lib/ipc";
import type { GeneralSettings } from "./types";

export function loadSettings(): Promise<GeneralSettings> {
  return call<GeneralSettings>("load_settings");
}

export function saveSettings(settings: GeneralSettings): Promise<void> {
  return call<void>("save_settings", { settings });
}

/** Re-register the global summon/hide hotkey live (after a settings change).
 *  Resolves to nothing; rejects with a message for an invalid accelerator. */
export function applyHotkey(enabled: boolean, accelerator: string): Promise<void> {
  return call<void>("hotkey_apply", { enabled, accelerator });
}
