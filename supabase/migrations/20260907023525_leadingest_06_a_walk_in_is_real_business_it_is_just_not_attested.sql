-- One flag was doing two jobs, and the Journey Lab found it by refusing to
-- write a passing verdict it could not earn.
--
-- `lead_provenance_kind.counts_as_real` was set false for `operator_recorded`,
-- and `lead_ingest_endpoint_production_needs_real_provenance` reads that flag.
-- The consequence, which nobody intended: a production `walk_in` or
-- `phone_call` endpoint was **a row that could not exist**. In a UAE showroom
-- the walk-in is the largest source there is, so the ingestion layer was
-- structurally incapable of recording the dealership's main channel while
-- happily recording Facebook.
--
-- The cause is a conflation. "A salesperson typed this in" and "a simulator
-- generated this" are both un-attested by any external system, and they are
-- nothing like each other commercially: one is a real customer standing in the
-- showroom, the other is a fixture. The flag was answering "did an external
-- system attest this?" while being read as "is this real business?".
--
-- So the two questions get two columns. The FK anchor keeps its name and takes
-- the commercial meaning, because that is what the production CHECK is actually
-- asking; attestation becomes its own column and is what the invariants and the
-- dealership's screen read.

alter table public.lead_provenance_kind
  add column is_externally_attested boolean not null default false;

update public.lead_provenance_kind set is_externally_attested = true
 where kind in ('hmac_sha256_x_hub','hmac_sha256_svix','shared_secret_header',
                'shared_secret_in_body','origin_and_form_key');

-- The correction itself: a person vouching for a customer they met is real
-- business. A fixture is not, and `simulated` and `unverified` stay false --
-- which is what keeps the simulator out of production numbers.
update public.lead_provenance_kind
   set counts_as_real = true,
       description = 'A human at the dealership typed this in -- a walk-in, or a phone call they took. '
                     'Nothing external attests it, so is_externally_attested is false; but it is a real '
                     'customer and in a UAE showroom it is the largest source there is, so it counts as '
                     'real business and a production endpoint may carry it.'
 where kind = 'operator_recorded';

comment on column public.lead_provenance_kind.counts_as_real is
  'Is this real business? True for anything an external system attested AND for '
  'what a person at the dealership vouched for. False only for simulator output '
  'and for an origin that was never established. This is the column the '
  'production endpoint CHECK reads, because the question it is asking is '
  'commercial, not cryptographic.';

comment on column public.lead_provenance_kind.is_externally_attested is
  'Did something outside NEXUS prove this arrival? False for operator_recorded, '
  'simulated and unverified. Separate from counts_as_real because a walk-in is '
  'real and unattested at the same time, and one flag answering both questions '
  'made a production walk-in endpoint impossible to register.';

-- A production endpoint whose provenance is not externally attested is a real
-- and legitimate thing (the walk-in), but it is a different kind of thing from
-- a signed webhook, and it must not be able to arrive over the public internet
-- pretending to be one. Manual entry has no public key that a stranger could
-- post to: it is written by a signed-in member of that dealership, so its
-- endpoint carries no secret and no Origin, and this constraint records that
-- the two categories stay separate.
alter table public.lead_ingest_endpoint
  add constraint lead_ingest_endpoint_manual_entry_holds_no_secret check (
    declared_provenance <> 'operator_recorded'
    or (secret_ref is null and cardinality(origin_allowlist) = 0)
  );

create or replace function public.nexus_lead_ingest_invariants()
returns table (invariant text, status text, detail text)
language sql
stable
security invoker
set search_path = public
as $$
  select 'A production endpoint never accepts provenance that is not real business',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' endpoint(s)'
    from public.lead_ingest_endpoint
   where environment = 'production' and not provenance_counts_as_real
  union all
  select 'A production event never rests on provenance that is not real business',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where environment = 'production' and not provenance_counts_as_real
  union all
  select 'No promoted lead came from an unestablished origin',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where phase = 'PROMOTED' and origin_verified = 'unverified'
  union all
  select 'No promoted event points at a lead belonging to another dealership',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event e join public.leads l on l.id = e.lead_id
   where l.tenant_id <> e.tenant_id
  union all
  select 'Simulator output never carries a production label',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where environment = 'production' and origin_verified = 'simulated'
  union all
  select 'Manual entry holds no secret and no public origin',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' endpoint(s)'
    from public.lead_ingest_endpoint
   where declared_provenance = 'operator_recorded'
     and (secret_ref is not null or cardinality(origin_allowlist) > 0)
  union all
  select 'Every source in the catalogue names a provenance that exists',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' source(s)'
    from public.lead_source_catalogue c
    left join public.lead_provenance_kind p on p.kind = c.required_provenance
   where p.kind is null
  union all
  -- Not a pass/fail. A dealership reading its own funnel is entitled to know
  -- how much of it rests on somebody's word rather than on a signature.
  select 'Share of arrivals that nothing external attested',
         'INFO',
         coalesce((select count(*)::text from public.lead_event e
                     join public.lead_provenance_kind p on p.kind = e.origin_verified
                    where e.environment = 'production' and not p.is_externally_attested), '0')
         || ' of '
         || (select count(*)::text from public.lead_event where environment = 'production')
         || ' production arrival(s) rest on a person''s word, not a signature'
  union all
  select 'Sources with no public integration are marked as such, not as buildable',
         'INFO',
         coalesce(string_agg(display_name, ', ' order by display_name), '(none)')
    from public.lead_source_catalogue where integration_status <> 'AVAILABLE';
$$;

revoke all on function public.nexus_lead_ingest_invariants() from public, anon, authenticated;
grant execute on function public.nexus_lead_ingest_invariants() to service_role;

drop view if exists public.v_lead_origin;

create view public.v_lead_origin
with (security_invoker = true) as
select e.event_id,
       e.tenant_id,
       e.source_key,
       c.display_name          as source,
       c.channel_family,
       c.integration_status,
       e.phase,
       e.disposition_reason,
       e.received_at,
       e.occurred_at,
       e.lead_id,
       p.is_cryptographic       as origin_cryptographically_verified,
       p.is_externally_attested as origin_externally_attested,
       p.strength_rank          as origin_strength,
       p.description            as origin_explanation,
       e.environment = 'simulation' as is_test_traffic
  from public.lead_event e
  join public.lead_source_catalogue c on c.source_key = e.source_key
  join public.lead_provenance_kind  p on p.kind = e.origin_verified;

comment on view public.v_lead_origin is
  'Where a dealership''s leads came from and how well that is attested. '
  'security_invoker, so a signed-in user sees only their own dealership''s rows '
  'through lead_event''s RLS. is_test_traffic is exposed rather than filtered, '
  'so a screen that forgets to exclude simulation traffic renders it as test '
  'data instead of counting it as real. origin_externally_attested is separate '
  'from origin_strength on purpose: a walk-in is real business that nothing '
  'external attested, and a Google lead authenticated by a secret sitting in a '
  'request body is attested weakly -- those are two different facts and a screen '
  'that collapses them will mislead somebody.';

alter view public.v_lead_origin owner to postgres;
revoke all on public.v_lead_origin from anon, authenticated, public;
grant select on public.v_lead_origin to authenticated, service_role;