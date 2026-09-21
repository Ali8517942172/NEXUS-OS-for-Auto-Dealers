-- NEXUS OS — NX1003: a dealer can see and keep its subscription
--
-- WHY THIS EXISTS
-- ----------------
-- NX990 (17 Sep 2026) built the subscription ledger — tenant_subscription,
-- subscription_event, subscription_state, and five functions to move a
-- dealership between them — and shipped it with zero rows. Every one of
-- NX990's write functions is `service_role` only: they are how Ali, by hand,
-- records what happened. Nothing in NEXUS OS could tell a dealer what THEY
-- were on, and nothing could put a dealer INTO the ledger in the first place
-- except a human running SQL.
--
-- The decision, made outside this database: AED 399/month, first month free
-- (30-day trial), no card processor. Payment is a bank transfer or cash and
-- Ali marks it paid by hand. The rule this migration encodes:
--
--     TRIAL (30 days) -> GRACE (7 days) -> READ_ONLY, until marked paid.
--
-- Nothing here charges anybody or checks a card, because there is nothing to
-- check a card WITH. This is bookkeeping and a clock, not a payment system.
--
-- WHAT THIS MIGRATION DOES
-- -------------------------
--   1. Adds two columns to tenant_subscription: current_period_end and
--      last_payment_reference. NX990's ACTIVE state had no notion of "paid
--      through when" -- nexus_subscription_convert_to_paid() just flips a
--      state -- because nothing yet needed to answer "when does this month
--      run out". A manual payment now does.
--   2. Backfills a TRIALING subscription for every active, non-quarantine
--      tenant that has none, by calling NX990's OWN
--      nexus_subscription_start_trial() -- not a duplicate insert -- so the
--      row, its validation and its subscription_event both come from the
--      one function already trusted to write them.
--   3. public.platform_admin -- a table with no rows, and
--      public.nexus_is_platform_admin() to read it. NX990 has no concept of
--      "who is Ali" beyond "whoever holds service_role", which the browser
--      never does. This migration inserts NOBODY into it: the orchestrator
--      seeds Ali's own auth_user_id after this ships. Until that row exists,
--      nexus_founder_mark_paid() refuses everyone, including Ali.
--   4. public.nexus_my_subscription() -- an authenticated read, scoped by
--      nexus_current_tenant_ids() exactly like nexus_subscription_status(),
--      returning the ONE thing a dealer's own screen needs: what they're on,
--      what it costs, how long is left, and what that leaves them able to
--      do (`access`).
--   5. public.nexus_founder_mark_paid(p_tenant, p_months, p_reference) -- the
--      founder-only write. Gated on nexus_is_platform_admin(), not on
--      service_role, because Ali using the dashboard signs in as an
--      authenticated user like everyone else; service_role is a backend
--      credential this app never holds.
--
-- WHY now() AND NOT tenant.created_at
-- -------------------------------------
-- ALBA (and every other tenant already using NEXUS before a subscription
-- concept existed) has been running for free with nobody billing it. Backing
-- the trial clock onto tenants.created_at would retroactively burn some or
-- all of the free month against days already spent unbilled -- punishing a
-- dealer for NEXUS being late to invoice them. now() gives every existing
-- tenant the full 30 days from the moment this migration runs, which is also
-- the first moment any of them could possibly see a countdown or a bill.

-- -- 1. The columns NX990 did not need until payment had a duration ----------
alter table public.tenant_subscription
  add column if not exists current_period_end   timestamptz,
  add column if not exists last_payment_reference text;

comment on column public.tenant_subscription.current_period_end is
  'Paid through this date. Set only by nexus_founder_mark_paid() -- manual '
  'payment, manually recorded. NULL for a tenant that has never been marked '
  'paid, including one sitting in TRIAL: a trial is not a paid period and '
  'must not be read as one.';
comment on column public.tenant_subscription.last_payment_reference is
  'Whatever Ali typed for the bank transfer or cash receipt this period was '
  'paid against -- free text, so it can be reconciled by hand later. Not '
  'validated against a bank feed: there is no bank feed.';

-- -- 2. Backfill: every active, non-quarantine tenant gets a trial -----------
-- Reuses nexus_subscription_start_trial() rather than inserting rows here.
-- That function already refuses a quarantine tenant, an inactive one, and a
-- tenant already TRIAL/ACTIVE/PAST_DUE -- so this loop only ever touches a
-- tenant NX990 left with no subscription row at all, and the validation, the
-- row and its subscription_event all come from the one function already
-- trusted to write them, not a second copy of that logic.
do $backfill$
declare
  t record;
  r record;
  n int := 0;
begin
  for t in
    select ten.id, ten.name
      from public.tenants ten
      left join public.tenant_subscription s on s.tenant_id = ten.id
     where ten.status = 'active'
       and ten.is_quarantine = false
       and s.tenant_id is null
  loop
    select * into r from public.nexus_subscription_start_trial(
      t.id, 30, 'NX1003 migration backfill',
      'Backfilled 21 Sep 2026 by the migration that first made a trial visible '
      'to the dealer. Clock starts now(), not this tenant''s created_at, so a '
      'dealership already running unbilled is not charged for days already '
      'spent before subscriptions existed.'
    );
    n := n + 1;
  end loop;
  raise notice 'NX1003: backfilled a TRIAL subscription for % tenant(s)', n;
end
$backfill$;

-- -- 3. Platform admin: a table with nobody in it, and a helper to read it --
create table if not exists public.platform_admin (
  auth_user_id uuid primary key,
  granted_at   timestamptz not null default now(),
  note         text
);

comment on table public.platform_admin is
  'Who NEXUS OS itself trusts to act for every dealership at once -- today '
  'that is one founder-only action: marking a manual payment received. This '
  'migration creates the table and inserts NOBODY into it. Ali''s own '
  'auth_user_id is seeded by the orchestrator after this ships; until that '
  'row exists, nexus_is_platform_admin() is false for everyone and '
  'nexus_founder_mark_paid() refuses everyone, Ali included. RLS is enabled '
  'with no policies for anon or authenticated, so the table answers neither '
  'role at all -- only service_role and the SECURITY DEFINER helper below '
  'can read it.';

alter table public.platform_admin enable row level security;
-- Deliberately no policies for anon/authenticated: a table with RLS on and no
-- permissive policy denies both by default, and that default is the point.
-- Only service_role (which bypasses RLS) and nexus_is_platform_admin() (a
-- SECURITY DEFINER function that runs as the table owner) can ever read it.

revoke all on public.platform_admin from public, anon, authenticated;
grant all on public.platform_admin to service_role;

create or replace function public.nexus_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select exists(
    select 1 from public.platform_admin p
     where auth.uid() is not null and p.auth_user_id = auth.uid()
  );
$fn$;

comment on function public.nexus_is_platform_admin() is
  'True only for a signed-in auth user whose id is a row in platform_admin -- '
  'today, nobody, until the orchestrator seeds Ali''s own id after this ships. '
  'SECURITY DEFINER so it can read a table that grants nothing to '
  'authenticated directly. Used to gate nexus_founder_mark_paid(); confers no '
  'access on its own.';

revoke all on function public.nexus_is_platform_admin() from public, anon, authenticated;
grant execute on function public.nexus_is_platform_admin() to authenticated, service_role;

-- -- 4. The read: what is MY dealership on, and what can I do ---------------
-- Shaped exactly like nexus_subscription_status(): scoped by
-- nexus_current_tenant_ids(), returns nothing for a caller with no
-- membership, never a default dealership. Adds the one thing that function
-- does not compute: the derived `access` a screen can act on directly,
-- instead of every screen re-deriving grace-period arithmetic from raw dates.
create or replace function public.nexus_my_subscription()
returns table (
  tenant_id           uuid,
  tenant_name         text,
  status              text,
  plan                text,
  price_aed           numeric,
  currency            text,
  trial_ends_at       timestamptz,
  grace               timestamptz,
  days_left           int,
  current_period_end  timestamptz,
  access              text,
  evidence            text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
#variable_conflict use_column
declare v_tenants uuid[];
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    -- No membership, no answer. See nexus_subscription_status(): a screen
    -- that silently shows somebody else's commercial terms is worse here
    -- than anywhere else in the product.
    return;
  end if;

  return query
  with sub as (
    select ten.id as tid,
           ten.name as tname,
           s.state as stored,
           s.price_aed, s.currency,
           s.trial_ends_at, s.current_period_end,
           case
             when s.state is null then 'NONE'
             when s.state = 'TRIAL' and s.trial_ends_at <= now() then 'EXPIRED'
             else s.state
           end as eff
      from public.tenants ten
      left join public.tenant_subscription s on s.tenant_id = ten.id
     where ten.id = any(v_tenants)
  ),
  derived as (
    select
      sub.*,
      -- Grace only exists for a lapsed trial, and only for 7 days past it.
      -- A tenant that was ACTIVE and lapsed into EXPIRED some other way
      -- (there is currently no such path -- ACTIVE/PAST_DUE stay entitled
      -- until CANCELLED) gets no grace window here on purpose: grace is the
      -- one free week attached to the free month, not a second one attached
      -- to a paid month nothing in NX990 ever lapses out of automatically.
      case when sub.eff = 'EXPIRED' and sub.stored = 'TRIAL'
           then sub.trial_ends_at + interval '7 days' end as grace_end
    from sub
  )
  select
    d.tid,
    d.tname,
    d.eff,
    'NEXUS Dealer -- AED 399/month, first month free'::text,
    coalesce(d.price_aed, 399),
    coalesce(d.currency, 'AED'),
    d.trial_ends_at,
    d.grace_end,
    case
      when d.eff = 'TRIAL' then
        greatest(0, ceil(extract(epoch from (d.trial_ends_at - now())) / 86400.0))::int
      when d.eff = 'EXPIRED' and d.grace_end is not null and now() < d.grace_end then
        greatest(0, ceil(extract(epoch from (d.grace_end - now())) / 86400.0))::int
      else null
    end,
    d.current_period_end,
    case
      when d.eff in ('TRIAL', 'ACTIVE', 'PAST_DUE') then 'full'
      when d.eff = 'EXPIRED' and d.grace_end is not null and now() < d.grace_end then 'grace'
      else 'read_only'
    end,
    case
      when d.eff = 'NONE' then
        'No subscription has ever been started for this dealership, so it is '
        'being treated as read-only until one is. This should not happen for '
        'a dealership created before this migration ran -- if you are seeing '
        'this, the backfill missed a tenant and NEXUS support should be told.'
      when d.eff = 'TRIAL' then
        'Free first month, no charge. Ends '
        || to_char(d.trial_ends_at at time zone 'Asia/Dubai', 'DD Mon YYYY') || ' Dubai time.'
      when d.eff = 'EXPIRED' and d.grace_end is not null and now() < d.grace_end then
        'The free month ended '
        || to_char(d.trial_ends_at at time zone 'Asia/Dubai', 'DD Mon YYYY')
        || '. Full access continues through a 7-day grace period, ending '
        || to_char(d.grace_end at time zone 'Asia/Dubai', 'DD Mon YYYY') || ' Dubai time.'
      when d.eff = 'EXPIRED' then
        'The free month and the 7-day grace period that followed it have both '
        'ended and this dealership was never marked paid. Reads still work; '
        'writes do not until payment is recorded.'
      when d.eff = 'ACTIVE' then
        'Paying AED 399 a month, collected by hand -- NEXUS holds no payment '
        'instrument.'
        || (case when d.current_period_end is not null
             then ' Paid through ' || to_char(d.current_period_end at time zone 'Asia/Dubai', 'DD Mon YYYY') || '.'
             else '' end)
      when d.eff = 'PAST_DUE' then
        'The last payment did not arrive. Still switched on -- a human '
        'decides what happens next.'
      when d.eff = 'CANCELLED' then
        'This dealership cancelled. Reads still work; writes do not.'
      else 'Unrecognised state ' || d.eff || '.'
    end
  from derived d
  order by 2;
end
$fn$;

comment on function public.nexus_my_subscription() is
  'What the caller''s own dealership(s) are subscribed to, scoped to their own '
  'memberships and nothing else. Derives `access` (full / grace / read_only) '
  'from the TRIAL -> 7-day GRACE -> READ_ONLY rule so no screen has to '
  'reimplement that arithmetic. Reports; enforces nothing -- the write '
  'functions and the frontend soft paywall are what actually stop a write.';

revoke all on function public.nexus_my_subscription() from public, anon, authenticated;
grant execute on function public.nexus_my_subscription() to authenticated, service_role;

-- -- 5. The founder-only write: mark a dealership paid by hand ---------------
-- Deliberately separate from NX990's nexus_subscription_convert_to_paid(),
-- which stays service_role-only and unaware of periods. This one is reached
-- from the DASHBOARD by a signed-in founder, so it is gated on
-- nexus_is_platform_admin() rather than on holding service_role -- the
-- browser never holds service_role and never should.
create or replace function public.nexus_founder_mark_paid(
  p_tenant    uuid,
  p_months    int,
  p_reference text
)
returns table (
  tenant_id           uuid,
  state               text,
  current_period_end  timestamptz,
  price_aed           numeric
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
#variable_conflict use_column
declare
  t          record;
  v_now      timestamptz := now();
  v_prev     text;
  v_prev_end timestamptz;
  v_base     timestamptz;
  v_new_end  timestamptz;
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = '42501',
      message = 'NX1003 REFUSED: only a NEXUS platform admin may mark a dealership as paid. '
                'This is not a dealership-level permission -- owner and admin roles at a '
                'dealership do not carry it.';
  end if;

  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception using errcode = 'P0001',
      message = 'NX1003 REFUSED: a payment must cover between 1 and 12 months. '
                'Record two payments rather than inventing a longer one.';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception using errcode = 'P0001',
      message = 'NX1003 REFUSED: a payment needs a reference -- a bank transfer id, a receipt '
                'number, anything that lets this be reconciled later against what actually '
                'arrived. NEXUS holds no payment instrument and no bank feed; this text is the '
                'only record that will ever exist of why the state changed.';
  end if;

  select id, name, status, is_quarantine into t from public.tenants where id = p_tenant;
  if not found or t.is_quarantine or t.status <> 'active' then
    raise exception using errcode = 'P0001',
      message = 'NX1003 REFUSED: that is not an active dealership.';
  end if;

  select s.state, s.current_period_end into v_prev, v_prev_end
    from public.tenant_subscription s where s.tenant_id = p_tenant;

  -- Extend from the existing period end when it is still in the future (an
  -- early renewal), otherwise start the new period from now. Never from a
  -- past period end -- that would silently grant free days for a period that
  -- already lapsed.
  v_base := greatest(v_now, coalesce(v_prev_end, v_now));
  v_new_end := v_base + make_interval(months => p_months);

  insert into public.tenant_subscription as s
    (tenant_id, state, price_aed, started_at, current_period_end, last_payment_reference)
  values (p_tenant, 'ACTIVE', 399, v_now, v_new_end, btrim(p_reference))
  on conflict (tenant_id) do update
    set state                   = 'ACTIVE',
        started_at              = coalesce(s.started_at, v_now),
        current_period_end      = v_new_end,
        last_payment_reference  = btrim(p_reference),
        cancelled_at            = null,
        cancel_reason           = null,
        updated_at              = v_now;

  insert into public.subscription_event
    (tenant_id, event_type, from_state, to_state, price_aed, occurred_at, actor, reason)
  values (
    p_tenant,
    case when v_prev is null or v_prev in ('CANCELLED', 'EXPIRED') then 'REACTIVATED' else 'PAYMENT_RECORDED' end,
    v_prev, 'ACTIVE', 399, v_now,
    'platform_admin:' || auth.uid()::text,
    format('Marked paid by hand for %s month(s), reference %L, period now ends %s (Dubai time).',
           p_months, btrim(p_reference), to_char(v_new_end at time zone 'Asia/Dubai', 'DD Mon YYYY'))
  );

  return query
  select p_tenant, 'ACTIVE'::text, v_new_end, 399::numeric;
end
$fn$;

comment on function public.nexus_founder_mark_paid(uuid, int, text) is
  'The one write a signed-in founder can make from the dashboard: record that '
  'a dealership paid, by hand, outside this system. Gated on '
  'nexus_is_platform_admin(), not on service_role -- the browser never holds '
  'service_role. Extends current_period_end from whichever is later, now() or '
  'the existing period end, so an early renewal adds months rather than '
  'discarding time already paid for. Refuses with no reference, no month '
  'count outside 1-12, a non-admin caller, or a tenant that is not active.';

revoke all on function public.nexus_founder_mark_paid(uuid, int, text) from public, anon, authenticated;
grant execute on function public.nexus_founder_mark_paid(uuid, int, text) to authenticated, service_role;
