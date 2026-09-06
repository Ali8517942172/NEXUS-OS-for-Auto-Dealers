-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- One row per CANDIDATE edge between two records, including the candidates
-- NEXUS refuses. is_evidence is the whole point of this view: a consumer that
-- wants to reason about money filters on is_evidence = true; a consumer that
-- wants to show the dealership what it cannot yet answer reads the false rows.
-- Nothing may collapse the two.
--
-- A refused candidate is emitted, not dropped. The Lexus case is the reason:
-- the one real sale's vehicle text matches unit NX-1011 exactly, that unit is
-- still marked Available, and a person needs to SEE the near-match and decide -
-- while the graph must never treat it as a link.
--
-- CAMPAIGN_TO_LEAD is emitted for every lead with basis NO_SOURCE_TABLE so the
-- break is countable. There is no campaigns table; leads.source names the
-- workflow that created the row, not a marketing channel.
--
-- Tenant scoping: security_invoker; every base table's RLS is evaluated as the
-- caller and tenant_id is carried on every row.

create or replace view public.v_attribution_edges
with (security_invoker = on) as
with cfg as (
  select t.id as tenant_id,
         coalesce(s.min_model_token_overlap, 2) as min_overlap
    from public.tenants t
    left join public.inventory_profit_settings s on s.tenant_id = t.id
),
msg_resolved as (
  select m.id as comm_id, count(distinct m.lead_id) as n_leads, min(m.lead_id) as lead_id
    from public.v_lead_messages m group by m.id
)

-- CAMPAIGN_TO_LEAD: the break, one row per lead so it can be counted ----------
select l.tenant_id,
       'CAMPAIGN_TO_LEAD'::text as edge,
       'campaign'::text  as from_kind,
       null::text        as from_ref,
       'lead'::text      as to_kind,
       l.id::text        as to_ref,
       'NO_SOURCE_TABLE'::text as basis,
       'NONE'::text      as confidence,
       ('No campaigns table exists in this database. leads.source holds "'
         || coalesce(nullif(btrim(l.source), ''), 'nothing')
         || '", which is the name of the internal workflow that created this row, not a '
         || 'marketing channel. Which advertisement, listing or referral produced this lead is UNKNOWN.')::text as note
  from public.leads l

union all

-- LEAD_TO_CONVERSATION -------------------------------------------------------
select cl.tenant_id, 'LEAD_TO_CONVERSATION',
       'lead',
       case when coalesce(r.n_leads,0) = 1 then r.lead_id::text end,
       'message', cl.id::text,
       case when coalesce(r.n_leads,0) = 1 then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when coalesce(r.n_leads,0) = 1 then 'MEDIUM' else 'NONE' end,
       case
         when coalesce(r.n_leads,0) = 1 then 'Identity rule (INV-002) on key ' || coalesce(cl.lead_email,'null') || '.'
         when coalesce(r.n_leads,0) > 1 then 'REFUSED: key ' || coalesce(cl.lead_email,'null') || ' resolves to more than one person.'
         else 'UNKNOWN: key ' || coalesce(cl.lead_email,'null') || ' matches no lead in this dealership.'
       end
  from public.communication_logs cl
  left join msg_resolved r on r.comm_id = cl.id
 where public.nexus_is_message(cl.direction, cl.channel, cl.message)

union all

-- LEAD_TO_VEHICLE: every refused text candidate, named -----------------------
select l.tenant_id, 'LEAD_TO_VEHICLE',
       'lead', l.id::text, 'inventory_unit', i.id,
       'MODEL_TEXT_ONLY', 'NONE',
       ('REFUSED. This lead''s free-text interest shares '
         || (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
              where t = any (public.nexus_model_tokens(l.vehicle_interest)))
         || ' model words with unit ' || i.id || ' (' || i.model
         || '). leads has no column that could name a unit, so this is a coincidence of words. '
         || 'Shown so a person can decide; never used as an edge.')
  from public.leads l
  join cfg c on c.tenant_id = l.tenant_id
  join public.inventory i on i.tenant_id = l.tenant_id
 where coalesce(btrim(l.vehicle_interest), '') <> ''
   and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
         where t = any (public.nexus_model_tokens(l.vehicle_interest))) >= c.min_overlap

union all

-- LEAD_TO_DEAL ----------------------------------------------------------------
select ph.tenant_id, 'LEAD_TO_DEAL',
       'lead', ph.lead_id::text, 'sale', ph.id::text,
       case when ph.lead_id is not null then 'FOREIGN_KEY' else 'LINK_FIELD_EMPTY' end,
       case when ph.lead_id is not null then 'HIGH' else 'NONE' end,
       case when ph.lead_id is not null
            then 'purchase_history.lead_id -> leads(id), enforced by the database.'
            else 'UNKNOWN: lead_id is NULL on this sale. Nobody recorded which lead it came from. '
                 || 'That is not the same as the sale having come from no lead.'
       end
  from public.purchase_history ph

union all

-- DEAL_TO_DEAL_RECORD ---------------------------------------------------------
select ph.tenant_id, 'DEAL_TO_DEAL_RECORD',
       'sale', ph.id::text, 'deal_embedding', de.id::text,
       'NATURAL_KEY_MATCH', 'HIGH',
       'Identical deal_id "' || ph.deal_id || '", scoped to this dealership. Exact but unenforced: no foreign key stands behind it.'
  from public.purchase_history ph
  join public.deals_embeddings de
    on de.tenant_id = ph.tenant_id
   and de.deal_id   = ph.deal_id
 where coalesce(btrim(ph.deal_id), '') <> ''

union all

-- DEAL_TO_VEHICLE, route 1: a named person confirmed it -----------------------
select ia.tenant_id, 'DEAL_TO_VEHICLE',
       'sale', ia.outcome_purchase_id::text, 'inventory_unit', ia.unit_id,
       'HUMAN_CONFIRMED_LINK', 'HIGH',
       'Confirmed by a named person through action_record_outcome() on inventory action '
         || ia.id::text || '. attribution_basis on that row reads '
         || coalesce(ia.attribution_basis, 'null')
         || '. This is a belief recorded by a person, not a fact about the schema, and NEXUS does '
         || 'not claim the action caused the sale.'
  from public.inventory_actions ia
 where ia.outcome_purchase_id is not null
   and ia.outcome_state = 'ATTRIBUTED'

union all

-- DEAL_TO_VEHICLE, route 2: the text near-miss, refused -----------------------
select ph.tenant_id, 'DEAL_TO_VEHICLE',
       'sale', ph.id::text, 'inventory_unit', i.id,
       'MODEL_TEXT_ONLY', 'NONE',
       ('REFUSED. Sale vehicle text "' || coalesce(ph.vehicle,'')
         || '" shares '
         || (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
              where t = any (public.nexus_model_tokens(ph.vehicle)))
         || ' model words with unit ' || i.id || ' (' || i.model || ', listed AED '
         || to_char(coalesce(i.price_aed,0), 'FM999,999,999') || ', status '
         || coalesce(i.status,'unknown') || ') against a sale of AED '
         || to_char(coalesce(ph.amount_aed,0), 'FM999,999,999')
         || '. purchase_history has no column that could name a unit, so nothing here is a link - '
         || 'not even an exact model and an exact price. A manager can confirm it through the '
         || 'Inventory Action Center, which records HUMAN_CONFIRMED_LINK against their name.')
  from public.purchase_history ph
  join cfg c on c.tenant_id = ph.tenant_id
  join public.inventory i on i.tenant_id = ph.tenant_id
 where coalesce(btrim(ph.vehicle), '') <> ''
   and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
         where t = any (public.nexus_model_tokens(ph.vehicle))) >= c.min_overlap
   and not exists (
     select 1 from public.inventory_actions ia
      where ia.tenant_id = ph.tenant_id
        and ia.outcome_purchase_id = ph.id
        and ia.outcome_state = 'ATTRIBUTED')

union all

-- LEAD_TO_FINANCE -------------------------------------------------------------
select fq.tenant_id, 'LEAD_TO_FINANCE',
       'lead', fl.lead_id::text, 'finance_quote', fq.id::text,
       case when fl.lead_id is not null then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when fl.lead_id is not null then 'MEDIUM' else 'NONE' end,
       case when fl.lead_id is not null
            then 'Identity rule on finance_quotes.lead_email, scoped to this dealership.'
            else 'UNKNOWN: finance_quotes.lead_email resolves to no lead.'
       end
  from public.finance_quotes fq
  cross join lateral (select public.nexus_lead_for_comm_key(fq.lead_email, fq.tenant_id) as lead_id) fl

union all

-- DEAL_TO_FINANCE: the break, one row per sale --------------------------------
select ph.tenant_id, 'DEAL_TO_FINANCE',
       'sale', ph.id::text, 'finance_quote', null::text,
       'NO_LINK_FIELD', 'NONE',
       'purchase_history carries no quote id and no calculation_id, and finance_quotes carries no '
         || 'sale id. Whether this sale was financed, and on what terms, is UNKNOWN.'
  from public.purchase_history ph

union all

-- DEAL_TO_REVENUE --------------------------------------------------------------
select ph.tenant_id, 'DEAL_TO_REVENUE',
       'sale', ph.id::text, 'revenue', ph.amount_aed::text,
       'SAME_ROW', 'HIGH',
       'AED ' || to_char(coalesce(ph.amount_aed,0), 'FM999,999,999')
         || ' is a column of the sale record. CONFIRMED revenue - not estimated, not attributed.'
  from public.purchase_history ph;

comment on view public.v_attribution_edges is
  'Every candidate edge between two records in the revenue chain, including the ones NEXUS refuses. Join public.attribution_link_basis on basis to get is_evidence: true means the edge may be reasoned from, false means it exists only to show a person what is missing and why. MODEL_TEXT_ONLY rows are named refusals - an exact model and an exact price match is still a refusal. CAMPAIGN_TO_LEAD is emitted for every lead so that the missing campaign link is countable rather than invisible.';

revoke all on public.v_attribution_edges from anon, public;
revoke all on public.v_attribution_edges from authenticated;
grant select on public.v_attribution_edges to authenticated, service_role;
