-- Live on the dealership's screen within minutes of the merge: eight of nine
-- sources reading "Connected -- this source can hand NEXUS an enquiry
-- directly." Not one of them is connected. There is no Meta app, no webhook
-- subscription, no receiver of any kind, and `lead_ingest_endpoint` holds zero
-- rows on both projects.
--
-- The screen was reading `lead_source_catalogue.integration_status` and
-- rendering `AVAILABLE` as connected. But that column answers a *commercial*
-- question -- does the provider publish a contract we could implement? -- and
-- the screen was asking an *operational* one: is this dealership wired up? Only
-- Dubizzle looked honest, and only because its value happens to be
-- COMMERCIAL_CONVERSATION_REQUIRED.
--
-- This is the same defect as `counts_as_real` twelve hours earlier: one field
-- answering two questions. That one made a legitimate row impossible to write.
-- This one told a paying dealership that Facebook was feeding it leads.
--
-- So the state is computed here rather than inferred there. The screen gets a
-- single value it renders directly and has nothing left to get wrong.

create or replace function public.nexus_lead_source_readiness()
returns table (
  source_key        text,
  display_name      text,
  channel_family    text,
  connection_state  text,
  provider_route    text,
  active_endpoints  integer,
  evidence_note     text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
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
$$;

comment on function public.nexus_lead_source_readiness() is
  'One row per lead source, telling a dealership whether it is actually '
  'receiving from that source. connection_state is computed here, not inferred '
  'by a screen, because a screen inferring it got it wrong the first time and '
  'told a paying dealership that Facebook Lead Ads was connected when no '
  'receiver existed anywhere. '
  'CONNECTED means an active production endpoint is registered to this '
  'dealership for this source. SIMULATION_ONLY means the only endpoints are '
  'simulator endpoints -- deliberately NOT the same word, so simulator output '
  'can never read as a live feed. NOT_CONNECTED means nothing is registered. '
  'NOT_CONNECTABLE means no route exists to connect to at all, whatever this '
  'dealership does, which today is Dubizzle. provider_route is kept alongside '
  'and is the commercial fact about the provider -- never render it as a '
  'connection state.';

-- SECURITY DEFINER, so read its ACL. Supabase default privileges grant EXECUTE
-- directly to anon and authenticated on every new function, and REVOKE FROM
-- PUBLIC does not touch a direct grant -- that exact shape has opened a hole in
-- this database three times.
revoke all on function public.nexus_lead_source_readiness() from public, anon;
grant execute on function public.nexus_lead_source_readiness() to authenticated, service_role;