// Pure challenge-response auth crypto for the mobile companion, mirroring the
// server's `auth.rs` and the desktop client's `src-tauri/src/session/crypto.rs`
// EXACTLY so the privacy-preserving login flow works without ever sending the
// password. Dependency-free (self-contained SHA-256 + HMAC) so it runs on
// Hermes and is exhaustively unit-tested under the root vitest, just like the
// Rust core it copies.
//
// Flow (see ArcadeLauncher-Server/src/auth.rs):
//   1. GET /api/auth/challenge?username=… -> { nonce }
//   2. key = SHA-256( lower(trim(username)) || 0x1f || password )   (32 bytes)
//      proof = hex( HMAC-SHA256(key, nonce_ascii) )
//      POST /api/auth/verify {username, proof, totpCode}
//        -> { iv (hex), token (hex ciphertext), … }
//   3. token = HMAC-CTR-XOR(key, iv, ciphertext)  (symmetric; same as encrypt)

const enc = new TextEncoder();
const dec = new TextDecoder();

/** UTF-8 encode, matching Rust's `str::as_bytes`. */
export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

/** Lowercase hex, matching Rust's `hex::encode`. */
export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Decode lowercase/uppercase hex; throws on odd length or non-hex, matching
 *  the Rust `hex::decode` error surface the caller reports to the user. */
export function hexDecode(hex: string): Uint8Array {
  const h = hex.trim();
  if (h.length % 2 !== 0) throw new Error("bad hex: odd length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("bad hex: non-hex digit");
    out[i] = byte;
  }
  return out;
}

// --- SHA-256 (FIPS 180-4), operating on and returning raw bytes. ------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Padding: append 0x80, then zeros, then the 64-bit big-endian bit length.
  const bitLen = msg.length * 8;
  const withOne = msg.length + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // 64-bit length; JS bit ops are 32-bit, so write the high word via division.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

const BLOCK = 64; // SHA-256 block size in bytes.

/** HMAC-SHA256 over raw bytes (RFC 2104). */
export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key.length > BLOCK ? sha256(key) : key;
  const k0 = new Uint8Array(BLOCK);
  k0.set(k);
  const ipad = new Uint8Array(BLOCK + msg.length);
  const opad = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = k0[i] ^ 0x36;
    opad[i] = k0[i] ^ 0x5c;
  }
  ipad.set(msg, BLOCK);
  opad.set(sha256(ipad), BLOCK);
  return sha256(opad);
}

// --- The three operations the login flow needs. ----------------------------

/** Password-derived shared secret: `SHA-256( lower(trim(username)) || 0x1f || password )`. */
export function deriveAuthKey(username: string, password: string): Uint8Array {
  const u = utf8(username.trim().toLowerCase());
  const p = utf8(password);
  const msg = new Uint8Array(u.length + 1 + p.length);
  msg.set(u, 0);
  msg[u.length] = 0x1f;
  msg.set(p, u.length + 1);
  return sha256(msg);
}

/** The proof for the challenge nonce: `hex( HMAC-SHA256(key, nonce) )`. */
export function challengeProof(key: Uint8Array, nonce: string): string {
  return hexEncode(hmacSha256(key, utf8(nonce)));
}

/** HMAC-SHA256 counter-mode keystream XOR. Symmetric (encrypt == decrypt).
 *  Block i = HMAC-SHA256(key, iv || be_u32(i)); counter starts at 0. */
export function hmacCtrXor(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let counter = 0;
  let block = new Uint8Array(0);
  let bi = 32; // force a fresh block on the first byte
  const ctr = new Uint8Array(iv.length + 4);
  ctr.set(iv);
  for (let i = 0; i < data.length; i++) {
    if (bi >= 32) {
      ctr[iv.length] = (counter >>> 24) & 0xff;
      ctr[iv.length + 1] = (counter >>> 16) & 0xff;
      ctr[iv.length + 2] = (counter >>> 8) & 0xff;
      ctr[iv.length + 3] = counter & 0xff;
      block = hmacSha256(key, ctr);
      counter = (counter + 1) >>> 0;
      bi = 0;
    }
    out[i] = data[i] ^ block[bi];
    bi += 1;
  }
  return out;
}

/** Decrypt the token from a `/api/auth/verify` response: `iv` and `token` are
 *  hex strings; the plaintext is a UTF-8 token. Throws on bad hex (surfaced to
 *  the user by the caller). */
export function decryptToken(key: Uint8Array, ivHex: string, tokenHex: string): string {
  const iv = hexDecode(ivHex);
  const ct = hexDecode(tokenHex);
  return dec.decode(hmacCtrXor(key, iv, ct));
}
