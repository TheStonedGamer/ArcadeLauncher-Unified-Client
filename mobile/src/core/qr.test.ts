import { describe, expect, it } from "vitest";
import { parseQrSignin, parseQrSigninDetails, qrMatchesSessionServer } from "./qr";

const VALID =
  "arcadelauncher://signin?server=https%3A%2F%2Farcade.example&id=req123&secret=scan456";

describe("QR sign-in core", () => {
  it("parses a complete branded sign-in URI", () => {
    expect(parseQrSignin(VALID)).toEqual({
      server: "https://arcade.example",
      challengeId: "req123",
      scanSecret: "scan456",
    });
  });

  it("rejects other schemes, insecure servers, and missing capabilities", () => {
    expect(parseQrSignin(VALID.replace("arcadelauncher:", "https:"))).toBeNull();
    expect(parseQrSignin(VALID.replace("https%3A", "http%3A"))).toBeNull();
    expect(parseQrSignin("arcadelauncher://signin?server=https%3A%2F%2Farcade.example")).toBeNull();
  });

  it("never authorizes a QR for a different server", () => {
    const challenge = parseQrSignin(VALID)!;
    expect(qrMatchesSessionServer(challenge, "arcade.example")).toBe(true);
    expect(qrMatchesSessionServer(challenge, "ARCADE.EXAMPLE")).toBe(true);
    expect(qrMatchesSessionServer(challenge, "evil.example")).toBe(false);
  });

  it("accepts only complete server inspection bodies", () => {
    expect(
      parseQrSigninDetails({
        challengeId: "req123",
        target: "store",
        deviceName: "Browser",
        ip: "192.0.2.1",
        expiresIn: 120,
      }),
    ).not.toBeNull();
    expect(parseQrSigninDetails({ target: "store" })).toBeNull();
  });
});
