-- NX990 — NEXUS could be sold, and could not be subscribed to.
--
-- Measured 17 Sep 2026 on production dsvuoovivysszdoiorch:
--
--   tables matching bill|subscrip|plan|trial|entitle|seat|invoic   -> 0
--   functions matching the same                                    -> 0
--   public.tenants columns: id, name, slug, status, created_at,
--                           is_quarantine, is_unattributed_default -> none commercial
--
-- Meanwhile the public site now states a price: AED 399 per month, flat,
-- permanent, first month free (ops/landing-page/PRICE-DECISION.md, decided by
-- Ali the same day). So a dealer can be told what NEXUS costs and then cannot
-- be given anything. There is nowhere to record that they said yes, no date on
-- which their free month ends, and no way to answer the three questions that
-- arrive the moment there is a second dealer:
--
--   who is paying · who is in trial · whose trial expired yesterday
--
-- This migration is the smallest schema that answers those three and nothing
-- more.
--
-- WHAT THIS DELIBERATELY IS NOT:
--
--   * It is NOT payment processing. There is no Stripe, no card, no token, no
--     payment credential, and no column that could hold one. Money is taken by
--     Ali by hand. What this records is THAT a dealership is subscribed and
--     since when -- never how they paid. A schema that has nowhere to put a
--     card number cannot leak one.
--   * It does NOT enforce anything. Nothing in NEXUS reads this table to switch
--     a dealer off, and an expired trial keeps working exactly as it did the
--     day before. Entitlement is reported here, not imposed; see
--     ops/billing/STATUS.md for the explicit list of what that leaves undone.
--   * It does NOT sweep. Nothing moves a row from TRIAL to EXPIRED on the day
--     it lapses, because there is no scheduled job to do it and inventing one
--     here would be a job nobody has watched run. The accessor therefore
--     reports the EFFECTIVE state (a trial past its end date reads EXPIRED)
--     alongside the STORED state, and says in words when the two disagree.
--     An operator who is told "ACTIVE TRIAL" about a trial that ended in
--     August finds out at the worst possible moment.
--
-- TWO TABLES, NOT ONE. `tenant_subscription` is a mutable state column: it can
-- answer "what is true now" and it can never answer "when did this dealer
-- convert", because converting overwrites the thing that knew. That question
-- gets asked the first time somebody works out revenue, so the history is
-- written as it happens, append-only, in `subscription_event`.
--
-- The quarantine tenant is refused a subscription. It is not a dealership; it
-- is where unattributed traffic is parked, and billing it would put a customer
-- on the revenue line who does not exist.

begin;

-- ── The vocabulary ────────────────────────────────────────────────────────
-- A lookup, not data. Five words, each with the plain sentence it means, so
-- that "PAST_DUE" has exactly one reading in this database and in the screen
-- that shows it.
create table if not exists public.subscription_state (
  state       text primary key,
  meaning     text not null,
  entitled    boolean not null,
  sort_order  int not null
);

insert into public.subscription_state (state, meaning, entitled, sort_order) values
  ('TRIAL',     'Inside the free month. Nothing has been charged and nothing is owed. Ends on trial_ends_at.', true,  1),
  ('ACTIVE',    'Paying AED 399 a month. Ali has been paid, by hand, outside this system.',                    true,  2),
  ('PAST_DUE',  'Was paying and the last payment did not arrive. Still switched on. A human decides what happens next.', true, 3),
  ('CANCELLED', 'The dealership asked to stop. cancel_reason says why, in their words where we have them.',    false, 4),
  ('EXPIRED',   'The free month ran out and it was never converted to a paying subscription.',                 false, 5)
on conflict (state) do nothing;

comment on table public.subscription_state is
  'The five words a dealership''s commercial relationship can be in, each with '
  'the sentence it means and whether it counts as entitled. A lookup: no '
  'tenant owns a row here. RLS is on with a stated read-all policy so that '
  '"RLS is off here" never has two possible readings in this schema.';
comment on column public.subscription_state.entitled is
  'Whether this state means the dealership should have the product. Reported, '
  'never enforced -- no code in NEXUS switches anybody off today.';

alter table public.subscription_state enable row level security;
drop policy if exists subscription_state_readable_by_signed_in on public.subscription_state;
drop policy if exists subscription_state_deny_anon             on public.subscription_state;
drop policy if exists subscription_state_service_role_all      on public.subscription_state;
create policy subscription_state_readable_by_signed_in on public.subscription_state
  for select to authenticated using (true);
create policy subscription_state_deny_anon on public.subscription_state
  as restrictive for all to anon using (false) with check (false);
create policy subscription_state_service_role_all on public.subscription_state
  for all to service_role using (true) with check (true);

revoke all on public.subscription_state from public, anon;
grant select on public.subscription_state to authenticated;
grant all    on public.subscription_state to service_role;

-- ── One row per dealership ────────────────────────────────────────────────
create table if not exists public.tenant_subscription (
  tenant_id        uuid primary key references public.tenants(id) on delete restrict,
  state            text not null references public.subscription_state(state),
  price_aed        numeric(10,2) not null default 399,
  currency         text not null default 'AED',
  trial_started_at timestamptz,
  trial_ends_at    timestamptz,
  started_at       timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint tenant_subscription_price_sane
    check (price_aed >= 0 and price_aed <= 100000),
  constraint tenant_subscription_currency_shape
    check (currency = upper(currency) and char_length(currency) = 3),
  -- A trial that cannot say when it ends is not a trial, it is a promise.
  constraint tenant_subscription_trial_has_dates
    check (state <> 'TRIAL' or (trial_started_at is not null and trial_ends_at is not null)),
  constraint tenant_subscription_trial_ends_after_it_starts
    check (trial_ends_at is null or trial_started_at is null or trial_ends_at > trial_started_at),
  -- ACTIVE and PAST_DUE both mean "this one pays", so both need a start date.
  constraint tenant_subscription_paying_has_start
    check (state not in ('ACTIVE','PAST_DUE') or started_at is not null),
  constraint tenant_subscription_cancelled_has_date
    check (state <> 'CANCELLED' or cancelled_at is not null),
  -- An expired trial must still be able to show the trial it expired from.
  constraint tenant_subscription_expired_has_trial
    check (state <> 'EXPIRED' or trial_ends_at is not null)
);

comment on table public.tenant_subscription is
  'One row per dealership: what NEXUS costs them, what state that relationship '
  'is in, and the dates that state turns on. AED 399 flat per month with a '
  'free first month (ops/landing-page/PRICE-DECISION.md). Holds NO payment '
  'instrument of any kind -- no card, no token, no bank detail, no processor '
  'id -- because money is taken by hand outside this system and a column that '
  'does not exist cannot leak. Readable by the dealership''s own signed-in '
  'staff; writable only by service_role, through the three functions below.';
comment on column public.tenant_subscription.state is
  'The STORED state. Nothing sweeps it, so a TRIAL row can sit past its end '
  'date -- nexus_subscription_status() reports the effective state and says '
  'when the two disagree.';
comment on column public.tenant_subscription.price_aed is
  'What this dealership pays per month. Defaults to 399, the decided flat '
  'price. Per-dealer because PRICE-DECISION.md leaves banding on stock size, '
  'message volume and logins explicitly open.';
comment on column public.tenant_subscription.trial_ends_at is
  'The day the free month runs out. Set once when the trial starts, so the '
  'answer to "whose trial expired yesterday" is a date comparison and not a '
  'memory.';
comment on column public.tenant_subscription.notes is
  'Free text for the operator. Not for customer data, not for anything a '
  'dealership''s own staff should not read -- they can read this row.';

create index if not exists tenant_subscription_state_idx
  on public.tenant_subscription (state);
create index if not exists tenant_subscription_trial_ends_at_idx
  on public.tenant_subscription (trial_ends_at)
  where trial_ends_at is not null;

alter table public.tenant_subscription enable row level security;
drop policy if exists tenant_subscription_authenticated_read on public.tenant_subscription;
drop policy if exists tenant_subscription_deny_anon          on public.tenant_subscription;
drop policy if exists tenant_subscription_service_role_all   on public.tenant_subscription;

-- SELECT only, and only your own dealership. Deliberately not FOR ALL: a
-- browser must not be able to write itself a subscription, and the absence of
-- an INSERT/UPDATE/DELETE policy is what stops it.
create policy tenant_subscription_authenticated_read on public.tenant_subscription
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy tenant_subscription_deny_anon on public.tenant_subscription
  as restrictive for all to anon using (false) with check (false);
create policy tenant_subscription_service_role_all on public.tenant_subscription
  for all to service_role using (true) with check (true);

revoke all    on public.tenant_subscription from public, anon, authenticated;
grant  select on public.tenant_subscription to authenticated;
grant  all    on public.tenant_subscription to service_role;

-- ── The history, append-only ──────────────────────────────────────────────
create table if not exists public.subscription_event (
  event_id    uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  event_type  text not null,
  from_state  text,
  to_state    text,
  price_aed   numeric(10,2),
  occurred_at timestamptz not null default now(),
  actor       text,
  reason      text,
  constraint subscription_event_type_known check (event_type in (
    'TRIAL_STARTED', 'TRIAL_EXTENDED', 'TRIAL_EXPIRED',
    'CONVERTED_TO_PAID', 'MARKED_PAST_DUE', 'REACTIVATED',
    'CANCELLED', 'PRICE_CHANGED'))
);

comment on table public.subscription_event is
  'Append-only history of every commercial state change, one row per change. '
  'Exists because tenant_subscription.state is overwritten by the next change '
  'and therefore can never answer "when did this dealer convert" -- which is '
  'the first question asked the first time anybody computes revenue. UPDATE '
  'is refused outright by a trigger; DELETE and TRUNCATE go through the NX900 '
  'destructive-write guard like the rest of the evidence tables. Holds no '
  'customer data and no payment instrument: a dealership id, a word, a date, '
  'a price and a reason.';
comment on column public.subscription_event.actor is
  'Who made this change, as free text an operator types -- a person or a '
  'script name. Not an auth user id: these changes are made by hand by Ali '
  'through service_role, and pretending otherwise would put a signed-in '
  'identity on a row that never had one.';

create index if not exists subscription_event_tenant_time_idx
  on public.subscription_event (tenant_id, occurred_at desc);

create or replace function public.nexus_subscription_event_is_append_only()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
begin
  raise exception using errcode = 'P0001',
    message = 'NX990 APPEND_ONLY_REFUSED: subscription_event records what happened, so it cannot be edited into something else.',
    detail  = 'An UPDATE here would rewrite the answer to "when did this dealer convert".',
    hint    = 'Insert a correcting event instead. The wrong one stays, and that is the point.';
end
$fn$;

comment on function public.nexus_subscription_event_is_append_only() is
  'Refuses every UPDATE on subscription_event. No escape hatch, unlike the '
  'NX900 delete guard: a history you can quietly edit is not a history.';

revoke all on function public.nexus_subscription_event_is_append_only() from public, anon, authenticated;

drop trigger if exists nexus_subscription_event_refuse_update on public.subscription_event;
create trigger nexus_subscription_event_refuse_update
  before update on public.subscription_event
  for each row execute function public.nexus_subscription_event_is_append_only();

alter table public.subscription_event enable row level security;
drop policy if exists subscription_event_authenticated_read on public.subscription_event;
drop policy if exists subscription_event_deny_anon          on public.subscription_event;
drop policy if exists subscription_event_service_role_all   on public.subscription_event;

create policy subscription_event_authenticated_read on public.subscription_event
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy subscription_event_deny_anon on public.subscription_event
  as restrictive for all to anon using (false) with check (false);
create policy subscription_event_service_role_all on public.subscription_event
  for all to service_role using (true) with check (true);

revoke all    on public.subscription_event from public, anon, authenticated;
grant  select on public.subscription_event to authenticated;
grant  all    on public.subscription_event to service_role;

-- ── The destructive-write guard (NX900 / NX950 / NX984) ───────────────────
-- Both tables carry the only record that a dealership is a customer. n8n and
-- every receiver run as service_role, which carries rolbypassrls, so RLS is
-- never consulted for them and this guard is the only thing between a
-- service-role mistake and the whole revenue record.
drop trigger if exists nexus_tenant_subscription_refuse_delete   on public.tenant_subscription;
drop trigger if exists nexus_tenant_subscription_refuse_truncate on public.tenant_subscription;
create trigger nexus_tenant_subscription_refuse_delete
  before delete on public.tenant_subscription
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_tenant_subscription_refuse_truncate
  before truncate on public.tenant_subscription
  for each statement execute function public.nexus_refuse_destructive_write();

drop trigger if exists nexus_subscription_event_refuse_delete   on public.subscription_event;
drop trigger if exists nexus_subscription_event_refuse_truncate on public.subscription_event;
create trigger nexus_subscription_event_refuse_delete
  before delete on public.subscription_event
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_subscription_event_refuse_truncate
  before truncate on public.subscription_event
  for each statement execute function public.nexus_refuse_destructive_write();

-- ── The read path ─────────────────────────────────────────────────────────
-- Shaped exactly like nexus_channel_status(): scoped by
-- nexus_current_tenant_ids(), returns NOTHING when the caller has no
-- membership, and never falls back to a default dealership.
create or replace function public.nexus_subscription_status()
returns table (
  tenant_id            uuid,
  tenant_name          text,
  state                text,
  stored_state         text,
  state_is_stale       boolean,
  entitled             boolean,
  price_aed            numeric,
  currency             text,
  trial_started_at     timestamptz,
  trial_ends_at        timestamptz,
  trial_days_remaining int,
  started_at           timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  evidence             text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare v_tenants uuid[];
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    -- No membership, no answer. Never a default dealership: a screen that
    -- silently shows somebody else's commercial terms is worse here than
    -- anywhere else in the product.
    return;
  end if;

  return query
  with sub as (
    select t.id as tid,
           t.name as tname,
           s.state as stored,
           s.price_aed, s.currency,
           s.trial_started_at, s.trial_ends_at,
           s.started_at, s.cancelled_at, s.cancel_reason,
           -- The effective state. A stored TRIAL past its end date is not a
           -- trial any more, whatever the column still says.
           case
             when s.state is null then 'NONE'
             when s.state = 'TRIAL' and s.trial_ends_at <= now() then 'EXPIRED'
             else s.state
           end as eff
      from public.tenants t
      left join public.tenant_subscription s on s.tenant_id = t.id
     where t.id = any(v_tenants)
  )
  select
    sub.tid,
    sub.tname,
    sub.eff,
    coalesce(sub.stored, 'NONE'),
    (sub.stored is not null and sub.stored <> sub.eff),
    coalesce(k.entitled, false),
    sub.price_aed,
    sub.currency,
    sub.trial_started_at,
    sub.trial_ends_at,
    case when sub.eff = 'TRIAL'
         then greatest(0, ceil(extract(epoch from (sub.trial_ends_at - now())) / 86400.0))::int
    end,
    sub.started_at,
    sub.cancelled_at,
    sub.cancel_reason,
    case
      when sub.eff = 'NONE' then
        'No subscription has ever been created for this dealership. They are '
        'using NEXUS and nobody has recorded that they are a customer.'
      when sub.eff = 'TRIAL' then
        'Free month, no charge. ' ||
        greatest(0, ceil(extract(epoch from (sub.trial_ends_at - now())) / 86400.0))::int ||
        ' day(s) left -- ends ' ||
        to_char(sub.trial_ends_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time. Nothing switches off on that date; somebody has to act.'
      when sub.eff = 'EXPIRED' and sub.stored = 'TRIAL' then
        'The free month ran out on ' ||
        to_char(sub.trial_ends_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time and the row still says TRIAL -- nothing sweeps it. They '
        'were never converted and they are still being served.'
      when sub.eff = 'EXPIRED' then
        'Trial ended ' || to_char(sub.trial_ends_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time and was never converted to a paying subscription.'
      when sub.eff = 'ACTIVE' then
        'Paying ' || sub.currency || ' ' || trim(to_char(sub.price_aed, 'FM999999.00')) ||
        ' a month since ' || to_char(sub.started_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time. Collected by hand -- NEXUS holds no payment instrument.'
      when sub.eff = 'PAST_DUE' then
        'Paying since ' || to_char(sub.started_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time and the last payment did not arrive. Still switched on.'
      when sub.eff = 'CANCELLED' then
        'Cancelled ' || to_char(sub.cancelled_at at time zone 'Asia/Dubai', 'DD Mon YYYY') ||
        ' Dubai time' || coalesce(' -- ' || sub.cancel_reason, ' with no reason recorded') || '.'
      else 'Unrecognised state ' || sub.eff || '.'
    end
  from sub
  left join public.subscription_state k on k.state = sub.eff
  order by 2;
end
$fn$;

comment on function public.nexus_subscription_status() is
  'What NEXUS costs the caller''s own dealership(s) and what state that stands '
  'in, scoped to their own memberships and to nothing else. Returns no rows at '
  'all for a caller with no membership -- never a default dealership. Reports '
  'the EFFECTIVE state beside the STORED one, so a trial that lapsed in August '
  'and was never swept reads EXPIRED rather than ACTIVE TRIAL. Reports '
  'entitlement; enforces nothing.';

revoke all on function public.nexus_subscription_status() from public, anon;
grant execute on function public.nexus_subscription_status() to authenticated, service_role;

-- ── The write path: service_role only, three verbs ────────────────────────
-- Never anon, never authenticated. A dealership's own browser must not be able
-- to start its own trial, convert itself, or cancel itself.

create or replace function public.nexus_subscription_start_trial(
  p_tenant_id   uuid,
  p_trial_days  int  default 30,
  p_actor       text default null,
  p_notes       text default null
) returns table (tenant_id uuid, state text, trial_ends_at timestamptz, action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  t      record;
  v_now  timestamptz := now();
  v_end  timestamptz;
  v_prev text;
begin
  if p_trial_days is null or p_trial_days < 1 or p_trial_days > 365 then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: a trial of that length is not the offer. The decided offer is one free month (30 days).';
  end if;

  select id, name, status, is_quarantine into t
    from public.tenants where id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: no dealership with that id, so this trial belongs to nobody.';
  end if;
  if t.is_quarantine then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: that is the unattributed quarantine tenant, not a dealership. Billing it would invent a customer.';
  end if;
  if t.status <> 'active' then
    raise exception using errcode = 'P0001',
      message = format('NX990 REFUSED: dealership %L is %s, not active.', t.name, t.status);
  end if;

  select s.state into v_prev from public.tenant_subscription s where s.tenant_id = p_tenant_id;
  if v_prev in ('ACTIVE','PAST_DUE') then
    raise exception using errcode = 'P0001',
      message = format('NX990 REFUSED: %L is already %s. A paying dealership does not go back into a free month.', t.name, v_prev);
  end if;
  if v_prev = 'TRIAL' then
    raise exception using errcode = 'P0001',
      message = format('NX990 REFUSED: %L is already in a trial. Extending one is a different, deliberate act.', t.name);
  end if;

  v_end := v_now + make_interval(days => p_trial_days);

  insert into public.tenant_subscription as s
    (tenant_id, state, trial_started_at, trial_ends_at, notes)
  values (p_tenant_id, 'TRIAL', v_now, v_end, p_notes)
  on conflict (tenant_id) do update
    set state            = 'TRIAL',
        trial_started_at = v_now,
        trial_ends_at    = v_end,
        started_at       = null,
        cancelled_at     = null,
        cancel_reason    = null,
        notes            = coalesce(p_notes, s.notes),
        updated_at       = v_now;

  insert into public.subscription_event
    (tenant_id, event_type, from_state, to_state, price_aed, occurred_at, actor, reason)
  values (p_tenant_id, 'TRIAL_STARTED', v_prev, 'TRIAL',
          (select s.price_aed from public.tenant_subscription s where s.tenant_id = p_tenant_id),
          v_now, p_actor, p_trial_days || '-day free month');

  tenant_id     := p_tenant_id;
  state         := 'TRIAL';
  trial_ends_at := v_end;
  action        := case when v_prev is null then 'TRIAL_STARTED' else 'TRIAL_RESTARTED' end;
  return next;
end
$fn$;

comment on function public.nexus_subscription_start_trial(uuid, int, text, text) is
  'Starts the free month for one dealership and writes the matching '
  'subscription_event. Refuses the quarantine tenant, a non-active tenant, a '
  'dealership already paying, and a dealership already in a trial. '
  'service_role only.';

create or replace function public.nexus_subscription_convert_to_paid(
  p_tenant_id uuid,
  p_price_aed numeric default 399,
  p_actor     text    default null,
  p_reason    text    default null
) returns table (tenant_id uuid, state text, started_at timestamptz, price_aed numeric)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  t      record;
  v_now  timestamptz := now();
  v_prev text;
begin
  if p_price_aed is null or p_price_aed < 0 then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: a subscription needs a price. The decided price is AED 399 flat per month.';
  end if;

  select id, name, status, is_quarantine into t
    from public.tenants where id = p_tenant_id;
  if not found or t.is_quarantine or t.status <> 'active' then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: that is not an active dealership.';
  end if;

  select s.state into v_prev from public.tenant_subscription s where s.tenant_id = p_tenant_id;
  if v_prev = 'ACTIVE' then
    raise exception using errcode = 'P0001',
      message = format('NX990 REFUSED: %L is already ACTIVE. Changing the price is PRICE_CHANGED, not a conversion.', t.name);
  end if;

  insert into public.tenant_subscription as s
    (tenant_id, state, price_aed, started_at)
  values (p_tenant_id, 'ACTIVE', p_price_aed, v_now)
  on conflict (tenant_id) do update
    set state         = 'ACTIVE',
        price_aed     = p_price_aed,
        started_at    = coalesce(s.started_at, v_now),
        cancelled_at  = null,
        cancel_reason = null,
        updated_at    = v_now;

  insert into public.subscription_event
    (tenant_id, event_type, from_state, to_state, price_aed, occurred_at, actor, reason)
  values (p_tenant_id,
          case when v_prev in ('CANCELLED','EXPIRED') then 'REACTIVATED' else 'CONVERTED_TO_PAID' end,
          v_prev, 'ACTIVE', p_price_aed, v_now, p_actor,
          coalesce(p_reason, 'Payment arranged by hand. NEXUS holds no payment instrument.'));

  select s.tenant_id, s.state, s.started_at, s.price_aed
    into tenant_id, state, started_at, price_aed
    from public.tenant_subscription s where s.tenant_id = p_tenant_id;
  return next;
end
$fn$;

comment on function public.nexus_subscription_convert_to_paid(uuid, numeric, text, text) is
  'Records that a dealership is now paying, and since when. Records the FACT '
  'of a subscription -- never a card, a token or any payment credential, '
  'because collection happens by hand outside this system. service_role only.';

create or replace function public.nexus_subscription_cancel(
  p_tenant_id uuid,
  p_reason    text,
  p_actor     text default null
) returns table (tenant_id uuid, state text, cancelled_at timestamptz)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now  timestamptz := now();
  v_prev text;
begin
  select s.state into v_prev from public.tenant_subscription s where s.tenant_id = p_tenant_id;
  if v_prev is null then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: that dealership has no subscription, so there is nothing to cancel.';
  end if;
  if v_prev = 'CANCELLED' then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: already cancelled. Cancelling twice would put a second date on the same ending.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = 'P0001',
      message = 'NX990 REFUSED: a cancellation with no reason teaches nothing. Say why, in their words if you have them.';
  end if;

  update public.tenant_subscription s
     set state         = 'CANCELLED',
         cancelled_at  = v_now,
         cancel_reason = btrim(p_reason),
         updated_at    = v_now
   where s.tenant_id = p_tenant_id;

  insert into public.subscription_event
    (tenant_id, event_type, from_state, to_state, price_aed, occurred_at, actor, reason)
  values (p_tenant_id, 'CANCELLED', v_prev, 'CANCELLED',
          (select s.price_aed from public.tenant_subscription s where s.tenant_id = p_tenant_id),
          v_now, p_actor, btrim(p_reason));

  tenant_id    := p_tenant_id;
  state        := 'CANCELLED';
  cancelled_at := v_now;
  return next;
end
$fn$;

comment on function public.nexus_subscription_cancel(uuid, text, text) is
  'Records that a dealership asked to stop, when, and why. Refuses a blank '
  'reason and refuses a second cancellation. Switches nothing off: no code in '
  'NEXUS reads this state to withdraw the product. service_role only.';

revoke all on function public.nexus_subscription_start_trial(uuid, int, text, text)      from public, anon, authenticated;
revoke all on function public.nexus_subscription_convert_to_paid(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.nexus_subscription_cancel(uuid, text, text)                from public, anon, authenticated;
grant execute on function public.nexus_subscription_start_trial(uuid, int, text, text)      to service_role;
grant execute on function public.nexus_subscription_convert_to_paid(uuid, numeric, text, text) to service_role;
grant execute on function public.nexus_subscription_cancel(uuid, text, text)                to service_role;

-- ── Verify, or roll the whole thing back ──────────────────────────────────
do $verify$
declare n int;
begin
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('subscription_state','tenant_subscription','subscription_event')
     and c.relrowsecurity;
  if n <> 3 then
    raise exception 'NX990: expected RLS enabled on 3 tables, found %. Rolling back.', n;
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('tenant_subscription','subscription_event','subscription_state')
     and grantee in ('anon','PUBLIC');
  if n <> 0 then
    raise exception 'NX990: anon or PUBLIC holds % grant(s) on the billing tables. Rolling back.', n;
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('tenant_subscription','subscription_event')
     and grantee = 'authenticated'
     and privilege_type <> 'SELECT';
  if n <> 0 then
    raise exception 'NX990: authenticated holds % non-SELECT grant(s). A browser could write itself a subscription. Rolling back.', n;
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where ns.nspname = 'public' and not t.tgisinternal
     and p.proname = 'nexus_refuse_destructive_write'
     and c.relname in ('tenant_subscription','subscription_event');
  if n <> 4 then
    raise exception 'NX990: expected 4 destructive-write guard triggers on the two new tables, found %. Rolling back.', n;
  end if;

  -- Nobody but service_role may run the write path.
  if has_function_privilege('authenticated', 'public.nexus_subscription_start_trial(uuid,int,text,text)', 'execute')
     or has_function_privilege('anon', 'public.nexus_subscription_convert_to_paid(uuid,numeric,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_subscription_cancel(uuid,text,text)', 'execute')
  then
    raise exception 'NX990: a browser role can execute the subscription write path. Rolling back.';
  end if;

  raise notice 'NX990: NEXUS can now be subscribed to. 3 tables, 1 read accessor, 3 write verbs, 4 guard triggers, append-only history. No payment instrument anywhere, and nothing is enforced -- see ops/billing/STATUS.md.';
end
$verify$;

commit;
