// Discord Rich Presence IPC. Both calls are best-effort: the Rust side reads the
// General settings to decide whether presence is enabled and which Discord app
// id to use, so the UI just announces launch/exit. Errors (no Discord running,
// feature off, plain browser) are swallowed — presence must never disrupt play.

import { call } from "../../lib/ipc";

/** Announce that `title` started playing now (best-effort, never throws). */
export async function setPlaying(title: string): Promise<void> {
  try {
    await call("presence_set_playing", {
      title,
      startedUnix: Math.floor(Date.now() / 1000),
    });
  } catch {
    /* presence is optional — ignore */
  }
}

/** Return to the idle "Browsing the library" status (best-effort). */
export async function setIdle(): Promise<void> {
  try {
    await call("presence_set_idle");
  } catch {
    /* presence is optional — ignore */
  }
}
