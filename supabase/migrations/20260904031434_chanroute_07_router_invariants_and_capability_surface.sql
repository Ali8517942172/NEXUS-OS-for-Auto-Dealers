-- chanroute_07_router_invariants_and_capability_surface

create or replace view public.v_channel_provider_capability
with (security_invoker = true) as
select c.provider,
       r.rank as provider_rank,
       coalesce(r.is_official_platform,false) as is_official_platform,
       c.send_form,
       f.label as send_form_label,
       f.requires_template_ref,
       f.is_media,
       c.support_state,
       c.basis,
       c.verified_at,
       (c.support_state = 'SUPPORTED' and c.basis <> 'MEASURED_HERE') as supported_but_never_exercised_here,
       c.evidence,
       c.set_by
  from public.channel_provider_capability c
  join public.channel_send_form f on f.code = c.send_form
  left join public.channel_provider_rank r on r.provider = c.provider;

comment on view public.v_channel_provider_capability is
  'The capability matrix with its provenance. supported_but_never_exercised_here is the honest column: it marks every pair NEXUS believes on the vendor word and has not itself done on this deployment. Today that is every pair except waha / FREEFORM_TEXT. Nothing gates on it - the router routes on support_state - but nobody should describe an unexercised pair as a proven capability.';


create or replace function public.nexus_provider_router_invariants()
returns table (
  check_id text,
  state    text,
  finding  text
)
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_n integer;
  v_t text;
begin
  ----------------------------------------------------------------------------
  -- R1. The rank table must not acquire an economic column. This is the
  --     mechanical half of the golden rule: a comment can be ignored, a failing
  --     check cannot be, and the shape of the defect (someone adds a cost
  --     column and ranks on it) has a column name.
  ----------------------------------------------------------------------------
  select string_agg(a.attname, ', ' order by a.attname) into v_t
    from pg_attribute a
   where a.attrelid = 'public.channel_provider_rank'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~* '(cost|price|rate|fee|tariff|charge|cheap|spend|budget)';
  if v_t is null then
    return query select 'R1_NO_COST_COLUMN_ON_RANK'::text, 'PASS'::text,
      'channel_provider_rank carries no economic column. Provider order is not, and must not become, a price order.'::text;
  else
    return query select 'R1_NO_COST_COLUMN_ON_RANK'::text, 'FAIL'::text,
      format('channel_provider_rank has acquired economic column(s): %s. The router selects on registration, policy and capability - never on cost. Using the unofficial transport to dodge the official platform charge is a policy bypass that risks the dealership own number. Remove the column or justify it in writing.', v_t)::text;
  end if;

  ----------------------------------------------------------------------------
  -- R2. The official platform must outrank the unofficial one.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_provider_rank o
   where o.is_official_platform
     and exists (select 1 from public.channel_provider_rank u
                  where not u.is_official_platform and u.rank <= o.rank);
  if v_n = 0 then
    return query select 'R2_OFFICIAL_PLATFORM_FIRST'::text, 'PASS'::text,
      'Every official-platform provider ranks ahead of every unofficial one.'::text;
  else
    return query select 'R2_OFFICIAL_PLATFORM_FIRST'::text, 'FAIL'::text,
      'An unofficial transport now ranks at or ahead of an official platform. That inverts the multi-provider rule and routes business-initiated traffic onto a number the platform does not sanction for it.'::text;
  end if;

  ----------------------------------------------------------------------------
  -- R3. whatsapp_cloud must remain a capability superset of waha. If it stops
  --     being one, the capability filter gains the ability to move a send DOWN
  --     from the official platform to the unofficial one.
  ----------------------------------------------------------------------------
  select string_agg(w.send_form, ', ' order by w.send_form) into v_t
    from public.channel_provider_capability w
   where w.provider = 'waha' and w.support_state = 'SUPPORTED'
     and not exists (select 1 from public.channel_provider_capability c
                      where c.provider = 'whatsapp_cloud' and c.send_form = w.send_form
                        and c.support_state = 'SUPPORTED');
  if v_t is null then
    return query select 'R3_CLOUD_IS_A_SUPERSET_OF_WAHA'::text, 'PASS'::text,
      'Every send form waha can carry, whatsapp_cloud can carry. The capability filter can therefore never move a send from the official platform down to the unofficial one.'::text;
  else
    return query select 'R3_CLOUD_IS_A_SUPERSET_OF_WAHA'::text, 'FAIL'::text,
      format('waha now supports send form(s) whatsapp_cloud does not: %s. nexus_channel_send_candidates filters on capability BEFORE it ranks, so this creates a path where a message lands on the unofficial transport while an official integration sits registered and active. Re-read the comment on channel_provider_capability.', v_t)::text;
  end if;

  ----------------------------------------------------------------------------
  -- R4. Capability completeness. A missing pair fails closed at read time, but
  --     silently; say it out loud.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from (select p.provider, f.code from public.channel_provider_rank p cross join public.channel_send_form f) x
   where not exists (select 1 from public.channel_provider_capability c
                      where c.provider = x.provider and c.send_form = x.code);
  return query select 'R4_CAPABILITY_MATRIX_COMPLETE'::text,
                      case when v_n = 0 then 'PASS' else 'WARN' end::text,
                      case when v_n = 0
                        then 'Every (provider, send form) pair is stated.'
                        else format('%s (provider, send form) pair(s) are not on file. nexus_channel_capability_state resolves those to NOT_SUPPORTED, so nothing unsafe happens - but a capability that is refused because nobody stated it looks identical to one that is refused on purpose.', v_n)
                      end::text;

  ----------------------------------------------------------------------------
  -- R5. Belt for the ledger CHECK: no SEND ever recorded without a decision.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_send_directive d
   where d.directive = 'SEND'
     and d.policy_decision is distinct from 'FREEFORM_ALLOWED'
     and d.policy_decision is distinct from 'TEMPLATE_REQUIRED';
  return query select 'R5_NO_SEND_WITHOUT_A_POLICY_DECISION'::text,
                      case when v_n = 0 then 'PASS' else 'FAIL' end::text,
                      case when v_n = 0
                        then 'No SEND directive exists without a policy decision behind it. The csd_send_requires_policy_decision constraint makes this structurally true, not merely observed.'
                        else format('%s SEND directive(s) carry no policy decision. This should be impossible - check whether csd_send_requires_policy_decision still exists.', v_n)
                      end::text;

  ----------------------------------------------------------------------------
  -- R6. The router must never have written a provider result onto a refusal.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_send_directive d
   where d.directive = 'DO_NOT_SEND'
     and d.send_result not in ('PENDING','NOT_ATTEMPTED');
  return query select 'R6_A_REFUSAL_NEVER_ACQUIRES_A_RESULT'::text,
                      case when v_n = 0 then 'PASS' else 'FAIL' end::text,
                      case when v_n = 0
                        then 'No refused directive carries a provider result.'
                        else format('%s refused directive(s) carry a provider result, which means something sent a message NEXUS had declined.', v_n)
                      end::text;
end;
$fn$;

comment on function public.nexus_provider_router_invariants() is
  'Run this after touching anything in the chanroute_* set. R1 and R3 are the mechanical form of the golden rule: R1 catches someone adding a cost column to the provider order, R3 catches someone giving the unofficial transport a capability the official platform lacks, which is the only way the capability filter could route downward. Both are the failure modes a comment alone would not stop.';

revoke all on public.v_channel_provider_capability from anon, authenticated, public;
revoke all on function public.nexus_provider_router_invariants() from anon, authenticated, public;
grant select on public.v_channel_provider_capability to service_role;
grant execute on function public.nexus_provider_router_invariants() to service_role;