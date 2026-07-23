// Sign-in guard core: the rolling code half of the Steam-Guard-style flow.
//
// The phone must be able to produce a code with no network (that is the whole
// point of the fallback), so the code is derived offline from a shared secret
// provisioned once at device enrolment. The server holds the same secret and
// verifies with a small clock-skew window.
//
// SHA-1/HMAC are implemented here rather than pulled from a native module on
// purpose: it keeps this file pure and IO-free, so the algorithm is covered by
// published RFC 2202 test vectors in CI on both runners instead of only being
// exercised on a device. SHA-1 is used because it is what the HOTP/TOTP
// construction (RFC 4226) specifies; its collision weaknesses do not apply to
// HMAC, which is the only way it is used here.

/** Seconds a single code is valid for before it rolls. */
export const CODE_PERIOD_SECONDS = 30;

/** Digits in a generated code.
 *
 *  This is 6-digit RFC 6238 TOTP, NOT Steam's 5-character alphabet, and that is
 *  deliberate: the server already ships TOTP (`users.totp_enabled` /
 *  `totp_secret`, checked at login by `verify_user_totp`) over the identical
 *  HMAC-SHA1 construction. Emitting a second, prettier code format would mean
 *  two algorithms to keep in step for a purely cosmetic difference, so the phone
 *  produces exactly the code the deployed server already verifies. */
export const CODE_LENGTH = 6;

// ---------------------------------------------------------------------------
// SHA-1 (FIPS 180-4) over byte arrays.
// ---------------------------------------------------------------------------

function rotl(n: number, b: number): number {
  return ((n << b) | (n >>> (32 - b))) >>> 0;
}

export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8;
  // Pad to 64-byte blocks: 0x80, zeros, then the 64-bit big-endian bit length.
  const withPad = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const dv = new DataView(withPad.buffer);
  // Lengths here are far below 2^32 bits, so the high word is always zero.
  dv.setUint32(withPad.length - 4, ml >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(ml / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  new DataView(out.buffer).setUint32(0, h0, false);
  new DataView(out.buffer).setUint32(4, h1, false);
  new DataView(out.buffer).setUint32(8, h2, false);
  new DataView(out.buffer).setUint32(12, h3, false);
  new DataView(out.buffer).setUint32(16, h4, false);
  return out;
}

/** HMAC-SHA1 (RFC 2104). */
export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = 64;
  let k = key;
  if (k.length > block) k = sha1(k);
  const padded = new Uint8Array(block);
  padded.set(k);

  const inner = new Uint8Array(block + message.length);
  const outer = new Uint8Array(block + 20);
  for (let i = 0; i < block; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(message, block);
  outer.set(sha1(inner), block);
  return sha1(outer);
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** The counter a timestamp falls into. Exported so the UI can show a countdown
 *  and the server can verify neighbouring windows. */
export function counterFor(unixSeconds: number): number {
  return Math.floor(unixSeconds / CODE_PERIOD_SECONDS);
}

/** Seconds remaining before the current code rolls (1..30). */
export function secondsRemaining(unixSeconds: number): number {
  const used = Math.floor(unixSeconds) % CODE_PERIOD_SECONDS;
  return CODE_PERIOD_SECONDS - used;
}

/** Dynamic truncation (RFC 4226 §5.3), zero-padded to CODE_LENGTH digits.
 *  Byte-for-byte equivalent to the server's `totp_code`. */
export function codeForCounter(secret: Uint8Array, counter: number): string {
  const msg = new Uint8Array(8);
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, Math.floor(counter / 0x100000000), false);
  dv.setUint32(4, counter >>> 0, false);

  const mac = hmacSha1(secret, msg);
  const offset = mac[19] & 0x0f;
  const value =
    (((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)) >>>
    0;

  return String(value % 1_000_000).padStart(CODE_LENGTH, "0");
}

/** The code for a moment in time. */
export function codeAt(secret: Uint8Array, unixSeconds: number): string {
  return codeForCounter(secret, counterFor(unixSeconds));
}

/** Verify a typed code, allowing `skew` windows either side of `unixSeconds`
 *  to absorb clock drift and typing latency. Comparison is case-insensitive
 *  and ignores spaces, because the code is read off a screen and retyped. */
export function verifyCode(secret: Uint8Array, typed: string, unixSeconds: number, skew = 1): boolean {
  const want = normalizeCode(typed);
  if (want.length !== CODE_LENGTH) return false;
  const base = counterFor(unixSeconds);
  for (let d = -skew; d <= skew; d++) {
    if (codeForCounter(secret, base + d) === want) return true;
  }
  return false;
}

/** Strip the formatting a human introduces when retyping a code. Mirrors the
 *  server's `verify_user_totp`, which keeps only ASCII digits. */
export function normalizeCode(typed: string): string {
  return (typed ?? "").replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Secret encoding — the enrolment payload is base32 (RFC 4648, unpadded), the
// same shape every authenticator app uses, so the secret stays copy-pasteable.
// ---------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 secret. Returns null on any character outside the alphabet
 *  so a mistyped enrolment string fails loudly instead of silently producing
 *  codes that will never verify. */
export function decodeBase32(text: string): Uint8Array | null {
  const clean = (text ?? "").replace(/[\s=-]/g, "").toUpperCase();
  if (!clean) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
