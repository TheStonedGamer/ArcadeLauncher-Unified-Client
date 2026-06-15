// Transport seam between the social reducer and the world. T3a defines the
// interface and ships a no-op gateway so the UI is fully wired and testable
// without a live server; T3b implements the real Tauri-backed WebSocket/REST
// gateway behind this same interface, and nothing in the UI or reducer changes.

import type { Inbound } from "./protocol";
import type { Friend } from "./types";

export type GatewayState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface Gateway {
  /** Open the gateway. Frames arrive via `onFrame`; lifecycle via `onState`. */
  connect(): void;
  /** Send a raw outbound frame string (built by `protocol.outbound`). */
  send(frame: string): void;
  /** Pull the authoritative friend list (REST `/api/social/friends`). */
  fetchFriends(): Promise<Friend[]>;
  disconnect(): void;
  onFrame(cb: (msg: Inbound) => void): void;
  onState(cb: (state: GatewayState) => void): void;
}

/**
 * Disconnected placeholder gateway. Reports `disconnected`, sends nothing,
 * returns no friends. Lets the social UI mount and render its empty/offline
 * states before the real transport exists (T3b).
 */
export class NullGateway implements Gateway {
  private stateCb: (s: GatewayState) => void = () => {};

  connect(): void {
    this.stateCb("disconnected");
  }
  send(): void {
    // No transport yet; outbound frames are dropped (see T3b).
  }
  async fetchFriends(): Promise<Friend[]> {
    return [];
  }
  disconnect(): void {}
  onFrame(): void {}
  onState(cb: (s: GatewayState) => void): void {
    this.stateCb = cb;
  }
}
