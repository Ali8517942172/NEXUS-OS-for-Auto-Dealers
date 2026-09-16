-- NX961 — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX961 — One function walks the whole journey, and says what it skipped.
--
-- The receiver already resolves the dealership and writes the message. This is
-- the single call it makes next, and it does the rest in one transaction:
--
--   message -> customer -> conversation -> intent -> promote? -> score
--           -> action -> audit, all under one correlation id.
--
-- Two properties worth stating out loud:
--
-- 1. IT IS IDEMPOTENT ON THE MESSAGE. Meta retries. A retried delivery must
--    not make a second lead, a second action and a second row of "revenue at
--    risk" on the owner's dashboard. The correlation id is derived from the
--    event, so a replay returns the first journey rather than starting a new one.
--
-- 2. IT RECORDS THE HOPS IT DID NOT TAKE. "Hi" produces a customer, a
--    conversation, and a journey_step saying PROMOTE / SKIPPED / GREETING_ONLY.
--    That row is the answer to the only support question that ever matters --
--    "why was this customer never contacted?" -- and a log that only records
--    successes cannot answer it.

create or replace function public.nexus_journey_from_channel_message(
  p_event_id      uuid,
  p_message_text  text default null,
  p_customer_name text default null
) returns table (
  correlation_id text, tenant_id uuid, customer_id uuid, conversation_id uuid,
  intent text, promoted boolean, lead_id integer, score integer,
  score_source text, action_id uuid, was_replay boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
declare
  ev            record;
  v_corr        text;
  v_cust        uuid;
  v_conv        uuid;
  v_intent      text;
  v_codes       text[];
  v_eligible    boolean;
  v_lead        integer;
  v_score       int := 0;
  v_status      text;
  v_action      uuid;
  v_name        text;
  v_txt         text := coalesce(p_message_text, '');
  v_existing    text;
begin
  select e.event_id, e.tenant_id, e.integration_id, e.customer_phone,
         e.customer_external_id, e.provider, e.received_at, e.direction
    into ev
    from public.channel_message_events e
   where e.event_id = p_event_id;

  if not found then
    raise exception using errcode='P0001',
      message = format('NX961 NO_SUCH_MESSAGE: channel_message_events has no event %L. '
                       'The journey starts from a recorded message, never from a claim.', p_event_id);
  end if;

  if ev.direction <> 'inbound' then
    raise exception using errcode='P0001',
      message='NX961 NOT_INBOUND: only a message from a customer starts a journey.';
  end if;

  -- One correlation id per message, derived not invented, so a replay lands on
  -- the same trail.
  v_corr := 'NX-' || upper(substr(replace(ev.event_id::text,'-',''), 1, 10));

  select js.correlation_id into v_existing
    from public.journey_step js
   where js.correlation_id = v_corr and js.step = 'MESSAGE' limit 1;

  if v_existing is not null then
    -- Replay. Report what the first run decided; change nothing.
    return query
      select v_corr, ev.tenant_id,
             (select js.ref_id::uuid from public.journey_step js
               where js.correlation_id=v_corr and js.step='CUSTOMER' and js.status='OK' limit 1),
             (select js.ref_id::uuid from public.journey_step js
               where js.correlation_id=v_corr and js.step='CONVERSATION' and js.status='OK' limit 1),
             (select js.detail from public.journey_step js
               where js.correlation_id=v_corr and js.step='CLASSIFY' limit 1),
             exists (select 1 from public.journey_step js
                      where js.correlation_id=v_corr and js.step='PROMOTE' and js.status='OK'),
             (select js.ref_id::int from public.journey_step js
               where js.correlation_id=v_corr and js.step='PROMOTE' and js.status='OK' limit 1),
             null::int, null::text,
             (select js.ref_id::uuid from public.journey_step js
               where js.correlation_id=v_corr and js.step='ACTION' and js.status='OK' limit 1),
             true;
    return;
  end if;

  insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
  values (v_corr, ev.tenant_id, 'MESSAGE', 'OK', 'channel_message_events', ev.event_id::text,
          format('%s inbound, received %s', ev.provider, ev.received_at));

  -- CUSTOMER ---------------------------------------------------------------
  v_name := nullif(btrim(coalesce(p_customer_name,'')), '');
  if ev.customer_phone is null then
    insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
    values (v_corr, ev.tenant_id, 'CUSTOMER', 'UNKNOWN',
            'The message carried no phone digits, so no person can be identified. '
            || 'Nothing further is invented.');
    return query select v_corr, ev.tenant_id, null::uuid, null::uuid, 'UNKNOWN'::text,
                        false, null::int, null::int, null::text, null::uuid, false;
    return;
  end if;

  insert into public.customer (tenant_id, display_name, phone_digits)
  values (ev.tenant_id, v_name, ev.customer_phone)
  on conflict (tenant_id, phone_digits) where phone_digits is not null
  do update set last_seen_at = now(),
                display_name = coalesce(public.customer.display_name, excluded.display_name)
  returning id into v_cust;

  insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
  values (v_corr, ev.tenant_id, 'CUSTOMER', 'OK', 'customer', v_cust::text,
          coalesce(v_name, 'name not given by the provider'));

  -- CONVERSATION -----------------------------------------------------------
  select c.id into v_conv from public.conversation c
   where c.tenant_id=ev.tenant_id and c.integration_id=ev.integration_id
     and c.customer_id=v_cust and c.state <> 'CLOSED' limit 1;

  if v_conv is null then
    insert into public.conversation (tenant_id, customer_id, integration_id, channel,
                                     last_message_at, message_count)
    values (ev.tenant_id, v_cust, ev.integration_id,
            case when ev.provider='whatsapp_cloud' then 'whatsapp_cloud' else 'whatsapp_waha' end,
            ev.received_at, 1)
    returning id into v_conv;
    insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
    values (v_corr, ev.tenant_id, 'CONVERSATION', 'OK', 'conversation', v_conv::text, 'opened');
  else
    update public.conversation
       set last_message_at = greatest(coalesce(last_message_at, ev.received_at), ev.received_at),
           message_count = message_count + 1, state = 'OPEN'
     where id = v_conv;
    insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
    values (v_corr, ev.tenant_id, 'CONVERSATION', 'OK', 'conversation', v_conv::text, 'continued');
  end if;

  -- CLASSIFY ---------------------------------------------------------------
  select ci.intent, ci.reason_codes, ci.promote_eligible
    into v_intent, v_codes, v_eligible
    from public.nexus_classify_message_intent(v_txt) ci;

  insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
  values (v_corr, ev.tenant_id, 'CLASSIFY', case when v_intent='UNKNOWN' then 'UNKNOWN' else 'OK' end,
          v_intent);

  -- PROMOTE ----------------------------------------------------------------
  if not v_eligible then
    insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
    values (v_corr, ev.tenant_id, 'PROMOTE', 'SKIPPED',
            format('%s is not a sales intent (%s). A conversation was recorded; no lead was invented.',
                   v_intent, array_to_string(v_codes, ', ')));
    insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
    values (v_corr, ev.tenant_id, 'SCORE', 'SKIPPED', 'Nothing was promoted, so nothing is scored.'),
           (v_corr, ev.tenant_id, 'ACTION', 'SKIPPED', 'No opportunity, no action.');

    insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
    values ('WhatsApp Journey', 'SUCCESS',
            format('%s | %s | message and conversation recorded, not promoted (%s)',
                   v_corr, v_intent, array_to_string(v_codes, ', ')), now(), ev.tenant_id);
    insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
    values (v_corr, ev.tenant_id, 'AUDIT', 'OK', 'audit_log row written');

    return query select v_corr, ev.tenant_id, v_cust, v_conv, v_intent, false,
                        null::int, null::int, null::text, null::uuid, false;
    return;
  end if;

  -- SCORE — deterministic rules, before any model is consulted --------------
  v_score := 20;
  if ev.customer_phone is not null then v_score := v_score + 25; end if;
  if v_intent in ('PRICE_ENQUIRY','FINANCE_ENQUIRY') then v_score := v_score + 25; end if;
  if v_intent in ('VEHICLE_ENQUIRY','TEST_DRIVE','TRADE_IN') then v_score := v_score + 15; end if;
  if 'MODEL_NAMED' = any(v_codes) then v_score := v_score + 15; end if;
  if lower(v_txt) ~ '\m(today|tonight|now|asap|urgent|tomorrow|this week)\M' then v_score := v_score + 15; end if;
  v_score := greatest(0, least(100, v_score));
  v_status := case when v_score >= 70 then 'HOT' when v_score >= 40 then 'WARM' else 'COLD' end;

  insert into public.leads (name, phone, vehicle_interest, status, ai_score, source,
                            tenant_id, score_source, rules_score, ai_parse_failed)
  values (coalesce(v_name, 'WhatsApp customer ' || right(ev.customer_phone, 4)),
          ev.customer_phone, left(nullif(btrim(v_txt),''), 500), v_status, v_score,
          'whatsapp-' || ev.provider, ev.tenant_id, 'RULES', v_score, false)
  returning id into v_lead;

  insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
  values (v_corr, ev.tenant_id, 'PROMOTE', 'OK', 'leads', v_lead::text,
          format('%s (%s)', v_intent, array_to_string(v_codes, ', '))),
         (v_corr, ev.tenant_id, 'SCORE', 'OK', 'leads', v_lead::text,
          format('RULES %s -> %s. Deterministic; no model has been consulted.', v_score, v_status));

  -- ACTION -----------------------------------------------------------------
  insert into public.lead_recovery_actions (tenant_id, lead_id, recommendation, status)
  values (ev.tenant_id, v_lead,
          case when v_status = 'HOT' then 'ESCALATE' else 'FOLLOW_UP' end, 'PROPOSED')
  returning id into v_action;

  insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
  values (v_corr, ev.tenant_id, 'ACTION', 'OK', 'lead_recovery_actions', v_action::text,
          case when v_status='HOT' then 'ESCALATE — contact now' else 'FOLLOW_UP' end);

  insert into public.audit_log (workflow, status, summary, lead_name, lead_score, intent, logged_at, tenant_id)
  values ('WhatsApp Journey', 'SUCCESS',
          format('%s | %s | lead %s scored %s %s by RULES | action %s',
                 v_corr, v_intent, v_lead, v_score, v_status,
                 case when v_status='HOT' then 'ESCALATE' else 'FOLLOW_UP' end),
          coalesce(v_name, 'WhatsApp customer'), v_score, v_status, now(), ev.tenant_id);
  insert into public.journey_step (correlation_id, tenant_id, step, status, detail)
  values (v_corr, ev.tenant_id, 'AUDIT', 'OK', 'audit_log row written');

  return query select v_corr, ev.tenant_id, v_cust, v_conv, v_intent, true,
                      v_lead, v_score, 'RULES'::text, v_action, false;
end;
$fn$;

revoke all on function public.nexus_journey_from_channel_message(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.nexus_journey_from_channel_message(uuid, text, text) to service_role;

-- Reading one journey back, in order.
create or replace function public.nexus_journey_trace(p_correlation_id text)
returns table (hop int, step text, status text, ref_table text, ref_id text, detail text, at timestamptz)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select row_number() over (order by js.id)::int, js.step, js.status,
         js.ref_table, js.ref_id, js.detail, js.at
    from public.journey_step js
   where js.correlation_id = p_correlation_id
   order by js.id;
$fn$;
revoke all on function public.nexus_journey_trace(text) from public, anon;
grant execute on function public.nexus_journey_trace(text) to authenticated, service_role;
