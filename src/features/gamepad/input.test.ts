import { describe, expect, it } from "vitest";
import { BTN, diffIntents, stickDirection, type PadSnapshot } from "./input";

function pad(buttons: number[], axes: number[] = []): PadSnapshot {
  // buttons is a list of pressed indices for convenience.
  const arr: boolean[] = [];
  for (const i of buttons) arr[i] = true;
  return { buttons: arr, axes };
}

describe("stickDirection", () => {
  it("returns neutral inside the dead zone", () => {
    expect(stickDirection([0, 0])).toBe("");
    expect(stickDirection([0.5, -0.5])).toBe("");
  });
  it("picks the dominant axis (no diagonals)", () => {
    expect(stickDirection([-0.9, 0.2])).toBe("left");
    expect(stickDirection([0.2, -0.9])).toBe("up");
    expect(stickDirection([0.9, 0.7])).toBe("right");
    expect(stickDirection([0.1, 0.8])).toBe("down");
  });
  it("honors a custom dead zone", () => {
    // 0.5 is below the default 0.6 dead zone (neutral) but above a 0.3 one.
    expect(stickDirection([0.5, 0])).toBe("");
    expect(stickDirection([0.5, 0], 0.3)).toBe("right");
    // A larger dead zone swallows a deflection the default would accept.
    expect(stickDirection([0.7, 0], 0.9)).toBe("");
  });
});

describe("diffIntents — buttons", () => {
  it("fires a dpad direction on press edge only", () => {
    const down = pad([BTN.DPAD_DOWN]);
    expect(diffIntents(down)).toEqual(["down"]);
    // Held across frames → no repeat.
    expect(diffIntents(down, down)).toEqual([]);
  });
  it("maps the face/shoulder/menu buttons to their intents", () => {
    expect(diffIntents(pad([BTN.A]))).toEqual(["select"]);
    expect(diffIntents(pad([BTN.B]))).toEqual(["back"]);
    expect(diffIntents(pad([BTN.X]))).toEqual(["context"]);
    expect(diffIntents(pad([BTN.Y]))).toEqual(["search"]);
    expect(diffIntents(pad([BTN.LB]))).toEqual(["tabPrev"]);
    expect(diffIntents(pad([BTN.RB]))).toEqual(["tabNext"]);
    expect(diffIntents(pad([BTN.LT]))).toEqual(["pageUp"]);
    expect(diffIntents(pad([BTN.RT]))).toEqual(["pageDown"]);
    expect(diffIntents(pad([BTN.START]))).toEqual(["settings"]);
    expect(diffIntents(pad([BTN.GUIDE]))).toEqual(["bigpicture"]);
  });
  it("releasing then pressing again re-fires", () => {
    const a = pad([BTN.A]);
    const none = pad([]);
    expect(diffIntents(a, none)).toEqual(["select"]);
    expect(diffIntents(a, a)).toEqual([]);
    expect(diffIntents(a, none)).toEqual(["select"]);
  });
});

describe("diffIntents — stick", () => {
  it("fires once when crossing into a direction", () => {
    const neutral = pad([], [0, 0]);
    const up = pad([], [0, -0.9]);
    expect(diffIntents(up, neutral)).toEqual(["up"]);
    // Still held in the same direction → no repeat.
    expect(diffIntents(up, up)).toEqual([]);
  });
  it("changing stick direction fires the new one", () => {
    const up = pad([], [0, -0.9]);
    const left = pad([], [-0.9, 0]);
    expect(diffIntents(left, up)).toEqual(["left"]);
  });
  it("threads a custom dead zone through to the stick", () => {
    const neutral = pad([], [0, 0]);
    const half = pad([], [0.5, 0]);
    // Below the default dead zone → nothing.
    expect(diffIntents(half, neutral)).toEqual([]);
    // With a looser dead zone the same deflection registers.
    expect(diffIntents(half, neutral, 0.3)).toEqual(["right"]);
  });
});
