// NEXUS OS — supabase/functions/webhook-dispatcher/lib.js
//
// Pure helpers shared by the Deno dispatcher (index.ts) and the Node test
// (lib.test.mjs). No Deno or Node APIs: WebCrypto + URL only, so the exact
// same bytes are what production runs and what CI tests.

const enc = new TextEncoder();

/** hex HMAC-SHA256(secret, message) via WebCrypto. */
export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let out = '';
  for (const b of sig) out += b.toString(16).padStart(2, '0');
  return out;
}

/** X-Nexus-Signature value: `t=<unix>,v1=<hex HMAC(secret, t + "." + rawBody)>`. */
export async function signatureHeader(secret, rawBody, unixSeconds) {
  const t = String(Math.floor(unixSeconds));
  return `t=${t},v1=${await hmacHex(secret, `${t}.${rawBody}`)}`;
}

/** Receiver-side check (used by tests; mirrors the docs). */
export async function verifySignature(secret, rawBody, header, nowSeconds, toleranceSeconds = 300) {
  const parts = Object.fromEntries(String(header).split(',').map(p => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`);
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

// ── SSRF guard ─────────────────────────────────────────────────────────────

function ipv4Octets(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? o : null;
}

/** true when an IPv4 literal is not a public unicast address. */
export function isBlockedIPv4(host) {
  const o = ipv4Octets(host);
  if (!o) return false;
  const [a, b, c] = o;
  return (
    a === 0 ||                                   // 0.0.0.0/8 "this network"
    a === 10 ||                                  // private
    a === 127 ||                                 // loopback
    (a === 100 && b >= 64 && b <= 127) ||        // CGNAT 100.64/10
    (a === 169 && b === 254) ||                  // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||         // private
    (a === 192 && b === 168) ||                  // private
    (a === 192 && b === 0 && c === 0) ||         // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||         // TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) ||     // benchmarking
    (a === 198 && b === 51 && c === 100) ||      // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||       // TEST-NET-3
    a >= 224                                     // multicast + reserved + broadcast
  );
}

/** Expand an IPv6 literal (no brackets) to 8 hextets, or null. */
function ipv6Hextets(host) {
  let h = host.toLowerCase();
  const pct = h.indexOf('%');
  if (pct >= 0) h = h.slice(0, pct);
  if (!h.includes(':')) return null;
  // trailing embedded IPv4 (::ffff:1.2.3.4)
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4) {
    const o = ipv4Octets(v4[1]);
    if (!o) return null;
    h = h.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || !all.every(x => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map(x => parseInt(x, 16));
}

/** true when an IPv6 literal is loopback/unspecified/ULA/link-local/multicast or maps a blocked v4. */
export function isBlockedIPv6(host) {
  const x = ipv6Hextets(host);
  if (!x) return false;
  const zeroPrefix = x.slice(0, 5).every(n => n === 0);
  if (x.every(n => n === 0)) return true;                                   // ::
  if (x.slice(0, 7).every(n => n === 0) && x[7] === 1) return true;         // ::1
  if ((x[0] & 0xfe00) === 0xfc00) return true;                              // fc00::/7 ULA
  if ((x[0] & 0xffc0) === 0xfe80) return true;                              // fe80::/10 link-local
  if ((x[0] & 0xffc0) === 0xfec0) return true;                              // fec0::/10 site-local
  if ((x[0] & 0xff00) === 0xff00) return true;                              // multicast
  if (x[0] === 0x2001 && x[1] === 0x0db8) return true;                      // documentation
  if (x[0] === 0x0064 && x[1] === 0xff9b) return true;                      // NAT64 → v4 behind it
  if (zeroPrefix && (x[5] === 0xffff || x[5] === 0)) {                      // v4-mapped / v4-compatible
    const v4 = `${x[6] >> 8}.${x[6] & 255}.${x[7] >> 8}.${x[7] & 255}`;
    return isBlockedIPv4(v4) || x[5] === 0;                                 // deprecated ::a.b.c.d always refused
  }
  return false;
}

/** true when an IP literal (v4 or v6, brackets optional) must not be contacted. */
export function isBlockedIp(ip) {
  const h = String(ip).replace(/^\[|\]$/g, '');
  return isBlockedIPv4(h) || isBlockedIPv6(h);
}

/**
 * Decide whether a subscriber URL may be POSTed to.
 * Returns { ok: true, url } or { ok: false, reason } — reason is safe to store
 * (it never contains the URL, which may carry a customer's token in its path).
 * WHATWG URL normalises decimal/hex/octal IPv4 forms (https://2130706433/ →
 * 127.0.0.1), so literals are checked after parsing, not before.
 */
export function checkTargetUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'https_required' };
  if (u.username || u.password) return { ok: false, reason: 'credentials_in_url' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'invalid_url' };
  if (host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal') ||
      host === 'metadata.google.internal') {
    return { ok: false, reason: 'blocked_host' };
  }
  if (isBlockedIp(host)) return { ok: false, reason: 'blocked_ip' };
  if (u.port && !/^\d+$/.test(u.port)) return { ok: false, reason: 'invalid_url' };
  return { ok: true, url: u };
}

/** Is this hostname an IP literal (so DNS resolution is unnecessary)? */
export function isIpLiteral(host) {
  const h = String(host).replace(/^\[|\]$/g, '');
  return ipv4Octets(h) !== null || ipv6Hextets(h) !== null;
}

/**
 * Body POSTed to the subscriber. If the queued payload already is an envelope
 * ({type, data}) it is sent as-is; otherwise it is wrapped. `id` is the
 * delivery id so it is stable across retries (receivers dedupe on it).
 */
export function buildEnvelope(row, nowIso) {
  const p = row.payload;
  if (p && typeof p === 'object' && !Array.isArray(p) && 'type' in p && 'data' in p) {
    return { id: p.id ?? row.delivery_id, type: p.type, created_at: p.created_at ?? nowIso,
             tenant_id: p.tenant_id ?? row.tenant_id, data: p.data };
  }
  return { id: row.delivery_id, type: row.event, created_at: nowIso, tenant_id: row.tenant_id, data: p ?? {} };
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
