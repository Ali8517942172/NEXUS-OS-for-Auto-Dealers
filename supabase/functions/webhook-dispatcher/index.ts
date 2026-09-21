// NEXUS OS — supabase/functions/webhook-dispatcher/index.ts
//
// Outbound webhook dispatcher. Invoked once a minute by pg_cron + pg_net
// (migration 20260921211000_nx1014_webhook_dispatch_schedule.sql) with the
// service-role key read from Vault. Deployed with verify_jwt = true, and on
// top of that refuses any caller whose bearer is not the service role: a
// signed-in dealer's JWT passes the gateway but must not be able to drain
// every dealership's queue.
//
// Per run: nexus_webhook_claim_deliveries(50) → POST each (5 at a time, 10s
// timeout, no redirects, https only, SSRF guard) → nexus_webhook_mark_delivery
// for every claimed row. Backoff, dead-lettering and auto-disable live in the
// mark RPC, not here.
//
// LOGGING: counts and delivery ids only. Never the URL (it may carry a
// customer's token), the secret, the payload, or the response body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { signatureHeader, checkTargetUrl, isBlockedIp, isIpLiteral, buildEnvelope, mapLimit } from './lib.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CLAIM_LIMIT = 50;
const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const MAX_ERROR_LEN = 300;

type Row = {
  delivery_id: string; webhook_id: string; tenant_id: string; url: string;
  secret: string; event: string; payload: unknown; attempts: number;
};
type Result = { ok: boolean; status: number | null; error: string | null };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bearerIsServiceRole(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  // Gateway already verified the signature (verify_jwt = true); read the role claim.
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

// DNS-level SSRF check: refuse a public-looking hostname that resolves to a
// private address. (A rebinding race between this lookup and fetch's own is
// still possible; the Edge runtime has no route to our private network, so
// this is defence in depth, not the only wall.)
async function resolvesToBlocked(host: string): Promise<boolean | null> {
  const addrs: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { addrs.push(...(await Deno.resolveDns(host, type))); } catch { /* no record of this type */ }
  }
  if (addrs.length === 0) return null;
  return addrs.some(a => isBlockedIp(a));
}

function trimError(e: unknown): string {
  const name = e instanceof Error ? e.name : 'Error';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  // Error messages from fetch can include the URL; keep only the class.
  return `network_error:${name}`.slice(0, MAX_ERROR_LEN);
}

async function deliver(row: Row): Promise<Result> {
  const target = checkTargetUrl(row.url);
  if (!target.ok) return { ok: false, status: null, error: `refused:${target.reason}` };
  const host = target.url.hostname.replace(/^\[|\]$/g, '');
  if (!isIpLiteral(host)) {
    const blocked = await resolvesToBlocked(host);
    if (blocked === null) return { ok: false, status: null, error: 'dns_unresolved' };
    if (blocked) return { ok: false, status: null, error: 'refused:blocked_ip' };
  }
  if (!row.secret) return { ok: false, status: null, error: 'refused:no_secret' };

  const body = JSON.stringify(buildEnvelope(row, new Date().toISOString()));
  const signature = await signatureHeader(row.secret, body, Date.now() / 1000);
  try {
    const res = await fetch(target.url.href, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NEXUS-Webhooks/1',
        'X-Nexus-Event': row.event,
        'X-Nexus-Delivery': row.delivery_id,
        'X-Nexus-Signature': signature,
      },
      body,
    });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    const ok = res.status >= 200 && res.status < 300;
    const redirected = res.status >= 300 && res.status < 400;
    return { ok, status: res.status, error: ok ? null : redirected ? 'redirect_not_followed' : `http_${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: trimError(e) };
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: { code: 'method_not_allowed', message: 'POST only' } });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: { code: 'misconfigured', message: 'runtime env missing' } });
  if (!bearerIsServiceRole(req)) return json(403, { error: { code: 'forbidden', message: 'service role only' } });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('nexus_webhook_claim_deliveries', { p_limit: CLAIM_LIMIT });
  if (error) {
    console.error('webhook-dispatcher: claim failed', error.code ?? '');
    return json(500, { error: { code: 'claim_failed', message: 'could not claim deliveries' } });
  }
  const rows = (data ?? []) as Row[];
  let ok = 0, failed = 0, markErrors = 0;

  await mapLimit(rows, CONCURRENCY, async (row: Row) => {
    const r = await deliver(row);
    r.ok ? ok++ : failed++;
    const { error: markErr } = await db.rpc('nexus_webhook_mark_delivery', {
      p_delivery_id: row.delivery_id, p_ok: r.ok, p_status_code: r.status, p_error: r.error,
    });
    if (markErr) {
      markErrors++;
      console.error('webhook-dispatcher: mark failed', row.delivery_id, markErr.code ?? '');
    }
  });

  console.log(`webhook-dispatcher: claimed=${rows.length} ok=${ok} failed=${failed} mark_errors=${markErrors}`);
  return json(200, { claimed: rows.length, ok, failed, mark_errors: markErrors });
});
