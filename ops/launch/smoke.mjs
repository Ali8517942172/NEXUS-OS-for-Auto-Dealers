#!/usr/bin/env node
/**
 * NEXUS launch smoke test — one repeatable run, one PASS/FAIL table.
 *
 *   node ops/launch/smoke.mjs --env=staging
 *   node ops/launch/smoke.mjs --env=production     (READ-ONLY lane only)
 *
 * WHAT THIS IS FOR
 *   Before a launch, somebody has to be able to ask "does the thing still do
 *   the thing" and get an answer in thirty seconds that nobody had to
 *   interpret. That is all this is. It is not a test suite and it does not
 *   replace ops/tenant-isolation-tests/two-tenant-suite.sql, which is far more
 *   thorough about tenancy than this file will ever be.
 *
 * THE THREE VERDICTS, AND WHY THERE ARE THREE
 *   PASS     the check ran and the system behaved.
 *   FAIL     the check ran and the system did not. Exit code is 1.
 *   NOT RUN  the check could NOT be run, with the reason printed beside it.
 *
 *   A check that cannot run never prints PASS. A missing credential, an absent
 *   function, an empty fixture: each of those is a NOT RUN carrying the reason,
 *   because a green square that means "we did not look" is worse than a red
 *   one — it is the same shape as evidence and it is not evidence.
 *
 * PRODUCTION IS READ-ONLY, AND IT IS ENFORCED IN CODE
 *   The production lane refuses to issue anything but GET/HEAD. Not by
 *   convention: request() throws on any other method when lane.readOnly is set,
 *   so a check added later that tries to POST at production fails loudly here
 *   rather than quietly writing to a dealership's database. PostgREST serves a
 *   STABLE function over GET, so the read-only accessor checks still run.
 *
 * CREDENTIALS ARE READ AT RUNTIME AND NEVER PRINTED
 *   Everything comes from the env file (default below, override with
 *   --env-file= or NEXUS_ENV_FILE) or from the process environment, which
 *   wins. No key is written into this file and no key is echoed into the
 *   output — only whether one was present.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

/* ── args and environment ─────────────────────────────────────────────── */

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));

const ENV_FILE = ARGS['env-file'] || process.env.NEXUS_ENV_FILE
  || `${homedir()}/mnt/MY RESUMES/nexus-os/.env`;

function readEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
    return { ok: true, values: out };
  } catch (e) {
    return { ok: false, values: {}, why: `${path}: ${e.code || e.message}` };
  }
}

const FILE_ENV = readEnvFile(ENV_FILE);
const E = { ...FILE_ENV.values, ...process.env };
const has = v => typeof v === 'string' && v.trim().length > 0;

const LANE_NAME = (ARGS.env || 'staging').toLowerCase();
if (!['staging', 'production'].includes(LANE_NAME)) {
  console.error(`unknown --env=${LANE_NAME}; use staging or production`);
  process.exit(2);
}

const LANE = LANE_NAME === 'staging'
  ? {
      name: 'staging',
      readOnly: false,
      url: (E.NEXUS_STAGING_URL || '').replace(/\/+$/, ''),
      anon: E.NEXUS_STAGING_ANON_KEY || E.NEXUS_STAGING_PUBLISHABLE_KEY || '',
      service: E.NEXUS_STAGING_SERVICE_ROLE_KEY || '',
    }
  : {
      name: 'production',
      readOnly: true,
      url: (E.SUPABASE_URL || '').replace(/\/+$/, ''),
      anon: E.SUPABASE_ANON_KEY || '',
      service: E.SUPABASE_SERVICE_ROLE_KEY || '',
    };

/* ── verdict recording ────────────────────────────────────────────────── */

const RESULTS = [];
const rec = (group, name, status, detail) => {
  RESULTS.push({ group, name, status, detail: String(detail ?? '').replace(/\s+/g, ' ').slice(0, 150) });
};
const PASS = (g, n, d) => rec(g, n, 'PASS', d);
const FAIL = (g, n, d) => rec(g, n, 'FAIL', d);
const SKIP = (g, n, d) => rec(g, n, 'NOT RUN', d);

/* ── HTTP ─────────────────────────────────────────────────────────────── */

class ReadOnlyViolation extends Error {}

async function request(path, opts = {}) {
  const { method = 'GET', key, token, body, profile, prefer, headers = {} } = opts;
  if (LANE.readOnly && !['GET', 'HEAD'].includes(method)) {
    throw new ReadOnlyViolation(
      `refused ${method} ${path}: the production lane of this harness is read-only by construction.`);
  }
  if (!LANE.url) throw new Error('no project URL for this lane');
  const h = {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    Accept: 'application/json',
    ...headers,
  };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (profile) { h['Content-Profile'] = profile; h['Accept-Profile'] = profile; }
  if (prefer) h.Prefer = prefer;

  const r = await fetch(LANE.url + path, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return {
    ok: r.ok, status: r.status, json, text,
    range: r.headers.get('content-range'),
    /* The message without the key, the URL or anything else a log should not carry. */
    why: (json && (json.message || json.error_description || json.error || json.hint)) || text.slice(0, 140),
  };
}

const rest = (table, qs, o = {}) => request(`/rest/v1/${table}${qs ? '?' + qs : ''}`, o);
const rpcPost = (fn, args, o = {}) => request(`/rest/v1/rpc/${fn}`, { ...o, method: 'POST', body: args });
const rpcGet = (fn, o = {}) => request(`/rest/v1/rpc/${fn}`, { ...o, method: 'GET' });

/* A password grant against GoTrue. POST, so it can only ever happen off
   production — request()'s guard, not a comment, is what makes that true. */
async function signIn(email, password) {
  const r = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', key: LANE.anon, body: { email, password },
  });
  return r.ok && r.json?.access_token
    ? { ok: true, token: r.json.access_token }
    : { ok: false, why: `sign-in ${r.status}: ${r.why}` };
}

const isRefusal = r => !r.ok && r.status >= 400;
/* The endpoint is not there, as opposed to there and saying no. PostgREST
   answers 404 for an unknown function and 406 for a schema it does not
   expose; either way nothing was tested. */
const unreachable = r => r.status === 404 || r.status === 406 ||
  /invalid schema|could not find the function|does not exist/i.test(String(r.why));
const rows = r => (Array.isArray(r.json) ? r.json : r.json ? [r.json] : []);

/* ── 1. website: the live /api/lead shape, against the RPC it actually calls ── */

async function groupWebsite() {
  const G = 'website';
  if (LANE.readOnly) {
    return SKIP(G, 'lead submission', 'production lane is read-only; submitting a lead there would be a test event in a real pipeline');
  }
  if (!has(LANE.anon)) {
    return SKIP(G, 'lead submission', 'no publishable key for this lane (NEXUS_STAGING_ANON_KEY)');
  }

  const sub = `smoke-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const attribution = {
    utm_source: 'smoke-harness', utm_medium: 'ops', utm_campaign: 'launch-smoke',
    gclid: `smoke-gclid-${randomUUID().slice(0, 8)}`,
  };
  /* Exactly the body apps/marketing-site/api/lead.js sends, in the same
     schema, with the same profile header. If this call shape drifts from that
     file, this check is the thing that notices. */
  const payload = {
    p_submission_id: sub,
    p_full_name: 'Smoke Harness',
    p_phone_e164: '+971500000000',
    p_email: 'smoke@nexus.invalid',
    p_dealership: 'Smoke Motors',
    p_stock_size: '50-200',
    p_message: 'Automated launch smoke test. Not a person.',
    p_attribution: attribution,
    p_ip_country: 'AE',
  };

  const first = await rpcPost('submit_sales_lead', payload, { key: LANE.anon, profile: 'nexus_intake' });
  /* Unreachable is not refused. A 404, or PostgREST's 406 "Invalid schema",
     means the door is not there at all -- and a check that never reached the
     validation it was testing must not claim the validation held. */
  if (unreachable(first)) {
    const why = `submit_sales_lead unreachable over PostgREST (${first.status}: ${String(first.why).slice(0, 60)}). Either nexus_intake is missing from this project's exposed schemas, or NX974/NX975 are not applied here.`;
    SKIP(G, 'durable storage', why);
    SKIP(G, 'duplicate submission', why);
    SKIP(G, 'malformed refused', why);
    SKIP(G, 'attribution persisted', why);
    return;
  }

  const r1 = rows(first)[0];
  if (first.ok && r1 && r1.was_duplicate === false && r1.submission_id === sub) {
    PASS(G, 'durable storage', `stored, was_duplicate=false, received_at=${r1.received_at}`);
  } else {
    FAIL(G, 'durable storage', `status ${first.status}: ${first.why}`);
  }

  const second = await rpcPost('submit_sales_lead', payload, { key: LANE.anon, profile: 'nexus_intake' });
  const r2 = rows(second)[0];
  if (second.ok && r2 && r2.was_duplicate === true) {
    PASS(G, 'duplicate submission', 'same submission_id returned was_duplicate=true — one enquiry, one row');
  } else {
    FAIL(G, 'duplicate submission', `status ${second.status}: ${second.why}`);
  }

  const noName = await rpcPost('submit_sales_lead',
    { ...payload, p_submission_id: sub + '-x1', p_full_name: '   ' }, { key: LANE.anon, profile: 'nexus_intake' });
  const noContact = await rpcPost('submit_sales_lead',
    { ...payload, p_submission_id: sub + '-x2', p_phone_e164: null, p_email: null }, { key: LANE.anon, profile: 'nexus_intake' });
  if (unreachable(noName) || unreachable(noContact)) {
    FAIL(G, 'malformed refused', `the endpoint stopped answering mid-run (${noName.status}/${noContact.status}); nothing was validated`);
  } else if (isRefusal(noName) && isRefusal(noContact)) {
    PASS(G, 'malformed refused', `no name -> ${noName.status}, no reachable contact -> ${noContact.status}`);
  } else {
    FAIL(G, 'malformed refused', `no name -> ${noName.status}, no contact -> ${noContact.status} (one of these was accepted)`);
  }

  if (!has(LANE.service)) {
    SKIP(G, 'attribution persisted', 'reading back nexus_sales_lead needs the service_role key (NEXUS_STAGING_SERVICE_ROLE_KEY); anon cannot select the table, by design');
  } else {
    const back = await rest('nexus_sales_lead',
      `submission_id=eq.${encodeURIComponent(sub)}&select=attribution,full_name`, { key: LANE.service });
    const got = rows(back)[0]?.attribution || {};
    const missing = Object.keys(attribution).filter(k => got[k] !== attribution[k]);
    missing.length === 0
      ? PASS(G, 'attribution persisted', `all ${Object.keys(attribution).length} attribution keys survived the write`)
      : FAIL(G, 'attribution persisted', `missing or altered: ${missing.join(', ')}`);
  }
}

/* ── 2. notification: the NX996 outbox state machine ──────────────────── */

async function groupNotification() {
  const G = 'notification';
  const names = ['enqueue -> PENDING', 'claim leases the row', 'mark_failed -> RETRYING', 'mark_sent -> SENT', 'illegal transition refused'];
  if (LANE.readOnly) return names.forEach(n => SKIP(G, n, 'production lane is read-only; the outbox machine is exercised on staging'));
  if (!has(LANE.service)) return names.forEach(n => SKIP(G, n, 'NX996 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set'));

  const K = { key: LANE.service };
  const lead = await rest('nexus_sales_lead', 'select=id&order=received_at.desc&limit=1', K);
  const leadId = rows(lead)[0]?.id;
  if (!leadId) return names.forEach(n => SKIP(G, n, `no nexus_sales_lead row to notify about (status ${lead.status}: ${lead.why})`));

  const worker = `smoke-${randomUUID().slice(0, 8)}`;
  const state = async id => rows(await rest('nexus_notification_outbox',
    `notification_id=eq.${id}&select=state,attempt_count,claimed_by`, K))[0] || {};

  /* EMAIL may already be queued by the NX996 insert trigger; SLACK is used for
     the send half so the two halves cannot collide inside one lead. */
  const enq = await rpcPost('nexus_notification_enqueue', { p_sales_lead_id: leadId, p_channel: 'EMAIL' }, K);
  const e1 = rows(enq)[0];
  if (enq.ok && e1?.notification_id && ['PENDING', 'RETRYING'].includes(e1.state)) {
    PASS(G, 'enqueue -> PENDING', `${e1.state}${e1.was_duplicate ? ' (already live: one enquiry, one notification)' : ''}`);
  } else {
    FAIL(G, 'enqueue -> PENDING', `status ${enq.status}: ${enq.why}`);
    return names.slice(1).forEach(n => SKIP(G, n, 'enqueue did not produce a notification to move'));
  }

  const idA = e1.notification_id;
  const claim = await rpcPost('nexus_notification_claim', { p_worker: worker, p_channel: 'EMAIL', p_limit: 50, p_lease_seconds: 60 }, K);
  const claimedA = rows(claim).some(r => r.notification_id === idA);
  const sA = await state(idA);
  claimedA && sA.claimed_by === worker
    ? PASS(G, 'claim leases the row', `attempt ${sA.attempt_count}, claimed_by this worker`)
    : FAIL(G, 'claim leases the row', `status ${claim.status}: ${claim.why || 'row not in the claimed batch'}`);

  if (claimedA) {
    const mf = await rpcPost('nexus_notification_mark_failed',
      { p_notification_id: idA, p_error_code: 'SMOKE_TEST', p_error_detail: 'deliberate failure from the launch smoke harness', p_worker: worker }, K);
    const s2 = await state(idA);
    mf.ok && s2.state === 'RETRYING'
      ? PASS(G, 'mark_failed -> RETRYING', `state=${s2.state} after attempt ${s2.attempt_count}`)
      : FAIL(G, 'mark_failed -> RETRYING', `status ${mf.status}: ${mf.why} (state=${s2.state})`);
  } else {
    SKIP(G, 'mark_failed -> RETRYING', 'the row was never claimed, so a failure could not be reported against it');
  }

  /* The send half needs a row that has not just been pushed behind a backoff,
     so it gets its own channel. */
  const enq2 = await rpcPost('nexus_notification_enqueue', { p_sales_lead_id: leadId, p_channel: 'SLACK' }, K);
  const idB = rows(enq2)[0]?.notification_id;
  if (!idB) {
    SKIP(G, 'mark_sent -> SENT', `second enqueue failed (${enq2.status}: ${enq2.why})`);
    SKIP(G, 'illegal transition refused', 'no SENT row to attempt an illegal move against');
    return;
  }
  const claim2 = await rpcPost('nexus_notification_claim', { p_worker: worker, p_channel: 'SLACK', p_limit: 50, p_lease_seconds: 60 }, K);
  const claimedB = rows(claim2).some(r => r.notification_id === idB);
  const ms = claimedB
    ? await rpcPost('nexus_notification_mark_sent', { p_notification_id: idB, p_worker: worker, p_detail: 'smoke harness' }, K)
    : null;
  const sB = await state(idB);
  if (claimedB && ms?.ok && sB.state === 'SENT') {
    PASS(G, 'mark_sent -> SENT', 'claimed then reported sent; state=SENT');
  } else {
    FAIL(G, 'mark_sent -> SENT', claimedB ? `status ${ms?.status}: ${ms?.why} (state=${sB.state})` : `row not claimable (${claim2.status}: ${claim2.why})`);
  }

  if (sB.state === 'SENT') {
    const again = await rpcPost('nexus_notification_mark_sent', { p_notification_id: idB, p_worker: worker }, K);
    isRefusal(again)
      ? PASS(G, 'illegal transition refused', `SENT -> SENT refused with ${again.status}: ${String(again.why).slice(0, 80)}`)
      : FAIL(G, 'illegal transition refused', 'a second mark_sent on an already-SENT notification was accepted');
  } else {
    SKIP(G, 'illegal transition refused', 'nothing reached SENT, so the illegal move had no row to be attempted on');
  }
}

/* ── 3. appointments: the NX995 booking machine ───────────────────────── */

async function groupAppointments() {
  const G = 'appointments';
  const names = ['request -> offer -> confirm', 'double booking refused', 'attendance before start refused'];
  if (LANE.readOnly) return names.forEach(n => SKIP(G, n, 'production lane is read-only; booking is exercised on staging'));
  if (!has(LANE.service)) return names.forEach(n => SKIP(G, n, 'NX995 functions are granted to service_role only and no NEXUS_STAGING_SERVICE_ROLE_KEY is set'));

  const K = { key: LANE.service };
  const tenant = E.NEXUS_STAGING_A_TENANT;
  if (!has(tenant)) return names.forEach(n => SKIP(G, n, 'NEXUS_STAGING_A_TENANT is not set, so there is no dealership to book inside'));

  const cust = rows(await rest('customer', `tenant_id=eq.${tenant}&select=id&limit=1`, K))[0]?.id;
  const staff = rows(await rest('users', `tenant_id=eq.${tenant}&select=id&limit=1`, K))[0]?.id;
  if (!cust) return names.forEach(n => SKIP(G, n, 'the fixture dealership has no customer row; an appointment attaches to a customer that already exists'));

  const mk = async () => {
    const req = await rpcPost('nexus_appointment_request',
      { p_tenant_id: tenant, p_customer_id: cust, p_channel: 'whatsapp', p_notes: 'launch smoke harness', p_actor: 'smoke' }, K);
    return { req, id: rows(req)[0]?.appointment_id };
  };

  const when = new Date(Date.now() + 36 * 3600 * 1000);
  when.setUTCMinutes(0, 0, 0);
  const startsAt = when.toISOString();

  const a = await mk();
  if (!a.id) return names.forEach(n => SKIP(G, n, `request refused (${a.req.status}: ${a.req.why})`));
  const offer = await rpcPost('nexus_appointment_offer_slots',
    { p_appointment_id: a.id, p_slots: [startsAt, new Date(when.getTime() + 7200e3).toISOString()], p_actor: 'smoke' }, K);
  const conf = await rpcPost('nexus_appointment_confirm',
    { p_appointment_id: a.id, p_starts_at: startsAt, p_duration_minutes: 45, p_assigned_to_id: staff || null, p_location: 'smoke showroom', p_actor: 'smoke' }, K);
  const c1 = rows(conf)[0];
  offer.ok && conf.ok && c1?.state === 'CONFIRMED'
    ? PASS(G, 'request -> offer -> confirm', `CONFIRMED for ${c1.starts_at} (ends ${c1.ends_at})`)
    : FAIL(G, 'request -> offer -> confirm', `offer ${offer.status}: ${offer.why} | confirm ${conf.status}: ${conf.why}`);

  if (!staff) {
    SKIP(G, 'double booking refused', 'no salesperson row in the fixture dealership; overlap is judged per assigned person');
  } else if (!conf.ok) {
    SKIP(G, 'double booking refused', 'the first appointment never reached CONFIRMED, so there is nothing to collide with');
  } else {
    const b = await mk();
    if (!b.id) {
      SKIP(G, 'double booking refused', `second request refused (${b.req.status}: ${b.req.why})`);
    } else {
      await rpcPost('nexus_appointment_offer_slots', { p_appointment_id: b.id, p_slots: [startsAt], p_actor: 'smoke' }, K);
      const clash = await rpcPost('nexus_appointment_confirm',
        { p_appointment_id: b.id, p_starts_at: new Date(when.getTime() + 15 * 60000).toISOString(), p_duration_minutes: 45, p_assigned_to_id: staff, p_actor: 'smoke' }, K);
      isRefusal(clash) && /DOUBLE_BOOKING/i.test(String(clash.why))
        ? PASS(G, 'double booking refused', String(clash.why).slice(0, 90))
        : FAIL(G, 'double booking refused', clash.ok ? 'an overlapping confirmation for the same salesperson was accepted' : `refused, but not as a double booking: ${clash.why}`);
    }
  }

  if (!conf.ok) {
    SKIP(G, 'attendance before start refused', 'nothing was confirmed, so attendance could not be claimed early');
  } else {
    const early = await rpcPost('nexus_appointment_mark_attended',
      { p_appointment_id: a.id, p_attended: true, p_actor: 'smoke' }, K);
    isRefusal(early)
      ? PASS(G, 'attendance before start refused', String(early.why).slice(0, 90))
      : FAIL(G, 'attendance before start refused', 'attendance was accepted for an appointment that has not started');
  }
}

/* ── 4. tenant isolation ──────────────────────────────────────────────── */

const ISOLATION_TABLES = ['leads', 'customer', 'conversation', 'appointment', 'tenant_subscription'];

async function groupIsolation() {
  const G = 'isolation';
  if (LANE.readOnly) return ISOLATION_TABLES.forEach(t => SKIP(G, `A sees 0 of B's ${t}`, 'production lane is read-only and signing a real user in there is a write; isolation is proved on staging'));
  const need = ['NEXUS_STAGING_A_EMAIL', 'NEXUS_STAGING_A_PASSWORD', 'NEXUS_STAGING_B_EMAIL', 'NEXUS_STAGING_B_PASSWORD', 'NEXUS_STAGING_A_TENANT', 'NEXUS_STAGING_B_TENANT'].filter(k => !has(E[k]));
  if (need.length || !has(LANE.anon)) {
    return ISOLATION_TABLES.forEach(t => SKIP(G, `A sees 0 of B's ${t}`, `missing ${(need.length ? need : ['NEXUS_STAGING_ANON_KEY']).join(', ')}`));
  }

  const A = await signIn(E.NEXUS_STAGING_A_EMAIL, E.NEXUS_STAGING_A_PASSWORD);
  const B = await signIn(E.NEXUS_STAGING_B_EMAIL, E.NEXUS_STAGING_B_PASSWORD);
  if (!A.ok || !B.ok) {
    return ISOLATION_TABLES.forEach(t => SKIP(G, `A sees 0 of B's ${t}`, A.ok ? B.why : A.why));
  }
  const tA = E.NEXUS_STAGING_A_TENANT, tB = E.NEXUS_STAGING_B_TENANT;

  for (const [me, mine, other, otherTenant, otherTok] of
       [['A', tA, 'B', tB, B.token], ['B', tB, 'A', tA, A.token]]) {
    const tok = me === 'A' ? A.token : B.token;
    for (const table of ISOLATION_TABLES) {
      const name = `${me} sees 0 of ${other}'s ${table}`;
      /* How many rows the OTHER caller can actually see in this table. If it is
         zero there is nothing to hide, and a check with nothing to hide proves
         nothing — so it says NOT RUN instead of taking the credit. */
      const theirs = await rest(table, `select=tenant_id&limit=1000`, { key: LANE.anon, token: otherTok });
      const theirCount = rows(theirs).filter(r => r.tenant_id === otherTenant).length;
      if (!theirs.ok) { SKIP(G, name, `${other} could not read ${table} at all (${theirs.status}: ${theirs.why})`); continue; }
      if (theirCount === 0) { SKIP(G, name, `${other} has no rows in ${table}; nothing for ${me} to be denied`); continue; }

      const crossed = await rest(table, `tenant_id=eq.${otherTenant}&select=tenant_id&limit=1000`, { key: LANE.anon, token: tok });
      const leaked = rows(crossed).length;
      const mineRes = await rest(table, `select=tenant_id&limit=1000`, { key: LANE.anon, token: tok });
      const foreign = rows(mineRes).filter(r => r.tenant_id !== mine).length;

      if (!crossed.ok && crossed.status >= 400 && foreign === 0) {
        PASS(G, name, `refused outright (${crossed.status}) — ${other} holds ${theirCount} row(s) there`);
      } else if (leaked === 0 && foreign === 0) {
        PASS(G, name, `0 of ${other}'s ${theirCount} row(s); nothing foreign in an unfiltered read either`);
      } else {
        FAIL(G, name, `${leaked} of ${other}'s rows visible; ${foreign} foreign tenant_id(s) in an unfiltered read`);
      }
    }
  }
}

/* ── 5. anon reaches nothing ──────────────────────────────────────────── */

const ANON_TABLES = ['leads', 'customer', 'conversation', 'appointment', 'tenant_subscription',
                     'nexus_sales_lead', 'nexus_notification_outbox', 'tenants', 'channel_registry'];
const ANON_ACCESSORS = ['nexus_channel_status', 'nexus_appointment_status', 'nexus_notification_status'];

async function groupAnon() {
  const G = 'anon';
  if (!has(LANE.anon)) return SKIP(G, 'every table refused', 'no publishable key for this lane');

  const reached = [];
  for (const t of ANON_TABLES) {
    const r = await rest(t, 'select=*&limit=1', { key: LANE.anon });
    if (!isRefusal(r)) reached.push(`${t} (${r.status}, ${rows(r).length} row(s))`);
  }
  reached.length === 0
    ? PASS(G, 'every table refused', `${ANON_TABLES.length} tables, all refused to anon`)
    : FAIL(G, 'every table refused', `anon reached: ${reached.join('; ')}`);

  /* STABLE functions are reachable over GET, so this works on the read-only
     lane too — and stays a read on both. */
  const gotIn = [], absent = [], tested = [];
  for (const fn of ANON_ACCESSORS) {
    const r = await rpcGet(fn, { key: LANE.anon });
    /* An accessor that does not exist here was not refused -- it was absent,
       and absence is not a control. Counted separately so the verdict cannot
       be carried by functions this project never had. */
    if (unreachable(r)) absent.push(fn);
    else if (!isRefusal(r)) gotIn.push(`${fn} (${r.status})`);
    else tested.push(fn);
  }
  if (gotIn.length) FAIL(G, 'every accessor refused', `anon executed: ${gotIn.join('; ')}`);
  else if (tested.length === 0) SKIP(G, 'every accessor refused', `none of these accessors exist on this project: ${absent.join(', ')}`);
  else PASS(G, 'every accessor refused', `${tested.length} refused to anon${absent.length ? `; ${absent.join(', ')} absent here and not counted` : ''}`);
}

/* ── 6. channels ──────────────────────────────────────────────────────── */

async function groupChannels() {
  const G = 'channels';

  if (LANE.readOnly) {
    SKIP(G, 'member caller sees rows', 'no production member credentials here, and a password grant is a write; the member half is proved on staging');
    const r = await rpcGet('nexus_channel_status', { key: LANE.service });
    if (!has(LANE.service)) return SKIP(G, 'no default dealership without membership', 'no SUPABASE_SERVICE_ROLE_KEY');
    if (unreachable(r)) return SKIP(G, 'no default dealership without membership', 'nexus_channel_status is not exposed on this project');
    if (!r.ok) return SKIP(G, 'no default dealership without membership', `status ${r.status}: ${r.why}`);
    return rows(r).length === 0
      ? PASS(G, 'no default dealership without membership', 'a caller with no membership got 0 rows, not somebody\'s dealership')
      : FAIL(G, 'no default dealership without membership', `${rows(r).length} row(s) returned to a caller who belongs to no dealership`);
  }

  if (!has(LANE.anon) || !has(E.NEXUS_STAGING_CHANNEL_EMAIL) || !has(E.NEXUS_STAGING_NOMEMBER_EMAIL)) {
    SKIP(G, 'member caller sees rows', 'NEXUS_STAGING_CHANNEL_EMAIL / NEXUS_STAGING_NOMEMBER_EMAIL not configured');
    SKIP(G, 'no default dealership without membership', 'NEXUS_STAGING_NOMEMBER_EMAIL not configured');
    return;
  }

  const member = await signIn(E.NEXUS_STAGING_CHANNEL_EMAIL, E.NEXUS_STAGING_CHANNEL_PASSWORD);
  if (!member.ok) SKIP(G, 'member caller sees rows', member.why);
  else {
    const r = await rpcGet('nexus_channel_status', { key: LANE.anon, token: member.token });
    if (unreachable(r)) SKIP(G, 'member caller sees rows', 'nexus_channel_status does not exist on this project (NX986 not applied here)');
    else if (!r.ok) FAIL(G, 'member caller sees rows', `status ${r.status}: ${r.why}`);
    else rows(r).length > 0
      ? PASS(G, 'member caller sees rows', `${rows(r).length} channel row(s) for a caller who belongs to a dealership`)
      : FAIL(G, 'member caller sees rows', 'a member of a dealership carrying channel rows was shown nothing');
  }

  const stranger = await signIn(E.NEXUS_STAGING_NOMEMBER_EMAIL, E.NEXUS_STAGING_NOMEMBER_PASSWORD);
  if (!stranger.ok) return SKIP(G, 'no default dealership without membership', stranger.why);
  const r2 = await rpcGet('nexus_channel_status', { key: LANE.anon, token: stranger.token });
  if (unreachable(r2)) return SKIP(G, 'no default dealership without membership', 'nexus_channel_status does not exist on this project (NX986 not applied here)');
  if (!r2.ok) return SKIP(G, 'no default dealership without membership', `status ${r2.status}: ${r2.why}`);
  rows(r2).length === 0
    ? PASS(G, 'no default dealership without membership', 'a signed-in user who belongs to no dealership got 0 rows')
    : FAIL(G, 'no default dealership without membership', `${rows(r2).length} row(s) shown to a user with no membership`);
}

/* ── 7. the production read-only lane ─────────────────────────────────── */

const COUNT_TABLES = ['tenants', 'leads', 'customer', 'conversation', 'appointment',
                      'nexus_sales_lead', 'nexus_notification_outbox', 'channel_message_events'];

async function groupProductionReadOnly() {
  const G = 'prod read-only';
  if (!LANE.readOnly) return;

  if (!has(LANE.service)) {
    SKIP(G, 'row counts', 'no SUPABASE_SERVICE_ROLE_KEY in the env file');
    SKIP(G, 'latest inbound channel event', 'no SUPABASE_SERVICE_ROLE_KEY in the env file');
  } else {
    const counts = [];
    const broke = [];
    for (const t of COUNT_TABLES) {
      const r = await rest(t, 'select=*&limit=0', { key: LANE.service, prefer: 'count=exact' });
      const n = r.range ? r.range.split('/')[1] : null;
      if (r.ok && n !== null) counts.push(`${t}=${n}`); else broke.push(`${t} (${r.status}: ${r.why})`);
    }
    broke.length === 0
      ? PASS(G, 'row counts', counts.join(' '))
      : FAIL(G, 'row counts', `unreadable: ${broke.join('; ')} | read: ${counts.join(' ')}`);

    const ev = await rest('channel_message_events',
      'direction=eq.inbound&select=received_at,channel_type,origin_verified&order=received_at.desc&limit=1', { key: LANE.service });
    if (!ev.ok) {
      SKIP(G, 'latest inbound channel event', `status ${ev.status}: ${ev.why}`);
    } else if (rows(ev).length === 0) {
      PASS(G, 'latest inbound channel event', 'none recorded yet — the table is readable and empty of inbound traffic');
    } else {
      const e = rows(ev)[0];
      const ageH = ((Date.now() - Date.parse(e.received_at)) / 3600e3).toFixed(1);
      PASS(G, 'latest inbound channel event', `${e.channel_type} at ${e.received_at} (${ageH}h ago), attested ${e.origin_verified ?? 'nothing'}`);
    }
  }

  /* supabase_migrations is not a PostgREST-exposed schema, and exposing it
     would be a production change. So the version is NOT RUN, and a separate,
     honestly-named check reports whether the newest migration's objects are
     actually present — which is a different claim and is labelled as one. */
  const mig = await rest('schema_migrations', 'select=version&order=version.desc&limit=1', { key: LANE.service });
  mig.ok && rows(mig).length
    ? PASS(G, 'latest migration version', rows(mig)[0].version)
    : SKIP(G, 'latest migration version', `supabase_migrations is not exposed over PostgREST (${mig.status}: ${String(mig.why).slice(0, 60)}); read it with SQL, not this harness`);

  if (has(LANE.service)) {
    const marker = await rest('nexus_notification_outbox', 'select=notification_id&limit=1', { key: LANE.service });
    marker.ok
      ? PASS(G, 'newest migration objects present', 'nexus_notification_outbox (NX996) exists and is readable — object presence, not a version number')
      : FAIL(G, 'newest migration objects present', `nexus_notification_outbox unreadable (${marker.status}: ${marker.why})`);
  }

  if (!has(LANE.anon)) {
    SKIP(G, 'anon has no USAGE on schema public', 'no SUPABASE_ANON_KEY in the env file');
  } else {
    const r = await rest('leads', 'select=id&limit=1', { key: LANE.anon });
    if (!isRefusal(r)) FAIL(G, 'anon has no USAGE on schema public', `anon read leads with ${r.status}`);
    else /permission denied for schema public/i.test(String(r.why))
      ? PASS(G, 'anon has no USAGE on schema public', `${r.status}: ${String(r.why).slice(0, 70)}`)
      : PASS(G, 'anon has no USAGE on schema public', `refused ${r.status}: ${String(r.why).slice(0, 70)} (refused, though not with the schema-USAGE message)`);
  }
}

/* ── run ──────────────────────────────────────────────────────────────── */

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function main() {
  const started = Date.now();
  console.log(`NEXUS launch smoke — lane: ${LANE.name}${LANE.readOnly ? ' (READ-ONLY)' : ''}`);
  console.log(`env file: ${ENV_FILE}${FILE_ENV.ok ? '' : `  [unreadable: ${FILE_ENV.why}]`}`);
  console.log(`project:  ${LANE.url || '(none configured)'}`);
  console.log(`keys:     publishable=${has(LANE.anon) ? 'present' : 'ABSENT'}  service_role=${has(LANE.service) ? 'present' : 'ABSENT'}\n`);

  if (!LANE.url) {
    console.error(`No project URL for the ${LANE.name} lane. Nothing can be checked, so nothing is claimed.`);
    process.exit(2);
  }

  const groups = [groupWebsite, groupNotification, groupAppointments, groupIsolation, groupAnon, groupChannels, groupProductionReadOnly];
  for (const g of groups) {
    try { await g(); }
    catch (e) {
      if (e instanceof ReadOnlyViolation) rec(g.name, 'read-only guard', 'FAIL', e.message);
      else rec(g.name.replace(/^group/, '').toLowerCase(), 'harness error', 'NOT RUN', `${e.name}: ${e.message}`);
    }
  }

  const W = [14, 38, 8];
  console.log(`${pad('GROUP', W[0])} ${pad('CHECK', W[1])} ${pad('VERDICT', W[2])} DETAIL`);
  console.log('-'.repeat(W[0] + W[1] + W[2] + 3 + 40));
  for (const r of RESULTS) console.log(`${pad(r.group, W[0])} ${pad(r.name, W[1])} ${pad(r.status, W[2])} ${r.detail}`);

  const n = s => RESULTS.filter(r => r.status === s).length;
  console.log(`\n${n('PASS')} PASS · ${n('FAIL')} FAIL · ${n('NOT RUN')} NOT RUN · ${((Date.now() - started) / 1000).toFixed(1)}s · lane ${LANE.name}`);
  if (ARGS.json) console.log('\n' + JSON.stringify({ lane: LANE.name, results: RESULTS }, null, 2));

  /* Default: only a FAIL fails the run, because a missing credential is not a
     broken system. --strict fails on NOT RUN too, which is what a launch gate
     wants: "everything was checked", not "nothing complained". */
  const bad = n('FAIL') + (ARGS.strict ? n('NOT RUN') : 0);
  if (ARGS.strict && n('NOT RUN')) console.log('--strict: NOT RUN counts as failure, because a launch gate needs every check to have run.');
  process.exit(bad > 0 ? 1 : 0);
}

main().catch(e => { console.error('smoke harness crashed:', e); process.exit(2); });
