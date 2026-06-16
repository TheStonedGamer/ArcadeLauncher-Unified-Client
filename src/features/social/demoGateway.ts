// Dev-only gateway: scripts a handful of friends, a presence update, and an
// inbound message through the SAME reducer the real client uses, so the social
// UI can be exercised end-to-end without a live backend. Activated only when the
// app is opened with `?demo` in the URL (see useSocial); the shipping path
// always uses NullGateway. This is a development aid, not a feature.

import type { Gateway, GatewayState } from "./gateway";
import type { Inbound } from "./protocol";
import type { Friend } from "./types";

const SELF_ID = 42;

const DEMO_FRIENDS: Friend[] = [
  { accountId: 2, username: "ryu_dev", presence: "ingame", relation: "accepted", currentGameId: "sf2", currentGameTitle: "Street Fighter II", statusText: "", lastOnline: 0, favorite: true, nickname: "", lastInteract: 200 },
  { accountId: 3, username: "pixelpat", presence: "online", relation: "accepted", currentGameId: "", currentGameTitle: "", statusText: "drawing sprites", lastOnline: 0, favorite: false, nickname: "Pat", lastInteract: 150 },
  { accountId: 4, username: "n64kid", presence: "away", relation: "accepted", currentGameId: "", currentGameTitle: "", statusText: "brb", lastOnline: 0, favorite: false, nickname: "", lastInteract: 100 },
  { accountId: 5, username: "ghost", presence: "offline", relation: "accepted", currentGameId: "", currentGameTitle: "", statusText: "", lastOnline: 0, favorite: false, nickname: "", lastInteract: 0 },
];

export class DemoGateway implements Gateway {
  private frameCb: (msg: Inbound) => void = () => {};
  private stateCb: (s: GatewayState) => void = () => {};

  connect(): void {
    // Brief "connecting" → "connected" so the status dot animates realistically.
    this.stateCb("connecting");
    setTimeout(() => {
      this.frameCb({ type: "hello", selfId: SELF_ID });
      this.stateCb("connected"); // triggers fetchFriends() in the hook
      // A live inbound message a moment later, so the roster shows an unread badge.
      setTimeout(() => {
        this.frameCb({
          type: "chat",
          messageId: 101,
          senderId: 3,
          receiverId: SELF_ID,
          text: "yo! got the new build working?",
          attachmentId: 0,
          replyTo: 0,
          timestamp: Math.floor(Date.now() / 1000),
        });
      }, 1200);
    }, 500);
  }

  async fetchFriends(): Promise<Friend[]> {
    return DEMO_FRIENDS;
  }

  send(frame: string): void {
    // Echo my outgoing chat back as an acked frame (resolves the pending bubble),
    // then simulate the peer reading it and typing a reply.
    const msg = JSON.parse(frame) as { type: string; to?: number; text?: string };
    if (msg.type !== "chat" || msg.to == null) return;
    const peer = msg.to;
    const id = Math.floor(Math.random() * 1_000_000) + 1000;
    setTimeout(() => {
      this.frameCb({ type: "chat", messageId: id, senderId: SELF_ID, receiverId: peer, text: msg.text ?? "", attachmentId: 0, replyTo: 0, timestamp: Math.floor(Date.now() / 1000) });
      this.frameCb({ type: "read", readerId: peer, upToId: id });
      setTimeout(() => this.frameCb({ type: "typing", fromId: peer }), 600);
      setTimeout(() => {
        this.frameCb({ type: "chat", messageId: id + 1, senderId: peer, receiverId: SELF_ID, text: "nice 🎮", attachmentId: 0, replyTo: 0, timestamp: Math.floor(Date.now() / 1000) });
      }, 1800);
    }, 300);
  }

  disconnect(): void {}
  onFrame(cb: (msg: Inbound) => void): void {
    this.frameCb = cb;
  }
  onState(cb: (s: GatewayState) => void): void {
    this.stateCb = cb;
  }
}
