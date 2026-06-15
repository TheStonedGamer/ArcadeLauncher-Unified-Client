// The live social gateway: a thin Gateway implementation over the Rust
// transport (src-tauri/src/social/transport.rs). It carries no protocol logic —
// the Rust engine owns the socket, heartbeat, reconnect/backoff and resume, and
// forwards inbound text frames + lifecycle as Tauri events. This class invokes
// the connect/send/disconnect commands and re-emits the events through the same
// Gateway interface the reducer already consumes, so the UI is identical whether
// it runs on NullGateway, DemoGateway, or this.
//
// Inbound frames are parsed with the same tested `parseInbound` the demo path
// uses, so the wire contract has a single source of truth on the TS side.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "../../lib/ipc";
import type { Gateway, GatewayState } from "./gateway";
import { parseInbound, type Inbound } from "./protocol";
import type { Friend, Presence, Relation } from "./types";
import { presenceFromWire, relationFromWire } from "./types";

const STATE_EVENT = "social://state";
const FRAME_EVENT = "social://frame";

/** The wire shape of one friend from REST `/api/social/friends` (camelCase from
 *  the Rust `model::Friend`); client-local prefs are filled in below. */
interface WireFriend {
  accountId: number;
  username: string;
  presence: string;
  relation: string;
  currentGameId: string;
  currentGameTitle: string;
  lastOnline: number;
}

function toFriend(w: WireFriend): Friend {
  return {
    accountId: w.accountId,
    username: w.username,
    presence: presenceFromWire(w.presence) as Presence,
    relation: relationFromWire(w.relation) as Relation,
    currentGameId: w.currentGameId ?? "",
    currentGameTitle: w.currentGameTitle ?? "",
    lastOnline: w.lastOnline ?? 0,
    // Client-local prefs default here; the reducer re-applies the user's saved
    // favorite/nickname/lastInteract over the top on each friend re-pull.
    favorite: false,
    nickname: "",
    lastInteract: 0,
  };
}

export class WsGateway implements Gateway {
  private frameCb: (msg: Inbound) => void = () => {};
  private stateCb: (s: GatewayState) => void = () => {};
  private unlisteners: UnlistenFn[] = [];
  /** Guards against double-connect (e.g. React StrictMode's mount→unmount→mount
   *  in dev): a second connect() while already started is ignored. The Rust side
   *  additionally supersedes any stale task by generation, so both ends are safe. */
  private started = false;

  constructor(
    private readonly host: string,
    private readonly token: string,
  ) {}

  connect(): void {
    if (this.started) return;
    this.started = true;

    Promise.all([
      listen<string>(STATE_EVENT, (e) => this.stateCb(e.payload as GatewayState)),
      listen<string>(FRAME_EVENT, (e) => {
        const msg = parseInbound(e.payload);
        if (msg) this.frameCb(msg);
      }),
    ]).then((uns) => {
      // disconnect() may have run before the listeners resolved; honor it.
      if (!this.started) {
        uns.forEach((u) => u());
        return;
      }
      this.unlisteners = uns;
      void call("social_connect", { host: this.host, token: this.token });
    });
  }

  send(frame: string): void {
    void call<boolean>("social_send", { frame });
  }

  async fetchFriends(): Promise<Friend[]> {
    const wire = await call<WireFriend[]>("social_fetch_friends", {
      host: this.host,
      token: this.token,
    });
    return wire.map(toFriend);
  }

  disconnect(): void {
    this.started = false;
    void call("social_disconnect");
    this.unlisteners.forEach((u) => u());
    this.unlisteners = [];
  }

  onFrame(cb: (msg: Inbound) => void): void {
    this.frameCb = cb;
  }

  onState(cb: (s: GatewayState) => void): void {
    this.stateCb = cb;
  }
}
