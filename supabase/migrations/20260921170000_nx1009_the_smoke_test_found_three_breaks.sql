-- NX1009 — The smoke test found three breaks.
--
-- A live smoke test (ALBA owner + platform admin) walked the app after
-- yesterday's live pass and found three things broken, plus one function the
-- app shell has been calling since NX930 shipped that no signed-in account
-- has ever been allowed to answer. All four are fixed here at the layer that
-- actually owns them: the database.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LEADS SCREEN — `leads?select=*,users(id,name)` failed outright
-- ═══════════════════════════════════════════════════════════════════════════
-- Not RLS, not a timeout, not a missing column. PostgREST resolves an embed
-- by finding exactly one foreign key between the two tables named in the
-- request; NX997 (20260918140000) ADDED a second one instead of replacing the
-- first, and from that moment `leads` has carried two live foreign keys to
-- `users` over overlapping columns:
--
--   leads_assigned_to_id_fkey          (assigned_to_id)             -> users(id)              ON DELETE SET NULL
--   leads_assigned_user_same_dealership (tenant_id, assigned_to_id) -> users(tenant_id, id)    ON DELETE NO ACTION
--
-- PostgREST cannot pick one on the caller's behalf, so `users(id,name)` — the
-- convention six screens in this codebase already rely on (see
-- screens/leads.js's own comment on why it is not `users:assigned_to_id(...)`)
-- — has been ambiguous, not broken, since NX997 merged: it returns PGRST201
-- ("more than one relationship was found"), which every one of those six
-- screens' callers surfaces as a flat "the request failed".
--
-- SECURITY_REGRESSION_REPORT.md (SEC-01) diagnosed the real hole NX997 was
-- closing — an assigned_to_id that pointed at another dealership's staff, RLS
-- on `users` hiding the name and Lead Recovery asserting an owner it could not
-- name — and its own prescribed fix was to DROP the single-column FK and
-- REPLACE it with a tenant-scoped one, not keep both. NX997 built the
-- replacement (as `leads_assigned_user_same_dealership`, matching its own
-- migration's naming convention for every other "_same_dealership" key it
-- adds) but never dropped the original, so the codebase has carried both
-- since 18 Sep and the embed ambiguity is a straight consequence of that,
-- not a new defect.
--
-- The fix is the drop NX997 owed, plus the one behaviour the old FK actually
-- carried that the new one does not: `leads_assigned_to_id_fkey` was
-- ON DELETE SET NULL, and screens/team.js states as fact (its own comment,
-- point 2) that deleting a user un-assigns their leads rather than blocking
-- the delete or leaving a dangling id. Postgres 15+'s column-scoped
-- `ON DELETE SET NULL (col)` lets the one surviving, tenant-scoped foreign
-- key carry that same behaviour on `assigned_to_id` alone — critically,
-- WITHOUT nulling `tenant_id`, which a bare `ON DELETE SET NULL` on a
-- composite key would do and which would be its own outage (a lead losing
-- its tenant is a lead RLS can no longer place anywhere).
alter table public.leads drop constraint if exists leads_assigned_to_id_fkey;
alter table public.leads drop constraint if exists leads_assigned_user_same_dealership;

alter table public.leads
  add constraint leads_assigned_user_same_dealership
  foreign key (tenant_id, assigned_to_id)
  references public.users (tenant_id, id)
  on delete set null (assigned_to_id);

comment on constraint leads_assigned_user_same_dealership on public.leads is
  'The one and only foreign key from leads to users. Composite and tenant-scoped '
  '(NX997''s SEC-01 fix: a lead may only be assigned to staff of its own '
  'dealership) and ON DELETE SET NULL on assigned_to_id alone (Postgres 15+ '
  'column-scoped syntax), so deleting a user unassigns their leads without '
  'nulling the lead''s tenant_id. Replaces the pre-NX997 leads_assigned_to_id_fkey, '
  'which NX997 should have dropped when it added this key and did not -- leaving '
  'two live foreign keys over the same columns, which is what made '
  '`leads?select=*,users(id,name)` ambiguous to PostgREST (PGRST201) for every '
  'caller from 18 Sep on. NX1009.';

do $verify$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.leads'::regclass and contype = 'f'
                and conname = 'leads_assigned_to_id_fkey') then
    raise exception 'NX1009: leads_assigned_to_id_fkey still exists -- the embed is still ambiguous.';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.leads'::regclass and contype = 'f'
         and confrelid = 'public.users'::regclass) <> 1 then
    raise exception 'NX1009: leads must carry exactly one foreign key to users.';
  end if;
end;
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FOUNDER CONSOLE — nexus_founder_list_tenants() failed for the platform admin
-- ═══════════════════════════════════════════════════════════════════════════
-- "column reference \"tenant_id\" is ambiguous", and the ambiguity is real:
-- PL/pgSQL registers every OUT parameter of a RETURNS TABLE function as a
-- variable across the WHOLE function body, including inside the text of
-- every SQL statement it runs — not just the top-level SELECT list. This
-- function's OUT parameters are (tenant_id, name, slug, status, created_at,
-- member_count, leads_count, subscription_status, last_activity_at, is_test),
-- and its three inline LEFT JOIN subqueries each do
-- `select tenant_id, ... from ... group by tenant_id` unqualified — a bare
-- `tenant_id` that matches both the OUT parameter and the subquery's own
-- source column, which is exactly the shape plpgsql.variable_conflict = error
-- (the default) refuses. The leads subquery doubles it: it also selects
-- `max(created_at) newest`, and `created_at` is an OUT parameter too.
--
-- NX1003's nexus_my_subscription() and nexus_founder_mark_paid(), in the very
-- same PR wave, already carry `#variable_conflict use_column` for this exact
-- reason — this function was the one RETURNS TABLE function in that wave that
-- did not get the pragma. Every other RETURNS TABLE function this migration's
-- own audit checked (NX1002's SQL-language functions, NX1005's appointment
-- wrappers, which only ever reference bare `select * from public.leads l
-- where l.id = ...` with an explicit alias, NX1007's SQL-language
-- nexus_channel_registry_for_owner and its RETURN NEXT functions, which
-- assign OUT parameters by name rather than selecting a column of the same
-- name, and the NX1008/feat-payment-details nexus_payment_instructions,
-- which selects from an explicitly-aliased v_row record) do not hit this
-- shape. This is the only one.
--
-- Fixed the same way NX1003 already fixes it: `#variable_conflict use_column`
-- resolves every bare identifier that names both a column and a variable to
-- the COLUMN, for the whole function body — which is what every one of these
-- subqueries always meant. The subquery source columns are additionally
-- qualified with their table names below, belt and braces, so the query reads
-- unambiguously even to someone who does not know the pragma is there.
create or replace function public.nexus_founder_list_tenants()
returns table (
  tenant_id           uuid,
  name                text,
  slug                text,
  status              text,
  created_at          timestamptz,
  member_count        bigint,
  leads_count         bigint,
  subscription_status text,
  last_activity_at    timestamptz,
  is_test             boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
#variable_conflict use_column
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may list every dealership.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  return query
  select
    t.id,
    t.name,
    t.slug,
    t.status,
    t.created_at,
    coalesce(mc.cnt, 0)::bigint  as member_count,
    coalesce(lc.cnt, 0)::bigint  as leads_count,
    ts.state                     as subscription_status,
    greatest(t.created_at, coalesce(lc.newest, t.created_at), coalesce(al.newest, t.created_at))
                                  as last_activity_at,
    (t.slug like 'test-%')       as is_test
  from public.tenants t
  left join (select tm.tenant_id, count(*) cnt
               from public.tenant_members tm
              group by tm.tenant_id) mc
    on mc.tenant_id = t.id
  left join (select l.tenant_id, count(*) cnt, max(l.created_at) newest
               from public.leads l
              group by l.tenant_id) lc
    on lc.tenant_id = t.id
  left join (select a.tenant_id, max(a.logged_at) newest
               from public.audit_log a
              group by a.tenant_id) al
    on al.tenant_id = t.id
  left join public.tenant_subscription ts
    on ts.tenant_id = t.id
  where not t.is_quarantine
  order by t.created_at desc;
end;
$fn$;

comment on function public.nexus_founder_list_tenants() is
  'Founder-only roster of every dealership: member and lead counts, subscription state, last activity and a test-tenant flag. Gated on nexus_is_platform_admin(); raises rather than returning empty for anyone else. #variable_conflict use_column (NX1009) -- the OUT parameters share names with columns in the LEFT JOIN subqueries (tenant_id, created_at), which plpgsql''s default variable_conflict=error refuses as ambiguous.';

revoke all on function public.nexus_founder_list_tenants() from public, anon, authenticated;
grant execute on function public.nexus_founder_list_tenants() to authenticated, service_role;

do $verify$
begin
  if not has_function_privilege('authenticated', 'public.nexus_founder_list_tenants()', 'execute') then
    raise exception 'NX1009: authenticated must retain execute on nexus_founder_list_tenants().';
  end if;
end;
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. APP SHELL — rpc/nexus_meta_onboarding_status refused every signed-in account
-- ═══════════════════════════════════════════════════════════════════════════
-- Not a regression and not new: NX930 granted this function to service_role
-- ONLY, on purpose ("Is this dealership ready? Answers without revealing
-- anything" — the not-revealing-anything was about the secret, not about the
-- tenant). NX986's own migration comment says so in as many words: "measured:
-- `authenticated` holds ... no EXECUTE on nexus_meta_onboarding_status(). A
-- browser has no read of the messaging plane at all." NX986 then built
-- nexus_channel_status() as the tenant-scoped accessor a browser CAN call —
-- but lib/setup.js's Setup screen and Money Leaks banner were never moved
-- onto it, so the app shell has been calling a function no signed-in account,
-- founder or dealer, has ever been allowed to execute. That is the "you do
-- not have permission" on every navigation to either screen.
--
-- Rejected fix: grant it to `authenticated` as written. The function has no
-- tenant filter at all — it reads `channel_registry` for every dealership
-- that has an active WhatsApp number and returns EVERY one of their rows in a
-- single result set. Granting that unfiltered is exactly the cross-tenant
-- leak this codebase has spent the last two weeks of migrations closing one
-- table at a time (NX997, NX999, secreg_leads_owner...): dealership A's
-- browser would receive dealership B's phone_number_id, install timestamps
-- and credential fingerprints, filtered only by lib/setup.js's own
-- `x.tenant_id === tenantId` — a browser-side filter an operator can remove
-- in devtools, the exact shape NX997's own migration comment already names
-- as the wrong place to put this kind of scoping.
--
-- Rejected fix: stop calling it from the shell and leave the WhatsApp setup
-- step permanently UNKNOWN. lib/setup.js already renders that gracefully
-- (`r.err` -> state UNKNOWN, with an honest note), so nothing crashes — but
-- an owner would never see whether WhatsApp is actually connected on the one
-- screen built to tell them, which is the defect NX986 itself exists to fix
-- for every other channel.
--
-- The fix: scope the function itself, the same way NX986's
-- nexus_channel_status() already does, and grant it to `authenticated` once
-- it is safe to. Two callers keep today's unfiltered, cross-tenant read
-- exactly as the ops onboarding runbook (ops/DEALER-ONBOARDING-whatsapp-cloud.md)
-- already exercises it: the platform admin (nexus_is_platform_admin()) and any
-- literal `service_role` session (checked on session_user, which a SECURITY
-- DEFINER function does not change — unlike current_user, which would read as
-- this function's owner for every caller). Every other authenticated caller
-- gets exactly its own tenant's rows via nexus_current_tenant_ids(), or zero
-- rows for no membership -- never another dealership's, and never a default.
-- The credential detail returned (an installed/missing state, an install
-- timestamp, an 8-character fingerprint prefix) was already established at
-- NX930 as safe to show a signed-in account -- the secret itself is never in
-- this function's result -- so scoping it to the caller's own dealership is
-- what makes calling it from a dealer's own browser safe, matching this
-- migration's other two fixes: the database does the scoping, not the screen.
create or replace function public.nexus_meta_onboarding_status()
returns table (tenant_id uuid, phone_number_id text, credential text,
               state text, detail text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_tenants uuid[];
begin
  if session_user <> 'service_role' and not public.nexus_is_platform_admin() then
    select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
    if v_tenants is null or cardinality(v_tenants) = 0 then
      -- No membership, no answer -- never a default dealership, the same rule
      -- nexus_channel_status() (NX986) already applies.
      return;
    end if;
  end if;

  return query
  select cr.tenant_id,
         cr.external_identifier,
         k.kind,
         case when cs.integration_id is null then 'MISSING' else 'INSTALLED' end,
         case when cs.integration_id is null
              then 'Not installed. ' || k.description
              else 'Installed ' || to_char(coalesce(cs.rotated_at, cs.installed_at),
                                           'YYYY-MM-DD HH24:MI')
                   || ' · fingerprint ' || left(cs.fingerprint, 8)
         end
    from public.channel_registry cr
   cross join public.channel_secret_kind k
    left join public.channel_secret cs
           on cs.integration_id = cr.integration_id and cs.kind = k.kind
   where cr.channel_type = 'whatsapp_cloud_phone_number_id'
     and cr.status = 'active'
     and (v_tenants is null or cr.tenant_id = any(v_tenants))
   order by cr.tenant_id, k.kind;
end;
$fn$;

comment on function public.nexus_meta_onboarding_status() is
  'Meta credential install status per registered WhatsApp Cloud number: INSTALLED/MISSING per credential kind, never the secret itself. Unfiltered (every dealership) for the platform admin and for a literal service_role session -- the shape the onboarding runbook already reads. Scoped to the caller''s own tenant(s) via nexus_current_tenant_ids() for every other authenticated caller, zero rows for no membership. NX1009: previously service_role-only and unfiltered, which is why it could never be granted to authenticated (would have leaked every dealership''s credential status to every dealership) and why the app shell''s WhatsApp setup step has refused every signed-in account since NX930.';

revoke all on function public.nexus_meta_onboarding_status() from public, anon, authenticated;
grant execute on function public.nexus_meta_onboarding_status() to authenticated, service_role;

do $verify$
begin
  if not has_function_privilege('authenticated', 'public.nexus_meta_onboarding_status()', 'execute') then
    raise exception 'NX1009: authenticated must be able to execute nexus_meta_onboarding_status() now that it is tenant-scoped.';
  end if;
end;
$verify$;
