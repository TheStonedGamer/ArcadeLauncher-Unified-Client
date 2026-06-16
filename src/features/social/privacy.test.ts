import { describe, it, expect } from "vitest";
import {
  FRIEND_POLICY_OPTIONS,
  DM_POLICY_OPTIONS,
  DEFAULT_PRIVACY,
  friendPolicyFromWire,
  dmPolicyFromWire,
  friendPolicyLabel,
  dmPolicyLabel,
} from "./privacy";

describe("policy option lists", () => {
  it("friend options in order", () => {
    expect(FRIEND_POLICY_OPTIONS.map((o) => o.value)).toEqual(["everyone", "mutual", "nobody"]);
  });
  it("dm options in order", () => {
    expect(DM_POLICY_OPTIONS.map((o) => o.value)).toEqual(["everyone", "friends", "nobody"]);
  });
});

describe("fromWire coercion", () => {
  it("friend policy", () => {
    expect(friendPolicyFromWire("mutual")).toBe("mutual");
    expect(friendPolicyFromWire("nobody")).toBe("nobody");
    expect(friendPolicyFromWire("garbage")).toBe("everyone");
  });
  it("dm policy", () => {
    expect(dmPolicyFromWire("friends")).toBe("friends");
    expect(dmPolicyFromWire("")).toBe("everyone");
  });
});

describe("labels", () => {
  it("map known values", () => {
    expect(friendPolicyLabel("mutual")).toBe("Mutual friends");
    expect(dmPolicyLabel("friends")).toBe("Friends only");
  });
  it("fall back to raw token", () => {
    expect(friendPolicyLabel("weird")).toBe("weird");
  });
});

describe("DEFAULT_PRIVACY", () => {
  it("is everyone/everyone", () => {
    expect(DEFAULT_PRIVACY).toEqual({ friendPolicy: "everyone", dmPolicy: "everyone" });
  });
});
