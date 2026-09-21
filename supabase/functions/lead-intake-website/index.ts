// NEXUS OS — supabase/functions/lead-intake-website/index.ts
//
// A dealer pastes one <script> tag (embed/nexus-lead-form.js) on its own
// website. The form posts here:
//
//   POST /functions/v1/lead-intake-website?k=<public_key>
//
// DEPLOY WITH verify_jwt = false. The caller is an anonymous visitor on the
// dealer's site; there is no user JWT and there never will be. The public key
// in ?k= is not a secret (it ships in page source): it only NAMES the
// dealership's website_form endpoint. What guards the door is the Origin
// allowlist on that endpoint, the rate limit, and the fact that the tenant
// comes from the endpoint and never from the body.
//
// All authority lives in SQL: public.nexus_ingest_website_form (NX1012),
// executable by service_role only. This function holds the service-role key
// (SUPABASE_SERVICE_ROLE_KEY, injected by Supabase), never returns it, never
// logs it, and logs no PII — only outcome codes.

import { parseSubmission, originAllowed, OUTCOME_HTTP, MAX_BODY_BYTES } from './validate.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const KEY_SHAPE = /^[A-Za-z0-9_-]{24,128}$/;

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'content-type';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function reply(status: number, body: Record<string, unknown> | null, allowedOrigin: string | null): Response {
  const headers = { ...cors(allowedOrigin), 'Cache-Control': 'no-store' } as Record<string, string>;
  if (body === null) return new Response(null, { status, headers });
  headers['Content-Type'] = 'application/json';
  return new Response(JSON.stringify(body), { status, headers });
}

const fail = (status: number, error: string, o: string | null) => reply(status, { ok: false, error }, o);

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('lead-intake-website: not configured');
    return fail(503, 'not_configured', null);
  }
  if (req.method !== 'POST' && req.method !== 'OPTIONS') return fail(405, 'method_not_allowed', null);

  const k = new URL(req.url).searchParams.get('k') ?? '';
  if (!KEY_SHAPE.test(k)) return fail(404, 'unknown_key', null);

  // Resolve the endpoint only to answer CORS; nexus_ingest_website_form
  // re-resolves and re-checks everything inside its own transaction.
  let ep: { source_key?: string; origin_allowlist?: string[] } | undefined;
  try {
    const r = await rpc('nexus_lead_endpoint_for_public_key', { p_public_key: k });
    if (!r.ok) {
      console.error('lead-intake-website: resolve failed', r.status);
      return fail(503, 'unavailable', null);
    }
    ep = Array.isArray(r.data) ? r.data[0] : undefined;
  } catch {
    console.error('lead-intake-website: resolve unreachable');
    return fail(503, 'unavailable', null);
  }
  if (!ep || ep.source_key !== 'website_form') return fail(404, 'unknown_key', null);

  const origin = req.headers.get('origin');
  const allowed = originAllowed(origin, ep.origin_allowlist ?? []) ? origin : null;
  if (!allowed) return fail(403, 'origin_not_allowed', null);

  if (req.method === 'OPTIONS') return reply(204, null, allowed);

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'payload_too_large', allowed);
  let text: string;
  try {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) return fail(413, 'payload_too_large', allowed);
    text = new TextDecoder().decode(buf);
  } catch {
    return fail(400, 'bad_payload', allowed);
  }

  const parsed = parseSubmission(req.headers.get('content-type'), text);
  if (!parsed.ok) return fail(parsed.status, parsed.error, allowed);
  if (parsed.honeypot) {
    console.log('lead-intake-website: honeypot');
    return reply(200, { ok: true }, allowed);
  }

  const f = parsed.fields as Record<string, string>;
  let row: { outcome?: string; lead_event_id?: string; was_duplicate?: boolean } | undefined;
  try {
    const r = await rpc('nexus_ingest_website_form', {
      p_public_key: k,
      p_origin: allowed,
      p_payload: {
        name: f.name, phone: f.phone ?? null, email: f.email ?? null,
        message: f.message ?? null, vehicle_interest: f.vehicle_interest ?? null,
        page_url: f.page_url ?? null,
      },
      p_submission_id: f.submission_id,
    });
    if (!r.ok) {
      // Ours, not theirs: 5XX so the browser retries with the same submission_id.
      console.error('lead-intake-website: ingest failed', r.status);
      return fail(503, 'unavailable', allowed);
    }
    row = Array.isArray(r.data) ? r.data[0] : undefined;
  } catch {
    console.error('lead-intake-website: ingest unreachable');
    return fail(503, 'unavailable', allowed);
  }

  const outcome = row?.outcome ?? '';
  const map = OUTCOME_HTTP[outcome as keyof typeof OUTCOME_HTTP];
  console.log('lead-intake-website:', outcome || 'NO_OUTCOME');
  if (!map) return fail(503, 'unavailable', allowed);
  const [status, error] = map;
  if (error) return fail(status, error, allowed);
  return reply(200, { ok: true, lead_event_id: row!.lead_event_id, was_duplicate: !!row!.was_duplicate }, allowed);
});
