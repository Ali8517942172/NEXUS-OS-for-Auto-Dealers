-- Attribution a dealership can actually read, without ever touching the identity.
--
-- WHAT WAS MISSING
--
-- Both Meta receivers and the Google receiver already record where a lead came
-- from: `ad_platform`, `ad_platform_confidence`, `ad_platform_evidence`, plus
-- campaign, adset, ad and form identifiers. All of it sits inside
-- hydrated_payload / payload_raw as jsonb, on a table the dealer plane cannot
-- read. So the facts existed and nobody could ask a question of them. A
-- dealership could not answer "how many of these came from Instagram", which is
-- the question that decides where next month's ad budget goes.
--
-- THE RULE THIS LAYER EXISTS TO KEEP
--
-- `lead_event_identity_key` is UNIQUE (tenant_id, source_key, external_event_id).
-- source_key IS the deduplication. Meta delivers Instagram lead ads on the
-- connected Facebook Page's leadgen subscription, so the obvious move -- move the
-- event to the Instagram source once the Graph hop reports the platform -- would
-- make Meta's redelivery of the same leadgen_id look new, and hand the
-- dealership two leads for one customer.
--
-- So attribution is a READ-SIDE PROJECTION. Nothing here writes, nothing here
-- changes source_key, and every column is derived from what the provider
-- actually said.
--
-- AND UNKNOWN STAYS UNKNOWN
--
-- This is the part that matters commercially. At RECEIVED time nobody can know
-- whether a Meta lead was Facebook or Instagram -- the webhook carries no
-- platform field at all. If the Graph hop has not happened, or Meta did not say,
-- the answer is UNKNOWN and it is rendered as UNKNOWN.
--
-- A dashboard that shows "Facebook 3, Instagram 0" while forty leads have no
-- platform at all is not reporting, it is guessing with a chart on top. So
-- nexus_lead_attribution_summary() always emits the UNKNOWN bucket, even when it
-- is empty, and it carries `share_of_known` and `share_of_all` as two DIFFERENT
-- numbers so that nobody can quote the flattering one by accident.

-- WHY THIS IS A SECURITY DEFINER FUNCTION AND NOT A VIEW, MEASURED THE HARD WAY
--
-- The first draft was a view. Two things killed it, in order:
--
-- 1. `authenticated` is denied payload_raw, hydrated_payload, normalized and
--    endpoint_id on lead_event by COLUMN grant -- correct, they are vendor
--    plumbing. A security_invoker view reading them fails 42501 for every
--    dealership user: dead on arrival.
--
-- 2. So the draft dropped security_invoker, to have column privileges checked as
--    the view owner. The DATABASE REFUSED IT, and was right to:
--
--      NEXUS SECURITY GATE: view(s) public.v_lead_attribution in schema public
--      lack security_invoker
--
--    nexus_require_security_invoker_views() is an event trigger that has been
--    guarding this exact mistake since before today, and it names the trap that
--    makes the mistake easy: CREATE OR REPLACE VIEW resets reloptions to NULL,
--    so the option has to be restated on every replace.
--
-- AND A FALSE FINDING THIS FILE ALMOST CARRIED
--
-- While looking for that, a sweep reported "one view has definer semantics, is
-- dealer-readable, touches a tenant table and names no tenant_id" -- which
-- sounded exactly like the KYC oracle and was not real. `v_competitor_latest` is
-- spelled `security_invoker=on`; the other 41 views are spelled
-- `security_invoker=true`. Postgres treats both as the same boolean. The sweep
-- compared option_value against the literal 'true' and read `on` as OFF.
--
-- The positive control is what saved it, before anything was written down:
--
--   an account belonging to 0 dealerships ... 0 rows from the view, 0 from the base table
--   a real member of the owning tenant ..... 7 rows from the view, 22 from the base table
--
-- Which is precisely what invoker semantics predicts. The measurement was right
-- and the reading of it was wrong. Worth carrying: a boolean reloption has more
-- than one spelling, and an audit that string-matches one of them is blind in a
-- direction that will not always be the safe one.
--
-- So: a SECURITY DEFINER function, which may read the jsonb, carrying its own
-- explicit tenant predicate on every statement -- because SECURITY DEFINER
-- bypasses the RLS that would otherwise have done it, and nexus_definer_scoping_audit()
-- is watching.
--
-- One consequence, stated rather than discovered later: service_role gets ZERO
-- rows from this, because nexus_current_tenant_ids() is empty for it. This
-- function answers "my dealership's attribution". The vendor reads lead_event.
create or replace function public.nexus_lead_attribution(
  p_since timestamptz default null
)
returns table (
  event_id                 uuid,
  lead_id                  integer,
  source                   text,
  channel_family           text,
  phase                    text,
  received_at              timestamptz,
  occurred_at              timestamptz,
  is_test_traffic          boolean,
  ad_platform              text,
  ad_platform_confidence   text,
  ad_platform_evidence     text,
  campaign_id              text,
  campaign_name            text,
  adset_or_adgroup_id      text,
  adset_name               text,
  ad_id                    text,
  ad_name                  text,
  form_id                  text,
  gcl_id                   text,
  attribution_completeness text
)
language sql
stable
security definer
set search_path to public, pg_catalog
as $function$
select e.event_id,
       e.lead_id,
       c.display_name   as source,
       c.channel_family,
       e.phase,
       e.received_at,
       e.occurred_at,
       e.environment = 'simulation' as is_test_traffic,

       -- The platform, as the PROVIDER stated it, or UNKNOWN. Never inferred
       -- from a campaign or ad name, however obvious that name looks.
       coalesce(
         nullif(e.hydrated_payload ->> 'ad_platform', ''),
         nullif(e.payload_raw      ->> 'ad_platform', ''),
         'UNKNOWN'
       ) as ad_platform,
       coalesce(
         nullif(e.hydrated_payload ->> 'ad_platform_confidence', ''),
         nullif(e.payload_raw      ->> 'ad_platform_confidence', ''),
         'UNKNOWN'
       ) as ad_platform_confidence,
       -- Why we believe it, in words, on the row. A confidence label with no
       -- evidence behind it is a number somebody will start trusting.
       coalesce(
         nullif(e.hydrated_payload ->> 'ad_platform_evidence', ''),
         nullif(e.payload_raw      ->> 'ad_platform_evidence', ''),
         'No platform was recorded. For a Meta lead this is the normal state '
         || 'until the Graph hop returns: the leadgen webhook carries no platform '
         || 'field, because Instagram lead ads arrive on the Facebook Page''s own '
         || 'subscription.'
       ) as ad_platform_evidence,

       -- The campaign spine, only where the provider sent it.
       coalesce(e.hydrated_payload ->> 'campaign_id',   e.payload_raw ->> 'campaign_id')   as campaign_id,
       coalesce(e.hydrated_payload ->> 'campaign_name', e.payload_raw ->> 'campaign_name') as campaign_name,
       coalesce(e.hydrated_payload ->> 'adset_id',      e.payload_raw ->> 'adgroup_id')    as adset_or_adgroup_id,
       e.hydrated_payload ->> 'adset_name'                                                 as adset_name,
       coalesce(e.hydrated_payload ->> 'ad_id',         e.payload_raw ->> 'ad_id')         as ad_id,
       e.hydrated_payload ->> 'ad_name'                                                    as ad_name,
       coalesce(e.hydrated_payload ->> 'form_id',       e.payload_raw ->> 'form_id')       as form_id,
       -- Google only, and kept for one specific future reason: offline
       -- conversion upload is the only way a dealership ever proves to Google
       -- that the click became a sale.
       e.payload_raw ->> 'gcl_id'                                                          as gcl_id,

       -- A stated grade, not a score. "How much of the spine did the provider
       -- actually give us" is a fact; turning it into 0.73 would invite someone
       -- to average it.
       case
         when coalesce(nullif(e.hydrated_payload ->> 'ad_platform', ''),
                       nullif(e.payload_raw ->> 'ad_platform', '')) is null
           then 'PLATFORM_UNKNOWN'
         when coalesce(e.hydrated_payload ->> 'campaign_id', e.payload_raw ->> 'campaign_id') is null
           then 'PLATFORM_ONLY'
         when coalesce(e.hydrated_payload ->> 'ad_id', e.payload_raw ->> 'ad_id') is null
           then 'PLATFORM_AND_CAMPAIGN'
         else 'FULL_SPINE'
       end as attribution_completeness
  from public.lead_event e
  join public.lead_source_catalogue c on c.source_key = e.source_key
  -- The tenant predicate, in the statement, because SECURITY DEFINER bypasses
  -- the RLS that would otherwise carry it.
 where e.tenant_id in (select public.nexus_current_tenant_ids())
   and (p_since is null or e.received_at >= p_since);
$function$;

comment on function public.nexus_lead_attribution(timestamptz) is
  'Where a lead came from, finer than source_key, derived read-side and never '
  'written back. source_key is the deduplication key -- UNIQUE (tenant_id, '
  'source_key, external_event_id) -- so re-attributing an event by changing it '
  'would make a provider redelivery look new and hand the dealership two leads '
  'for one customer. ad_platform is facebook, instagram, google_search or '
  'UNKNOWN; for Meta it is unknowable until the Graph hop returns, because '
  'Instagram lead ads arrive on the connected Facebook Page''s leadgen '
  'subscription and the webhook has no platform field at all. It is never '
  'inferred from a campaign or ad name. Vendor plumbing -- payload_raw, '
  'endpoint_id, public_key, secret_ref -- is absent from the result type rather '
  'than merely unselected. SECURITY DEFINER because authenticated is denied the '
  'jsonb columns by column grant; the tenant predicate is therefore written into '
  'the statement, and service_role gets zero rows by design.';

revoke all on function public.nexus_lead_attribution(timestamptz) from public, anon;
grant execute on function public.nexus_lead_attribution(timestamptz) to authenticated, service_role;

-- The summary the dashboard should read, shaped so it cannot flatter.
create or replace function public.nexus_lead_attribution_summary(
  p_since timestamptz default null
)
returns table (
  ad_platform     text,
  leads           bigint,
  promoted_leads  bigint,
  share_of_known  numeric,
  share_of_all    numeric,
  note            text
)
language sql
stable
security invoker
set search_path to public
as $$
  -- security invoker over a function that carries its own tenant predicate.
  with base as (
    select a.ad_platform, a.lead_id
      from public.nexus_lead_attribution(p_since) a
     where not a.is_test_traffic
  ),
  tally as (
    select ad_platform,
           count(*)                              as leads,
           count(*) filter (where lead_id is not null) as promoted_leads
      from base group by ad_platform
  ),
  -- The UNKNOWN bucket is emitted even when empty. A platform breakdown that
  -- silently omits it lets "Facebook 3, Instagram 0" stand next to forty leads
  -- nobody can attribute.
  with_unknown as (
    select * from tally
    union all
    select 'UNKNOWN', 0, 0
     where not exists (select 1 from tally where ad_platform = 'UNKNOWN')
  ),
  totals as (
    select sum(leads) as all_leads,
           sum(leads) filter (where ad_platform <> 'UNKNOWN') as known_leads
      from with_unknown
  )
  select w.ad_platform, w.leads, w.promoted_leads,
         case when w.ad_platform = 'UNKNOWN' then null
              when coalesce(t.known_leads, 0) = 0 then null
              else round(100.0 * w.leads / t.known_leads, 1) end,
         case when coalesce(t.all_leads, 0) = 0 then null
              else round(100.0 * w.leads / t.all_leads, 1) end,
         case when w.ad_platform = 'UNKNOWN'
              then 'Leads whose platform the provider never stated. Not a '
                || 'platform, and deliberately excluded from share_of_known -- '
                || 'quote share_of_all if you are asked what fraction of the '
                || 'month came from anywhere in particular.'
              else 'share_of_known excludes the UNKNOWN bucket and will always '
                || 'read higher than share_of_all. They are different questions.'
         end
    from with_unknown w cross join totals t
   order by (w.ad_platform = 'UNKNOWN'), w.leads desc, w.ad_platform;
$$;

comment on function public.nexus_lead_attribution_summary(timestamptz) is
  'Lead counts by advertising platform for the caller''s dealership, scoped by '
  'nexus_lead_attribution(). Always emits the UNKNOWN bucket, even at zero, '
  'and returns share_of_known and share_of_all as two different numbers so the '
  'flattering one cannot be quoted by accident. Simulation traffic is excluded.';

revoke all on function public.nexus_lead_attribution_summary(timestamptz) from public, anon;
grant execute on function public.nexus_lead_attribution_summary(timestamptz) to authenticated, service_role;

do $$
declare v_unknown_present boolean; v_rows int;
begin
  -- The UNKNOWN bucket must be there even on an empty database, or the whole
  -- point of the function is lost the first time somebody reads it.
  select count(*), bool_or(ad_platform = 'UNKNOWN')
    into v_rows, v_unknown_present
    from public.nexus_lead_attribution_summary();
  if not coalesce(v_unknown_present, false) then
    raise exception 'the attribution summary omitted the UNKNOWN bucket, which is the one thing it must never do';
  end if;

  if has_function_privilege('anon', 'public.nexus_lead_attribution(timestamptz)', 'execute') then
    raise exception 'anon can read the attribution projection';
  end if;
  if not has_function_privilege('authenticated', 'public.nexus_lead_attribution(timestamptz)', 'execute') then
    raise exception 'a dealership cannot read its own attribution';
  end if;
  -- SECURITY DEFINER, so the standing audit must see it and be content with it.
  if exists (select 1 from public.nexus_definer_scoping_audit()
              where function_name = 'nexus_lead_attribution' and verdict = 'REVIEW') then
    raise exception 'the new attribution function trips the definer scoping audit';
  end if;
end $$;
