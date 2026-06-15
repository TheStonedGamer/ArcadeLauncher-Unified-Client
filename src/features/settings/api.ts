// Settings IPC wrappers.

import { call } from "../../lib/ipc";
import type { GeneralSettings } from "./types";

export function loadSettings(): Promise<GeneralSettings> {
  return call<GeneralSettings>("load_settings");
}

export function saveSettings(settings: GeneralSettings): Promise<void> {
  return call<void>("save_settings", { settings });
}
