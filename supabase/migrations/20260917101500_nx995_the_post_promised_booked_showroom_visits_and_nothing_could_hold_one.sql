-- NX995 — The post promised booked showroom visits and nothing could hold one.
--
-- A published Adqonic post says NEXUS will "schedule showroom visits
-- seamlessly" and "turn website visitors & social leads into booked
-- appointments automatically". Measured 17 Sep 2026 on production
-- dsvuoovivysszdoiorch:
--
--   tables  matching appoint|booking|visit|showroom|slot|calendar|test_drive -> 0
--   functions matching appoint|booking|visit|slot|calendar                   -> 0
--   columns named appoint|booked|visit_at|showroom                           -> 0
--
-- Nothing in this database books anything. Ali's instruction was to make the
-- claim true rather than delete it, so this migration is the schema that makes
-- the word "booked" mean something checkable.
--
-- WHAT THIS DELIBERATELY IS NOT:
--
--   * It is NOT a calendar. Nothing here writes to Google Calendar, Outlook,
--     or a salesperson's phone. An appointment confirmed in NEXUS is invisible
--     to every other diary in the dealership until a human copies it across.
--   * It does NOT send anything. No confirmation message, no reminder, no
--     WhatsApp template. The messaging layer exists and this does not call it.
--     "CONFIRMED" here means a human recorded that the customer agreed -- it
--     does not mean the customer was ever written to.
--   * It has NO capacity model. It does not know how many salespeople are on
--     shift, when the showroom opens, or that Friday afternoon is prayer time.
--     It will happily accept 03:00 on a Saturday if somebody types it.
--   * It does NOT create the customer. An appointment attaches to the
--     customer, lead and vehicle that already exist, by composite foreign key,
--     so a booking can never invent a parallel person or point at another
--     dealership's records. See ops/appointments/STATUS.md for the full list of
--     what is still missing.
--
-- THE STATE MACHINE CANNOT LIE. This is the point of the file. NX986 keeps
-- REGISTERED, CONNECTED and RECEIVING apart because a channel that is merely
-- registered is not working. The same discipline applies here, and it matters
-- more, because "booked appointments" is the number a dealer will judge us on:
--
--   REQUESTED  a customer asked. Nobody has offered them anything.
--   OFFERED    we proposed times. The customer has not agreed to any of them.
--   CONFIRMED  the customer agreed to one specific time. THIS, and only this,
--              is a booking.
--   ATTENDED   somebody recorded that they walked in.
--   NO_SHOW    somebody recorded that they did not.
--   CANCELLED  it is off.
--
-- Two lies are structurally impossible as a result. "Booked" cannot be shown
-- for an appointment nobody confirmed, because counts_as_booked is a column on
-- a lookup table and it is false for REQUESTED and OFFERED. And "attended"
-- cannot be inferred from the clock, because no code path moves CONFIRMED to
-- ATTENDED -- time passing produces is_overdue_for_outcome, which reads "the
-- slot has passed and nobody has said whether they turned up", not a number.
--
-- DOUBLE BOOKING IS REFUSED BY THE DATABASE, NOT BY THE CALLER. A unique
-- constraint on (salesperson, starts_at) would only catch two appointments
-- that begin on the same second; 14:00-14:45 and 14:30-15:15 would both be
-- accepted and one customer would be stood up. Overlap is a range question, so
-- the mechanism is an EXCLUDE USING gist over tstzrange with &&, partial on
-- state = 'CONFIRMED' -- proposing three overlapping slots to three customers
-- is normal and must stay legal; two people agreeing to the same salesperson
-- at the same time must not. It is a constraint rather than a check in the
-- write function because n8n and every receiver run as service_role, which
-- carries rolbypassrls, and a constraint is the only layer they cannot skip.

begin;

-- btree_gist gives gist the = operator for uuid and text, which the exclusion
-- constraint needs alongside the built-in range &&. Extensions live in
-- `extensions`, never public (NX931), and the opclasses below are qualified
-- explicitly so that nothing depends on search_path at DDL time.
create extension if not exists btree_gist with schema extensions;

-- ── Tenancy-enforcing keys on the three things a booking points at ────────
-- Additive unique constraints, no behaviour change on their own. They exist so
-- that appointment's foreign keys can carry tenant_id, which turns "an
-- appointment must not reference another dealership's customer" from a rule
-- somebody has to remember into a key the database refuses to violate.
do $mk$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'customer_tenant_id_key'
                    and conrelid = 'public.customer'::regclass) then
    alter table public.customer add constraint customer_tenant_id_key unique (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'leads_tenant_id_key'
                    and conrelid = 'public.leads'::regclass) then
    alter table public.leads add constraint leads_tenant_id_key unique (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'users_tenant_id_key'
                    and conrelid = 'public.users'::regclass) then
    alter table public.users add constraint users_tenant_id_key unique (tenant_id, id);
  end if;
end
$mk$;

-- ── The vocabulary ────────────────────────────────────────────────────────
-- A lookup, not data. Six words, each with the plain sentence it means, so
-- that a screen cannot decide for itself what "booked" covers.
create table if not exists public.appointment_state (
  state              text primary key,
  meaning            text not null,
  counts_as_booked   boolean not null,
  counts_as_attended boolean not null,
  is_terminal        boolean not null,
  sort_order         int not null
);

insert into public.appointment_state
  (state, meaning, counts_as_booked, counts_as_attended, is_terminal, sort_order) values
  ('REQUESTED', 'A customer asked to come in. No time has been proposed and nothing is in anyone''s diary.', false, false, false, 1),
  ('OFFERED',   'We proposed one or more times. The customer has not agreed to any of them yet.',           false, false, false, 2),
  ('CONFIRMED', 'The customer agreed to one specific time. This is the only state that is a booking.',      true,  false, false, 3),
  ('ATTENDED',  'A human recorded that the customer walked in. Never inferred from the clock.',             true,  true,  true,  4),
  ('NO_SHOW',   'A human recorded that the customer did not walk in.',                                      true,  false, true,  5),
  ('CANCELLED', 'Called off, by the customer or by the dealership. outcome_reason says which, in words.',   false, false, true,  6)
on conflict (state) do update
  set meaning            = excluded.meaning,
      counts_as_booked   = excluded.counts_as_booked,
      counts_as_attended = excluded.counts_as_attended,
      is_terminal        = excluded.is_terminal,
      sort_order         = excluded.sort_order;

comment on table public.appointment_state is
  'The six words a showroom visit can be in, each with the sentence it means. '
  'counts_as_booked is true for CONFIRMED, ATTENDED and NO_SHOW and false for '
  'REQUESTED and OFFERED -- so any screen that reports "booked appointments" '
  'reads this column instead of deciding for itself, and an appointment nobody '
  'agreed to can never be counted. A lookup: no tenant owns a row here. RLS is '
  'on with a stated read-all policy so that "RLS is off here" never has two '
  'readings in this schema.';
comment on column public.appointment_state.counts_as_attended is
  'True for ATTENDED alone. Nothing in NEXUS sets this state automatically; a '
  'confirmed appointment whose time has passed stays CONFIRMED until a human '
  'says what happened.';

alter table public.appointment_state enable row level security;
drop policy if exists appointment_state_readable_by_signed_in on public.appointment_state;
drop policy if exists appointment_state_deny_anon             on public.appointment_state;
drop policy if exists appointment_state_service_role_all      on public.appointment_state;
create policy appointment_state_readable_by_signed_in on public.appointment_state
  for select to authenticated using (true);
create policy appointment_state_deny_anon on public.appointment_state
  as restrictive for all to anon using (false) with check (false);
create policy appointment_state_service_role_all on public.appointment_state
  for all to service_role using (true) with check (true);

revoke all on public.appointment_state from public, anon;
grant select on public.appointment_state to authenticated;
grant all    on public.appointment_state to service_role;

-- ── The machine itself, as data ───────────────────────────────────────────
-- Every legal move, one row each. The write functions read this table rather
-- than carrying the rules in nine separate if-statements, so the refusal
-- message can quote the machine and the machine has exactly one definition.
create table if not exists public.appointment_transition (
  from_state text not null references public.appointment_state(state),
  to_state   text not null references public.appointment_state(state),
  verb       text not null,
  primary key (from_state, to_state)
);

insert into public.appointment_transition (from_state, to_state, verb) values
  ('REQUESTED', 'OFFERED',   'nexus_appointment_offer_slots'),
  ('REQUESTED', 'CONFIRMED', 'nexus_appointment_confirm'),
  ('REQUESTED', 'CANCELLED', 'nexus_appointment_cancel'),
  ('OFFERED',   'OFFERED',   'nexus_appointment_offer_slots'),
  ('OFFERED',   'CONFIRMED', 'nexus_appointment_confirm'),
  ('OFFERED',   'CANCELLED', 'nexus_appointment_cancel'),
  ('CONFIRMED', 'CONFIRMED', 'nexus_appointment_confirm'),
  ('CONFIRMED', 'ATTENDED',  'nexus_appointment_mark_attended'),
  ('CONFIRMED', 'NO_SHOW',   'nexus_appointment_mark_attended'),
  ('CONFIRMED', 'CANCELLED', 'nexus_appointment_cancel')
on conflict (from_state, to_state) do update set verb = excluded.verb;

comment on table public.appointment_transition is
  'Every move the appointment state machine allows, as data. ATTENDED, NO_SHOW '
  'and CANCELLED appear only as destinations: they are terminal, so a cancelled '
  'appointment cannot be confirmed back into existence and a no-show cannot be '
  'quietly upgraded to attended. CONFIRMED -> CONFIRMED is the reschedule, and '
  'it is a deliberate row rather than an accident.';

alter table public.appointment_transition enable row level security;
drop policy if exists appointment_transition_readable_by_signed_in on public.appointment_transition;
drop policy if exists appointment_transition_deny_anon             on public.appointment_transition;
drop policy if exists appointment_transition_service_role_all      on public.appointment_transition;
create policy appointment_transition_readable_by_signed_in on public.appointment_transition
  for select to authenticated using (true);
create policy appointment_transition_deny_anon on public.appointment_transition
  as restrictive for all to anon using (false) with check (false);
create policy appointment_transition_service_role_all on public.appointment_transition
  for all to service_role using (true) with check (true);

revoke all on public.appointment_transition from public, anon;
grant select on public.appointment_transition to authenticated;
grant all    on public.appointment_transition to service_role;

-- ── The appointment ───────────────────────────────────────────────────────
-- Times are timestamptz throughout and are STORED in UTC. Asia/Dubai is a
-- display convention, applied in the accessor's evidence line exactly as NX986
-- and NX990 do it, so that two dealerships in two emirates never disagree
-- about what "10:00" meant.
create table if not exists public.appointment (
  appointment_id   uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  customer_id      uuid not null,
  lead_id          integer,
  inventory_id     text,
  assigned_to_id   uuid,
  state            text not null references public.appointment_state(state),
  channel          text not null,
  starts_at        timestamptz,
  duration_minutes int not null default 45,
  ends_at          timestamptz,
  location         text,
  resource         text,
  offered_slots    timestamptz[] not null default '{}',
  confirmed_slot_was_offered boolean,
  requested_at     timestamptz not null default now(),
  offered_at       timestamptz,
  confirmed_at     timestamptz,
  closed_at        timestamptz,
  outcome_reason   text,
  booked_by        text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Tenancy as a key, not as a habit. Each of these four references carries
  -- tenant_id, so an appointment physically cannot point at another
  -- dealership's customer, lead, vehicle or salesperson.
  constraint appointment_customer_same_dealership
    foreign key (tenant_id, customer_id)    references public.customer(tenant_id, id)  on delete restrict,
  constraint appointment_lead_same_dealership
    foreign key (tenant_id, lead_id)        references public.leads(tenant_id, id)     on delete restrict,
  constraint appointment_vehicle_same_dealership
    foreign key (tenant_id, inventory_id)   references public.inventory(tenant_id, id) on delete restrict,
  constraint appointment_salesperson_same_dealership
    foreign key (tenant_id, assigned_to_id) references public.users(tenant_id, id)     on delete restrict,

  constraint appointment_channel_known check (channel in (
    'WHATSAPP','WEB_FORM','PHONE','WALK_IN','EMAIL','META_LEAD_AD','GOOGLE_LEAD_FORM','OTHER')),
  constraint appointment_duration_sane
    check (duration_minutes between 5 and 480),
  -- A booking with no time is not a booking.
  constraint appointment_timed_states_have_a_time
    check (state not in ('CONFIRMED','ATTENDED','NO_SHOW') or starts_at is not null),
  -- ...and it cannot claim the customer agreed without a moment of agreement.
  constraint appointment_booked_states_have_a_confirmation
    check (state not in ('CONFIRMED','ATTENDED','NO_SHOW') or confirmed_at is not null),
  -- OFFERED means slots were actually proposed, not that we meant to.
  constraint appointment_offered_has_slots
    check (state <> 'OFFERED' or cardinality(offered_slots) > 0),
  constraint appointment_offered_has_a_time_it_happened
    check (state <> 'OFFERED' or offered_at is not null),
  -- Terminal states are closed and non-terminal ones are not; no third option.
  constraint appointment_terminal_states_are_closed
    check ((state in ('ATTENDED','NO_SHOW','CANCELLED')) = (closed_at is not null)),
  constraint appointment_cancelled_has_reason
    check (state <> 'CANCELLED' or (outcome_reason is not null and length(trim(outcome_reason)) > 0)),
  -- ends_at is written by a trigger, never by a caller, so it cannot disagree
  -- with starts_at + duration. These two checks make a hand-written wrong value
  -- impossible rather than merely unlikely.
  constraint appointment_ends_at_exists_with_starts_at
    check ((starts_at is null) = (ends_at is null)),
  constraint appointment_ends_at_is_after_starts_at
    check (ends_at is null or ends_at > starts_at)
);

comment on table public.appointment is
  'One showroom visit, from the moment a customer asks to the moment somebody '
  'records whether they walked in. Attaches by composite foreign key to the '
  'customer, lead, vehicle and salesperson that already exist in the same '
  'dealership -- it never invents a parallel person. Readable by that '
  'dealership''s signed-in staff; writable only by service_role, through the '
  'five functions below. Nothing here is sent to anybody and nothing here '
  'reaches any calendar: see ops/appointments/STATUS.md.';
comment on column public.appointment.state is
  'One of the six words in appointment_state. Only CONFIRMED, ATTENDED and '
  'NO_SHOW count as booked, and a screen must read appointment_state rather '
  'than guess.';
comment on column public.appointment.starts_at is
  'Null until somebody confirms a time. A REQUESTED or OFFERED appointment has '
  'no time, and pretending otherwise by defaulting it to now() would put '
  'imaginary visits in today''s list.';
comment on column public.appointment.offered_slots is
  'The times we proposed, in order. Kept after confirmation so that '
  'confirmed_slot_was_offered can be checked rather than believed.';
comment on column public.appointment.confirmed_slot_was_offered is
  'Whether the confirmed time was one of the slots we had offered. False means '
  'the customer counter-proposed and a human accepted it -- legal, and worth '
  'being able to see.';
comment on column public.appointment.resource is
  'A named bookable thing that is not a person: a bay, a desk, a demo car slot. '
  'Used as the double-booking key when no salesperson is assigned.';
comment on column public.appointment.booked_by is
  'Who recorded this, as free text an operator or a workflow name writes. Not '
  'an auth user id: these writes arrive through service_role from n8n and by '
  'hand, and stamping a signed-in identity on them would be a fiction.';
comment on column public.appointment.ends_at is
  'Written by nexus_appointment_stamp_ends_at(), never by a caller: starts_at '
  'plus duration_minutes, recomputed on every insert and update. It is a stored '
  'column rather than a GENERATED one because timestamptz + interval is STABLE, '
  'not IMMUTABLE (it depends on the session time zone), and Postgres refuses '
  'both generated columns and index expressions built on it -- and the overlap '
  'constraint below has to be an index. The trigger buys back the guarantee the '
  'generated column would have given.';

create index if not exists appointment_tenant_starts_idx
  on public.appointment (tenant_id, starts_at);
create index if not exists appointment_tenant_state_idx
  on public.appointment (tenant_id, state);
create index if not exists appointment_customer_idx
  on public.appointment (tenant_id, customer_id);
create index if not exists appointment_lead_idx
  on public.appointment (tenant_id, lead_id) where lead_id is not null;

-- ── ends_at is stamped, not trusted ───────────────────────────────────────
create or replace function public.nexus_appointment_stamp_ends_at()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
begin
  new.ends_at := case when new.starts_at is null then null
                      else new.starts_at + make_interval(mins => new.duration_minutes) end;
  return new;
end
$fn$;

comment on function public.nexus_appointment_stamp_ends_at() is
  'Recomputes appointment.ends_at from starts_at and duration_minutes on every '
  'insert and update, overwriting whatever the caller passed. The overlap '
  'constraint indexes ends_at, so a caller-supplied wrong value would silently '
  'widen or shrink the slot that double-booking is checked against.';

revoke all on function public.nexus_appointment_stamp_ends_at() from public, anon, authenticated;

drop trigger if exists nexus_appointment_stamp_ends_at on public.appointment;
create trigger nexus_appointment_stamp_ends_at
  before insert or update on public.appointment
  for each row execute function public.nexus_appointment_stamp_ends_at();

-- ── Double booking, refused by the database ───────────────────────────────
-- Partial on CONFIRMED: offering the same 16:00 to three customers is normal
-- and stays legal. Two of them AGREEING to it with the same salesperson is
-- what gets refused. The opclasses are schema-qualified because btree_gist
-- lives in `extensions` (NX931) and this must not depend on search_path.
do $mk$
begin
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'appointment' and not t.tgisinternal
                    and t.tgname = 'nexus_appointment_stamp_ends_at') then
    raise exception 'NX995: ends_at is not being stamped, so the overlap window could be a lie. Rolling back.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'appointment_no_double_booking'
                    and conrelid = 'public.appointment'::regclass) then
    alter table public.appointment add constraint appointment_no_double_booking
      exclude using gist (
        tenant_id extensions.gist_uuid_ops with =,
        (coalesce(assigned_to_id::text, 'RESOURCE:' || resource)) extensions.gist_text_ops with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (state = 'CONFIRMED'
               and (assigned_to_id is not null or resource is not null));
  end if;
end
$mk$;

comment on constraint appointment_no_double_booking on public.appointment is
  'One salesperson (or one named resource) in one dealership cannot hold two '
  'CONFIRMED appointments whose time ranges overlap. An EXCLUDE over tstzrange '
  'rather than a UNIQUE on starts_at, because unique would accept 14:00-14:45 '
  'beside 14:30-15:15 and one of those customers would be stood up. KNOWN GAP: '
  'a confirmed appointment with neither a salesperson nor a resource is outside '
  'this constraint -- there is nothing to double-book it against.';

alter table public.appointment enable row level security;
drop policy if exists appointment_authenticated_read on public.appointment;
drop policy if exists appointment_deny_anon          on public.appointment;
drop policy if exists appointment_service_role_all   on public.appointment;

-- SELECT only, and only your own dealership. Deliberately not FOR ALL: a
-- browser must not be able to write itself a booking, and the absence of an
-- INSERT/UPDATE/DELETE policy is what stops it.
create policy appointment_authenticated_read on public.appointment
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy appointment_deny_anon on public.appointment
  as restrictive for all to anon using (false) with check (false);
create policy appointment_service_role_all on public.appointment
  for all to service_role using (true) with check (true);

revoke all    on public.appointment from public, anon, authenticated;
grant  select on public.appointment to authenticated;
grant  all    on public.appointment to service_role;

-- ── The history, append-only ──────────────────────────────────────────────
create table if not exists public.appointment_event (
  event_id       uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment(appointment_id) on delete restrict,
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  event_type     text not null,
  from_state     text,
  to_state       text,
  occurred_at    timestamptz not null default now(),
  actor          text,
  slots          timestamptz[],
  starts_at      timestamptz,
  reason         text,
  constraint appointment_event_type_known check (event_type in (
    'REQUESTED','SLOTS_OFFERED','CONFIRMED','RESCHEDULED','CANCELLED','ATTENDED','NO_SHOW'))
);

comment on table public.appointment_event is
  'Append-only history of every state change on every appointment, one row per '
  'change. Exists because appointment.state is overwritten by the next change '
  'and therefore can never answer "when did this become confirmed" -- the '
  'question asked the first time anybody argues about a no-show or measures '
  'how long a request sat before somebody offered a time. UPDATE is refused '
  'outright by a trigger; DELETE and TRUNCATE go through the NX900 '
  'destructive-write guard.';
comment on column public.appointment_event.slots is
  'The times proposed on a SLOTS_OFFERED event, so a later dispute can see what '
  'was actually offered rather than what the row says today.';

create index if not exists appointment_event_appt_time_idx
  on public.appointment_event (appointment_id, occurred_at);
create index if not exists appointment_event_tenant_time_idx
  on public.appointment_event (tenant_id, occurred_at desc);

create or replace function public.nexus_appointment_event_is_append_only()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
begin
  raise exception using errcode = 'P0001',
    message = 'NX995 APPEND_ONLY_REFUSED: appointment_event records what happened, so it cannot be edited into something else.',
    detail  = 'An UPDATE here would rewrite the answer to "when did this become confirmed".',
    hint    = 'Insert a correcting event instead. The wrong one stays, and that is the point.';
end
$fn$;

comment on function public.nexus_appointment_event_is_append_only() is
  'Refuses every UPDATE on appointment_event. No escape hatch, unlike the NX900 '
  'delete guard: a history you can quietly edit is not a history.';

revoke all on function public.nexus_appointment_event_is_append_only() from public, anon, authenticated;

drop trigger if exists nexus_appointment_event_refuse_update on public.appointment_event;
create trigger nexus_appointment_event_refuse_update
  before update on public.appointment_event
  for each row execute function public.nexus_appointment_event_is_append_only();

alter table public.appointment_event enable row level security;
drop policy if exists appointment_event_authenticated_read on public.appointment_event;
drop policy if exists appointment_event_deny_anon          on public.appointment_event;
drop policy if exists appointment_event_service_role_all   on public.appointment_event;

create policy appointment_event_authenticated_read on public.appointment_event
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy appointment_event_deny_anon on public.appointment_event
  as restrictive for all to anon using (false) with check (false);
create policy appointment_event_service_role_all on public.appointment_event
  for all to service_role using (true) with check (true);

revoke all    on public.appointment_event from public, anon, authenticated;
grant  select on public.appointment_event to authenticated;
grant  all    on public.appointment_event to service_role;

-- ── The destructive-write guard (NX900 / NX950 / NX984 / NX990) ───────────
-- n8n and every receiver run as service_role, which carries rolbypassrls, so
-- RLS is never consulted for them and this guard is the only thing between a
-- service-role mistake and every booking in the diary.
drop trigger if exists nexus_appointment_refuse_delete   on public.appointment;
drop trigger if exists nexus_appointment_refuse_truncate on public.appointment;
create trigger nexus_appointment_refuse_delete
  before delete on public.appointment
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_appointment_refuse_truncate
  before truncate on public.appointment
  for each statement execute function public.nexus_refuse_destructive_write();

drop trigger if exists nexus_appointment_event_refuse_delete   on public.appointment_event;
drop trigger if exists nexus_appointment_event_refuse_truncate on public.appointment_event;
create trigger nexus_appointment_event_refuse_delete
  before delete on public.appointment_event
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_appointment_event_refuse_truncate
  before truncate on public.appointment_event
  for each statement execute function public.nexus_refuse_destructive_write();

-- ── The read path ─────────────────────────────────────────────────────────
-- Shaped exactly like nexus_channel_status() and nexus_subscription_status():
-- scoped by nexus_current_tenant_ids(), returns NOTHING when the caller has no
-- membership, and never falls back to a default dealership.
create or replace function public.nexus_appointment_status(p_days int default 7)
returns table (
  appointment_id         uuid,
  tenant_id              uuid,
  tenant_name            text,
  state                  text,
  state_meaning          text,
  counts_as_booked       boolean,
  counts_as_attended     boolean,
  customer_id            uuid,
  customer_name          text,
  lead_id                integer,
  inventory_id           text,
  vehicle_model          text,
  assigned_to_id         uuid,
  assigned_to_name       text,
  channel                text,
  starts_at              timestamptz,
  ends_at                timestamptz,
  starts_at_dubai        text,
  location               text,
  resource               text,
  offered_slots          timestamptz[],
  requested_at           timestamptz,
  confirmed_at           timestamptz,
  closed_at              timestamptz,
  awaiting_outcome       boolean,
  slot_is_protected      boolean,
  evidence               text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare v_tenants uuid[];
        v_days    int := greatest(1, least(coalesce(p_days, 7), 90));
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    -- No membership, no answer. Never a default dealership: a screen that
    -- silently shows somebody else's customers standing in somebody else's
    -- showroom is the worst failure this product has.
    return;
  end if;

  return query
  select
    a.appointment_id,
    a.tenant_id,
    t.name,
    a.state,
    k.meaning,
    k.counts_as_booked,
    k.counts_as_attended,
    a.customer_id,
    c.display_name,
    a.lead_id,
    a.inventory_id,
    i.model,
    a.assigned_to_id,
    u.name,
    a.channel,
    a.starts_at,
    a.ends_at,
    case when a.starts_at is null then null
         else to_char(a.starts_at at time zone 'Asia/Dubai', 'Dy DD Mon YYYY HH24:MI') || ' Dubai' end,
    a.location,
    a.resource,
    a.offered_slots,
    a.requested_at,
    a.confirmed_at,
    a.closed_at,
    -- The slot has passed and no human has said what happened. This is the
    -- ONLY thing the clock is allowed to produce. It is never attendance.
    (a.state = 'CONFIRMED' and a.ends_at is not null and a.ends_at < now()),
    (a.state <> 'CONFIRMED' or a.assigned_to_id is not null or a.resource is not null),
    case
      when a.state = 'REQUESTED' then
        'A customer asked to come in on ' ||
        to_char(a.requested_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') ||
        ' Dubai via ' || a.channel ||
        '. No time has been offered, nothing is in anyone''s diary, and this is NOT a booking.'
      when a.state = 'OFFERED' then
        cardinality(a.offered_slots) || ' time(s) were offered on ' ||
        to_char(a.offered_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') ||
        ' Dubai. The customer has not agreed to any of them, so this is NOT a booking.'
      when a.state = 'CONFIRMED' and a.ends_at < now() then
        'The slot at ' || to_char(a.starts_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') ||
        ' Dubai has passed and nobody has recorded whether they turned up. NEXUS ' ||
        'does not decide that from the clock -- a human calls it ATTENDED or NO_SHOW.'
      when a.state = 'CONFIRMED' then
        'Booked for ' || to_char(a.starts_at at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI') ||
        ' Dubai (' || a.duration_minutes || ' min' ||
        coalesce(' with ' || u.name, ', no salesperson assigned') ||
        coalesce(' at ' || a.location, '') || '). The customer agreed on ' ||
        to_char(a.confirmed_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') || ' Dubai' ||
        case when a.confirmed_slot_was_offered is false
             then ', to a time they proposed themselves rather than one we offered' else '' end ||
        '. NEXUS has sent them nothing about it and it is in no calendar.'
      when a.state = 'ATTENDED' then
        'Walked in. Recorded by a human on ' ||
        to_char(a.closed_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') || ' Dubai' ||
        coalesce(' -- ' || a.outcome_reason, '') || '.'
      when a.state = 'NO_SHOW' then
        'Did not walk in. Recorded by a human on ' ||
        to_char(a.closed_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') || ' Dubai' ||
        coalesce(' -- ' || a.outcome_reason, '') || '.'
      when a.state = 'CANCELLED' then
        'Cancelled on ' || to_char(a.closed_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI') ||
        ' Dubai -- ' || a.outcome_reason || '.'
      else 'Unrecognised state ' || a.state || '.'
    end ||
    case when a.state = 'CONFIRMED' and a.assigned_to_id is null and a.resource is null
         then ' No salesperson or resource is attached, so nothing stops this slot being double-booked.'
         else '' end
  from public.appointment a
  join public.tenants t on t.id = a.tenant_id
  join public.appointment_state k on k.state = a.state
  left join public.customer  c on c.tenant_id = a.tenant_id and c.id = a.customer_id
  left join public.inventory i on i.tenant_id = a.tenant_id and i.id = a.inventory_id
  left join public.users     u on u.tenant_id = a.tenant_id and u.id = a.assigned_to_id
  where a.tenant_id = any(v_tenants)
    and (
      -- the window the caller asked for
      (a.starts_at is not null
       and a.starts_at >= now() - interval '1 day'
       and a.starts_at <  now() + make_interval(days => v_days))
      -- anything still waiting on us, whenever it was asked for
      or a.state in ('REQUESTED','OFFERED')
      -- anything confirmed whose slot has passed with no outcome recorded,
      -- however old: these are the ones that quietly rot into a fake number.
      or (a.state = 'CONFIRMED' and a.ends_at < now())
    )
  order by coalesce(a.starts_at, a.requested_at);
end
$fn$;

comment on function public.nexus_appointment_status(int) is
  'The caller''s own dealership''s showroom visits: everything starting inside '
  'the next p_days (7 by default), everything still awaiting an offer or an '
  'answer, and every confirmed slot that has passed without a recorded '
  'outcome. Returns no rows at all for a caller with no membership -- never a '
  'default dealership. Each row carries an evidence line that says in words '
  'what state it is in and, for anything not CONFIRMED, says outright that it '
  'is not a booking. awaiting_outcome is the only thing the clock produces; '
  'attendance is never inferred.';

revoke all on function public.nexus_appointment_status(int) from public, anon;
grant execute on function public.nexus_appointment_status(int) to authenticated, service_role;

-- ── The write path: service_role only, five verbs ─────────────────────────
-- Never anon, never authenticated. A dealership's browser must not be able to
-- confirm its own bookings or mark its own attendance; those numbers decide
-- whether the product is working.

create or replace function public.nexus_appointment_request(
  p_tenant_id    uuid,
  p_customer_id  uuid,
  p_channel      text,
  p_lead_id      integer default null,
  p_inventory_id text    default null,
  p_notes        text    default null,
  p_actor        text    default null
) returns table (appointment_id uuid, state text, requested_at timestamptz, action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_t    record;
  v_now  timestamptz := now();
  v_id   uuid;
begin
  select id, name, status, is_quarantine into v_t
    from public.tenants where id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: no dealership with that id, so this visit belongs to nobody.';
  end if;
  if v_t.is_quarantine then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: that is the unattributed quarantine tenant, not a dealership. It has no showroom to visit.';
  end if;
  if v_t.status <> 'active' then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: dealership %L is %s, not active.', v_t.name, v_t.status);
  end if;

  if not exists (select 1 from public.customer c
                  where c.id = p_customer_id and c.tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: customer %s does not exist in dealership %L. An appointment attaches to a customer who already exists; it does not create one.', p_customer_id, v_t.name);
  end if;
  if p_lead_id is not null and not exists (select 1 from public.leads l
                  where l.id = p_lead_id and l.tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: lead %s does not belong to dealership %L.', p_lead_id, v_t.name);
  end if;
  if p_inventory_id is not null and not exists (select 1 from public.inventory i
                  where i.id = p_inventory_id and i.tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: vehicle %L is not in dealership %L''s stock.', p_inventory_id, v_t.name);
  end if;

  insert into public.appointment
    (tenant_id, customer_id, lead_id, inventory_id, state, channel,
     requested_at, notes, booked_by, created_at, updated_at)
  values (p_tenant_id, p_customer_id, p_lead_id, p_inventory_id, 'REQUESTED', p_channel,
          v_now, p_notes, p_actor, v_now, v_now)
  returning appointment.appointment_id into v_id;

  insert into public.appointment_event
    (appointment_id, tenant_id, event_type, from_state, to_state, occurred_at, actor, reason)
  values (v_id, p_tenant_id, 'REQUESTED', null, 'REQUESTED', v_now, p_actor,
          'Customer asked to visit via ' || p_channel || '. No time offered yet.');

  appointment_id := v_id;
  state          := 'REQUESTED';
  requested_at   := v_now;
  action         := 'REQUESTED';
  return next;
end
$fn$;

comment on function public.nexus_appointment_request(uuid, uuid, text, integer, text, text, text) is
  'Records that a customer asked to come in. Creates a REQUESTED appointment '
  'and nothing else: no time, no diary entry, no message. Refuses the '
  'quarantine tenant and refuses a customer, lead or vehicle belonging to any '
  'other dealership. service_role only.';

create or replace function public.nexus_appointment_offer_slots(
  p_appointment_id uuid,
  p_slots          timestamptz[],
  p_actor          text default null
) returns table (appointment_id uuid, state text, offered_slots timestamptz[], action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_a    record;
  v_now  timestamptz := now();
begin
  select a.* into v_a from public.appointment a where a.appointment_id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: no appointment with that id.';
  end if;

  if p_slots is null or cardinality(p_slots) = 0 then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: OFFERED means times were actually proposed. An empty slot list is not an offer.';
  end if;
  if cardinality(p_slots) > 6 then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: %s slots is not an offer, it is a calendar dump. Offer at most 6.', cardinality(p_slots));
  end if;
  if exists (select 1 from unnest(p_slots) s where s <= v_now) then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: one of those slots is in the past. A customer cannot agree to a time that has already gone.';
  end if;

  if not exists (select 1 from public.appointment_transition tr
                  where tr.from_state = v_a.state and tr.to_state = 'OFFERED') then
    raise exception using errcode = 'P0001',
      message = format('NX995 TRANSITION_REFUSED: appointment %s is %s, and %s -> OFFERED is not a move this machine allows.',
                       p_appointment_id, v_a.state, v_a.state),
      detail  = (select k.meaning from public.appointment_state k where k.state = v_a.state),
      hint    = coalesce((select 'Legal moves from ' || v_a.state || ': ' || string_agg(tr.to_state, ', ' order by tr.to_state)
                            from public.appointment_transition tr where tr.from_state = v_a.state),
                         v_a.state || ' is terminal. Nothing follows it.');
  end if;

  update public.appointment a
     set state         = 'OFFERED',
         offered_slots = p_slots,
         offered_at    = v_now,
         booked_by     = coalesce(p_actor, a.booked_by),
         updated_at    = v_now
   where a.appointment_id = p_appointment_id;

  insert into public.appointment_event
    (appointment_id, tenant_id, event_type, from_state, to_state, occurred_at, actor, slots, reason)
  values (p_appointment_id, v_a.tenant_id, 'SLOTS_OFFERED', v_a.state, 'OFFERED', v_now, p_actor,
          p_slots, cardinality(p_slots) || ' slot(s) proposed. The customer has not agreed to any of them.');

  appointment_id := p_appointment_id;
  state          := 'OFFERED';
  offered_slots  := p_slots;
  action         := 'SLOTS_OFFERED';
  return next;
end
$fn$;

comment on function public.nexus_appointment_offer_slots(uuid, timestamptz[], text) is
  'Records the times we proposed. Does NOT send them to the customer -- nothing '
  'in NEXUS does that yet. OFFERED is not a booking and the accessor says so in '
  'words. service_role only.';

create or replace function public.nexus_appointment_confirm(
  p_appointment_id   uuid,
  p_starts_at        timestamptz,
  p_duration_minutes int     default 45,
  p_assigned_to_id   uuid    default null,
  p_location         text    default null,
  p_resource         text    default null,
  p_actor            text    default null
) returns table (appointment_id uuid, state text, starts_at timestamptz, ends_at timestamptz,
                 confirmed_slot_was_offered boolean, action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_a       record;
  v_now     timestamptz := now();
  v_ends    timestamptz;
  v_offered boolean;
  v_clash   record;
  v_who     text;
begin
  select a.* into v_a from public.appointment a where a.appointment_id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: no appointment with that id.';
  end if;

  if not exists (select 1 from public.appointment_transition tr
                  where tr.from_state = v_a.state and tr.to_state = 'CONFIRMED') then
    raise exception using errcode = 'P0001',
      message = format('NX995 TRANSITION_REFUSED: appointment %s is %s, and %s -> CONFIRMED is not a move this machine allows.',
                       p_appointment_id, v_a.state, v_a.state),
      detail  = (select k.meaning from public.appointment_state k where k.state = v_a.state),
      hint    = coalesce((select 'Legal moves from ' || v_a.state || ': ' || string_agg(tr.to_state, ', ' order by tr.to_state)
                            from public.appointment_transition tr where tr.from_state = v_a.state),
                         v_a.state || ' is terminal. Nothing follows it.');
  end if;

  if p_starts_at is null then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: a confirmation needs the one specific time the customer agreed to.';
  end if;
  if p_starts_at <= v_now then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: %s Dubai is in the past. Confirming a visit that has already happened would put a booking in today''s count that nobody can attend.',
                       to_char(p_starts_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI'));
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 480 then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: a showroom visit lasts between 5 and 480 minutes.';
  end if;
  if p_assigned_to_id is not null and not exists (
       select 1 from public.users u where u.id = p_assigned_to_id and u.tenant_id = v_a.tenant_id) then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: salesperson %s does not work at this dealership.', p_assigned_to_id);
  end if;

  v_ends    := p_starts_at + make_interval(mins => p_duration_minutes);
  v_offered := (v_a.offered_slots is not null and p_starts_at = any(v_a.offered_slots));

  begin
    update public.appointment a
       set state                      = 'CONFIRMED',
           starts_at                  = p_starts_at,
           duration_minutes           = p_duration_minutes,
           assigned_to_id             = coalesce(p_assigned_to_id, a.assigned_to_id),
           location                   = coalesce(p_location, a.location),
           resource                   = coalesce(p_resource, a.resource),
           confirmed_at               = coalesce(a.confirmed_at, v_now),
           confirmed_slot_was_offered = v_offered,
           booked_by                  = coalesce(p_actor, a.booked_by),
           updated_at                 = v_now
     where a.appointment_id = p_appointment_id;
  exception when exclusion_violation then
    -- The database refused it, not this function. Translate the constraint
    -- into the sentence the person on the floor needs.
    select a2.appointment_id as aid, a2.starts_at as s, a2.ends_at as e, c2.display_name as who
      into v_clash
      from public.appointment a2
      left join public.customer c2 on c2.tenant_id = a2.tenant_id and c2.id = a2.customer_id
     where a2.tenant_id = v_a.tenant_id
       and a2.state = 'CONFIRMED'
       and a2.appointment_id <> p_appointment_id
       and coalesce(a2.assigned_to_id::text, 'RESOURCE:' || a2.resource)
         = coalesce(coalesce(p_assigned_to_id, v_a.assigned_to_id)::text,
                    'RESOURCE:' || coalesce(p_resource, v_a.resource))
       and tstzrange(a2.starts_at, a2.ends_at, '[)')
        && tstzrange(p_starts_at, v_ends, '[)')
     limit 1;

    v_who := coalesce((select u.name from public.users u
                        where u.id = coalesce(p_assigned_to_id, v_a.assigned_to_id)),
                      'resource ' || coalesce(p_resource, v_a.resource));

    raise exception using errcode = 'P0001',
      message = format('NX995 DOUBLE_BOOKING_REFUSED: %s already has a confirmed appointment from %s to %s Dubai, which overlaps %s to %s Dubai.',
                       v_who,
                       to_char(v_clash.s at time zone 'Asia/Dubai', 'DD Mon HH24:MI'),
                       to_char(v_clash.e at time zone 'Asia/Dubai', 'HH24:MI'),
                       to_char(p_starts_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI'),
                       to_char(v_ends at time zone 'Asia/Dubai', 'HH24:MI')),
      detail  = format('The clashing appointment is %s (%s). Refused by the exclusion constraint appointment_no_double_booking, not by this function.',
                       v_clash.aid, coalesce(v_clash.who, 'customer name not recorded')),
      hint    = 'Offer a different time, a different salesperson, or a different bay.';
  end;

  insert into public.appointment_event
    (appointment_id, tenant_id, event_type, from_state, to_state, occurred_at, actor, starts_at, reason)
  values (p_appointment_id, v_a.tenant_id,
          case when v_a.state = 'CONFIRMED' then 'RESCHEDULED' else 'CONFIRMED' end,
          v_a.state, 'CONFIRMED', v_now, p_actor, p_starts_at,
          case when v_offered then 'Customer agreed to a time we had offered.'
               else 'Customer agreed to a time that was not among the slots we offered.' end);

  appointment_id             := p_appointment_id;
  state                      := 'CONFIRMED';
  starts_at                  := p_starts_at;
  ends_at                    := v_ends;
  confirmed_slot_was_offered := v_offered;
  action                     := case when v_a.state = 'CONFIRMED' then 'RESCHEDULED' else 'CONFIRMED' end;
  return next;
end
$fn$;

comment on function public.nexus_appointment_confirm(uuid, timestamptz, int, uuid, text, text, text) is
  'Records that the customer agreed to one specific time. This is the only '
  'function in NEXUS that produces a booking. Refuses a past time, an illegal '
  'transition, a salesperson from another dealership, and any slot that '
  'overlaps an existing confirmed appointment for the same salesperson or '
  'resource -- that last refusal comes from the exclusion constraint, which '
  'service_role cannot bypass. Sends the customer nothing. service_role only.';

create or replace function public.nexus_appointment_cancel(
  p_appointment_id uuid,
  p_reason         text,
  p_actor          text default null
) returns table (appointment_id uuid, state text, closed_at timestamptz, action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_a   record;
  v_now timestamptz := now();
begin
  select a.* into v_a from public.appointment a where a.appointment_id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: no appointment with that id.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: a cancellation without a reason tells the next person nothing. Say who called it off and why.';
  end if;

  if not exists (select 1 from public.appointment_transition tr
                  where tr.from_state = v_a.state and tr.to_state = 'CANCELLED') then
    raise exception using errcode = 'P0001',
      message = format('NX995 TRANSITION_REFUSED: appointment %s is %s, and %s -> CANCELLED is not a move this machine allows.',
                       p_appointment_id, v_a.state, v_a.state),
      detail  = (select k.meaning from public.appointment_state k where k.state = v_a.state),
      hint    = coalesce((select 'Legal moves from ' || v_a.state || ': ' || string_agg(tr.to_state, ', ' order by tr.to_state)
                            from public.appointment_transition tr where tr.from_state = v_a.state),
                         v_a.state || ' is terminal. Nothing follows it.');
  end if;

  update public.appointment a
     set state          = 'CANCELLED',
         closed_at      = v_now,
         outcome_reason = p_reason,
         updated_at     = v_now
   where a.appointment_id = p_appointment_id;

  insert into public.appointment_event
    (appointment_id, tenant_id, event_type, from_state, to_state, occurred_at, actor, reason)
  values (p_appointment_id, v_a.tenant_id, 'CANCELLED', v_a.state, 'CANCELLED', v_now, p_actor, p_reason);

  appointment_id := p_appointment_id;
  state          := 'CANCELLED';
  closed_at      := v_now;
  action         := 'CANCELLED';
  return next;
end
$fn$;

comment on function public.nexus_appointment_cancel(uuid, text, text) is
  'Calls a visit off and records why, in words. Refuses a blank reason and '
  'refuses to cancel anything already terminal. Tells the customer nothing. '
  'service_role only.';

create or replace function public.nexus_appointment_mark_attended(
  p_appointment_id uuid,
  p_attended       boolean,
  p_actor          text default null,
  p_reason         text default null
) returns table (appointment_id uuid, state text, closed_at timestamptz, action text)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_a   record;
  v_now timestamptz := now();
  v_to  text;
begin
  select a.* into v_a from public.appointment a where a.appointment_id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: no appointment with that id.';
  end if;
  if p_attended is null then
    raise exception using errcode = 'P0001',
      message = 'NX995 REFUSED: did they walk in, yes or no? An unanswered outcome must stay CONFIRMED and visible.';
  end if;

  v_to := case when p_attended then 'ATTENDED' else 'NO_SHOW' end;

  if not exists (select 1 from public.appointment_transition tr
                  where tr.from_state = v_a.state and tr.to_state = v_to) then
    raise exception using errcode = 'P0001',
      message = format('NX995 TRANSITION_REFUSED: appointment %s is %s, and %s -> %s is not a move this machine allows.',
                       p_appointment_id, v_a.state, v_a.state, v_to),
      detail  = (select k.meaning from public.appointment_state k where k.state = v_a.state),
      hint    = coalesce((select 'Legal moves from ' || v_a.state || ': ' || string_agg(tr.to_state, ', ' order by tr.to_state)
                            from public.appointment_transition tr where tr.from_state = v_a.state),
                         v_a.state || ' is terminal. Nothing follows it.');
  end if;

  -- An outcome is a human observation, so it cannot be recorded before there
  -- is anything to observe. The clock never fills this in by itself.
  if v_a.starts_at > v_now then
    raise exception using errcode = 'P0001',
      message = format('NX995 REFUSED: that appointment starts at %s Dubai and has not happened yet. Attendance is something a person sees, not something a date implies.',
                       to_char(v_a.starts_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI'));
  end if;

  update public.appointment a
     set state          = v_to,
         closed_at      = v_now,
         outcome_reason = p_reason,
         updated_at     = v_now
   where a.appointment_id = p_appointment_id;

  insert into public.appointment_event
    (appointment_id, tenant_id, event_type, from_state, to_state, occurred_at, actor, reason)
  values (p_appointment_id, v_a.tenant_id, v_to, v_a.state, v_to, v_now, p_actor,
          coalesce(p_reason, case when p_attended then 'Recorded as walked in by a human.'
                                  else 'Recorded as did not walk in by a human.' end));

  appointment_id := p_appointment_id;
  state          := v_to;
  closed_at      := v_now;
  action         := v_to;
  return next;
end
$fn$;

comment on function public.nexus_appointment_mark_attended(uuid, boolean, text, text) is
  'Records what a human saw: the customer walked in, or did not. Refuses any '
  'appointment that has not started yet, and refuses anything not CONFIRMED. '
  'Nothing else in NEXUS writes these two states, so an attendance number can '
  'only ever come from somebody having looked. service_role only.';

revoke all on function public.nexus_appointment_request(uuid, uuid, text, integer, text, text, text)      from public, anon, authenticated;
revoke all on function public.nexus_appointment_offer_slots(uuid, timestamptz[], text)                    from public, anon, authenticated;
revoke all on function public.nexus_appointment_confirm(uuid, timestamptz, int, uuid, text, text, text)   from public, anon, authenticated;
revoke all on function public.nexus_appointment_cancel(uuid, text, text)                                  from public, anon, authenticated;
revoke all on function public.nexus_appointment_mark_attended(uuid, boolean, text, text)                  from public, anon, authenticated;
grant execute on function public.nexus_appointment_request(uuid, uuid, text, integer, text, text, text)    to service_role;
grant execute on function public.nexus_appointment_offer_slots(uuid, timestamptz[], text)                  to service_role;
grant execute on function public.nexus_appointment_confirm(uuid, timestamptz, int, uuid, text, text, text) to service_role;
grant execute on function public.nexus_appointment_cancel(uuid, text, text)                                to service_role;
grant execute on function public.nexus_appointment_mark_attended(uuid, boolean, text, text)                to service_role;

-- ── Verify, or roll the whole thing back ──────────────────────────────────
do $verify$
declare n int;
begin
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('appointment','appointment_event','appointment_state','appointment_transition')
     and c.relrowsecurity;
  if n <> 4 then
    raise exception 'NX995: expected RLS enabled on 4 tables, found %. Rolling back.', n;
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('appointment','appointment_event','appointment_state','appointment_transition')
     and grantee in ('anon','PUBLIC');
  if n <> 0 then
    raise exception 'NX995: anon or PUBLIC holds % grant(s) on the appointment tables. Rolling back.', n;
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('appointment','appointment_event')
     and grantee = 'authenticated'
     and privilege_type <> 'SELECT';
  if n <> 0 then
    raise exception 'NX995: authenticated holds % non-SELECT grant(s). A browser could book itself an appointment. Rolling back.', n;
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where ns.nspname = 'public' and not t.tgisinternal
     and p.proname = 'nexus_refuse_destructive_write'
     and c.relname in ('appointment','appointment_event');
  if n <> 4 then
    raise exception 'NX995: expected 4 destructive-write guard triggers on the two new tables, found %. Rolling back.', n;
  end if;

  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'appointment' and not t.tgisinternal
                    and t.tgname = 'nexus_appointment_stamp_ends_at') then
    raise exception 'NX995: ends_at is not being stamped, so the overlap window could be a lie. Rolling back.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'appointment_no_double_booking'
                    and conrelid = 'public.appointment'::regclass
                    and contype = 'x') then
    raise exception 'NX995: the double-booking exclusion constraint is not there. Rolling back.';
  end if;

  -- All four references must carry tenant_id, or an appointment could point at
  -- another dealership's customer.
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.appointment'::regclass and contype = 'f'
     and conname in ('appointment_customer_same_dealership','appointment_lead_same_dealership',
                     'appointment_vehicle_same_dealership','appointment_salesperson_same_dealership');
  if n <> 4 then
    raise exception 'NX995: expected 4 tenant-carrying foreign keys, found %. Rolling back.', n;
  end if;

  if has_function_privilege('authenticated', 'public.nexus_appointment_confirm(uuid,timestamptz,int,uuid,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.nexus_appointment_request(uuid,uuid,text,integer,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_appointment_mark_attended(uuid,boolean,text,text)', 'execute')
  then
    raise exception 'NX995: a browser role can execute the appointment write path. Rolling back.';
  end if;

  raise notice 'NX995: NEXUS can now hold a booking. 4 tables, 1 read accessor, 5 write verbs, 4 guard triggers, 1 overlap exclusion, append-only history. Nothing is sent and nothing reaches a calendar -- see ops/appointments/STATUS.md.';
end
$verify$;

commit;
