// Local storefront integration (Steam, Epic). Scans each launcher's on-disk
// install manifests via Rust and launches games through their protocol handler.
// No account login — these only read what's already installed on the PC.

import { call } from "../../lib/ipc";

export type StoreSource = "steam" | "epic";

export interface StoreGame {
  /** Steam appid, or Epic AppName. */
  id: string;
  name: string;
  installDir: string;
  /** Protocol URI that launches the game via its storefront. */
  launchUri: string;
  source: StoreSource;
  /** Best-effort cover art URL (Steam CDN); empty when unavailable. */
  coverUrl: string;
  /** Fallback art URL tried if coverUrl 404s (Steam header image). */
  fallbackUrl: string;
}

export async function scanStore(source: StoreSource): Promise<StoreGame[]> {
  return call<StoreGame[]>(source === "steam" ? "scan_steam" : "scan_epic");
}

/** Launch an installed game via its storefront protocol handler. */
export async function launchStoreGame(uri: string): Promise<void> {
  return call("launch_store_uri", { uri });
}
