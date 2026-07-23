import { describe, expect, it } from "vitest";

import {
  challengeProof,
  decryptToken,
  deriveAuthKey,
  hexDecode,
  hexEncode,
  hmacCtrXor,
  hmacSha256,
  sha256,
  utf8,
} from "./crypto";

// The primitives must match the world's known-answer vectors, or nothing built
// on them interoperates with the server's Rust `auth.rs`.
describe("sha256 / hmac primitives (known-answer)", () => {
  it("hashes the empty string to the NIST vector", () => {
    expect(hexEncode(sha256(utf8("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc' to the NIST vector", () => {
    expect(hexEncode(sha256(utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes a >1 block message to the NIST vector", () => {
    const msg = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(hexEncode(sha256(utf8(msg)))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches RFC 4231 HMAC-SHA256 test case 1", () => {
    // key = 0x0b*20, data = "Hi There"
    const key = new Uint8Array(20).fill(0x0b);
    expect(hexEncode(hmacSha256(key, utf8("Hi There")))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("matches RFC 4231 HMAC-SHA256 test case 2", () => {
    // key = "Jefe", data = "what do ya want for nothing?"
    expect(hexEncode(hmacSha256(utf8("Jefe"), utf8("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("HMAC keys longer than the block are hashed first (RFC 4231 case 6)", () => {
    const key = new Uint8Array(131).fill(0xaa);
    const data = utf8("Test Using Larger Than Block-Size Key - Hash Key First");
    expect(hexEncode(hmacSha256(key, data))).toBe(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    );
  });
});

// These mirror src-tauri/src/session/crypto.rs one-for-one so both clients
// derive the same key, proof and token.
describe("deriveAuthKey (mirrors crypto.rs)", () => {
  it("is SHA-256(lower(trim(username)) || 0x1f || password)", () => {
    // Independently: SHA-256("alice" \x1f "hunter2pass").
    const msg = new Uint8Array([...utf8("alice"), 0x1f, ...utf8("hunter2pass")]);
    const expected = hexEncode(sha256(msg));
    // Username is lower-cased and trimmed.
    expect(hexEncode(deriveAuthKey("  Alice  ", "hunter2pass"))).toBe(expected);
  });
});

describe("challengeProof (mirrors crypto.rs)", () => {
  it("is a lowercase 64-char hex HMAC of the nonce, deterministic and nonce-bound", () => {
    const key = deriveAuthKey("bob", "correct horse");
    const proof = challengeProof(key, "nonce-xyz");
    expect(proof).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(proof)).toBe(true);
    expect(proof).toBe(challengeProof(key, "nonce-xyz"));
    expect(proof).not.toBe(challengeProof(key, "nonce-abc"));
  });
});

describe("hmacCtrXor / decryptToken (mirrors crypto.rs)", () => {
  it("round-trips and is symmetric", () => {
    const key = deriveAuthKey("carol", "pw");
    const iv = new Uint8Array(16).fill(7);
    const token = utf8("a-real-session-token.with.dots-and_underscores");
    const ct = hmacCtrXor(key, iv, token);
    expect(hexEncode(ct)).not.toBe(hexEncode(token));
    expect(hexEncode(hmacCtrXor(key, iv, ct))).toBe(hexEncode(token));
  });

  it("decryptToken reverses the server's HMAC-CTR encrypt", () => {
    const key = deriveAuthKey("dave", "s3cr3t");
    const iv = new Uint8Array(16).fill(0xab);
    const token = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
    const ct = hmacCtrXor(key, iv, utf8(token));
    expect(decryptToken(key, hexEncode(iv), hexEncode(ct))).toBe(token);
  });

  it("crosses the 32-byte keystream block boundary", () => {
    const key = deriveAuthKey("erin", "pw");
    const iv = new Uint8Array(16).fill(1);
    const token = "x".repeat(100);
    const ct = hmacCtrXor(key, iv, utf8(token));
    expect(decryptToken(key, hexEncode(iv), hexEncode(ct))).toBe(token);
  });

  it("rejects bad hex", () => {
    const key = deriveAuthKey("f", "p");
    expect(() => decryptToken(key, "zz", "00")).toThrow();
    expect(() => decryptToken(key, "00", "zz")).toThrow();
    expect(() => hexDecode("abc")).toThrow(); // odd length
  });
});
