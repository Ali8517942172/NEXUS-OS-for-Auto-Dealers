-- CONNECTED meant "an endpoint row exists". For a walk-in it also had to mean
-- "somebody can type one in", and nobody could.
--
-- WHAT WAS MEASURED
-- -----------------
-- nexus_lead_source_readiness() reports walk_in and phone_call as CONNECTED to
-- the ALBA session today, and the Lead Sources screen renders that as the only
-- green pill it has. Both endpoints are registered, active and production.
--
-- Then the dashboard was searched, source and shipped bundle both, for any way
-- a human could put a lead into NEXUS. There is none. Measured 7 Sep 2026:
--
--   * The ONLY write anywhere that touches public.leads is
--     lib/lead-drawer.js:490 -- a PATCH of assigned_to_id on a row that already
--     exists. There is no POST to leads and no lead-creating rpc.
--   * nexus_record_lead_event, nexus_hydrate_lead_event and
--     nexus_promote_lead_event appear NOWHERE in the app -- not in source, and
--     zero occurrences in dist/assets/main-*.js, which is the deployed truth.
--   * The three doors are service_role-only by grant, so a signed-in
--     salesperson could not call them from the browser even if a form existed.
--
-- So for the two sources a UAE showroom actually lives on -- the person who
-- walks in, and the person who telephones -- NEXUS says CONNECTED and there is
-- nowhere to enter one. That is this project's own recurring defect, one layer
-- further out. This file already records the first two turns of it:
--
--   v1: connectedness derived from integration_status -- a fact about the
--       PROVIDER. Wrong, because Meta being available says nothing about us.
--   v2: derived from whether an endpoint row exists -- a fact about US. Better,
--       and the comment in v2 says in its own words that an endpoint row "is
--       still not the same fact as a delivery can arrive".
--   v3, here: for a WEBHOOK source the endpoint IS the path, because the
--       deliverer is a provider that posts to it. For a MANUAL_ENTRY source the
--       deliverer is a person, and the path is a screen. A registered endpoint
--       with no screen behind it is a door with no handle on the inside.
--
-- WHY A COLUMN AND NOT A RULE
-- ---------------------------
-- The tempting fix -- "MANUAL_ENTRY is never CONNECTED" -- is wrong the day the
-- form ships, and it would be wrong silently. The function cannot see the
-- dashboard, so the existence of an entry surface is a FACT SOMEBODY MUST
-- RECORD, and flipping it has to be a deliberate act tied to shipping the
-- screen. lead_source_catalogue.manual_entry_surface names that screen; NULL
-- means there is not one.
--
-- The CHECK stops the column becoming a general-purpose lie: only a
-- MANUAL_ENTRY source may name a surface, so a webhook source cannot claim one
-- to make itself read green.
--
-- ALTER TABLE here is safe and that was checked rather than assumed.
-- nexus_guard_born_open_grants() revokes ALL from anon and
-- INSERT/UPDATE/DELETE/TRUNCATE from authenticated. lead_source_catalogue holds
-- exactly `authenticated=r` and nothing else, so there is nothing for the guard
-- to strip -- unlike public.leads and public.inventory, where the same
-- statement takes two live screens offline.

alter table public.lead_source_catalogue
  add column if not exists manual_entry_surface text;

comment on column public.lead_source_catalogue.manual_entry_surface is
  'The screen a person uses to enter a lead of this kind by hand, or NULL if '
  'there is not one. Only meaningful for MANUAL_ENTRY sources: for every other '
  'delivery shape the deliverer is a provider and the registered endpoint is '
  'itself the path. NULL is the honest default and this column exists so that '
  '"a person can do this" is a recorded fact rather than something a readiness '
  'function assumes. Set it in the same change that ships the screen.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lead_source_catalogue'::regclass
                    and conname = 'lead_source_manual_surface_only_for_manual_entry') then
    alter table public.lead_source_catalogue
      add constraint lead_source_manual_surface_only_for_manual_entry
      check (manual_entry_surface is null
             or (delivery_shape = 'MANUAL_ENTRY' and btrim(manual_entry_surface) <> ''));
  end if;
end $$;

-- Nothing is set. There is no such screen today, and writing a placeholder here
-- would put the green pill straight back.

create or replace function public.nexus_lead_source_readiness()
returns table (source_key text, display_name text, channel_family text,
               connection_state text, provider_route text,
               active_endpoints integer, evidence_note text)
language sql
stable security definer
set search_path = public, pg_catalog
as $function$
  with mine as (
    select e.source_key,
           count(*) filter (where e.environment = 'production')  as prod_n,
           count(*) filter (where e.environment = 'simulation')  as sim_n
      from public.lead_ingest_endpoint e
      join public.tenants t on t.id = e.tenant_id and t.status = 'active'
     where e.status = 'active'
       and e.tenant_id in (select public.nexus_current_tenant_ids())
     group by e.source_key
  )
  select c.source_key,
         c.display_name,
         c.channel_family,
         case
           -- Nothing this dealership does can connect this one. Said first,
           -- because it is true regardless of what is or is not registered.
           when c.integration_status = 'COMMERCIAL_CONVERSATION_REQUIRED'
             then 'NOT_CONNECTABLE'
           -- Said BEFORE the CONNECTED branch, because this is the case where
           -- CONNECTED was true of the endpoint and false of the dealership. A
           -- manual source's deliverer is a person; with no surface for that
           -- person, a registered endpoint receives nothing and the pill was
           -- telling a showroom its walk-ins were being captured.
           when c.delivery_shape = 'MANUAL_ENTRY'
                and coalesce(m.prod_n, 0) > 0
                and c.manual_entry_surface is null
             then 'REGISTERED_NO_ENTRY_PATH'
           when coalesce(m.prod_n, 0) > 0 then 'CONNECTED'
           -- A simulation endpoint is not a connection. It must never read as
           -- one, or the simulator becomes indistinguishable from a live feed.
           when coalesce(m.sim_n, 0) > 0 then 'SIMULATION_ONLY'
           else 'NOT_CONNECTED'
         end                                        as connection_state,
         c.integration_status                       as provider_route,
         coalesce(m.prod_n, 0)::integer             as active_endpoints,
         c.evidence_note
    from public.lead_source_catalogue c
    left join mine m on m.source_key = c.source_key
   order by c.channel_family, c.display_name;
$function$;

comment on function public.nexus_lead_source_readiness() is
  'Whether THIS dealership is receiving from each source. Derived from what is '
  'registered to the caller''s own dealership, never from the provider''s '
  'availability -- and, for a MANUAL_ENTRY source, never from the endpoint '
  'alone: a walk-in needs a person and a screen, and REGISTERED_NO_ENTRY_PATH '
  'is what a registered endpoint with no screen behind it actually is.';

revoke all on function public.nexus_lead_source_readiness() from public, anon, authenticated;
grant execute on function public.nexus_lead_source_readiness() to authenticated, service_role;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_lead_source_readiness()', 'execute') then
    bad := array_append(bad, 'anon can execute the readiness function');
  end if;
  if not has_function_privilege('authenticated', 'public.nexus_lead_source_readiness()', 'execute') then
    bad := array_append(bad, 'authenticated CANNOT execute it, so the Lead Sources screen is broken');
  end if;
  if not has_function_privilege('service_role', 'public.nexus_lead_source_readiness()', 'execute') then
    bad := array_append(bad, 'service_role CANNOT execute it');
  end if;
  -- The guard fires on the ALTER TABLE above. It strips writes, not reads, and
  -- this table holds only authenticated=r -- but "should be unaffected" is what
  -- was believed about public.leads too, so it is measured here.
  if not has_table_privilege('authenticated', 'public.lead_source_catalogue', 'SELECT') then
    bad := array_append(bad, 'authenticated lost SELECT on lead_source_catalogue');
  end if;
  if has_table_privilege('anon', 'public.lead_source_catalogue', 'SELECT') then
    bad := array_append(bad, 'anon gained SELECT on lead_source_catalogue');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'lead source readiness change is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
