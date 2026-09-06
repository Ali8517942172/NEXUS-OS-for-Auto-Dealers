-- ===========================================================================
-- team_04_a_dealership_can_see_its_own_consent_state
--
-- WHY. A UAE dealership will be asked who agreed to be messaged on WhatsApp,
-- when, and on what evidence. NEXUS holds that record and the dealership
-- cannot see any of it: measured on both projects, `authenticated` gets
-- SQLSTATE 42501 on public.whatsapp_opt_in_event -- no table grant, no column
-- grant, and a RESTRICTIVE whatsapp_opt_in_event_deny_end_users naming
-- `authenticated` and `anon` that was laid deliberately on 6 Sep 2026
-- (migration 20260906050648) precisely so the closure would be a decision
-- rather than an accident.
--
-- THAT FLOOR IS NOT LIFTED HERE, and lifting it was the wrong move. The
-- reasoning is recorded in CLAUDE.md against the same table: opening a grant
-- means designing a projection at the table, where a later CREATE OR REPLACE
-- or a forgotten revoke widens it with no grant-shaped diff to review. The
-- pattern this project settled on the same morning is
-- nexus_workflow_catalogue(): a SECURITY DEFINER accessor whose RESULT TYPE is
-- the projection, so a column that is not returned is absent by construction
-- rather than merely unprojected.
--
-- SCOPE. Both functions filter on public.nexus_current_tenant_ids() -- the same
-- key every tenant-scoped policy uses. A member of an active dealership sees
-- that dealership's consent record; a session belonging to no dealership sees
-- nothing; service_role sees nothing here, because there is no auth.uid() on an
-- n8n request. The engine's own writers are untouched and keep reading the
-- table directly as service_role.
--
-- WHAT IS DELIBERATELY RETURNED. customer_wa_id, the event, when it happened,
-- the mechanism, and the evidence -- kind and reference both. The evidence is
-- the whole point: "we have consent" is worth nothing in a compliance review
-- without the thing it rests on. `id` and `consent_rank` are NEXUS's own
-- bookkeeping and the second is a generated tie-break, so neither is returned;
-- recorded_at is, because "when the customer said it" and "when we wrote it
-- down" are different facts and a reviewer will ask for both.
--
-- CURRENT STATE IS NOT DERIVED A SECOND TIME. nexus_whatsapp_consent_current()
-- calls public.whatsapp_opt_in_state() for each customer rather than repeating
-- its ORDER BY. That function is the single canonical derivation -- the
-- consent-identity pass on 4 Sep 2026 removed two hand-written ORDER BYs
-- specifically so this answer could not depend on which consumer asked -- and
-- it carries the future-dated filter and the OPT_OUT-wins tie-break with it.
--
-- ZERO ROWS IS THE HONEST ANSWER TODAY. Production and staging both hold zero
-- rows in whatsapp_opt_in_event. The screen reading this MUST render that as
-- "nothing has been recorded yet", never as "nobody has opted out" -- an empty
-- consent table is the absence of a record, and treating it as evidence of
-- consent, or of its withdrawal, is the exact substitution this codebase has
-- made in six other places.
-- ===========================================================================

create or replace function public.nexus_whatsapp_consent_events(
  p_limit integer default 200
)
returns table (
  tenant_id            uuid,
  integration_id       uuid,
  channel_type         text,
  channel_identifier   text,
  customer_wa_id       text,
  event                text,
  occurred_at          timestamptz,
  mechanism            text,
  evidence_kind        text,
  evidence_ref         text,
  recorded_by          text,
  recorded_at          timestamptz,
  notes                text
)
language sql
security definer
stable
set search_path = public
as $fn$
  select
    e.tenant_id,
    e.integration_id,
    c.channel_type,
    c.external_identifier,
    e.customer_wa_id,
    e.event,
    e.occurred_at,
    e.mechanism,
    e.evidence_kind,
    e.evidence_ref,
    e.recorded_by,
    e.recorded_at,
    e.notes
  from public.whatsapp_opt_in_event e
  left join public.channel_registry c on c.integration_id = e.integration_id
  where e.tenant_id in (select public.nexus_current_tenant_ids())
  order by e.occurred_at desc, e.recorded_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$fn$;

comment on function public.nexus_whatsapp_consent_events(integer) is
  'The caller''s own dealership''s WhatsApp consent history: which customer, opted in or out, when, by what mechanism and on what evidence. Scoped by nexus_current_tenant_ids(). The table itself stays closed to end users by grant and by a RESTRICTIVE policy; this projection is the grant.';

create or replace function public.nexus_whatsapp_consent_current()
returns table (
  tenant_id          uuid,
  integration_id     uuid,
  channel_type       text,
  channel_identifier text,
  customer_wa_id     text,
  state              text,
  event              text,
  occurred_at        timestamptz,
  mechanism          text,
  evidence_kind      text,
  evidence_ref       text,
  recorded_by        text,
  recorded_at        timestamptz
)
language sql
security definer
stable
set search_path = public
as $fn$
  select
    k.tenant_id,
    k.integration_id,
    c.channel_type,
    c.external_identifier,
    k.customer_wa_id,
    s.state,
    s.event,
    s.occurred_at,
    s.mechanism,
    s.evidence_kind,
    s.evidence_ref,
    s.recorded_by,
    s.recorded_at
  from (
    select distinct e.tenant_id, e.integration_id, e.customer_wa_id
      from public.whatsapp_opt_in_event e
     where e.tenant_id in (select public.nexus_current_tenant_ids())
  ) k
  -- The single canonical derivation. Repeating its ORDER BY here would be a
  -- second answer to "is this customer opted in", and the 4 Sep consent pass
  -- deleted the last two of those on purpose.
  cross join lateral public.whatsapp_opt_in_state(k.tenant_id, k.integration_id, k.customer_wa_id) s
  left join public.channel_registry c on c.integration_id = k.integration_id
  order by s.occurred_at desc;
$fn$;

comment on function public.nexus_whatsapp_consent_current() is
  'Where each customer stands right now on WhatsApp consent at the caller''s dealership, derived by whatsapp_opt_in_state() rather than re-ordered here. A customer with no event at all does not appear -- unknown is not an opt-out.';

revoke all on function public.nexus_whatsapp_consent_events(integer) from public, anon;
revoke all on function public.nexus_whatsapp_consent_current()       from public, anon;
grant execute on function public.nexus_whatsapp_consent_events(integer) to authenticated, service_role;
grant execute on function public.nexus_whatsapp_consent_current()       to authenticated, service_role;