-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- DEFECT FOUND AND FIXED IN THE SAME PASS. attr_04/05/07/08 resolved a finance
-- quote to a lead by calling nexus_lead_for_comm_key(text, uuid). That function
-- is SECURITY DEFINER and its EXECUTE was deliberately revoked from
-- `authenticated` on 2 Sep - it takes a tenant as an argument and runs as
-- definer, which is the exact shape that has opened a hole here three times.
-- So the dashboard, which reads as `authenticated`, got
-- "42501 permission denied for function nexus_lead_for_comm_key" on
-- v_attribution_events and v_attribution_edges, and would have got it on both
-- chain views the moment a single finance quote existed - the empty table was
-- the only thing hiding it.
--
-- The fix does NOT re-grant that function (it must stay service_role only) and
-- does NOT re-implement the matching rule (INV-002: one rule, one owner).
-- It reuses the rule's own OUTPUT: v_lead_messages is the security_invoker view
-- that already applies the rule, so the key -> lead map it produces is that
-- same rule's answer, reached through a surface the browser is allowed to read.
--
-- KNOWN AND DELIBERATE NARROWING, reported rather than hidden: a key that has
-- never appeared in communication_logs has no entry in that map, so a quote
-- keyed by a phone number for a customer who has never messaged reads
-- UNRESOLVED_KEY instead of resolving. That MISSES a link; it never invents
-- one - the same posture screens/finance.js already takes. finance_quotes holds
-- 0 rows today, so nothing is currently affected. The underlying gap is worth
-- naming: only communication_logs has a view that exposes the identity rule to
-- the browser's role. Any other table that needs the rule needs one too.

create or replace view public.v_attribution_events
with (security_invoker = on) as
with cfg as (
  select t.id as tenant_id, coalesce(s.min_model_token_overlap, 2) as min_overlap
    from public.tenants t
    left join public.inventory_profit_settings s on s.tenant_id = t.id
),
msg_resolved as (
  select m.id as comm_id, count(distinct m.lead_id) as n_leads, min(m.lead_id) as lead_id
    from public.v_lead_messages m group by m.id
),
key_lead as (
  select cl.tenant_id, lower(btrim(m.lead_email)) as ckey, min(m.lead_id) as lead_id
    from public.v_lead_messages m
    join public.communication_logs cl on cl.id = m.id
   group by cl.tenant_id, lower(btrim(m.lead_email))
  having count(distinct m.lead_id) = 1
)
select l.tenant_id                     as tenant_id,
       10                              as event_seq,
       'LEAD_CREATED'::text            as event_type,
       'lead:' || l.id::text           as event_id,
       l.created_at                    as occurred_at,
       'CUSTOMER'::text                as actor,
       'lead'::text                    as subject_kind,
       l.id::text                      as subject_ref,
       l.id                            as lead_id,
       'SAME_ROW'::text                as lead_basis,
       'HIGH'::text                    as lead_confidence,
       'The lead row is the event.'::text as lead_note,
       null::text                      as unit_id,
       'NO_LINK_FIELD'::text           as unit_basis,
       'leads carries no vehicle reference of any kind.'::text as unit_note,
       null::integer                   as amount_aed,
       'NONE'::text                    as amount_kind,
       ('source=' || coalesce(nullif(btrim(l.source), ''), 'not recorded')
         || '; status=' || coalesce(l.status, 'not recorded')) as detail
  from public.leads l
union all
select l.tenant_id, 40, 'VEHICLE_INTEREST', 'lead-interest:' || l.id::text, l.created_at,
       'CUSTOMER', 'lead', l.id::text, l.id, 'SAME_ROW', 'HIGH',
       'Interest belongs to the lead row it is written on.', null::text,
       case when cand.n > 0 then 'MODEL_TEXT_ONLY' else 'NO_LINK_FIELD' end,
       case when cand.n > 0
            then cand.n || ' inventory unit(s) share ' || c.min_overlap
                 || '+ model words with this free text. NOT LINKED: there is no column on '
                 || 'leads that could name a unit, so this is a text coincidence and a prompt '
                 || 'for a person, not an edge.'
            else 'No inventory unit shares ' || c.min_overlap
                 || '+ model words with this text, and leads has no column that could name a unit anyway.'
       end,
       null::integer, 'NONE', left(l.vehicle_interest, 300)
  from public.leads l
  join cfg c on c.tenant_id = l.tenant_id
  cross join lateral (
    select count(*)::integer as n from public.inventory i
     where i.tenant_id = l.tenant_id
       and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
             where t = any (public.nexus_model_tokens(l.vehicle_interest))) >= c.min_overlap
  ) cand
 where coalesce(btrim(l.vehicle_interest), '') <> ''
union all
select cl.tenant_id,
       case when lower(btrim(cl.direction)) = 'inbound' then 20 else 30 end,
       case when lower(btrim(cl.direction)) = 'inbound' then 'MESSAGE_RECEIVED' else 'MESSAGE_SENT' end,
       'msg:' || cl.id::text, cl.created_at,
       case when lower(btrim(cl.direction)) = 'inbound' then 'CUSTOMER' else 'DEALERSHIP' end,
       'message', cl.id::text,
       case when coalesce(r.n_leads, 0) = 1 then r.lead_id end,
       case when coalesce(r.n_leads, 0) = 1 then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when coalesce(r.n_leads, 0) = 1 then 'MEDIUM' else 'NONE' end,
       case
         when coalesce(r.n_leads, 0) = 1
           then 'Resolved by the identity rule (v_lead_messages) from the key '
                || coalesce(cl.lead_email, 'null') || '. MEDIUM, not HIGH: a rule over text, not a foreign key.'
         when coalesce(r.n_leads, 0) > 1
           then 'REFUSED: the key ' || coalesce(cl.lead_email, 'null')
                || ' resolves to more than one person, so it is attached to neither (INV-002).'
         else 'UNKNOWN: the key ' || coalesce(cl.lead_email, 'null')
              || ' matches no lead. This is a customer NEXUS has messages from and no lead row for - not an absence of conversation.'
       end,
       null::text, 'NO_LINK_FIELD', 'communication_logs carries no vehicle reference.',
       null::integer, 'NONE', left(coalesce(cl.message, ''), 300)
  from public.communication_logs cl
  left join msg_resolved r on r.comm_id = cl.id
 where public.nexus_is_message(cl.direction, cl.channel, cl.message)
union all
select fq.tenant_id, 70, 'FINANCE_QUOTE', 'quote:' || fq.id::text, fq.created_at,
       'DEALERSHIP', 'finance_quote', fq.id::text,
       kl.lead_id,
       case when kl.lead_id is not null then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when kl.lead_id is not null then 'MEDIUM' else 'NONE' end,
       case when kl.lead_id is not null
            then 'Resolved by the identity rule, reusing the key -> lead map v_lead_messages produced.'
            else 'UNKNOWN: this quote''s lead_email is a key the identity rule has never resolved in a '
                 || 'conversation, and the rule''s direct entry point is service_role only. Reported '
                 || 'unknown rather than guessed. This MISSES links; it never invents one.'
       end,
       null::text, 'NO_LINK_FIELD',
       'finance_quotes carries no inventory reference; vehicle_value_aed is a number, not a unit.',
       null::integer, 'NONE',
       ('tier=' || coalesce(fq.finance_tier, '?') || '; calculation_id=' || fq.calculation_id::text)
  from public.finance_quotes fq
  left join key_lead kl on kl.tenant_id = fq.tenant_id and kl.ckey = lower(btrim(fq.lead_email))
union all
select ph.tenant_id, e.seq, e.event_type, e.prefix || ph.id::text, e.occurred_at,
       'DEALERSHIP', 'sale', ph.id::text, ph.lead_id,
       case when ph.lead_id is not null then 'FOREIGN_KEY' else 'LINK_FIELD_EMPTY' end,
       case when ph.lead_id is not null then 'HIGH' else 'NONE' end,
       case when ph.lead_id is not null
            then 'purchase_history.lead_id, a declared foreign key to leads(id).'
            else 'UNKNOWN: lead_id is NULL. The dashboard writes it only when the deal was picked '
                 || 'from a lead, so this means nobody recorded the provenance - NOT that the sale came from no lead.'
       end,
       null::text, 'NO_LINK_FIELD',
       'purchase_history holds no VIN, no stock number and no inventory id. The vehicle text on '
         || 'this sale may match a unit exactly and still prove nothing.',
       case when e.event_type = 'SALE_CONFIRMED' then ph.amount_aed end,
       case when e.event_type = 'SALE_CONFIRMED' then 'CONFIRMED_REVENUE' else 'NONE' end,
       left(coalesce(ph.vehicle, ''), 300)
  from public.purchase_history ph
  cross join lateral (values
    (50, 'DEAL_CREATED'::text,   'deal:'::text, ph.created_at),
    (80, 'SALE_CONFIRMED'::text, 'sale:'::text, (ph.purchase_date::timestamp at time zone 'Asia/Dubai'))
  ) as e(seq, event_type, prefix, occurred_at);

create or replace view public.v_attribution_edges
with (security_invoker = on) as
with cfg as (
  select t.id as tenant_id, coalesce(s.min_model_token_overlap, 2) as min_overlap
    from public.tenants t
    left join public.inventory_profit_settings s on s.tenant_id = t.id
),
msg_resolved as (
  select m.id as comm_id, count(distinct m.lead_id) as n_leads, min(m.lead_id) as lead_id
    from public.v_lead_messages m group by m.id
),
key_lead as (
  select cl.tenant_id, lower(btrim(m.lead_email)) as ckey, min(m.lead_id) as lead_id
    from public.v_lead_messages m
    join public.communication_logs cl on cl.id = m.id
   group by cl.tenant_id, lower(btrim(m.lead_email))
  having count(distinct m.lead_id) = 1
)
select l.tenant_id        as tenant_id,
       'CAMPAIGN_TO_LEAD'::text as edge,
       'campaign'::text   as from_kind,
       null::text         as from_ref,
       'lead'::text       as to_kind,
       l.id::text         as to_ref,
       'NO_SOURCE_TABLE'::text as basis,
       'NONE'::text       as confidence,
       ('No campaigns table exists in this database. leads.source holds "'
         || coalesce(nullif(btrim(l.source), ''), 'nothing')
         || '", which is the name of the internal workflow that created this row, not a '
         || 'marketing channel. Which advertisement, listing or referral produced this lead is UNKNOWN.')::text as note
  from public.leads l
union all
select cl.tenant_id, 'LEAD_TO_CONVERSATION', 'lead',
       case when coalesce(r.n_leads,0) = 1 then r.lead_id::text end,
       'message', cl.id::text,
       case when coalesce(r.n_leads,0) = 1 then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when coalesce(r.n_leads,0) = 1 then 'MEDIUM' else 'NONE' end,
       case when coalesce(r.n_leads,0) = 1 then 'Identity rule (INV-002) on key ' || coalesce(cl.lead_email,'null') || '.'
            when coalesce(r.n_leads,0) > 1 then 'REFUSED: key ' || coalesce(cl.lead_email,'null') || ' resolves to more than one person.'
            else 'UNKNOWN: key ' || coalesce(cl.lead_email,'null') || ' matches no lead in this dealership.'
       end
  from public.communication_logs cl
  left join msg_resolved r on r.comm_id = cl.id
 where public.nexus_is_message(cl.direction, cl.channel, cl.message)
union all
select l.tenant_id, 'LEAD_TO_VEHICLE', 'lead', l.id::text, 'inventory_unit', i.id,
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
select ph.tenant_id, 'LEAD_TO_DEAL', 'lead', ph.lead_id::text, 'sale', ph.id::text,
       case when ph.lead_id is not null then 'FOREIGN_KEY' else 'LINK_FIELD_EMPTY' end,
       case when ph.lead_id is not null then 'HIGH' else 'NONE' end,
       case when ph.lead_id is not null
            then 'purchase_history.lead_id -> leads(id), enforced by the database.'
            else 'UNKNOWN: lead_id is NULL on this sale. Nobody recorded which lead it came from. '
                 || 'That is not the same as the sale having come from no lead.'
       end
  from public.purchase_history ph
union all
select ph.tenant_id, 'DEAL_TO_DEAL_RECORD', 'sale', ph.id::text, 'deal_embedding', de.id::text,
       'NATURAL_KEY_MATCH', 'HIGH',
       'Identical deal_id "' || ph.deal_id || '", scoped to this dealership. Exact but unenforced: no foreign key stands behind it.'
  from public.purchase_history ph
  join public.deals_embeddings de on de.tenant_id = ph.tenant_id and de.deal_id = ph.deal_id
 where coalesce(btrim(ph.deal_id), '') <> ''
union all
select ia.tenant_id, 'DEAL_TO_VEHICLE', 'sale', ia.outcome_purchase_id::text, 'inventory_unit', ia.unit_id,
       'HUMAN_CONFIRMED_LINK', 'HIGH',
       'Confirmed by a named person through action_record_outcome() on inventory action '
         || ia.id::text || '. attribution_basis on that row reads '
         || coalesce(ia.attribution_basis, 'null')
         || '. This is a belief recorded by a person, not a fact about the schema, and NEXUS does '
         || 'not claim the action caused the sale.'
  from public.inventory_actions ia
 where ia.outcome_purchase_id is not null and ia.outcome_state = 'ATTRIBUTED'
union all
select ph.tenant_id, 'DEAL_TO_VEHICLE', 'sale', ph.id::text, 'inventory_unit', i.id,
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
   and not exists (select 1 from public.inventory_actions ia
                    where ia.tenant_id = ph.tenant_id and ia.outcome_purchase_id = ph.id
                      and ia.outcome_state = 'ATTRIBUTED')
union all
select fq.tenant_id, 'LEAD_TO_FINANCE', 'lead', kl.lead_id::text, 'finance_quote', fq.id::text,
       case when kl.lead_id is not null then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when kl.lead_id is not null then 'MEDIUM' else 'NONE' end,
       case when kl.lead_id is not null
            then 'Identity rule, reusing the key -> lead map v_lead_messages produced.'
            else 'UNKNOWN: this quote''s lead_email is a key the identity rule has never resolved in a '
                 || 'conversation, and the rule''s direct entry point is service_role only. Missed, not guessed.'
       end
  from public.finance_quotes fq
  left join key_lead kl on kl.tenant_id = fq.tenant_id and kl.ckey = lower(btrim(fq.lead_email))
union all
select ph.tenant_id, 'DEAL_TO_FINANCE', 'sale', ph.id::text, 'finance_quote', null::text,
       'NO_LINK_FIELD', 'NONE',
       'purchase_history carries no quote id and no calculation_id, and finance_quotes carries no '
         || 'sale id. Whether this sale was financed, and on what terms, is UNKNOWN.'
  from public.purchase_history ph
union all
select ph.tenant_id, 'DEAL_TO_REVENUE', 'sale', ph.id::text, 'revenue', ph.amount_aed::text,
       'SAME_ROW', 'HIGH',
       'AED ' || to_char(coalesce(ph.amount_aed,0), 'FM999,999,999')
         || ' is a column of the sale record. CONFIRMED revenue - not estimated, not attributed.'
  from public.purchase_history ph;

revoke all on public.v_attribution_events from anon, public;
revoke all on public.v_attribution_edges  from anon, public;
revoke all on public.v_attribution_events from authenticated;
revoke all on public.v_attribution_edges  from authenticated;
grant select on public.v_attribution_events to authenticated, service_role;
grant select on public.v_attribution_edges  to authenticated, service_role;
