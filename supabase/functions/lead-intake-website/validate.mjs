// Pure request-shape logic for lead-intake-website. No I/O, so it runs under
// Deno (the edge function) and Node (validate.test.mjs) unchanged.
//
// This is the FIRST filter, not the authority. Tenant, Origin allowlist, rate
// limit, idempotency and the Lead Event contract are decided in SQL by
// public.nexus_ingest_website_form. This only refuses what is obviously not a
// form submission before a database round trip is spent on it.

export const MAX_BODY_BYTES = 10 * 1024;
export const FIELDS = ['name', 'phone', 'email', 'message', 'vehicle_interest', 'submission_id', 'page_url'];
const LIMITS = { name: 120, phone: 40, email: 160, message: 2000, vehicle_interest: 200, submission_id: 64, page_url: 500 };
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normOrigin(o) {
  return String(o || '').trim().replace(/\/+$/, '').toLowerCase();
}

export function originAllowed(origin, allowlist) {
  const o = normOrigin(origin);
  if (!o || o === 'null') return false;
  return Array.isArray(allowlist) && allowlist.some((a) => normOrigin(a) === o);
}

// Returns { ok:true, honeypot:boolean, fields } or { ok:false, status, error }.
export function parseSubmission(contentType, bodyText) {
  const bytes = new TextEncoder().encode(bodyText || '').length;
  if (bytes > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'payload_too_large' };
  const ct = String(contentType || '').toLowerCase();
  let raw;
  try {
    if (ct.includes('application/json')) {
      raw = JSON.parse(bodyText || '{}');
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      raw = Object.fromEntries(new URLSearchParams(bodyText || ''));
    } else {
      return { ok: false, status: 415, error: 'unsupported_content_type' };
    }
  } catch {
    return { ok: false, status: 400, error: 'bad_json' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'bad_payload' };
  }
  // Honeypot: a person never fills a field they cannot see.
  const honeypot = typeof raw.website === 'string' ? raw.website.trim() !== '' : raw.website != null && raw.website !== '';
  const fields = {};
  for (const k of FIELDS) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).replace(CONTROL, '').trim().slice(0, LIMITS[k]);
    if (s) fields[k] = s;
  }
  if (honeypot) return { ok: true, honeypot: true, fields: {} };
  if (!fields.phone && !fields.email) return { ok: false, status: 400, error: 'contact_required' };
  if (!fields.name) return { ok: false, status: 400, error: 'name_required' };
  if (!fields.submission_id || !UUID.test(fields.submission_id)) {
    return { ok: false, status: 400, error: 'submission_id_required' };
  }
  return { ok: true, honeypot: false, fields };
}

// SQL outcome -> HTTP status + public error code.
export const OUTCOME_HTTP = {
  ACCEPTED: [200, null],
  DUPLICATE: [200, null],
  UNKNOWN_KEY: [404, 'unknown_key'],
  ORIGIN_NOT_ALLOWED: [403, 'origin_not_allowed'],
  RATE_LIMITED: [429, 'rate_limited'],
  BAD_PAYLOAD: [400, 'bad_payload'],
  SUBMISSION_ID_REQUIRED: [400, 'submission_id_required'],
  CONTACT_REQUIRED: [400, 'contact_required'],
  NAME_REQUIRED: [400, 'name_required'],
};
