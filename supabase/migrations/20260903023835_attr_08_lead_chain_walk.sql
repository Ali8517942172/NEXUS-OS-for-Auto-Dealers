-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- The same walk, forwards from a lead: what channel brought this person in,
-- what was said, which car, what was quoted, what was sold, what it earned.
-- Every hop that cannot be evidenced renders UNKNOWN with its reason.
--
-- revenue_confirmed_aed sums only sales that carry this lead by the declared
-- foreign key. A sale whose lead_id is NULL is counted NOWHERE - not against a
-- guessed lead and not as zero against this one. Unattributed revenue is
-- reported separately by v_attribution_link_map, never folded in here.
--
-- A lead with no sale gets revenue_confirmed_aed = 0 and sale_state
-- 'NO_SALE_RECORDED', which is a statement about this database's records and
-- NOT a statement that the person did not buy (INV-007).
--
-- Tenant scoping: security_invoker; all sources already scoped.

create or replace view public.v_attribution_lead_chain
with (security_invoker = on) as
with cfg as (
  select t.id as tenant_id, coalesce(s.min_model_token_overlap, 2) as min_overlap
    from public.tenants t
    left join public.inventory_profit_settings s on s.tenant_id = t.id
),
msg as (
  select m.id as comm_id, min(m.lead_id) as lead_id
    from public.v_lead_messages m group by m.id having count(distinct m.lead_id) = 1
),
conv as (
  select cl.tenant_id, m.lead_id,
         count(*)::integer as msgs,
         count(*) filter (where lower(btrim(cl.direction)) = 'inbound')::integer  as msgs_in,
         count(*) filter (where lower(btrim(cl.direction)) = 'outbound')::integer as msgs_out,
         min(cl.created_at) as first_at, max(cl.created_at) as last_at
    from public.communication_logs cl
    join msg m on m.comm_id = cl.id
   where public.nexus_is_message(cl.direction, cl.channel, cl.message)
   group by cl.tenant_id, m.lead_id
),
sales as (
  select ph.tenant_id, ph.lead_id,
         count(*)::integer as n_sales,
         sum(ph.amount_aed)::bigint as revenue_aed,
         max(ph.purchase_date) as last_sale_date
    from public.purchase_history ph
   where ph.lead_id is not null
   group by ph.tenant_id, ph.lead_id
),
base as (
  select l.tenant_id, l.id as lead_id, l.name as lead_name, l.created_at, l.source,
         l.status, l.ai_score, l.vehicle_interest, c.min_overlap,
         cv.msgs, cv.msgs_in, cv.msgs_out, cv.first_at, cv.last_at,
         s.n_sales, s.revenue_aed, s.last_sale_date,
         (select count(*)::integer from public.finance_quotes fq
           where fq.tenant_id = l.tenant_id
             and public.nexus_lead_for_comm_key(fq.lead_email, fq.tenant_id) = l.id) as quotes,
         (select count(*)::integer from public.inventory i
           where i.tenant_id = l.tenant_id
             and coalesce(btrim(l.vehicle_interest),'') <> ''
             and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
                   where t = any (public.nexus_model_tokens(l.vehicle_interest))) >= c.min_overlap
         ) as unit_candidates,
         (select string_agg(i.id, ', ' order by i.id) from public.inventory i
           where i.tenant_id = l.tenant_id
             and coalesce(btrim(l.vehicle_interest),'') <> ''
             and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
                   where t = any (public.nexus_model_tokens(l.vehicle_interest))) >= c.min_overlap
         ) as unit_candidate_list
    from public.leads l
    join cfg c on c.tenant_id = l.tenant_id
    left join conv cv on cv.tenant_id = l.tenant_id and cv.lead_id = l.id
    left join sales s on s.tenant_id = l.tenant_id and s.lead_id = l.id
)
select b.tenant_id, b.lead_id, b.lead_name, b.created_at, b.status, b.ai_score,
       b.source as lead_source_field,

       'UNKNOWN_NO_SOURCE'::text as campaign_state,
       'NO_SOURCE_TABLE'::text   as campaign_basis,
       ('UNKNOWN. No campaigns table exists. leads.source reads "'
         || coalesce(nullif(btrim(b.source),''),'nothing')
         || '", the name of the internal workflow that created this row, not a marketing channel. '
         || 'Nothing records which advertisement, listing or referral this person came from.')::text as campaign_note,

       coalesce(b.msgs,0)     as conversation_messages,
       coalesce(b.msgs_in,0)  as messages_in,
       coalesce(b.msgs_out,0) as messages_out,
       b.first_at as first_message_at,
       b.last_at  as last_message_at,
       case when coalesce(b.msgs,0) > 0 then 'RESOLVED' else 'UNKNOWN_NO_RESOLVED_MESSAGES' end as conversation_state,
       case when coalesce(b.msgs,0) > 0 then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end as conversation_basis,
       case when coalesce(b.msgs,0) > 0 then 'MEDIUM' else 'NONE' end as conversation_confidence,
       case when coalesce(b.msgs,0) > 0
            then coalesce(b.msgs,0) || ' messages resolved to this lead by the identity rule (INV-002).'
            else 'UNKNOWN: no message resolves to this lead. Messages may exist under a WhatsApp handle '
                 || 'nobody has tied to this person - a missing row is not proof nothing was said.'
       end as conversation_note,

       left(coalesce(b.vehicle_interest,''), 300) as vehicle_interest_text,
       coalesce(b.unit_candidates,0) as vehicle_text_candidates,
       case when coalesce(btrim(b.vehicle_interest),'') = '' then 'UNKNOWN_NOT_RECORDED'
            when coalesce(b.unit_candidates,0) > 0 then 'UNKNOWN_TEXT_ONLY'
            else 'UNKNOWN_NO_FIELD' end as vehicle_state,
       case when coalesce(b.unit_candidates,0) > 0 then 'MODEL_TEXT_ONLY' else 'NO_LINK_FIELD' end as vehicle_basis,
       case when coalesce(btrim(b.vehicle_interest),'') = ''
              then 'UNKNOWN: no vehicle interest recorded on this lead at all.'
            when coalesce(b.unit_candidates,0) > 0
              then 'UNKNOWN. leads has no column that could name a unit. ' || b.unit_candidates
                   || ' unit(s) share ' || b.min_overlap || '+ model words with the free text ('
                   || b.unit_candidate_list || '), which is a prompt for a person and not a link.'
            else 'UNKNOWN. leads has no column that could name a unit, and no unit shares '
                 || b.min_overlap || '+ model words with what this person wrote.'
       end as vehicle_note,

       coalesce(b.quotes,0) as finance_quotes,
       case when coalesce(b.quotes,0) > 0 then 'RESOLVED' else 'NO_QUOTE_RECORDED' end as finance_state,
       case when coalesce(b.quotes,0) > 0 then 'RESOLVED_IDENTITY' else 'LINK_FIELD_EMPTY' end as finance_basis,
       case when coalesce(b.quotes,0) > 0
            then coalesce(b.quotes,0) || ' finance quote(s) resolve to this person. Note this says nothing '
                 || 'about whether any sale closed on one: no column ties a quote to a sale.'
            else 'No finance quote resolves to this person. That is this database''s record, not proof '
                 || 'they were never quoted.'
       end as finance_note,

       coalesce(b.n_sales,0)     as sales_recorded,
       coalesce(b.revenue_aed,0) as revenue_confirmed_aed,
       'CONFIRMED_REVENUE'::text as revenue_kind,
       b.last_sale_date,
       case when coalesce(b.n_sales,0) > 0 then 'RESOLVED' else 'NO_SALE_RECORDED' end as sale_state,
       case when coalesce(b.n_sales,0) > 0 then 'FOREIGN_KEY' else 'LINK_FIELD_EMPTY' end as sale_basis,
       case when coalesce(b.n_sales,0) > 0
            then coalesce(b.n_sales,0) || ' sale(s) carry this lead by the declared foreign key '
                 || 'purchase_history.lead_id. Revenue is CONFIRMED - a column of each sale.'
            else 'No sale in this database names this lead. A sale recorded without a lead_id would be '
                 || 'invisible here, so this is not proof this person did not buy.'
       end as sale_note,

       null::bigint as gross_margin_aed,
       'NOT_COMPUTABLE'::text as margin_state,
       ('NOT COMPUTABLE, not zero. Margin needs the acquisition cost of the unit sold, and no column '
         || 'ties any sale to an inventory unit.')::text as margin_note,

       6 as hops_total,
       (0                                                                  -- campaign: never evidenced today
      + case when coalesce(b.msgs,0)   > 0 then 1 else 0 end               -- conversation
      + 0                                                                  -- vehicle: always refused today
      + case when coalesce(b.quotes,0) > 0 then 1 else 0 end               -- finance
      + case when coalesce(b.n_sales,0)> 0 then 1 else 0 end               -- sale
      + case when coalesce(b.n_sales,0)> 0 then 1 else 0 end               -- revenue
       ) as hops_evidenced,
       'CAMPAIGN'::text as first_break,
       jsonb_build_array(
         jsonb_build_object('hop','CAMPAIGN','state','UNKNOWN_NO_SOURCE','basis','NO_SOURCE_TABLE'),
         jsonb_build_object('hop','CONVERSATION','state',
            case when coalesce(b.msgs,0) > 0 then 'RESOLVED' else 'UNKNOWN_NO_RESOLVED_MESSAGES' end,
            'messages', coalesce(b.msgs,0)),
         jsonb_build_object('hop','VEHICLE','state',
            case when coalesce(b.unit_candidates,0) > 0 then 'UNKNOWN_TEXT_ONLY' else 'UNKNOWN_NO_FIELD' end,
            'refused_candidates', coalesce(b.unit_candidates,0)),
         jsonb_build_object('hop','FINANCE','state',
            case when coalesce(b.quotes,0) > 0 then 'RESOLVED' else 'NO_QUOTE_RECORDED' end,
            'quotes', coalesce(b.quotes,0)),
         jsonb_build_object('hop','SALE','state',
            case when coalesce(b.n_sales,0) > 0 then 'RESOLVED' else 'NO_SALE_RECORDED' end,
            'sales', coalesce(b.n_sales,0)),
         jsonb_build_object('hop','REVENUE','state',
            case when coalesce(b.n_sales,0) > 0 then 'CONFIRMED' else 'NONE_RECORDED' end,
            'aed', coalesce(b.revenue_aed,0))
       ) as chain
  from base b;

comment on view public.v_attribution_lead_chain is
  'One row per lead, walking forward: Campaign -> Conversation -> Vehicle -> Finance -> Sale -> Revenue, with state, basis and reason at every hop. first_break is CAMPAIGN for every lead in this database because no campaigns table exists. revenue_confirmed_aed counts only sales carrying this lead by foreign key; a sale with a NULL lead_id is counted against nobody rather than guessed onto somebody. NO_SALE_RECORDED is a statement about the records, never a statement that the person did not buy.';

revoke all on public.v_attribution_lead_chain from anon, public;
revoke all on public.v_attribution_lead_chain from authenticated;
grant select on public.v_attribution_lead_chain to authenticated, service_role;
