import { describe, it, expect } from "vitest";
import { clampStep, isLastStep, ONBOARDING_STEPS } from "./onboarding";

describe("clampStep", () => {
  it("keeps an in-range index", () => {
    expect(clampStep(2, 5)).toBe(2);
  });
  it("clamps below zero and above the end", () => {
    expect(clampStep(-3, 5)).toBe(0);
    expect(clampStep(99, 5)).toBe(4);
  });
  it("returns 0 when there are no steps", () => {
    expect(clampStep(3, 0)).toBe(0);
  });
});

describe("isLastStep", () => {
  it("is true only on the final index", () => {
    expect(isLastStep(4, 5)).toBe(true);
    expect(isLastStep(3, 5)).toBe(false);
  });
  it("is false with no steps", () => {
    expect(isLastStep(0, 0)).toBe(false);
  });
});

describe("ONBOARDING_STEPS", () => {
  it("has unique non-empty step ids", () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
