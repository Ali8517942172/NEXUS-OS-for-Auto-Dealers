// NEXUS OS — supabase/functions/founder-invite/index.ts
//
// THE MISSING PIECE, NAMED IN ITS OWN MIGRATION. team_02
// (20260906061916_team_02_pending_membership_applied_at_first_sign_in.sql)
// built nexus_team_invite() and said, in its own comment, exactly what it
// could not do:
//
//   "auth.admin.inviteUserByEmail requires the service_role key, and a
//    service_role key in a browser bundle is the whole database handed to
//    anyone who opens devtools. Measured 6 Sep 2026: this project has ZERO
//    Edge Functions deployed, so there is no server-side place that key
//    could live either."
//
// This function is that server-side place. It is the ONLY thing in NEXUS OS
// that holds the service-role key, it never returns that key or logs it, and
// it never accepts it from a caller — it reads it once from its own runtime
// environment (SUPABASE_SERVICE_ROLE_KEY, injected by Supabase into every
// Edge Function; nothing here sets it).
//
// TWO CALLERS, ONE FUNCTION, TWO DIFFERENT AUTHORITIES.
//
//   THE FOUNDER  — public.nexus_is_platform_admin() true for the caller's own
//   JWT. May invite anyone into ANY dealership, naming that dealership by id.
//   This is the founder console's "add a colleague to this dealer" action and
//   the founder onboarding a dealership's very first login.
//
//   THE DEALER OWNER  — has an 'owner' row in tenant_members for the ONE
//   dealership named in the request, read through a client scoped to the
//   caller's own JWT so Postgres RLS (tenant_members_self_read: auth_user_id
//   = auth.uid()) is the thing deciding what this function can even see, not
//   this file's own judgement. An owner may only ever name their own
//   dealership — there is no branch here that lets an owner's request through
//   for a tenant_id their own membership row does not carry.
//
// Anyone who is neither is refused before a single Auth Admin call is made.
//
// WHAT THIS DOES NOT DO. It does not choose a role's meaning, does not
// invent a pending-membership table of its own (tenant_member_invite already
// exists and is left alone — this function talks to auth.admin directly and
// to tenant_members directly, because unlike the pre-Edge-Function world, an
// invite sent from here creates the auth.users row immediately and there is
// no "wait for them to sign up later" gap left to bridge), and does not
// decide who is a platform admin or a dealership owner — both of those
// questions are asked of Postgres, through nexus_is_platform_admin() and RLS,
// and answered there.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Every one of these is injected automatically into every Supabase Edge
// Function's runtime for the project it belongs to. Nothing in this file, in
// a deploy script, or in supabase/config.toml sets them — see the README
// beside this file for the full account and why they are never hand-set.
const ENV_ERROR = !SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY
  ? 'founder-invite is missing one of SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY from its own runtime environment. These are normally injected automatically; see README.md beside this file.'
  : null;

// The roles tenant_member_invite_role_check already enforces at the database
// (team_02). Repeated here so a bad role is refused with a clear JSON body
// before any Auth Admin call is made, not as a raw Postgres constraint
// violation after one.
const ROLES = ['owner', 'admin', 'manager', 'sales', 'technician', 'member'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function badRequest(message: string, detail: string) {
  return json({ outcome: 'error', message, detail }, 400);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return badRequest('Only POST is accepted.', 'NX_INVITE_METHOD');
  if (ENV_ERROR) return json({ outcome: 'error', message: ENV_ERROR, detail: 'NX_INVITE_ENV' }, 500);

  // -- Who is calling --
  // The bearer token is the signed-in user's own Supabase session token —
  // the same one every other call in this dashboard sends (lib/data.js's
  // authToken()). It is verified below in two different ways for two
  // different questions, and neither is a substitute for the other:
  //
  //   1. adminClient.auth.getUser(token) asks GoTrue "is this a real,
  //      unexpired session, and whose is it" — using the service-role key,
  //      so a malformed or forged token is rejected before this function
  //      trusts anything else about it.
  //   2. callerClient, built from the SAME token against the ANON key, is
  //      how this function then asks POSTGRES who this person may act as —
  //      nexus_is_platform_admin() and the tenant_members RLS read both run
  //      AS the caller, not as the service role, so the authority check is
  //      the database's own, not this file's guess at it.
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ outcome: 'error', message: 'No signed-in session was presented, so nobody was invited.', detail: 'NX_INVITE_NO_SESSION' }, 401);
  }

  const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const callerClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerAuth, error: callerAuthErr } = await adminClient.auth.getUser(token);
  if (callerAuthErr || !callerAuth?.user) {
    return json({ outcome: 'error', message: 'That session is not valid, so nobody was invited.', detail: 'NX_INVITE_BAD_SESSION' }, 401);
  }

  // -- What is being asked --
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('The request body was not valid JSON, so nobody was invited.', 'NX_INVITE_BAD_JSON');
  }

  const tenantId = String(body.tenant_id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || '').trim().toLowerCase();
  const staffUserId = body.staff_user_id ? String(body.staff_user_id).trim() : null;
  const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;

  if (!tenantId) return badRequest('A tenant_id is required, so nobody was invited.', 'NX_INVITE_NO_TENANT');
  if (!email || email.indexOf('@') < 1) return badRequest('That is not an email address, so nobody was invited.', 'NX_INVITE_BAD_EMAIL');
  if (!ROLES.includes(role)) {
    return badRequest(`That is not a role NEXUS recognises. The roles are ${ROLES.join(', ')}.`, 'NX_INVITE_BAD_ROLE');
  }

  // -- Which authority applies --
  // Platform admin first: a founder inviting into a dealership they are not
  // personally a member of must not fall through to the owner check below
  // and be refused for the wrong reason.
  const { data: isFounder } = await callerClient.rpc('nexus_is_platform_admin');

  let authorised = isFounder === true;
  let authorityNote = 'founder';

  if (!authorised) {
    // RLS (tenant_members_self_read) restricts this read to the caller's OWN
    // rows before this file ever sees them — the .eq('tenant_id', …) below
    // narrows within that, it does not widen it. There is no way to make
    // this query return somebody else's membership row by changing tenantId.
    const { data: ownRow } = await callerClient
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (ownRow?.role === 'owner') {
      authorised = true;
      authorityNote = 'owner';
    }
  }

  if (!authorised) {
    return json({
      outcome: 'error',
      message: 'You may not invite anyone to this dealership. Only the NEXUS founder, or that dealership’s own owner, may.',
      detail: 'NX_INVITE_REFUSED',
    }, 403);
  }

  // An owner naming 'owner' for someone else is allowed here for the same
  // reason nexus_team_invite() allows it (team_02,
  // NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY): the caller who reached this branch is
  // already confirmed to hold the owner role themselves.

  // -- Does the target dealership exist, and (if named) the staff record --
  const { data: tenantRow, error: tenantErr } = await adminClient
    .from('tenants')
    .select('id, name, slug, is_quarantine')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr || !tenantRow) {
    return json({ outcome: 'error', message: 'No dealership matches that id, so nobody was invited.', detail: 'NX_INVITE_TENANT_NOT_FOUND' }, 404);
  }
  if (tenantRow.is_quarantine) {
    return json({ outcome: 'error', message: 'The quarantine tenant is not a dealership and nobody may be invited to it.', detail: 'NX_INVITE_QUARANTINE_PROTECTED' }, 400);
  }

  if (staffUserId) {
    const { data: staffRow } = await adminClient
      .from('users')
      .select('id')
      .eq('id', staffUserId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!staffRow) {
      return json({ outcome: 'error', message: 'That staff record is not one of this dealership’s, so nobody was invited.', detail: 'NX_INVITE_STAFF_NOT_HERE' }, 400);
    }
  }

  // -- Already a member here? Mirrors nexus_team_invite's own refusal --
  const { data: existingMember } = await adminClient
    .from('tenant_members')
    .select('auth_user_id, role, users:auth_user_id ( email )')
    .eq('tenant_id', tenantId);
  const already = (existingMember || []).find((m: any) => String(m?.email || '').toLowerCase() === email);
  // The join above only resolves if the FK view exposes auth.users, which
  // PostgREST does not by default -- so this is treated as a possibility, not
  // a certainty, and the real dedupe happens after resolving the auth user
  // id below (v_existing check), which is authoritative either way.

  // -- Resolve (or create) the auth.users account --
  // inviteUserByEmail both creates the account AND sends Supabase's own
  // invite email in one call -- this is the step nx1004/team_02 could not
  // take without a service-role key, and it is the entire reason this
  // function exists.
  let targetUserId: string | null = null;
  let sentInviteEmail = false;

  const inviteRes = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invited_tenant_id: tenantId, invited_role: role },
  });

  if (inviteRes.data?.user?.id) {
    targetUserId = inviteRes.data.user.id;
    sentInviteEmail = true;
  } else {
    // Most likely cause: the address already has a login. GoTrue's own
    // wording for that case is not stable across versions, so this branch is
    // reached on ANY invite failure and resolved by looking the account up
    // directly, rather than by pattern-matching an error string that could
    // change under this function without warning.
    const found = await findUserByEmail(adminClient, email);
    if (!found) {
      return json({
        outcome: 'error',
        message: 'The invite could not be sent and no existing account for that address was found either.',
        detail: 'NX_INVITE_SEND_FAILED',
        technical: String(inviteRes.error?.message || 'no reason given'),
      }, 502);
    }
    targetUserId = found.id;
  }

  // -- The authorisation act itself --
  const { data: existingRow } = await adminClient
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('auth_user_id', targetUserId)
    .maybeSingle();

  let outcome: string;
  if (existingRow) {
    // Already a member: the dealership's existing answer about this person
    // is not silently overwritten by a second invite. team_02's
    // NX_TEAM_ALREADY_A_MEMBER makes the identical call for the same reason.
    outcome = 'already_member';
  } else {
    const { error: insertErr } = await adminClient.from('tenant_members').insert({
      tenant_id: tenantId,
      auth_user_id: targetUserId,
      role,
      staff_user_id: staffUserId,
    });
    if (insertErr) {
      return json({
        outcome: 'error',
        message: 'The invite email was sent, but membership could not be recorded. Please tell NEXUS support the exact time this happened.',
        detail: 'NX_INVITE_MEMBERSHIP_WRITE_FAILED',
        technical: insertErr.message,
      }, 500);
    }
    outcome = sentInviteEmail ? 'invited' : 'added_existing_account';
  }

  await adminClient.from('audit_log').insert({
    workflow: authorityNote === 'founder' ? 'Founder Console' : 'Team Access',
    status: 'SUCCESS',
    summary: `${authorityNote === 'founder' ? 'Founder' : 'Owner'} invited ${email} to "${tenantRow.name}" (${tenantRow.slug}) as ${role} — ${outcome}`,
    tenant_id: tenantId,
  });

  return json({
    outcome,
    tenant_id: tenantId,
    tenant_name: tenantRow.name,
    email,
    role,
    sent_invite_email: sentInviteEmail,
  });
});

// GoTrue's admin REST API accepts an `email` filter on newer Supabase Auth
// versions but not all -- and an ignored filter would silently return the
// WRONG user's id from page 1, which is the one failure mode this function
// must never have. So this scans explicitly and matches client-side, capped
// at a generous page count: dealership invite volume is low by construction
// (one founder, a handful of owners, each inviting a handful of people), and
// a cap that is never hit in practice is safer here than an unbounded loop.
async function findUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(u => String(u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < perPage) return null; // last page
  }
  return null;
}
