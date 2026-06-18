// Discord Rich Presence IPC. The calls are best-effort: the Rust side reads the
// `discordRichPresence` toggle to decide whether presence is enabled, while the
// Discord application id is supplied by the server (configureFromServer below).
// Errors (no Discord running, feature off, plain browser) are swallowed —
// presence must never disrupt play.

import { call } from "../../lib/ipc";

/** Shape of the public client config served by the server's /api/client-config. */
interface ClientConfig {
  discordAppId: string;
}

/** Fetch the public client config (currently the Discord app id) from the
 *  server. Anonymous endpoint; returns an empty app id when unset/unreachable. */
export async function getClientConfig(host: string): Promise<ClientConfig> {
  const base = host.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/client-config`);
  if (!res.ok) throw new Error(`client-config HTTP ${res.status}`);
  return (await res.json()) as ClientConfig;
}

/** Fetch the server's Discord app id and hand it to the Rust presence manager.
 *  Best-effort: on any failure presence simply stays disabled. */
export async function configureFromServer(host: string): Promise<void> {
  try {
    const { discordAppId } = await getClientConfig(host);
    await call("presence_configure", { appId: discordAppId });
  } catch {
    /* presence is optional — ignore */
  }
}

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
