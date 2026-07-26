import { call } from "../../lib/ipc";

export interface AvailableUpdate {
  version: string;
  url: string;
}

export function checkAppUpdate(): Promise<AvailableUpdate | null> {
  return call<AvailableUpdate | null>("app_update_check", {});
}
