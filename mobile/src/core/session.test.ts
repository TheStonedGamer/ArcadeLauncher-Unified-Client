import { describe, expect, it } from "vitest";
import {
  apiUrl,
  authHeaders,
  isValidHost,
  loginBlocker,
  loginError,
  normalizeHost,
  parseStoredSession,
  sessionFromLogin,
} from "./session";

describe("normalizeHost", () => {
  it("strips scheme, trailing slashes and surrounding space", () => {
    for (const input of [
      "arcade.example.net",
      "https://arcade.example.net",
      "http://arcade.example.net/",
      "  https://arcade.example.net///  ",
      "HTTPS://arcade.example.net",
    ]) {
      expect(normalizeHost(input)).toBe("arcade.example.net");
    }
  });

  it("keeps a port", () => {
    expect(normalizeHost("https://10.0.0.210:8721")).toBe("10.0.0.210:8721");
  });

  it("drops a pasted path", () => {
    expect(normalizeHost("https://arcade.example.net/api/catalog")).toBe("arcade.example.net");
  });

  it("survives empty input", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("   ")).toBe("");
  });
});

describe("isValidHost / apiUrl", () => {
  it("accepts a real host and rejects blank or spaced input", () => {
    expect(isValidHost("arcade.example.net")).toBe(true);
    expect(isValidHost("")).toBe(false);
    expect(isValidHost("   ")).toBe(false);
    expect(isValidHost("bad host.net")).toBe(false);
  });

  it("builds https URLs without doubling slashes or scheme", () => {
    expect(apiUrl("https://arcade.example.net/", "/api/catalog")).toBe("https://arcade.example.net/api/catalog");
    expect(apiUrl("arcade.example.net", "api/me")).toBe("https://arcade.example.net/api/me");
  });
});

describe("loginBlocker", () => {
  it("passes a complete form", () => {
    expect(loginBlocker("arcade.example.net", "ash", "pw")).toBeNull();
  });

  it("names the first missing field", () => {
    expect(loginBlocker("", "ash", "pw")).toMatch(/server/i);
    expect(loginBlocker("arcade.example.net", "  ", "pw")).toMatch(/username/i);
    expect(loginBlocker("arcade.example.net", "ash", "")).toMatch(/password/i);
  });
});

describe("sessionFromLogin", () => {
  it("builds a session and normalizes the host", () => {
    expect(sessionFromLogin("https://arcade.example.net/", "ash", { token: "t", username: "Ash", isAdmin: true }))
      .toEqual({ host: "arcade.example.net", username: "Ash", token: "t", isAdmin: true });
  });

  it("falls back to the typed username when the server omits one", () => {
    expect(sessionFromLogin("h.net", " ash ", { token: "t" })?.username).toBe("ash");
  });

  it("defaults isAdmin to false rather than trusting a loose value", () => {
    expect(sessionFromLogin("h.net", "ash", { token: "t", isAdmin: "yes" })?.isAdmin).toBe(false);
  });

  it("refuses a response with no usable token", () => {
    for (const body of [null, "ok", {}, { token: "" }, { token: 7 }]) {
      expect(sessionFromLogin("h.net", "ash", body)).toBeNull();
    }
  });
});

describe("loginError", () => {
  it("prefers the server's own message", () => {
    expect(loginError({ error: "Account pending approval" }, 403)).toBe("Account pending approval");
  });

  it("explains auth failures in plain words", () => {
    expect(loginError({}, 401)).toMatch(/wrong username or password/i);
    expect(loginError(null, 403)).toMatch(/wrong username or password/i);
  });

  it("falls back to the status for anything else", () => {
    expect(loginError(null, 500)).toContain("500");
    expect(loginError({ error: "   " }, 500)).toContain("500");
  });
});

describe("authHeaders", () => {
  it("emits a bearer header", () => {
    expect(authHeaders({ host: "h", username: "u", token: "abc", isAdmin: false })).toEqual({
      Authorization: "Bearer abc",
    });
  });
});

describe("parseStoredSession", () => {
  const good = { host: "https://arcade.example.net/", username: "ash", token: "t", isAdmin: true };

  it("reads back an object or its JSON string, normalizing the host", () => {
    expect(parseStoredSession(good)).toEqual({
      host: "arcade.example.net",
      username: "ash",
      token: "t",
      isAdmin: true,
    });
    expect(parseStoredSession(JSON.stringify(good))).toEqual(parseStoredSession(good));
  });

  it("tolerates a missing username", () => {
    expect(parseStoredSession({ host: "h.net", token: "t" })?.username).toBe("");
  });

  it("rejects anything that couldn't authenticate a request", () => {
    for (const bad of [null, "", "{oops", {}, { host: "h.net" }, { token: "t" }, { host: "", token: "t" }]) {
      expect(parseStoredSession(bad)).toBeNull();
    }
  });
});
