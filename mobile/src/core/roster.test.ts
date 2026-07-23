import { describe, expect, it } from "vitest";
import {
  applyFrame,
  conversationOrder,
  emptyRoster,
  isOnline,
  liveGuard,
  secondsLeft,
  type RosterState,
} from "./roster";
import { parseFrame } from "./social";

const NOW = 1_700_000_000;

/** Fold raw wire text, the way the gateway does, so the tests exercise the
 *  parser and the reducer together rather than a hand-built frame that no
 *  server would send. */
function feed(state: RosterState, raw: string, now = NOW): RosterState {
  return applyFrame(state, parseFrame(raw), now);
}

function signedIn(selfId = 42): RosterState {
  return feed(emptyRoster(), `{"type":"hello","selfId":${selfId},"deviceId":"ph-1"}`);
}

describe("applyFrame", () => {
  it("learns our own id from the handshake", () => {
    expect(signedIn().selfId).toBe(42);
  });

  it("files an incoming message under the sender", () => {
    const s = feed(signedIn(), '{"type":"chat","messageId":1,"senderId":7,"receiverId":42,"text":"hi"}');
    expect(s.conversations[7]).toHaveLength(1);
    expect(s.conversations[7][0]).toMatchObject({ peerId: 7, mine: false, text: "hi" });
  });

  it("files the echo of our own message under the same conversation", () => {
    // Otherwise a reply would open a second thread against ourselves.
    let s = signedIn();
    s = feed(s, '{"type":"chat","messageId":1,"senderId":42,"receiverId":7,"text":"yo"}');
    s = feed(s, '{"type":"chat","messageId":2,"senderId":7,"receiverId":42,"text":"hey"}');
    expect(Object.keys(s.conversations)).toEqual(["7"]);
    expect(s.conversations[7].map((m) => m.mine)).toEqual([true, false]);
  });

  it("ignores a replayed message rather than showing it twice", () => {
    // The server replays after a reconnect from the last id we acknowledged.
    let s = signedIn();
    const raw = '{"type":"chat","messageId":9,"senderId":7,"receiverId":42,"text":"hi"}';
    s = feed(s, raw);
    const after = feed(s, raw);
    expect(after).toBe(s);
    expect(after.conversations[7]).toHaveLength(1);
  });

  it("stamps a timestamp-less message with now, so it does not sort to the top", () => {
    const s = feed(signedIn(), '{"type":"chat","messageId":1,"senderId":7,"receiverId":42,"text":"hi"}');
    expect(s.conversations[7][0].timestamp).toBe(NOW);
  });

  it("keeps a conversation in time order when history arrives out of order", () => {
    let s = signedIn();
    s = feed(s, '{"type":"chat","messageId":3,"senderId":7,"receiverId":42,"text":"third","timestamp":300}');
    s = feed(s, '{"type":"chat","messageId":1,"senderId":7,"receiverId":42,"text":"first","timestamp":100}');
    s = feed(s, '{"type":"chat","messageId":2,"senderId":7,"receiverId":42,"text":"second","timestamp":200}');
    expect(s.conversations[7].map((m) => m.text)).toEqual(["first", "second", "third"]);
  });

  it("drops a message with no addressable peer instead of opening a thread with nobody", () => {
    const s = feed(signedIn(), '{"type":"chat","messageId":1,"senderId":0,"receiverId":0,"text":"?"}');
    expect(s.conversations).toEqual({});
  });

  it("records presence and what a friend is playing", () => {
    const s = feed(signedIn(), '{"type":"presence","userId":7,"state":"in-game","gameTitle":"Doom"}');
    expect(s.presence[7]).toBe("in-game");
    expect(s.playing[7]).toBe("Doom");
  });

  it("returns the same state when presence repeats, so React can skip a render", () => {
    const raw = '{"type":"presence","userId":7,"state":"online"}';
    const s = feed(signedIn(), raw);
    expect(feed(s, raw)).toBe(s);
  });

  it("replaces the device list wholesale, so a PC that signed out disappears", () => {
    let s = feed(signedIn(), '{"type":"devices","devices":[{"id":"pc-1","kind":"desktop"}]}');
    s = feed(s, '{"type":"devices","devices":[]}');
    expect(s.devices).toEqual([]);
  });

  it("turns a refused install into a notice the user can read", () => {
    const s = feed(
      signedIn(),
      '{"type":"remote_install_ack","deviceId":"pc-1","gameId":"g","ok":false,"error":"unknown_device"}',
    );
    expect(s.install).toMatchObject({ status: "refused" });
    expect(s.install?.message).not.toBe("");
  });

  it("has a message for a bare acknowledgement too", () => {
    const s = feed(signedIn(), '{"type":"remote_install_ack","deviceId":"pc-1","gameId":"g","ok":true}');
    expect(s.install).toMatchObject({ status: "sent" });
    expect(s.install?.message).not.toBe("");
  });

  it("lets a later result overwrite the acknowledgement", () => {
    let s = feed(signedIn(), '{"type":"remote_install_ack","deviceId":"pc-1","gameId":"g","ok":true}');
    s = feed(s, '{"type":"remote_install_result","deviceId":"pc-1","gameId":"g","status":"done","message":"Installed."}');
    expect(s.install).toMatchObject({ status: "done", message: "Installed." });
  });

  it("stores a guard deadline as a clock time, not a countdown", () => {
    // The prompt may arrive while the screen is off; it must be judged against
    // the clock rather than against when we next happen to look at it.
    const s = feed(signedIn(), '{"type":"guard_request","requestId":"r1","expiresIn":120}');
    expect(s.guard?.expiresAt).toBe(NOW + 120);
  });

  it("lets a newer sign-in request supersede an unanswered one", () => {
    let s = feed(signedIn(), '{"type":"guard_request","requestId":"r1","expiresIn":120}');
    s = feed(s, '{"type":"guard_request","requestId":"r2","expiresIn":120}');
    expect(s.guard?.requestId).toBe("r2");
  });

  it("leaves the state alone for a frame it does not know", () => {
    const s = signedIn();
    expect(feed(s, '{"type":"invented_later"}')).toBe(s);
    expect(feed(s, "not json")).toBe(s);
  });
});

describe("liveGuard", () => {
  const s = feed(signedIn(), '{"type":"guard_request","requestId":"r1","expiresIn":120}');

  it("shows a prompt that is still answerable", () => {
    expect(liveGuard(s, NOW + 119)?.requestId).toBe("r1");
  });

  it("drops an expired prompt rather than showing a button that cannot work", () => {
    expect(liveGuard(s, NOW + 120)).toBeNull();
    expect(liveGuard(s, NOW + 9999)).toBeNull();
  });

  it("is null when nothing is pending", () => {
    expect(liveGuard(signedIn(), NOW)).toBeNull();
  });

  it("counts down and floors at zero", () => {
    const g = s.guard!;
    expect(secondsLeft(g, NOW)).toBe(120);
    expect(secondsLeft(g, NOW + 90)).toBe(30);
    expect(secondsLeft(g, NOW + 9999)).toBe(0);
  });
});

describe("conversationOrder", () => {
  it("puts the most recently active conversation first", () => {
    let s = signedIn();
    s = feed(s, '{"type":"chat","messageId":1,"senderId":7,"receiverId":42,"text":"old","timestamp":100}');
    s = feed(s, '{"type":"chat","messageId":2,"senderId":8,"receiverId":42,"text":"new","timestamp":200}');
    expect(conversationOrder(s)).toEqual([8, 7]);
    s = feed(s, '{"type":"chat","messageId":3,"senderId":7,"receiverId":42,"text":"newest","timestamp":300}');
    expect(conversationOrder(s)).toEqual([7, 8]);
  });

  it("is empty before anyone has said anything", () => {
    expect(conversationOrder(signedIn())).toEqual([]);
  });
});

describe("isOnline", () => {
  it("treats a friend we have heard nothing about as offline", () => {
    // Offering a call that cannot connect is worse than not offering one.
    expect(isOnline(signedIn(), 7)).toBe(false);
  });

  it("counts any non-offline state as reachable", () => {
    let s = feed(signedIn(), '{"type":"presence","userId":7,"state":"in-game"}');
    expect(isOnline(s, 7)).toBe(true);
    s = feed(s, '{"type":"presence","userId":7,"state":"offline"}');
    expect(isOnline(s, 7)).toBe(false);
  });
});
