// Big Picture window IPC. Toggling fullscreen is a Rust command so it works
// regardless of webview capability config. Best-effort in a plain browser.

import { call } from "../../lib/ipc";

export function setFullscreen(fullscreen: boolean): Promise<boolean> {
  return call<boolean>("set_fullscreen", { fullscreen });
}

export function isFullscreen(): Promise<boolean> {
  return call<boolean>("is_fullscreen");
}
