import { describe, expect, it } from "vitest";
import { accountInitial } from "./AccountMenu";

describe("accountInitial", () => {
  it("uses an uppercase username initial", () => {
    expect(accountInitial(" brian")).toBe("B");
  });

  it("falls back when the username is blank", () => {
    expect(accountInitial("   ")).toBe("?");
  });
});
