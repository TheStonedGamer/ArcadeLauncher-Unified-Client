import { call } from "../../lib/ipc";

export interface AvailableUpdate {
  version: string;
  url: string;
}

export function checkAppUpdate(): Promise<AvailableUpdate | null> {
  return call<AvailableUpdate | null>("app_update_check", {});
}

/** Spawn the bootstrap updater and exit the launcher. The updater handles
 *  downloading, verifying, installing, and relaunching the app. */
export function triggerAppUpdate(): Promise<void> {
  return call<void>("trigger_app_update", {});
}
