// NEXUS OS — supabase/functions/api-v1/index.ts
//
// The tenant-scoped public REST API. NEXUS sits ON TOP of a dealership's own
// DMS, CRM and call system; this is the door those systems use to read leads,
// push leads, stock and calls, and read appointments. Contract: openapi.yaml
// beside this file. Database half: migration NX1013.
//
// AUTHORITY. Callers send `Authorization: Bearer nxk_live_...`. The key is
// resolved by nexus_api_authenticate() (sha256 lookup, revoked keys and
// inactive dealerships refused) using the service-role key this function
// reads from its own runtime environment. Every data RPC takes p_tenant, and
// the ONLY value ever passed is the tenant that authenticate returned — never
// anything from the request.
//
// DEPLOY with verify_jwt = false (callers hold an API key, not a Supabase JWT):
//   supabase functions deploy api-v1 --no-verify-jwt
//
// RATE LIMIT. 120 requests/minute per key, fixed one-minute window, counted in
// Postgres (api_rate_window via nexus_api_rate_limit_hit) so it holds across
// edge isolates. If that counter cannot be reached the request is served
// (fail open on the limiter only; authentication never fails open).
//
// CORS is deliberately OFF: this is a server-to-server API. No
// Access-Control-* headers are sent, so a browser page cannot call it with a
// dealer's key.
//
// LOGGING. One line per request: request id, method, route name, status,
// duration, key id. Never a body, a name, a phone, an email or a key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ApiError, RATE_LIMIT_PER_MINUTE, errorBody, mapDbError, parseAppointmentsQuery, parseAuthorization,
  parseInventoryQuery, parseJsonBody, parseLeadId, parseLeadsQuery, requireScope, route,
  validateCall, validateInventoryBody, validateLeadCreate, validateLeadPatch,
} from './validate.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const db = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

type Json = Record<string, unknown> | unknown[] | null;

function respond(status: number, body: Json, requestId: string, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': requestId,
    'x-content-type-options': 'nosniff',
    ...extra,
  };
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db!.rpc(fn, args);
  if (error) throw mapDbError(error);
  return data;
}

async function readBody(req: Request) {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 1_000_000) throw new ApiError(413, 'payload_too_large', 'Body exceeds 1 MB.');
  const ct = req.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(ct)) throw new ApiError(415, 'unsupported_media_type', 'Send Content-Type: application/json.');
  return parseJsonBody(await req.text());
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  let routeName = 'unrouted';
  let keyId: string | null = null;
  let rateHeaders: Record<string, string> = {};
  let res: Response;

  try {
    if (!db) throw new ApiError(500, 'misconfigured', 'The API is not configured.');
    const url = new URL(req.url);
    const r = route(req.method, url.pathname);
    routeName = r.name;

    const key = parseAuthorization(req.headers.get('authorization'));
    if (!key) throw new ApiError(401, 'unauthorized', 'Send Authorization: Bearer <your NEXUS API key>.');
    const auth = await rpc('nexus_api_authenticate', { p_key: key });
    const who = Array.isArray(auth) ? auth[0] : null;
    if (!who) throw new ApiError(401, 'unauthorized', 'This API key is not valid, has been revoked, or its dealership is inactive.');
    keyId = who.key_id;
    const tenant: string = who.tenant_id;

    try {
      const { data: rl } = await db.rpc('nexus_api_rate_limit_hit', { p_key_id: keyId, p_limit: RATE_LIMIT_PER_MINUTE });
      const w = Array.isArray(rl) ? rl[0] : null;
      if (w) {
        const reset = Math.ceil(new Date(w.reset_at).getTime() / 1000);
        rateHeaders = {
          'x-ratelimit-limit': String(RATE_LIMIT_PER_MINUTE),
          'x-ratelimit-remaining': String(w.remaining),
          'x-ratelimit-reset': String(reset),
        };
        if (!w.allowed) {
          rateHeaders['retry-after'] = String(Math.max(1, reset - Math.floor(Date.now() / 1000)));
          throw new ApiError(429, 'rate_limited', `More than ${RATE_LIMIT_PER_MINUTE} requests in a minute. Retry after the Retry-After header.`);
        }
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;   // limiter unreachable: serve the request
    }

    requireScope(who.scopes, r.scope);
    const sp = url.searchParams;

    switch (r.name) {
      case 'me': {
        const me = await rpc('nexus_api_me', { p_tenant: tenant, p_key_id: keyId });
        res = respond(200, me, requestId, rateHeaders); break;
      }
      case 'leads.list': {
        const q = parseLeadsQuery(sp);
        res = respond(200, await rpc('nexus_api_leads_list', { p_tenant: tenant, ...q }), requestId, rateHeaders); break;
      }
      case 'leads.get': {
        const lead = await rpc('nexus_api_lead_get', { p_tenant: tenant, p_lead_id: parseLeadId(r.params[0]) });
        if (!lead) throw new ApiError(404, 'not_found', 'No such lead.');
        res = respond(200, { data: lead }, requestId, rateHeaders); break;
      }
      case 'leads.create': {
        const { payload, externalId } = validateLeadCreate(await readBody(req), req.headers.get('idempotency-key'));
        const out = await rpc('nexus_api_lead_create', { p_tenant: tenant, p_payload: payload, p_external_id: externalId });
        res = respond(out.created ? 201 : 200,
          { data: out.lead, created: out.created, duplicate_of: out.duplicate_of ?? null }, requestId, rateHeaders);
        break;
      }
      case 'leads.update': {
        const id = parseLeadId(r.params[0]);
        const patch = validateLeadPatch(await readBody(req));
        res = respond(200, { data: await rpc('nexus_api_lead_update', { p_tenant: tenant, p_lead_id: id, p_patch: patch }) },
          requestId, rateHeaders);
        break;
      }
      case 'inventory.list': {
        res = respond(200, await rpc('nexus_api_inventory_list', { p_tenant: tenant, ...parseInventoryQuery(sp) }), requestId, rateHeaders);
        break;
      }
      case 'inventory.upsert': {
        const items = validateInventoryBody(await readBody(req));
        res = respond(200, await rpc('nexus_api_inventory_upsert', { p_tenant: tenant, p_payload: items }), requestId, rateHeaders);
        break;
      }
      case 'calls.create': {
        const call = validateCall(await readBody(req));
        const out = await rpc('nexus_api_call_log', { p_tenant: tenant, p_payload: call });
        res = respond(out.was_duplicate ? 200 : 201, { data: out }, requestId, rateHeaders);
        break;
      }
      case 'appointments.list': {
        res = respond(200, await rpc('nexus_api_appointments_list', { p_tenant: tenant, ...parseAppointmentsQuery(sp) }), requestId, rateHeaders);
        break;
      }
      default:
        throw new ApiError(404, 'not_found', 'No such endpoint.');
    }
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'internal_error', 'Something went wrong on our side.');
    if (!(e instanceof ApiError)) console.error(JSON.stringify({ request_id: requestId, route: routeName, error: 'unhandled' }));
    const extra = { ...rateHeaders };
    if (err.status === 401) extra['www-authenticate'] = 'Bearer realm="nexus-api"';
    if (err.status === 405) extra['allow'] = 'GET, POST, PATCH';
    res = respond(err.status, errorBody(err), requestId, extra);
  }

  console.log(JSON.stringify({
    request_id: requestId, method: req.method, route: routeName, status: res!.status,
    ms: Date.now() - started, key_id: keyId,
  }));
  return res!;
});
