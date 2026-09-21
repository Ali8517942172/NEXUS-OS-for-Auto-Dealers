-- NX1002 — The lead was lost when the quota ran out.
--
-- ORIGINAL DEFECT, proven live 20 Sep 2026 (n8n executions 16069, 16072).
-- Master Lead Router (JnlZFAVmFAuNXVya): "Validate & Enrich Input" ->
-- "Model Ladder" -> "AI Lead Scoring Agent" -> "Parse AI Decision" ->
-- "Persist Lead (deterministic)". The row is written ONLY after scoring
-- succeeds. "AI Lead Scoring Agent" already retries through "Model Ladder"
-- on a model failure (onError: continueErrorOutput, output 1 loops back to
-- the ladder), but "Model Ladder" itself (n8n-nodes-base.code) throws once
-- every tier is exhausted -- `if (attempt >= TIERS.length) throw new
-- Error(...)` -- and that node's onError was never set, so the throw is
-- fatal to the WHOLE execution. On 20 Sep, OpenRouter's free-tier daily quota
-- ("Rate limit exceeded: free-models-per-day") took out every OpenRouter tier
-- and the Groq fallback did not save it; the execution died inside "Model
-- Ladder" and "Persist Lead (deterministic)" never ran. A real customer's
-- lead -- name, phone, vehicle interest -- was never written anywhere.
--
-- THE FIX IS "PERSIST FIRST, SCORE LATER", FREE-TIER ONLY. This migration is
-- the database half: a scoring_state column so a row can exist and be
-- correctly understood as "not scored yet" instead of implying scoring never
-- ran. The workflow half (ops/tenant-precedence/patched4/JnlZFAVmFAuNXVya.json,
-- not yet applied -- n8n is read-only for this task) moves "Persist Lead
-- (deterministic)" to run immediately after "Validate & Enrich Input",
-- writing the row with scoring_state='PENDING' before the model ladder ever
-- runs, sets "Model Ladder"'s onError to continueErrorOutput so ladder
-- exhaustion can no longer kill the execution, and adds an "Update Lead
-- Scoring (PATCH)" node after "Parse AI Decision" that PATCHes the SAME row
-- (matched on the existing UNIQUE (tenant_id, email) index
-- leads_tenant_email_key) to scoring_state='SCORED' on success.
--
-- WHY scoring_state IS A NEW COLUMN AND NOT score_source. NX920
-- (20260914065739) already added score_source/ai_score_raw/ai_intent_raw/
-- ai_parse_failed to this table, but that column answers a different
-- question -- "once a score exists, who is authoritative for it (deterministic
-- RULES vs the model vs a regex fallback)" -- and its own check constraint
-- (RULES/AI_SCORE_CONFIRMED/AI_SCORE_FALLBACK/AI_SCORE_UNKNOWN) has no member
-- for "has not been scored yet". Overloading AI_SCORE_UNKNOWN for that would
-- silently change its documented meaning ("provenance was never recorded",
-- written for the pre-NX920 backfill) for every row this migration backfills.
-- scoring_state is pipeline state (has this row been scored at all), an
-- orthogonal axis to score_source (given a score, who is trusted for it).
--
-- scoring_attempts / scoring_last_error back the retry sweep
-- (nexus_pending_scoring_leads_for_tenant /
-- nexus_record_lead_scoring_result below, driven by the new scheduled
-- workflow ops/tenant-precedence/patched4/NEW_rescore_pending_leads.json,
-- a create-me payload, not applied). scored_at is when scoring_state last
-- became 'SCORED'.

begin;

alter table public.leads
  add column if not exists scoring_state      text,
  add column if not exists scoring_attempts    integer not null default 0,
  add column if not exists scoring_last_error  text,
  add column if not exists scored_at           timestamptz;

-- Every row written before this migration either already carries an ai_score
-- (scored, one way or another -- RULES, a confirmed model call, or the prose
-- fallback all wrote a number) or was never scored at all (a pre-NX973/NX1002
-- gap, or a row this same defect already dropped mid-flight on some earlier
-- day). Only the former is honestly 'SCORED'; the rest default to 'PENDING'
-- so the new hourly sweep picks them up rather than the migration silently
-- asserting they were handled.
update public.leads
   set scoring_state = 'SCORED',
       scored_at     = coalesce(scored_at, created_at)
 where ai_score is not null
   and scoring_state is null;

update public.leads
   set scoring_state = 'PENDING'
 where scoring_state is null;

alter table public.leads
  alter column scoring_state set default 'PENDING',
  alter column scoring_state set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'leads_scoring_state_is_a_known_label'
  ) then
    alter table public.leads
      add constraint leads_scoring_state_is_a_known_label
      check (scoring_state in (
        'PENDING',  -- row is written; the model ladder has not produced a score yet (or is retrying)
        'SCORED',   -- ai_score/status reflect a completed scoring pass (any score_source)
        'FAILED'    -- scoring_attempts reached the sweep's cap; stopped retrying, row is not lost
      ));
  end if;
end $$;

comment on column public.leads.scoring_state is
  'Pipeline state, NOT score provenance (see score_source, NX920). PENDING = '
  'row persisted by "Persist Lead (deterministic)" before the model ladder ran '
  'or while it is retrying. SCORED = a scoring pass (router-inline or the '
  'hourly rescore sweep) wrote ai_score/status. FAILED = the sweep gave up '
  'after scoring_attempts reached its cap; the row still exists with whatever '
  'deterministic data Persist Lead wrote, it is just unscored.';
comment on column public.leads.scoring_attempts is
  'Incremented by nexus_record_lead_scoring_result on every scoring attempt '
  '(router-inline or sweep), success or failure. Never reset.';
comment on column public.leads.scoring_last_error is
  'Free text from the most recent failed scoring attempt (e.g. an OpenRouter '
  'free-tier quota message). Null once scoring_state = SCORED.';
comment on column public.leads.scored_at is
  'When scoring_state last became SCORED. Null for PENDING/FAILED rows.';

-- Sweep needs "this tenant's PENDING rows, oldest first" cheaply and often
-- (hourly); scoring_state alone is low-cardinality so pair it with tenant_id.
create index if not exists idx_leads_tenant_scoring_pending
  on public.leads (tenant_id, created_at)
  where scoring_state = 'PENDING';

-- ── nexus_pending_scoring_leads_for_tenant ──────────────────────────────────
-- Read side of the sweep. Same shape as NX1000's
-- nexus_customer_360_directory_for_tenant: p_tenant is a REQUIRED argument
-- (never a default/global read), SECURITY DEFINER, service_role-only. The
-- scheduled workflow iterates public.nexus_active_dealership_ids() and calls
-- this once per dealership -- exactly the pattern NX1000/NX1001 established
-- for a batch job that has no authenticated caller to validate a claim
-- against. Only scoring_state = 'PENDING' rows are ever returned, which is
-- what makes the sweep idempotent: a lead the router (or a previous sweep
-- run) already marked SCORED simply stops appearing here, with no separate
-- locking needed for this workload.
drop function if exists public.nexus_pending_scoring_leads_for_tenant(uuid, integer);

create or replace function public.nexus_pending_scoring_leads_for_tenant(p_tenant uuid, p_limit integer default 50)
returns table (
  id               integer,
  name             text,
  email            text,
  phone            text,
  vehicle_interest text,
  budget_aed       integer,
  source           text,
  scoring_attempts integer,
  created_at       timestamptz,
  tenant_id        uuid
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select l.id, l.name, l.email, l.phone, l.vehicle_interest, l.budget_aed,
         l.source, l.scoring_attempts, l.created_at, l.tenant_id
    from public.leads l
   where p_tenant is not null
     and l.tenant_id = p_tenant
     and l.scoring_state = 'PENDING'
     and not exists (
       select 1 from public.tenants _q
        where _q.id = p_tenant and _q.is_quarantine
     )
   order by l.created_at asc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

comment on function public.nexus_pending_scoring_leads_for_tenant(uuid, integer) is
  'PENDING-scoring leads for exactly ONE explicit dealership, oldest first, for '
  'the hourly rescore sweep (n8n NEW_rescore_pending_leads, not yet created). '
  'p_tenant is required and the caller (the sweep) resolves it by iterating '
  'nexus_active_dealership_ids() itself -- same shape as NX1000''s '
  'nexus_customer_360_directory_for_tenant and NX1001''s '
  'nexus_erp_bitrix24_hot_leads_backlog, for the same reason: a scheduled batch '
  'has no authenticated caller for nexus_caller_tenant_scope() to resolve. A '
  'quarantine p_tenant, or one not owning any of these rows, returns zero rows. '
  'Returning only scoring_state=PENDING rows is what makes the sweep idempotent '
  '-- a lead already SCORED (by the router inline, or a prior sweep run) simply '
  'stops being returned. SECURITY DEFINER and service_role-only: p_tenant is the '
  'entire boundary (public.leads carries no RLS an arbitrary caller''s p_tenant '
  'would still be checked against), so anon/authenticated must never reach it.';

revoke all on function public.nexus_pending_scoring_leads_for_tenant(uuid, integer) from public, anon, authenticated;
grant execute on function public.nexus_pending_scoring_leads_for_tenant(uuid, integer) to service_role;

-- ── nexus_record_lead_scoring_result ────────────────────────────────────────
-- Write side of the sweep (and reusable by the router's own inline PATCH
-- node, "Update Lead Scoring (PATCH)"). p_tenant + p_lead_id together are the
-- boundary: the update predicate names both, so a caller cannot touch a row
-- outside its own claimed tenant even under service_role's bypass-RLS. Every
-- call increments scoring_attempts; on success the row becomes SCORED; on
-- failure it stays/returns to PENDING until scoring_attempts reaches
-- p_max_attempts, at which point it becomes FAILED and the sweep stops
-- retrying it (the row is never deleted -- FAILED is not lost, PENDING was
-- the whole point of this migration).
drop function if exists public.nexus_record_lead_scoring_result(uuid, integer, boolean, integer, text, text, integer);

create or replace function public.nexus_record_lead_scoring_result(
  p_tenant       uuid,
  p_lead_id      integer,
  p_success      boolean,
  p_ai_score     integer default null,
  p_intent       text    default null,
  p_error        text    default null,
  p_max_attempts integer default 5
)
returns setof public.leads
language sql
volatile
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  update public.leads l
     set scoring_attempts   = l.scoring_attempts + 1,
         ai_score            = case when p_success then coalesce(p_ai_score, l.ai_score) else l.ai_score end,
         status              = case when p_success then coalesce(p_intent, l.status) else l.status end,
         scoring_state       = case
                                  when p_success then 'SCORED'
                                  when l.scoring_attempts + 1 >= greatest(1, coalesce(p_max_attempts, 5)) then 'FAILED'
                                  else 'PENDING'
                                end,
         scoring_last_error  = case when p_success then null else p_error end,
         scored_at           = case when p_success then now() else l.scored_at end
   where p_tenant is not null
     and l.tenant_id = p_tenant
     and l.id = p_lead_id
     and l.scoring_state <> 'SCORED'
  returning l.*;
$fn$;

comment on function public.nexus_record_lead_scoring_result(uuid, integer, boolean, integer, text, text, integer) is
  'Records one scoring attempt (router-inline or sweep) against exactly one '
  'row, matched on (p_tenant, p_lead_id) so a service_role caller cannot cross '
  'a tenant boundary even though service_role itself bypasses RLS. Always '
  'increments scoring_attempts. On success: ai_score/status/scored_at are set '
  'and scoring_state becomes SCORED. On failure: scoring_last_error is set and '
  'scoring_state stays/returns to PENDING until scoring_attempts reaches '
  'p_max_attempts (default 5), then becomes FAILED -- the row is kept, not '
  'deleted; a human can still see and act on it. The '
  '`l.scoring_state <> ''SCORED''` guard makes double-recording a no-op (0 rows '
  'updated) once a row is SCORED, which is the other half of sweep idempotency '
  'alongside nexus_pending_scoring_leads_for_tenant only ever listing PENDING '
  'rows. SECURITY DEFINER and service_role-only, same reasoning as the read '
  'function above.';

revoke all on function public.nexus_record_lead_scoring_result(uuid, integer, boolean, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.nexus_record_lead_scoring_result(uuid, integer, boolean, integer, text, text, integer) to service_role;

commit;
