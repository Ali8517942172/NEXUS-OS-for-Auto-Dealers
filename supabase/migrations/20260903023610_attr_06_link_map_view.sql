-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- The link map is half the deliverable, so it is a live reading rather than a
-- document that goes stale. This view puts the schema-level finding for each
-- hop next to what that hop actually resolves to in THIS dealership's data
-- today, and orders the broken hops by the integration that would fix them.
--
-- coverage_pct is deliberately NULL rather than 0 when a hop has no instances
-- at all. Nothing was measured, so no percentage is claimed: a missing input is
-- not zero.
--
-- Tenant scoping: security_invoker over v_attribution_edges (itself scoped) and
-- public.tenants, whose RLS limits the caller to their own dealership.

create or replace view public.v_attribution_link_map
with (security_invoker = on) as
with vis as (select t.id as tenant_id, t.name as tenant_name from public.tenants t),
agg as (
  select e.tenant_id, e.edge,
         count(*)::integer as instances_total,
         count(*) filter (where b.is_evidence)::integer     as instances_evidenced,
         count(*) filter (where not b.is_evidence)::integer as instances_refused
    from public.v_attribution_edges e
    join public.attribution_link_basis b using (basis)
   group by e.tenant_id, e.edge
)
select v.tenant_id,
       v.tenant_name,
       et.seq,
       et.edge,
       et.from_node,
       et.to_node,
       et.state,
       et.basis,
       b.is_evidence           as basis_is_evidence,
       b.default_confidence    as basis_confidence,
       et.source_ref,
       et.finding,
       et.unlocked_by,
       et.unlock_rank,
       coalesce(a.instances_total, 0)     as instances_total,
       coalesce(a.instances_evidenced, 0) as instances_evidenced,
       coalesce(a.instances_refused, 0)   as instances_refused,
       case when coalesce(a.instances_total, 0) = 0 then null::numeric
            else round(a.instances_evidenced::numeric * 100 / a.instances_total, 1)
       end as coverage_pct,
       case
         when a.edge is null and et.state in ('ABSENT_NO_TABLE','ABSENT_NO_FIELD','BLOCKED_BY_UPSTREAM')
           then 'No instances, and none can exist: ' || lower(et.state) || '. Coverage is UNKNOWN, not 0%.'
         when a.edge is null
           then 'This hop is not instantiated row-by-row by v_attribution_edges - either nothing has '
                || 'happened yet, or the candidate set would be every record against every unit and is '
                || 'reported in aggregate instead. Coverage is UNKNOWN, not 0%.'
         when a.instances_evidenced = 0
           then a.instances_total || ' candidate(s) exist and NOT ONE is evidence. Everything on this hop is a refusal.'
         when a.instances_refused = 0
           then 'All ' || a.instances_total || ' instances are evidenced.'
         else a.instances_evidenced || ' of ' || a.instances_total
              || ' instances are evidence; the other ' || a.instances_refused
              || ' are refusals and must render as UNKNOWN.'
       end as coverage_note
  from vis v
  cross join public.attribution_edge_type et
  join public.attribution_link_basis b on b.basis = et.basis
  left join agg a on a.tenant_id = v.tenant_id and a.edge = et.edge;

comment on view public.v_attribution_link_map is
  'The revenue attribution chain hop by hop for this dealership: what the schema can evidence (attribution_edge_type), what it actually resolves to in live data (v_attribution_edges), and which integration would close each break (unlocked_by, ordered by unlock_rank). coverage_pct is NULL, never 0, where nothing was measured. Read the ABSENT_ and TEXT_ONLY_ rows as the sales conversation: they are the questions this dealership cannot answer yet and what it would cost to answer them.';

revoke all on public.v_attribution_link_map from anon, public;
revoke all on public.v_attribution_link_map from authenticated;
grant select on public.v_attribution_link_map to authenticated, service_role;
