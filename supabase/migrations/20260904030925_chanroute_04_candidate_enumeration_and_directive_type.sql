-- chanroute_04_candidate_enumeration_and_directive_type

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                  where n.nspname='public' and t.typname='nexus_send_directive_row') then
    create type public.nexus_send_directive_row as (
      directive                       text,
      outcome                         text,
      reason_code                     text,
      reason                          text,
      what_would_change_it            text,
      tenant_id                       uuid,
      tenant_slug                     text,
      customer_external_id            text,
      intent                          text,
      requested_send_form             text,
      integration_id                  uuid,
      provider                        text,
      channel_type                    text,
      external_identifier             text,
      credential_ref                  text,
      carrier_rule                    text,
      candidates_considered           jsonb,
      resolved_send_form              text,
      message_body                    text,
      template_ref                    text,
      template_variables              jsonb,
      template_category_required      text,
      template_verification           text,
      template_verification_detail    text,
      media_ref                       text,
      media_mime                      text,
      policy_decision                 text,
      policy_reason_code              text,
      policy_reason                   text,
      policy_what_would_change_it     text,
      policy_applied_rule_id          uuid,
      policy_rule_verification_status text,
      policy_window_state             text,
      policy_window_expires_at        timestamptz,
      policy_evaluated_at             timestamptz,
      capability_state                text,
      capability_basis                text,
      capability_evidence             text,
      whatsapp_capability_state       text,
      whatsapp_capability_note        text,
      requested_by                    text,
      routed_at                       timestamptz,
      routed_by                       text
    );
  end if;
end$$;

comment on type public.nexus_send_directive_row is
  'What the provider router hands back: what to send, through which integration, with which credential REFERENCE, and the policy decision it rests on. It contains no credential and performs no HTTP call - the call belongs in n8n, where the credentials live.';


-- ---------------------------------------------------------------------------
-- Candidate enumeration. Every active integration the dealership has, ordered
-- by the carrier rules, with the ineligible ones kept in the result rather than
-- filtered away, so that the reason an integration was NOT used is recorded
-- alongside the one that was.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_channel_send_candidates(
  p_tenant_id            uuid,
  p_send_form            text,
  p_customer_external_id text
) returns table (
  integration_id            uuid,
  channel_type              text,
  external_identifier       text,
  credential_ref            text,
  provider                  text,
  provider_rank             integer,
  is_official_platform      boolean,
  support_state             text,
  capability_basis          text,
  capability_evidence       text,
  last_customer_message_at  timestamptz,
  registered_at             timestamptz,
  eligible                  boolean,
  selection_order           bigint,
  excluded_because          text
)
language sql
stable
set search_path to 'public','pg_catalog'
as $fn$
  with cand as (
    select cr.integration_id,
           cr.channel_type,
           cr.external_identifier,
           cr.credential_ref,
           cr.created_at as registered_at,
           case cr.channel_type
             when 'whatsapp_waha_session'          then 'waha'
             when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
           end as provider
      from public.channel_registry cr
      join public.tenants t on t.id = cr.tenant_id
     where cr.tenant_id = p_tenant_id
       and cr.status    = 'active'
       and t.status     = 'active'
  ),
  enriched as (
    select c.*,
           r.rank as provider_rank,
           coalesce(r.is_official_platform, false) as is_official_platform,
           k.support_state,
           k.basis    as capability_basis,
           k.evidence as capability_evidence,
           ws.last_customer_message_at
      from cand c
      left join public.channel_provider_rank r on r.provider = c.provider
      left join lateral public.nexus_channel_capability_state(c.provider, p_send_form) k on true
      left join public.whatsapp_conversation_state ws
             on ws.tenant_id      = p_tenant_id
            and ws.integration_id = c.integration_id
            and ws.customer_wa_id = lower(btrim(coalesce(p_customer_external_id,'')))
  ),
  ranked as (
    select e.*,
           (e.support_state = 'SUPPORTED' and e.provider is not null) as eligible,
           case when e.support_state = 'SUPPORTED' and e.provider is not null then
             row_number() over (
               -- C1 conversation continuity: a reply leaves from the number the
               --    customer actually wrote to. Outranks the provider preference.
               order by (e.last_customer_message_at is null),
                        e.last_customer_message_at desc nulls last,
               -- C2 official platform first. Lower rank wins. NOT cheaper first.
                        coalesce(e.provider_rank, 999),
               -- C3 deterministic tie-break. Never random, never least-loaded.
                        e.registered_at asc,
                        e.integration_id asc
             )
           end as selection_order
      from enriched e
  )
  select integration_id, channel_type, external_identifier, credential_ref, provider,
         provider_rank, is_official_platform, support_state, capability_basis,
         capability_evidence, last_customer_message_at, registered_at, eligible,
         selection_order,
         case
           when provider is null then
             'This channel_type has no provider mapping, so NEXUS does not know what would carry it.'
           when support_state <> 'SUPPORTED' then
             format('%s cannot carry a %s send. %s', provider, upper(btrim(coalesce(p_send_form,''))), capability_evidence)
           when selection_order > 1 then
             'Capable, but another active integration was selected ahead of it by the carrier rules.'
         end as excluded_because
    from ranked
   order by eligible desc, selection_order nulls last, registered_at, integration_id;
$fn$;

comment on function public.nexus_channel_send_candidates(uuid,text,text) is
$c$Every active integration a dealership holds, with whether it can carry this
send form and where it sits in the carrier order. It returns ineligible
integrations too, so the router can record WHY a channel was not used.

The carrier order is, in strict priority:
  C1  Conversation continuity. If the customer has a measured inbound message on
      one of the capable integrations, the message leaves from that one. A reply
      must come from the number the customer wrote to; splitting one customer
      thread across two dealership numbers is worse than any provider preference.
  C2  Official platform first: channel_provider_rank ascending, which is
      whatsapp_cloud before waha. Read that table comment - the ordering is
      explicitly not economic, and reversing it to save the Cloud API charge is
      the bypass the router forbids.
  C3  Earliest registered, then lowest integration_id. Deterministic, and
      deliberately not "least loaded" or "most recently used".

Note what makes C1 safe. C1 can pick WAHA over a registered Cloud integration,
and someone will eventually ask whether that is a way to dodge the Cloud
template requirement. It is not, and the thing that stops it is not this
ordering: it is that C1 only ever ranks integrations that ALREADY PASSED the
capability filter, and waha has no template capability at all. A message that
policy says needs a template can therefore never come to rest on waha - it comes
to rest on nothing, and the router refuses. The capability data is load-bearing
here, which is why channel_provider_capability's comment forbids adding a
waha-only send form.$c$;

revoke all on function public.nexus_channel_send_candidates(uuid,text,text) from anon, authenticated, public;
grant execute on function public.nexus_channel_send_candidates(uuid,text,text) to service_role;