// NEXUS OS — supabase/functions/api-v1/validate.mjs
//
// Pure request parsing and validation for the public REST API. No Deno, no
// network, no database: imported by index.ts at runtime and by
// validate.test.mjs under plain `node --test`, so the rules the API enforces
// at the edge are the rules CI checks. The database re-validates everything
// (NX1013); this layer exists to answer 4xx fast and to keep junk off the RPCs.

export const SCOPES = Object.freeze([
  'leads:read', 'leads:write', 'inventory:read', 'inventory:write', 'calls:write', 'appointments:read',
]);

export const MAX_BODY_BYTES = 1_000_000;
export const MAX_INVENTORY_BATCH = 500;
export const RATE_LIMIT_PER_MINUTE = 120;

const KEY_RE = /^nxk_live_[0-9a-f]{40}$/;
const EXTERNAL_ID_RE = /^[A-Za-z0-9._:@/-]{1,200}$/;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const LEAD_ID_RE = /^[1-9][0-9]{0,9}$/;

/** A validation failure the router turns into an HTTP response. */
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Extract an API key from an Authorization header. Returns null if absent or malformed. */
export function parseAuthorization(header) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  if (!m) return null;
  return KEY_RE.test(m[1]) ? m[1] : null;
}

/** Routing table: [method, pattern, name, scope|null]. */
const ROUTES = [
  ['GET',   /^\/v1\/me$/,                  'me',               null],
  ['GET',   /^\/v1\/leads$/,               'leads.list',       'leads:read'],
  ['POST',  /^\/v1\/leads$/,               'leads.create',     'leads:write'],
  ['GET',   /^\/v1\/leads\/([^/]+)$/,      'leads.get',        'leads:read'],
  ['PATCH', /^\/v1\/leads\/([^/]+)$/,      'leads.update',     'leads:write'],
  ['GET',   /^\/v1\/inventory$/,           'inventory.list',   'inventory:read'],
  ['POST',  /^\/v1\/inventory$/,           'inventory.upsert', 'inventory:write'],
  ['POST',  /^\/v1\/calls$/,               'calls.create',     'calls:write'],
  ['GET',   /^\/v1\/appointments$/,        'appointments.list','appointments:read'],
];

/** Strip everything up to and including the function name, e.g.
 *  /functions/v1/api-v1/v1/leads or /api-v1/v1/leads  ->  /v1/leads */
export function apiPath(pathname) {
  let p = String(pathname || '/');
  const i = p.indexOf('/api-v1');
  if (i >= 0) p = p.slice(i + '/api-v1'.length);
  p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Resolve a request to a route. Throws ApiError 404/405. */
export function route(method, pathname) {
  const path = apiPath(pathname);
  let pathMatched = false;
  for (const [m, re, name, scope] of ROUTES) {
    const hit = re.exec(path);
    if (!hit) continue;
    pathMatched = true;
    if (m === method) return { name, scope, params: hit.slice(1).map(decodeURIComponent) };
  }
  if (pathMatched) throw new ApiError(405, 'method_not_allowed', `${method} is not supported on ${path}.`);
  throw new ApiError(404, 'not_found', `No such endpoint: ${path}.`);
}

export function requireScope(scopes, needed) {
  if (!needed) return;
  if (!Array.isArray(scopes) || !scopes.includes(needed)) {
    throw new ApiError(403, 'insufficient_scope', `This API key lacks the ${needed} scope.`);
  }
}

export function parseLeadId(raw) {
  if (!LEAD_ID_RE.test(String(raw)) || Number(raw) > 2147483647) {
    throw new ApiError(404, 'not_found', 'No such lead.');
  }
  return Number(raw);
}

function parseLimit(v, dflt, max) {
  if (v == null || v === '') return dflt;
  if (!/^[0-9]{1,4}$/.test(v) || Number(v) < 1 || Number(v) > max) {
    throw new ApiError(422, 'invalid_limit', `limit must be an integer 1-${max}.`);
  }
  return Number(v);
}

function parseTimestamp(v, field) {
  if (v == null || v === '') return null;
  // ISO-8601 with an explicit offset or Z; a bare date is accepted as UTC midnight.
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2}))?$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ApiError(422, 'invalid_timestamp', `${field} must be an ISO-8601 timestamp, e.g. 2026-09-21T10:00:00Z.`);
  }
  return new Date(v).toISOString();
}

function parseCursor(v) {
  if (v == null || v === '') return null;
  if (!/^[0-9a-f.-]{1,300}$/i.test(v)) throw new ApiError(422, 'invalid_cursor', 'Malformed cursor.');
  return v;
}

const ONLY = (sp, allowed) => {
  for (const k of sp.keys()) {
    if (!allowed.includes(k)) throw new ApiError(422, 'unknown_parameter', `Unknown query parameter: ${k}. Allowed: ${allowed.join(', ')}.`);
  }
};

export function parseLeadsQuery(sp) {
  ONLY(sp, ['updated_since', 'limit', 'cursor']);
  return {
    p_updated_since: parseTimestamp(sp.get('updated_since'), 'updated_since'),
    p_limit: parseLimit(sp.get('limit'), 50, 200),
    p_cursor: parseCursor(sp.get('cursor')),
  };
}

export function parseInventoryQuery(sp) {
  ONLY(sp, ['status', 'limit', 'cursor']);
  const status = sp.get('status');
  if (status != null && (status.length < 1 || status.length > 40)) {
    throw new ApiError(422, 'invalid_status', 'status must be 1-40 characters.');
  }
  return { p_status: status || null, p_limit: parseLimit(sp.get('limit'), 100, 500), p_cursor: parseCursor(sp.get('cursor')) };
}

export const APPOINTMENT_STATES = ['REQUESTED', 'OFFERED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'];

export function parseAppointmentsQuery(sp) {
  ONLY(sp, ['updated_since', 'state', 'limit', 'cursor']);
  const state = sp.get('state');
  if (state != null && !/^[A-Za-z_]{2,20}$/.test(state)) {
    throw new ApiError(422, 'invalid_state', 'state must be an appointment state such as CONFIRMED.');
  }
  return {
    p_updated_since: parseTimestamp(sp.get('updated_since'), 'updated_since'),
    p_state: state ? state.toUpperCase() : null,
    p_limit: parseLimit(sp.get('limit'), 50, 200),
    p_cursor: parseCursor(sp.get('cursor')),
  };
}

/** Parse a JSON body text. Throws 413/422. */
export function parseJsonBody(text) {
  if (typeof text !== 'string' || text.length === 0) throw new ApiError(422, 'invalid_json', 'A JSON body is required.');
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large', 'Body exceeds 1 MB.');
  try { return JSON.parse(text); } catch { throw new ApiError(422, 'invalid_json', 'The body is not valid JSON.'); }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Normalise a phone the way the database does (nexus_api_e164). Returns null if unusable. */
export function toE164(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/[\s().-]/g, '');
  if (E164_RE.test(v)) return v;
  if (/^00[1-9][0-9]{7,14}$/.test(v)) return '+' + v.slice(2);
  if (/^971[0-9]{8,9}$/.test(v)) return '+' + v;
  if (/^0[1-9][0-9]{7,8}$/.test(v)) return '+971' + v.slice(1);
  return null;
}

/** POST /v1/leads. Returns { payload, externalId }. */
export function validateLeadCreate(body, idempotencyKey) {
  if (!isObj(body)) throw new ApiError(422, 'invalid_body', 'The body must be a JSON object.');
  const hdr = idempotencyKey == null || idempotencyKey === '' ? null : String(idempotencyKey);
  const ext = body.external_id == null ? null : body.external_id;
  if (hdr !== null && !EXTERNAL_ID_RE.test(hdr)) throw new ApiError(422, 'invalid_idempotency_key', 'Idempotency-Key must be 1-200 of letters, digits and ._:@/-');
  if (ext !== null && (typeof ext !== 'string' || !EXTERNAL_ID_RE.test(ext))) throw new ApiError(422, 'invalid_external_id', 'external_id must be 1-200 of letters, digits and ._:@/-');
  if (hdr !== null && ext !== null && hdr !== ext) throw new ApiError(422, 'idempotency_conflict', 'Idempotency-Key and external_id differ; send one, or the same value in both.');
  const name = body.name ?? body.full_name;
  if (!str(name, 200)) throw new ApiError(422, 'name_required', 'name is required (1-200 characters).');
  if (body.email != null && (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 254)) {
    throw new ApiError(422, 'invalid_email', 'email is malformed.');
  }
  if (body.phone != null && toE164(String(body.phone)) === null) {
    throw new ApiError(422, 'invalid_phone', 'phone must be an E.164 number such as +971501234567.');
  }
  if (body.email == null && body.phone == null) throw new ApiError(422, 'contact_required', 'A lead needs an email or a phone.');
  if (body.budget_aed != null && (typeof body.budget_aed !== 'number' || !Number.isFinite(body.budget_aed) || body.budget_aed < 0 || body.budget_aed > 1e8)) {
    throw new ApiError(422, 'invalid_budget', 'budget_aed must be a number between 0 and 100,000,000.');
  }
  if (body.vehicle_interest != null && typeof body.vehicle_interest !== 'string') throw new ApiError(422, 'invalid_vehicle_interest', 'vehicle_interest must be a string.');
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) throw new ApiError(422, 'invalid_notes', 'notes must be a string of at most 2000 characters.');
  if (body.occurred_at != null) parseTimestamp(String(body.occurred_at), 'occurred_at');
  const payload = {};
  for (const k of ['name', 'full_name', 'email', 'phone', 'vehicle_interest', 'budget_aed', 'notes', 'source_detail', 'occurred_at']) {
    if (body[k] !== undefined) payload[k] = body[k];
  }
  if (payload.phone != null) payload.phone = toE164(String(payload.phone));
  return { payload, externalId: hdr ?? ext };
}

export const LEAD_PATCH_FIELDS = ['status', 'assigned_to_id', 'vehicle_interest', 'budget_aed', 'notes'];

export function validateLeadPatch(body) {
  if (!isObj(body) || Object.keys(body).length === 0) throw new ApiError(422, 'invalid_body', 'The body must be a non-empty JSON object.');
  const bad = Object.keys(body).filter(k => !LEAD_PATCH_FIELDS.includes(k));
  if (bad.length) throw new ApiError(422, 'field_not_updatable', `Not updatable: ${bad.join(', ')}. Updatable: ${LEAD_PATCH_FIELDS.join(', ')}.`);
  if ('status' in body && (typeof body.status !== 'string' || !/^[A-Za-z][A-Za-z_ -]{0,31}$/.test(body.status.trim()))) {
    throw new ApiError(422, 'invalid_status', 'status must be a word of 1-32 letters (e.g. HOT, WARM, COLD, WON, LOST).');
  }
  if ('assigned_to_id' in body && body.assigned_to_id !== null
      && (typeof body.assigned_to_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assigned_to_id))) {
    throw new ApiError(422, 'invalid_assignee', 'assigned_to_id must be a uuid or null.');
  }
  if ('budget_aed' in body && body.budget_aed !== null && (typeof body.budget_aed !== 'number' || body.budget_aed < 0 || body.budget_aed > 1e8)) {
    throw new ApiError(422, 'invalid_budget', 'budget_aed must be a number between 0 and 100,000,000, or null.');
  }
  if ('vehicle_interest' in body && body.vehicle_interest !== null && typeof body.vehicle_interest !== 'string') {
    throw new ApiError(422, 'invalid_vehicle_interest', 'vehicle_interest must be a string or null.');
  }
  if ('notes' in body && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
    throw new ApiError(422, 'invalid_notes', 'notes must be a string of at most 2000 characters.');
  }
  return body;
}

/** POST /v1/inventory: object or array of 1-500. Per-row rules are enforced by the database, per row. */
export function validateInventoryBody(body) {
  const items = Array.isArray(body) ? body : isObj(body) ? [body] : null;
  if (!items) throw new ApiError(422, 'invalid_body', 'Send one vehicle object or an array of vehicles.');
  if (items.length === 0 || items.length > MAX_INVENTORY_BATCH) {
    throw new ApiError(422, 'invalid_batch_size', `Send between 1 and ${MAX_INVENTORY_BATCH} vehicles per request.`);
  }
  items.forEach((it, i) => {
    if (!isObj(it)) throw new ApiError(422, 'invalid_vehicle', `Item ${i} is not an object.`);
    if (it.stock_number == null && it.vin == null) throw new ApiError(422, 'vehicle_key_required', `Item ${i} needs a stock_number or a vin.`);
  });
  return items;
}

export function validateCall(body) {
  if (!isObj(body)) throw new ApiError(422, 'invalid_body', 'The body must be a JSON object.');
  if (typeof body.external_call_id !== 'string' || !EXTERNAL_ID_RE.test(body.external_call_id)) {
    throw new ApiError(422, 'invalid_external_call_id', 'external_call_id is required (1-200 of letters, digits and ._:@/-).');
  }
  if (!['inbound', 'outbound'].includes(body.direction)) throw new ApiError(422, 'invalid_direction', 'direction must be inbound or outbound.');
  const customer = body.direction === 'inbound' ? body.from_number : body.to_number;
  if (toE164(customer == null ? '' : String(customer)) === null) {
    throw new ApiError(422, 'invalid_customer_phone', `${body.direction === 'inbound' ? 'from_number' : 'to_number'} must be the customer's phone number, e.g. +971501234567.`);
  }
  if (body.duration_sec != null && (!Number.isInteger(body.duration_sec) || body.duration_sec < 0 || body.duration_sec > 86400)) {
    throw new ApiError(422, 'invalid_duration', 'duration_sec must be an integer 0-86400.');
  }
  if (body.recording_url != null && (typeof body.recording_url !== 'string' || !/^https:\/\/\S+$/.test(body.recording_url) || body.recording_url.length > 2048)) {
    throw new ApiError(422, 'invalid_recording_url', 'recording_url must be an https:// URL.');
  }
  if (body.started_at != null) parseTimestamp(String(body.started_at), 'started_at');
  return body;
}

/** Map a PostgREST/RPC error to an HTTP error without leaking internals. */
export function mapDbError(err) {
  const detail = String(err?.details ?? err?.detail ?? '');
  const message = String(err?.message ?? '');
  if (detail === 'NX_API_NOT_FOUND') return new ApiError(404, 'not_found', message || 'Not found.');
  if (detail === 'NX_API_NO_DEALERSHIP') return new ApiError(403, 'dealership_inactive', 'This dealership is not active.');
  if (detail === 'CONCURRENT_RECORD_ROLLED_BACK') return new ApiError(503, 'retry', 'A concurrent request held this key; retry.');
  if (/^(NX_API_|NX_WEBHOOK_|NORMALIZED_|OCCURRED_AT_)/.test(detail)) {
    return new ApiError(422, detail.toLowerCase(), message || 'The request was refused.');
  }
  return new ApiError(500, 'internal_error', 'Something went wrong on our side. Retry, or contact NEXUS support with the X-Request-Id.');
}

export function errorBody(e) {
  return { error: { code: e.code, message: e.message } };
}
