import { describe, expect, it } from "vitest";
import type { HostButton, Profile } from "./api";
import {
  DEFAULT_DEAD_ZONE,
  clampDeadZone,
  emptyProfile,
  profilesEqual,
  resetProfile,
  setBinding,
  tokenFor,
} from "./profile";

const BUTTONS: HostButton[] = [
  { id: "a", label: "A", defaultToken: "FaceSouth" },
  { id: "b", label: "B", defaultToken: "FaceEast" },
  { id: "leftBumper", label: "LB", defaultToken: "LeftShoulder" },
];

describe("tokenFor", () => {
  it("falls back to the identity token when unbound", () => {
    expect(tokenFor(emptyProfile(), BUTTONS, "a")).toBe("FaceSouth");
    expect(tokenFor(emptyProfile(), BUTTONS, "leftBumper")).toBe("LeftShoulder");
  });

  it("uses the explicit binding when present", () => {
    const p: Profile = { deadZone: DEFAULT_DEAD_ZONE, bindings: { a: "FaceEast" } };
    expect(tokenFor(p, BUTTONS, "a")).toBe("FaceEast");
  });

  it("returns empty for an unknown button", () => {
    expect(tokenFor(emptyProfile(), BUTTONS, "nope")).toBe("");
  });
});

describe("setBinding", () => {
  it("records a non-identity token", () => {
    const p = setBinding(emptyProfile(), BUTTONS, "a", "FaceEast");
    expect(p.bindings.a).toBe("FaceEast");
  });

  it("clears the entry when reselecting the identity token", () => {
    let p = setBinding(emptyProfile(), BUTTONS, "a", "FaceEast");
    p = setBinding(p, BUTTONS, "a", "FaceSouth"); // a's identity
    expect(p.bindings.a).toBeUndefined();
    expect(tokenFor(p, BUTTONS, "a")).toBe("FaceSouth");
  });

  it("does not mutate the input profile", () => {
    const original = emptyProfile();
    setBinding(original, BUTTONS, "a", "FaceEast");
    expect(original.bindings.a).toBeUndefined();
  });
});

describe("clampDeadZone", () => {
  it("clamps to the 5%–95% band", () => {
    expect(clampDeadZone(0)).toBeCloseTo(0.05);
    expect(clampDeadZone(1)).toBeCloseTo(0.95);
    expect(clampDeadZone(0.5)).toBeCloseTo(0.5);
  });

  it("defaults NaN", () => {
    expect(clampDeadZone(Number.NaN)).toBe(DEFAULT_DEAD_ZONE);
  });
});

describe("profilesEqual", () => {
  it("treats empty and all-identity-explicit maps as equal", () => {
    const a = emptyProfile();
    const b: Profile = {
      deadZone: DEFAULT_DEAD_ZONE,
      bindings: { a: "FaceSouth", b: "FaceEast", leftBumper: "LeftShoulder" },
    };
    expect(profilesEqual(a, b, BUTTONS)).toBe(true);
  });

  it("detects a changed binding", () => {
    const a = emptyProfile();
    const b = setBinding(a, BUTTONS, "a", "FaceEast");
    expect(profilesEqual(a, b, BUTTONS)).toBe(false);
  });

  it("detects a changed dead zone", () => {
    const a = emptyProfile();
    const b: Profile = { deadZone: 0.5, bindings: {} };
    expect(profilesEqual(a, b, BUTTONS)).toBe(false);
  });
});

describe("resetProfile", () => {
  it("returns the identity default", () => {
    expect(resetProfile()).toEqual(emptyProfile());
  });
});
