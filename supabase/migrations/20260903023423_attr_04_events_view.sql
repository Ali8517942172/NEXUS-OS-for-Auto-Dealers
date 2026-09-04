-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- One row per thing that actually happened, from the records this database
-- really holds, with the lead and the vehicle each carrying HOW they were
-- established and HOW STRONGLY. An event whose lead cannot be resolved is
-- emitted anyway, with lead_id NULL and a basis that says why - because a
-- customer whose messages resolve to nobody is exactly the customer the
-- dealership is losing, and dropping the row would hide them.
--
-- Only the six events this database can actually produce appear here.
-- DEAL_UPDATED is emitted by nothing (no deal-stage table) and is recorded as
-- ABSENT_NO_SOURCE in attribution_event_type rather than faked from timestamps.
--
-- Identity is NOT re-implemented. Messages resolve through v_lead_messages and
-- finance quotes through nexus_lead_for_comm_key(text, uuid) - the two Postgres
-- spellings of the one rule that lib/identity.js implements in the browser
-- (INV-002). Vehicle text uses nexus_model_tokens(), the same tokeniser the
-- Profit Sentinel and action_outcome_candidates() use, and its output is used
-- only to COUNT candidates for a refusal note, never to set a unit.
--
-- Tenant scoping: security_invoker, so every base table's RLS is evaluated as
-- the caller. tenant_id is carried on every row and the tenant of the row being
-- resolved is passed explicitly into the identity function, so a definer
-- function cannot widen the scope.

create or replace view public.v_attribution_events
with (security_invoker = on) as
with cfg as (
  select t.id as tenant_id,
         coalesce(s.min_model_token_overlap, 2) as min_overlap
    from public.tenants t
    left join public.inventory_profit_settings s on s.tenant_id = t.id
),
-- One resolution per message, refusing anything that resolves to more than one
-- person. Today: 53 of 108 rows resolve, each to exactly one lead.
msg_resolved as (
  select m.id as comm_id,
         count(distinct m.lead_id) as n_leads,
         min(m.lead_id)            as lead_id
    from public.v_lead_messages m
   group by m.id
)

-- LEAD_CREATED ---------------------------------------------------------------
select l.tenant_id,
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

-- VEHICLE_INTEREST (from the lead record) ------------------------------------
select l.tenant_id, 40, 'VEHICLE_INTEREST',
       'lead-interest:' || l.id::text,
       l.created_at, 'CUSTOMER', 'lead', l.id::text,
       l.id, 'SAME_ROW', 'HIGH', 'Interest belongs to the lead row it is written on.',
       null::text,
       case when cand.n > 0 then 'MODEL_TEXT_ONLY' else 'NO_LINK_FIELD' end,
       case when cand.n > 0
            then cand.n || ' inventory unit(s) share ' || c.min_overlap
                 || '+ model words with this free text. NOT LINKED: there is no column on '
                 || 'leads that could name a unit, so this is a text coincidence and a prompt '
                 || 'for a person, not an edge.'
            else 'No inventory unit shares ' || c.min_overlap
                 || '+ model words with this text, and leads has no column that could name a unit anyway.'
       end,
       null::integer, 'NONE',
       left(l.vehicle_interest, 300)
  from public.leads l
  join cfg c on c.tenant_id = l.tenant_id
  cross join lateral (
    select count(*)::integer as n
      from public.inventory i
     where i.tenant_id = l.tenant_id
       and (select count(*) from unnest(public.nexus_model_tokens(i.model)) t
             where t = any (public.nexus_model_tokens(l.vehicle_interest))) >= c.min_overlap
  ) cand
 where coalesce(btrim(l.vehicle_interest), '') <> ''

union all

-- MESSAGE_RECEIVED / MESSAGE_SENT --------------------------------------------
select cl.tenant_id,
       case when lower(btrim(cl.direction)) = 'inbound' then 20 else 30 end,
       case when lower(btrim(cl.direction)) = 'inbound' then 'MESSAGE_RECEIVED' else 'MESSAGE_SENT' end,
       'msg:' || cl.id::text,
       cl.created_at,
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
       null::text, 'NO_LINK_FIELD',
       'communication_logs carries no vehicle reference.',
       null::integer, 'NONE',
       left(coalesce(cl.message, ''), 300)
  from public.communication_logs cl
  left join msg_resolved r on r.comm_id = cl.id
 where public.nexus_is_message(cl.direction, cl.channel, cl.message)

union all

-- FINANCE_QUOTE ---------------------------------------------------------------
select fq.tenant_id, 70, 'FINANCE_QUOTE',
       'quote:' || fq.id::text,
       fq.created_at, 'DEALERSHIP', 'finance_quote', fq.id::text,
       fl.lead_id,
       case when fl.lead_id is not null then 'RESOLVED_IDENTITY' else 'UNRESOLVED_KEY' end,
       case when fl.lead_id is not null then 'MEDIUM' else 'NONE' end,
       case when fl.lead_id is not null
            then 'Resolved by nexus_lead_for_comm_key() from finance_quotes.lead_email, scoped to this dealership.'
            else 'UNKNOWN: finance_quotes.lead_email does not resolve to a lead under the identity rule.'
       end,
       null::text, 'NO_LINK_FIELD',
       'finance_quotes carries no inventory reference; vehicle_value_aed is a number, not a unit.',
       null::integer, 'NONE',
       ('tier=' || coalesce(fq.finance_tier, '?') || '; calculation_id=' || fq.calculation_id::text)
  from public.finance_quotes fq
  cross join lateral (
    select public.nexus_lead_for_comm_key(fq.lead_email, fq.tenant_id) as lead_id
  ) fl

union all

-- DEAL_CREATED and SALE_CONFIRMED --------------------------------------------
-- Two events, one row. purchase_history only ever records a closed-won deal, so
-- these cannot be separated in time; both are emitted so the chain has the shape
-- it will keep when an open-deal record eventually exists, and
-- attribution_event_type records that they are conflated today.
select ph.tenant_id, e.seq, e.event_type,
       e.prefix || ph.id::text,
       e.occurred_at, 'DEALERSHIP', 'sale', ph.id::text,
       ph.lead_id,
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
    (80, 'SALE_CONFIRMED'::text, 'sale:'::text,
        (ph.purchase_date::timestamp at time zone 'Asia/Dubai'))
  ) as e(seq, event_type, prefix, occurred_at);

comment on view public.v_attribution_events is
  'The revenue attribution event stream: LEAD_CREATED, VEHICLE_INTEREST, MESSAGE_RECEIVED, MESSAGE_SENT, FINANCE_QUOTE, DEAL_CREATED, SALE_CONFIRMED. Every row carries lead_basis/lead_confidence and unit_basis saying how each end was established, from public.attribution_link_basis. A row whose lead does not resolve is still emitted, with lead_id NULL and the reason in lead_note - unknown is not none. DEAL_UPDATED does not appear because nothing in this database emits it; see attribution_event_type. amount_kind is CONFIRMED_REVENUE only on SALE_CONFIRMED, where the money is a column of the sale itself; nothing here is estimated or attributed revenue.';

revoke all on public.v_attribution_events from anon, public;
revoke all on public.v_attribution_events from authenticated;
grant select on public.v_attribution_events to authenticated, service_role;
