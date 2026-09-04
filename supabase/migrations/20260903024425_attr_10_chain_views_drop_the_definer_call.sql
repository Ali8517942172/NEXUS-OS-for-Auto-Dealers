-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- Same fix as attr_09, applied to the two chain walks. They counted a lead's
-- finance quotes by calling nexus_lead_for_comm_key(), which the dashboard's
-- role may not execute. The empty finance_quotes table was the only reason
-- neither view had failed yet: the correlated subquery never evaluated the
-- function because there were no rows to evaluate it against. That is a defect
-- hiding behind a count of zero, which is exactly the failure mode this project
-- keeps hitting - so it is fixed now rather than when the first quote lands.
--
-- Resolution reuses the identity rule's own output via v_lead_messages, as in
-- attr_09. Narrower than the rule (it misses a key that has never appeared in a
-- conversation) and never wider: it can only fail to find a quote, never
-- attach one to the wrong person.

create or replace view public.v_attribution_sale_chain
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
key_lead as (
  select cl.tenant_id, lower(btrim(m.lead_email)) as ckey, min(m.lead_id) as lead_id
    from public.v_lead_messages m
    join public.communication_logs cl on cl.id = m.id
   group by cl.tenant_id, lower(btrim(m.lead_email))
  having count(distinct m.lead_id) = 1
),
quotes_by_lead as (
  select fq.tenant_id, kl.lead_id, count(*)::integer as n
    from public.finance_quotes fq
    join key_lead kl on kl.tenant_id = fq.tenant_id and kl.ckey = lower(btrim(fq.lead_email))
   group by fq.tenant_id, kl.lead_id
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
hc as (
  select ia.tenant_id, ia.outcome_purchase_id as sale_id, ia.unit_id, ia.id as action_id
    from public.inventory_actions ia
   where ia.outcome_purchase_id is not null and ia.outcome_state = 'ATTRIBUTED'
),
base as (
  select ph.tenant_id, ph.id as sale_id, ph.purchase_date, ph.created_at,
         ph.customer_name, ph.email, ph.phone, ph.vehicle, ph.amount_aed,
         ph.deal_id, ph.lead_id,
         l.name as lead_name, l.source as lead_source, l.created_at as lead_created_at,
         c.min_overlap,
         hc.unit_id   as confirmed_unit_id,
         hc.action_id as confirmed_by_action,
         (select count(*)::integer from public.inventory i
           where i.tenant_id = ph.tenant_id
             and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
                   where t = any (public.nexus_model_tokens(ph.vehicle))) >= c.min_overlap
         ) as text_candidates,
         (select string_agg(i.id || ' (' || i.model || ', ' || coalesce(i.status,'?')
                            || ', listed AED ' || to_char(coalesce(i.price_aed,0),'FM999,999,999') || ')', '; '
                            order by i.id)
            from public.inventory i
           where i.tenant_id = ph.tenant_id
             and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
                   where t = any (public.nexus_model_tokens(ph.vehicle))) >= c.min_overlap
         ) as text_candidate_list,
         (select count(*)::integer from public.deals_embeddings de
           where de.tenant_id = ph.tenant_id and de.deal_id = ph.deal_id) as deal_records,
         coalesce(q.n, 0) as quotes_for_lead,
         cv.msgs, cv.msgs_in, cv.msgs_out, cv.first_at, cv.last_at
    from public.purchase_history ph
    join cfg c   on c.tenant_id = ph.tenant_id
    left join public.leads l on l.tenant_id = ph.tenant_id and l.id = ph.lead_id
    left join hc on hc.tenant_id = ph.tenant_id and hc.sale_id = ph.id
    left join conv cv on cv.tenant_id = ph.tenant_id and cv.lead_id = ph.lead_id
    left join quotes_by_lead q on q.tenant_id = ph.tenant_id and q.lead_id = ph.lead_id
),
walk as (
  select b.*,
    'UNKNOWN_NO_SOURCE'::text as campaign_state,
    'NO_SOURCE_TABLE'::text   as campaign_basis,
    ('UNKNOWN. There is no campaigns table in this database. The lead this sale came from records '
      || 'source "' || coalesce(nullif(btrim(b.lead_source),''), 'nothing')
      || '", which names the internal workflow that created the row, not a marketing channel. '
      || 'Which channel produced this AED ' || to_char(coalesce(b.amount_aed,0),'FM999,999,999')
      || ' cannot be answered at any confidence.')::text as campaign_note,
    case when b.lead_id is not null then 'RESOLVED' else 'UNKNOWN_LINK_EMPTY' end as lead_state,
    case when b.lead_id is not null then 'FOREIGN_KEY' else 'LINK_FIELD_EMPTY' end as lead_basis,
    case when b.lead_id is not null then 'HIGH' else 'NONE' end as lead_confidence,
    case when b.lead_id is not null
         then 'Lead ' || b.lead_id || ' (' || coalesce(b.lead_name,'unnamed')
              || '), by the declared foreign key purchase_history.lead_id -> leads(id).'
         else 'UNKNOWN. lead_id is NULL. The dashboard writes it only when the deal was picked from a '
              || 'lead, so this records that nobody captured the provenance - not that the sale came '
              || 'from no lead. Every hop before this one is unreachable as a result.'
    end as lead_note,
    case when b.lead_id is null then 'UNKNOWN_UPSTREAM'
         when coalesce(b.msgs,0) > 0 then 'RESOLVED'
         else 'UNKNOWN_NO_RESOLVED_MESSAGES' end as conversation_state,
    case when b.lead_id is null then 'LINK_FIELD_EMPTY'
         when coalesce(b.msgs,0) > 0 then 'RESOLVED_IDENTITY'
         else 'UNRESOLVED_KEY' end as conversation_basis,
    case when b.lead_id is not null and coalesce(b.msgs,0) > 0 then 'MEDIUM' else 'NONE' end as conversation_confidence,
    case when b.lead_id is null
           then 'UNKNOWN: no lead on the sale, so no conversation can be reached from it.'
         when coalesce(b.msgs,0) > 0
           then b.msgs || ' messages (' || b.msgs_in || ' in, ' || b.msgs_out || ' out) between '
                || to_char(b.first_at,'DD Mon YYYY') || ' and ' || to_char(b.last_at,'DD Mon YYYY')
                || ', resolved to this lead by the identity rule (INV-002). MEDIUM: a rule over four '
                || 'incompatible key shapes, not a foreign key.'
         else 'UNKNOWN: no message resolves to this lead. Messages may exist under a WhatsApp handle '
              || 'this dealership has never tied to a person.'
    end as conversation_note,
    case when b.confirmed_unit_id is not null then 'RESOLVED'
         when coalesce(b.text_candidates,0) > 0 then 'UNKNOWN_TEXT_ONLY'
         else 'UNKNOWN_NO_FIELD' end as vehicle_state,
    case when b.confirmed_unit_id is not null then 'HUMAN_CONFIRMED_LINK'
         when coalesce(b.text_candidates,0) > 0 then 'MODEL_TEXT_ONLY'
         else 'NO_LINK_FIELD' end as vehicle_basis,
    case when b.confirmed_unit_id is not null then 'HIGH' else 'NONE' end as vehicle_confidence,
    case when b.confirmed_unit_id is not null
           then 'Unit ' || b.confirmed_unit_id || ', confirmed by a named person through inventory action '
                || b.confirmed_by_action::text || '. A belief recorded by a person; NEXUS does not claim '
                || 'that action caused the sale.'
         when coalesce(b.text_candidates,0) > 0
           then 'UNKNOWN. purchase_history holds no VIN, no stock number and no inventory id. '
                || b.text_candidates || ' unit(s) share model words with the sale text "'
                || coalesce(b.vehicle,'') || '": ' || b.text_candidate_list
                || '. THE TEXT MATCHES AND PROVES NOTHING - note the unit''s status. A manager can '
                || 'confirm the link in the Inventory Action Center; until one does, this stays UNKNOWN.'
         else 'UNKNOWN. purchase_history holds no reference to an inventory unit, and no unit even '
              || 'shares model words with the sale text.'
    end as vehicle_note,
    case when coalesce(b.deal_records,0) > 0 then 'RESOLVED' else 'UNKNOWN_NO_MATCH' end as deal_record_state,
    case when coalesce(b.deal_records,0) > 0 then 'NATURAL_KEY_MATCH' else 'UNRESOLVED_KEY' end as deal_record_basis,
    case when coalesce(b.deal_records,0) > 0 then 'HIGH' else 'NONE' end as deal_record_confidence,
    case when coalesce(b.deal_records,0) > 0
         then b.deal_records || ' deals_embeddings row(s) on the identical deal_id "' || b.deal_id
              || '". Exact but unenforced - no foreign key stands behind it.'
         else 'UNKNOWN: no deals_embeddings row carries deal_id "' || coalesce(b.deal_id,'') || '".'
    end as deal_record_note,
    'UNKNOWN_NO_FIELD'::text as finance_state,
    'NO_LINK_FIELD'::text    as finance_basis,
    ('UNKNOWN. purchase_history carries no quote id and no calculation_id; finance_quotes carries no '
      || 'sale id. '
      || case when b.lead_id is null then 'No lead on the sale, so not even a same-person quote can be found.'
              when coalesce(b.quotes_for_lead,0) > 0
                then b.quotes_for_lead || ' finance quote(s) exist for the same person, which is NOT the '
                     || 'same as knowing this sale closed on one of them.'
              else 'No finance quote resolves to this person either, so nothing is known about how it was paid for.'
         end)::text as finance_note,
    'CONFIRMED'::text as revenue_state,
    'SAME_ROW'::text  as revenue_basis,
    ('AED ' || to_char(coalesce(b.amount_aed,0),'FM999,999,999')
      || ', a column of the sale record. CONFIRMED revenue - not estimated, not attributed.')::text as revenue_note,
    'NOT_COMPUTABLE'::text as margin_state,
    ('NOT COMPUTABLE, which is not the same as zero. Gross profit is the sale amount minus the unit''s '
      || 'acquisition cost, and inventory.cost_aed is present on every unit - but nothing ties this sale '
      || 'to a unit, so there is no cost to subtract. Fix the vehicle hop and this becomes a number '
      || 'with no further work.')::text as margin_note
  from base b
)
select w.tenant_id, w.sale_id, w.purchase_date, w.created_at as recorded_at,
       w.customer_name, w.vehicle as vehicle_text, w.deal_id,
       w.amount_aed as revenue_aed, 'CONFIRMED_REVENUE'::text as revenue_kind,
       null::integer as gross_margin_aed,
       w.campaign_state, w.campaign_basis, w.campaign_note,
       w.lead_id, w.lead_name, w.lead_state, w.lead_basis, w.lead_confidence, w.lead_note,
       w.msgs as conversation_messages,
       w.conversation_state, w.conversation_basis, w.conversation_confidence, w.conversation_note,
       w.confirmed_unit_id as vehicle_unit_id, w.text_candidates as vehicle_text_candidates,
       w.vehicle_state, w.vehicle_basis, w.vehicle_confidence, w.vehicle_note,
       w.deal_record_state, w.deal_record_basis, w.deal_record_confidence, w.deal_record_note,
       w.quotes_for_lead as finance_quotes_for_lead,
       w.finance_state, w.finance_basis, w.finance_note,
       w.revenue_state, w.revenue_basis, w.revenue_note,
       w.margin_state, w.margin_note,
       8 as hops_total,
       (case when w.campaign_state       = 'UNKNOWN_NO_SOURCE' then 0 else 1 end
      + case when w.lead_state           = 'RESOLVED'          then 1 else 0 end
      + case when w.conversation_state   = 'RESOLVED'          then 1 else 0 end
      + case when w.vehicle_state        = 'RESOLVED'          then 1 else 0 end
      + case when w.deal_record_state    = 'RESOLVED'          then 1 else 0 end
      + case when w.finance_state        = 'UNKNOWN_NO_FIELD'  then 0 else 1 end
      + 1
      + case when w.margin_state         = 'NOT_COMPUTABLE'    then 0 else 1 end
       ) as hops_evidenced,
       case
         when w.campaign_state <> 'RESOLVED'     then 'CAMPAIGN'
         when w.lead_state     <> 'RESOLVED'     then 'LEAD'
         when w.conversation_state <> 'RESOLVED' then 'CONVERSATION'
         when w.vehicle_state  <> 'RESOLVED'     then 'VEHICLE'
         when w.deal_record_state <> 'RESOLVED'  then 'DEAL_RECORD'
         when w.finance_state  <> 'RESOLVED'     then 'FINANCE'
         when w.margin_state   <> 'COMPUTED'     then 'MARGIN'
         else null
       end as first_break,
       jsonb_build_array(
         jsonb_build_object('hop','CAMPAIGN',     'state', w.campaign_state,     'basis', w.campaign_basis,     'note', w.campaign_note),
         jsonb_build_object('hop','LEAD',         'state', w.lead_state,         'basis', w.lead_basis,         'note', w.lead_note),
         jsonb_build_object('hop','CONVERSATION', 'state', w.conversation_state, 'basis', w.conversation_basis, 'note', w.conversation_note),
         jsonb_build_object('hop','VEHICLE',      'state', w.vehicle_state,      'basis', w.vehicle_basis,      'note', w.vehicle_note),
         jsonb_build_object('hop','DEAL_RECORD',  'state', w.deal_record_state,  'basis', w.deal_record_basis,  'note', w.deal_record_note),
         jsonb_build_object('hop','FINANCE',      'state', w.finance_state,      'basis', w.finance_basis,      'note', w.finance_note),
         jsonb_build_object('hop','REVENUE',      'state', w.revenue_state,      'basis', w.revenue_basis,      'note', w.revenue_note),
         jsonb_build_object('hop','MARGIN',       'state', w.margin_state,       'basis', 'NO_LINK_FIELD',      'note', w.margin_note)
       ) as chain
  from walk w;

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
key_lead as (
  select cl.tenant_id, lower(btrim(m.lead_email)) as ckey, min(m.lead_id) as lead_id
    from public.v_lead_messages m
    join public.communication_logs cl on cl.id = m.id
   group by cl.tenant_id, lower(btrim(m.lead_email))
  having count(distinct m.lead_id) = 1
),
quotes_by_lead as (
  select fq.tenant_id, kl.lead_id, count(*)::integer as n
    from public.finance_quotes fq
    join key_lead kl on kl.tenant_id = fq.tenant_id and kl.ckey = lower(btrim(fq.lead_email))
   group by fq.tenant_id, kl.lead_id
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
  select ph.tenant_id, ph.lead_id, count(*)::integer as n_sales,
         sum(ph.amount_aed)::bigint as revenue_aed, max(ph.purchase_date) as last_sale_date
    from public.purchase_history ph
   where ph.lead_id is not null
   group by ph.tenant_id, ph.lead_id
),
base as (
  select l.tenant_id, l.id as lead_id, l.name as lead_name, l.created_at, l.source,
         l.status, l.ai_score, l.vehicle_interest, c.min_overlap,
         cv.msgs, cv.msgs_in, cv.msgs_out, cv.first_at, cv.last_at,
         s.n_sales, s.revenue_aed, s.last_sale_date,
         coalesce(q.n, 0) as quotes,
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
    left join quotes_by_lead q on q.tenant_id = l.tenant_id and q.lead_id = l.id
)
select b.tenant_id, b.lead_id, b.lead_name, b.created_at, b.status, b.ai_score,
       b.source as lead_source_field,
       'UNKNOWN_NO_SOURCE'::text as campaign_state,
       'NO_SOURCE_TABLE'::text   as campaign_basis,
       ('UNKNOWN. No campaigns table exists. leads.source reads "'
         || coalesce(nullif(btrim(b.source),''),'nothing')
         || '", the name of the internal workflow that created this row, not a marketing channel. '
         || 'Nothing records which advertisement, listing or referral this person came from.')::text as campaign_note,
       coalesce(b.msgs,0) as conversation_messages,
       coalesce(b.msgs_in,0) as messages_in,
       coalesce(b.msgs_out,0) as messages_out,
       b.first_at as first_message_at, b.last_at as last_message_at,
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
       coalesce(b.n_sales,0) as sales_recorded,
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
       (0
      + case when coalesce(b.msgs,0)   > 0 then 1 else 0 end
      + 0
      + case when coalesce(b.quotes,0) > 0 then 1 else 0 end
      + case when coalesce(b.n_sales,0)> 0 then 1 else 0 end
      + case when coalesce(b.n_sales,0)> 0 then 1 else 0 end
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

revoke all on public.v_attribution_sale_chain from anon, public;
revoke all on public.v_attribution_lead_chain from anon, public;
revoke all on public.v_attribution_sale_chain from authenticated;
revoke all on public.v_attribution_lead_chain from authenticated;
grant select on public.v_attribution_sale_chain to authenticated, service_role;
grant select on public.v_attribution_lead_chain to authenticated, service_role;
