import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  codeAt,
  codeForCounter,
  counterFor,
  decodeBase32,
  encodeBase32,
  hmacSha1,
  normalizeCode,
  secondsRemaining,
  sha1,
  verifyCode,
} from "./guard";

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const fromHex = (h: string): Uint8Array =>
  new Uint8Array((h.match(/../g) ?? []).map((p) => parseInt(p, 16)));

describe("sha1 — FIPS 180-2 / RFC 3174 vectors", () => {
  it("hashes the empty string", () => {
    expect(hex(sha1(new Uint8Array(0)))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it('hashes "abc"', () => {
    expect(hex(sha1(ascii("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("hashes the 56-byte two-block vector", () => {
    expect(hex(sha1(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    );
  });

  it("hashes a million 'a's", () => {
    expect(hex(sha1(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
    );
  });

  it("handles the length-boundary cases around a padded block", () => {
    // 55 bytes still fits with its padding in one block; 56 forces a second.
    // Cross-checked against Node's crypto.createHash("sha1").
    const cases: Array<[number, string]> = [
      [55, "c1c8bbdc22796e28c0e15163d20899b65621d65a"],
      [56, "c2db330f6083854c99d4b5bfb6e8f29f201be699"],
      [63, "03f09f5b158a7a8cdad920bddc29b81c18a551f5"],
      [64, "0098ba824b5c16427bd7a1122a5a442a25ec644d"],
      [119, "ee971065aaa017e0632a8ca6c77bb3bf8b1dfc56"],
      [120, "f34c1488385346a55709ba056ddd08280dd4c6d6"],
    ];
    for (const [len, want] of cases) {
      expect(hex(sha1(new Uint8Array(len).fill(0x61)))).toBe(want);
    }
  });
});

describe("hmacSha1 — RFC 2202 vectors", () => {
  it("case 1: 20-byte 0x0b key", () => {
    expect(hex(hmacSha1(new Uint8Array(20).fill(0x0b), ascii("Hi There")))).toBe(
      "b617318655057264e28bc0b6fb378c8ef146be00",
    );
  });

  it("case 2: short ascii key", () => {
    expect(hex(hmacSha1(ascii("Jefe"), ascii("what do ya want for nothing?")))).toBe(
      "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79",
    );
  });

  it("case 3: 20-byte 0xaa key with 50 x 0xdd data", () => {
    expect(hex(hmacSha1(new Uint8Array(20).fill(0xaa), new Uint8Array(50).fill(0xdd)))).toBe(
      "125d7342b9ac11cd91a39af48aa17b4f63f175d3",
    );
  });

  it("case 6: key longer than the 64-byte block is hashed first", () => {
    expect(
      hex(hmacSha1(new Uint8Array(80).fill(0xaa), ascii("Test Using Larger Than Block-Size Key - Hash Key First"))),
    ).toBe("aa4ae5e15272d00e95705637ce8a3b55ed402112");
  });
});

describe("counterFor / secondsRemaining", () => {
  it("buckets time into 30-second windows", () => {
    expect(counterFor(0)).toBe(0);
    expect(counterFor(29)).toBe(0);
    expect(counterFor(30)).toBe(1);
    expect(counterFor(59)).toBe(1);
  });

  it("counts down within a window and never reports zero", () => {
    expect(secondsRemaining(0)).toBe(30);
    expect(secondsRemaining(1)).toBe(29);
    expect(secondsRemaining(29)).toBe(1);
    expect(secondsRemaining(30)).toBe(30);
  });
});

describe("codeForCounter", () => {
  // RFC 6238's shared secret: the ASCII string "12345678901234567890".
  const secret = fromHex("3132333435363738393031323334353637383930");

  it("matches the RFC 6238 reference vectors (6-digit, SHA-1)", () => {
    // The RFC publishes 8-digit codes; a 6-digit code is the low 6 digits,
    // because both come from `bin % 10^digits` of the same truncation.
    const cases: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [t, want] of cases) {
      expect(codeAt(secret, t)).toBe(want);
    }
  });

  it("produces a stable code of the right shape", () => {
    const code = codeForCounter(secret, 1);
    expect(code).toHaveLength(CODE_LENGTH);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("zero-pads codes whose truncation is below 100000", () => {
    // 1234567890 → "005924" above; assert the padding explicitly.
    expect(codeAt(secret, 1234567890).startsWith("00")).toBe(true);
  });

  it("is deterministic for the same secret and counter", () => {
    expect(codeForCounter(secret, 42)).toBe(codeForCounter(secret, 42));
  });

  it("changes when the counter advances", () => {
    expect(codeForCounter(secret, 42)).not.toBe(codeForCounter(secret, 43));
  });

  it("changes when the secret changes", () => {
    const other = fromHex("3132333435363738393031323334353637383931");
    expect(codeForCounter(secret, 42)).not.toBe(codeForCounter(other, 42));
  });

  it("always emits six digits across many windows", () => {
    for (let c = 0; c < 500; c++) {
      expect(codeForCounter(secret, c)).toMatch(/^\d{6}$/);
    }
  });

  it("codeAt agrees with the counter the timestamp falls in", () => {
    expect(codeAt(secret, 95)).toBe(codeForCounter(secret, 3));
  });
});

describe("verifyCode", () => {
  const secret = fromHex("3132333435363738393031323334353637383930");
  const now = 1_700_000_000;

  it("accepts the current code", () => {
    expect(verifyCode(secret, codeAt(secret, now), now)).toBe(true);
  });

  it("tolerates one window of drift either side", () => {
    expect(verifyCode(secret, codeAt(secret, now - 30), now)).toBe(true);
    expect(verifyCode(secret, codeAt(secret, now + 30), now)).toBe(true);
  });

  it("rejects drift beyond the allowed window", () => {
    expect(verifyCode(secret, codeAt(secret, now - 120), now)).toBe(false);
  });

  it("can be tightened to no skew at all", () => {
    expect(verifyCode(secret, codeAt(secret, now - 30), now, 0)).toBe(false);
  });

  it("ignores spaces and dashes the way a human retypes", () => {
    const code = codeAt(secret, now);
    expect(verifyCode(secret, `${code.slice(0, 2)} ${code.slice(2)}`, now)).toBe(true);
    expect(verifyCode(secret, `${code.slice(0, 2)}-${code.slice(2)}`, now)).toBe(true);
  });

  it("rejects a wrong or malformed code", () => {
    for (const bad of ["", "22222", "ABC", "2222222", "!!!!!", "1234567"]) {
      if (bad === codeAt(secret, now)) continue;
      expect(verifyCode(secret, bad, now)).toBe(false);
    }
  });

  it("rejects a code from a different secret", () => {
    const other = fromHex("aabbccddeeff00112233445566778899aabbccdd");
    expect(verifyCode(secret, codeAt(other, now), now)).toBe(false);
  });
});

describe("normalizeCode", () => {
  it("keeps only digits, the way the server's verify_user_totp does", () => {
    expect(normalizeCode(" 12-34 56 ")).toBe("123456");
    expect(normalizeCode("abc123")).toBe("123");
    expect(normalizeCode("")).toBe("");
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    }
  });

  it("matches RFC 4648 vectors (unpadded)", () => {
    expect(encodeBase32(ascii("f"))).toBe("MY");
    expect(encodeBase32(ascii("fo"))).toBe("MZXQ");
    expect(encodeBase32(ascii("foo"))).toBe("MZXW6");
    expect(encodeBase32(ascii("foobar"))).toBe("MZXW6YTBOI");
  });

  it("tolerates padding, spaces and lower case on the way in", () => {
    expect(decodeBase32("mzxw6ytboi")).toEqual(ascii("foobar"));
    expect(decodeBase32("MZXW 6YTB OI==")).toEqual(ascii("foobar"));
  });

  it("rejects characters outside the alphabet instead of guessing", () => {
    for (const bad of ["", "   ", "MZXW0", "MZXW1", "hello!"]) {
      expect(decodeBase32(bad)).toBeNull();
    }
  });
});
