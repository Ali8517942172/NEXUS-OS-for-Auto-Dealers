-- NX960 — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX960 — A message becomes a journey, and "Hi" does not become a lead.
--
-- The receiver has proven it can take a real Meta Cloud message, verify the
-- signature, resolve the dealership and write channel_message_events. Then it
-- answers 200 and stops. A dealership cannot sell anything from that.
--
-- What was missing, measured today: there is no `customers` table, no
-- `conversations` table, no `opportunities` table, and no correlation id
-- anywhere in the schema. `lead_recovery_actions` exists and has never held a
-- row. So the journey is built here, once, as one function the receiver calls.
--
-- THE RULE THAT MATTERS MOST
-- Not every WhatsApp message is a lead. "Hi" is a conversation, not an
-- opportunity. A CRM that turns every greeting into a lead is a CRM nobody
-- trusts by week two. Classification is deterministic and happens BEFORE
-- promotion; only named business intents are eligible; everything else is
-- recorded truthfully and promoted to nothing.

begin;

-- 1. Who wrote to us --------------------------------------------------------
create table if not exists public.customer (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  display_name    text,
  phone_digits    text,
  email           text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  constraint customer_phone_is_digits
    check (phone_digits is null or phone_digits ~ '^[0-9]{6,20}$'),
  constraint customer_has_an_identity
    check (phone_digits is not null or email is not null)
);
create unique index if not exists customer_tenant_phone_key
  on public.customer (tenant_id, phone_digits) where phone_digits is not null;
comment on table public.customer is
  'A person a dealership has heard from. Identity is the phone digits WhatsApp '
  'gave us -- never a formatted string, so the same person is one row.';

-- 2. The thread -------------------------------------------------------------
create table if not exists public.conversation (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  customer_id        uuid not null references public.customer(id) on delete restrict,
  integration_id     uuid not null references public.channel_registry(integration_id) on delete restrict,
  channel            text not null,
  state              text not null default 'OPEN',
  opened_at          timestamptz not null default now(),
  last_message_at    timestamptz,
  message_count      integer not null default 0,
  constraint conversation_state_check check (state in ('OPEN','DORMANT','CLOSED')),
  constraint conversation_channel_check
    check (channel in ('whatsapp_cloud','whatsapp_waha','email','web'))
);
create unique index if not exists conversation_open_per_customer_channel
  on public.conversation (tenant_id, integration_id, customer_id)
  where state <> 'CLOSED';

-- 3. The vocabulary of intent ----------------------------------------------
create table if not exists public.message_intent (
  intent            text primary key,
  promote_eligible  boolean not null,
  meaning           text not null
);
insert into public.message_intent (intent, promote_eligible, meaning) values
  ('VEHICLE_ENQUIRY', true,  'Asked about a specific vehicle or model.'),
  ('PRICE_ENQUIRY',   true,  'Asked what something costs, or to negotiate.'),
  ('FINANCE_ENQUIRY', true,  'Asked about finance, instalments, EMI or a down payment.'),
  ('TRADE_IN',        true,  'Offered a vehicle in exchange or asked what theirs is worth.'),
  ('TEST_DRIVE',      true,  'Asked to see, view or drive a vehicle.'),
  ('SERVICE',         false, 'Service, repair or maintenance -- real, but not a sales opportunity.'),
  ('FOLLOW_UP',       false, 'Continuing an existing thread without a new ask.'),
  ('GREETING',        false, 'A greeting and nothing else. A conversation, not an opportunity.'),
  ('INFO_ONLY',       false, 'Asked for hours, location or directions.'),
  ('SPAM',            false, 'Promotional or automated. Recorded, never promoted.'),
  ('NON_BUSINESS',    false, 'Nothing to do with the dealership.'),
  ('UNKNOWN',         false, 'Could not be classified. Kept as-is -- never guessed into a lead.')
on conflict (intent) do nothing;

-- 4. The trail one correlation id can walk ----------------------------------
create table if not exists public.journey_step (
  id              bigserial primary key,
  correlation_id  text not null,
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  step            text not null,
  status          text not null,
  ref_table       text,
  ref_id          text,
  detail          text,
  at              timestamptz not null default now(),
  constraint journey_step_status_check
    check (status in ('OK','SKIPPED','REFUSED','FAILED','UNKNOWN'))
);
create index if not exists journey_step_correlation_idx
  on public.journey_step (correlation_id, id);
comment on table public.journey_step is
  'One row per hop of one customer journey. This is what answers "why was this '
  'customer never contacted?" -- including the hops that were deliberately '
  'skipped, which is the half a log usually loses.';

-- 5. FAILED joins the score vocabulary -------------------------------------
-- A model that errors is not the same as a model that answered badly, and
-- neither is the same as never having asked.
alter table public.leads drop constraint if exists leads_score_source_is_a_known_label;
alter table public.leads add constraint leads_score_source_is_a_known_label
  check (score_source in (
    'RULES', 'AI_SCORE_CONFIRMED', 'AI_SCORE_FALLBACK',
    'AI_SCORE_UNKNOWN', 'AI_SCORE_FAILED'));

-- 6. Classification — deterministic, explainable, no model ------------------
create or replace function public.nexus_classify_message_intent(p_text text)
returns table (intent text, reason_codes text[], promote_eligible boolean)
language plpgsql
immutable
as $fn$
declare
  t text := lower(coalesce(p_text, ''));
  rc text[] := '{}';
begin
  if btrim(t) = '' then
    return query select 'UNKNOWN'::text, array['EMPTY_MESSAGE']::text[], false; return;
  end if;

  -- Order matters: the strongest commercial signal wins, and a greeting that
  -- also carries an ask is an ask.
  if t ~ '\m(instal?ment|emi|finance|financing|down\s?payment|lease|loan|bank)\M' then
    rc := rc || 'FINANCE_WORD';
    return query select 'FINANCE_ENQUIRY'::text, rc, true; return;
  end if;

  if t ~ '\m(trade[\s-]?in|exchange|part[\s-]?ex|my old car|sell my)\M' then
    rc := rc || 'TRADE_IN_WORD';
    return query select 'TRADE_IN'::text, rc, true; return;
  end if;

  if t ~ '\m(price|pricing|cost|how much|rate|quote|discount|best offer|final)\M' then
    rc := rc || 'PRICE_WORD';
    if t ~ '\m(fortuner|prado|patrol|land cruiser|hilux|corolla|camry|explorer|lexus|nissan|toyota|ford|bmw|mercedes|audi|kia|hyundai|honda)\M' then
      rc := rc || 'MODEL_NAMED';
    end if;
    return query select 'PRICE_ENQUIRY'::text, rc, true; return;
  end if;

  if t ~ '\m(test drive|testdrive|view|viewing|see the car|come and see|visit|showroom)\M' then
    rc := rc || 'VIEWING_WORD';
    return query select 'TEST_DRIVE'::text, rc, true; return;
  end if;

  if t ~ '\m(fortuner|prado|patrol|land cruiser|hilux|corolla|camry|explorer|lexus|nissan|toyota|ford|bmw|mercedes|audi|kia|hyundai|honda)\M'
     or t ~ '\m(available|availability|stock|in stock|interested in|looking for|do you have)\M' then
    rc := rc || 'VEHICLE_INTEREST';
    return query select 'VEHICLE_ENQUIRY'::text, rc, true; return;
  end if;

  if t ~ '\m(service|servicing|repair|oil change|maintenance|warranty claim|workshop)\M' then
    rc := rc || 'SERVICE_WORD';
    return query select 'SERVICE'::text, rc, false; return;
  end if;

  if t ~ '\m(timing|open|close|hours|where are you|location|address|directions)\M' then
    rc := rc || 'INFO_WORD';
    return query select 'INFO_ONLY'::text, rc, false; return;
  end if;

  if t ~ '(http://|https://|www\.)' or t ~ '\m(congratulations|you have won|click here|unsubscribe|promo code)\M' then
    rc := rc || 'SPAM_SIGNAL';
    return query select 'SPAM'::text, rc, false; return;
  end if;

  -- A greeting ONLY when that is the entire message. This is the rule that
  -- stops "Hi" becoming a lead, and it is checked late so that
  -- "Hi, what is the price" is a price enquiry.
  if t ~ '^\s*(hi|hello|hey|salam|salaam|assalam[ou]?\s?alaikum|good (morning|afternoon|evening)|thanks|thank you|ok|okay|yes|no)\W*$' then
    rc := rc || 'GREETING_ONLY';
    return query select 'GREETING'::text, rc, false; return;
  end if;

  if length(btrim(t)) < 4 then
    rc := rc || 'TOO_SHORT_TO_READ';
    return query select 'UNKNOWN'::text, rc, false; return;
  end if;

  rc := rc || 'NO_RULE_MATCHED';
  return query select 'UNKNOWN'::text, rc, false;
end;
$fn$;

comment on function public.nexus_classify_message_intent(text) is
  'Deterministic. No model. UNKNOWN is a real answer and must never be '
  'rewritten into a business intent to make a funnel look fuller.';

commit;
