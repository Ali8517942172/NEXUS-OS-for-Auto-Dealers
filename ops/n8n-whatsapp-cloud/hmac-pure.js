/* HMAC-SHA256 with no crypto module and no WebCrypto.
 *
 * Measured on the NEXUS n8n box on 7 September 2026, from inside a Code node on
 * the live receiver: require('crypto') throws, AND the WebCrypto global is
 * "crypto is not defined". Both routes the receiver was first written with are
 * unavailable there, so the signature check could not depend on either. This is
 * the third route, and it has no dependencies at all.
 *
 * It operates on bytes from end to end. The body is never parsed, re-serialised
 * or round-tripped through a string before hashing — that re-encode is the exact
 * defect the whole receiver exists to avoid.
 */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(bytes) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length;
  /* Pad to the next multiple of 64 that leaves room for the 0x80 byte and the
     8-byte length. The obvious (l + 9) here is wrong: at l % 64 === 55 the
     0x80 and the length fit in the current block exactly, and (l + 9) rounds up
     to an extra all-zero block. That off-by-one block is invisible on almost
     every input — it only bites at lengths 55, 119, 183, 247 …, which is why a
     handful of published vectors passed while a differential test against
     node:crypto found it in 300 random bodies. */
  const buf = new Uint8Array((((l + 8) >> 6) + 1) << 6);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = l * 8;
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296));
  dv.setUint32(buf.length - 4, bits >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

function hmacSha256(keyBytes, msgBytes) {
  const k = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  const inner = new Uint8Array(64 + msgBytes.length);
  inner.set(ipad); inner.set(msgBytes, 64);
  const ih = sha256(inner);
  const outer = new Uint8Array(96);
  outer.set(opad); outer.set(ih, 64);
  return sha256(outer);
}

const hex = u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const utf8 = s => new TextEncoder().encode(s);

module.exports = { sha256, hmacSha256, hex, utf8 };
