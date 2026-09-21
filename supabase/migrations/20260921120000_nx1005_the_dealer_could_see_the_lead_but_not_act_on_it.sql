-- NX1005 — The dealer could see the lead but not act on it.
--
-- Three read-only gaps, one migration, all closed the same way: a browser
-- cannot reach a service_role-only verb, so signed-in staff could SEE the
-- state (a FAILED score, a service_role-only appointment table, a stranded
-- lead) but had no door back into the machine that moves it forward. Every
-- function below is that door -- SECURITY DEFINER, EXECUTE granted to
-- `authenticated` alone, and every one of them takes the dealership from
-- `nexus_current_tenant_ids()` rather than from an argument, following the
-- exact shape `nexus_lead_record_manual` (7 Sep 2026) already proved: refuse
-- with no active dealership, refuse (not guess) when the account is in more
-- than one, and verify every id the caller supplies actually belongs to the
-- dealership so derived, not to whichever id was typed.
--
-- ===========================================================================
-- PART 1 -- A FAILED score is not a dead end
-- ===========================================================================
-- `leads.scoring_state` has been PENDING / SCORED / FAILED since the scoring
-- pipeline landed, and `dCRmzWHCz7bniIBr` sweeps PENDING leads every hour.
-- A lead that exhausts its attempts sits at FAILED forever -- nothing ever
-- rescores it, and until this migration nothing signed-in could either.
-- `nexus_my_lead_retry_scoring` resets exactly that: a FAILED lead of the
-- caller's own dealership goes back to PENDING with a fresh attempt budget
-- (scoring_attempts = 0, scoring_last_error cleared), so the next hourly
-- sweep picks it up rather than immediately re-failing on an exhausted
-- counter. It touches nothing else on the row -- not status, not ai_score --
-- because a retry is a request to look again, not a claim about what the
-- next look will find.
--
-- ===========================================================================
-- PART 2 -- NX995's appointment verbs get a dealer-facing door
-- ===========================================================================
-- screens/appointments.js has said since it was written that "no workflow in
-- production calls" nexus_appointment_request / offer_slots / confirm /
-- mark_attended / cancel, because all five were granted to service_role
-- alone. Six wrappers close that: request, offer, confirm, attend, no-show
-- and cancel (attend and no-show are the same underlying verb,
-- nexus_appointment_mark_attended, split into two one-argument doors because
-- that is the shape a button on a screen needs -- "did they show up, yes or
-- no" is not a parameter a rep should be typing).
--
-- Every wrapper re-derives the tenant from the JWT and then checks the
-- APPOINTMENT ROW ITSELF carries that tenant_id before doing anything to it
-- -- not merely that *a* row with that id exists. `nexus_my_appointment_request`
-- makes the same check on the LEAD before it will attach a visit to it.
-- Everything past that point -- the six-state machine, the double-booking
-- exclusion constraint, the "did the customer actually agree to an offered
-- slot" bookkeeping -- is unchanged: these wrappers call NX995's own verbs and
-- hand back exactly what those verbs return, including their refusals
-- verbatim (a caller who tries CONFIRMED -> CONFIRMED with a clashing salesperson
-- still gets NX995's own DOUBLE_BOOKING_REFUSED sentence, not a paraphrase of it).
--
-- nexus_appointment_request needs a `customer_id`, and this dashboard's
-- screens have never had a "customer" concept independent of a lead -- a
-- salesperson books a visit for a LEAD. `nexus_my_appointment_request`
-- therefore resolves (or creates, first-seen-here) the `customer` row itself,
-- keyed on the lead's phone digits where the lead has a real one and falling
-- back to its email only when that column actually looks like an address --
-- `leads.email` holds a router-synthesised `+digits@whatsapp.lead` key on
-- some rows (see screens/leads.js's KEY_SHAPE note), and writing that into
-- `customer.email` as though it were somewhere a person could be reached
-- would be the exact fault that file was rewritten to stop making. A lead
-- with neither is refused rather than attached to a placeholder customer.
--
-- ===========================================================================
-- PART 3 -- NX996 is deliberately NOT wrapped here, and that is a finding
-- ===========================================================================
-- The task this migration was written against asked for a dealer-facing
-- notifications screen over "the NX996 notification outbox ... for the
-- caller's tenant." Reading NX996 (20260918120000) before writing anything
-- shows that request cannot be honoured without opening a door this codebase
-- closed on purpose, in writing, twice:
--
--   * `nexus_sales_lead` (NX974) carries NO tenant_id at all. Its own
--     migration says so in capitals: "NEXUS's own vendor pipeline and sits
--     outside the tenant model on purpose. A dealership owner enquiring
--     about buying NEXUS is a prospect for the vendor and is never a car
--     buyer belonging to a dealership." It is the marketing site's own lead
--     form -- prospective DEALERSHIPS asking to buy NEXUS OS -- not a
--     dealership's own customer data.
--   * `nexus_notification_outbox`, built on top of it, restates the same
--     boundary as a restrictive RLS policy:
--     `nexus_notification_outbox_never_end_users ... using (false)`, with
--     the comment "a dealership's signed-in staff have no business reading
--     the vendor's pipeline ... restrictive, so nothing can re-open it later
--     by accident." Every one of NX996's own verbs
--     (nexus_notification_acknowledge / claim / enqueue / mark_failed /
--     mark_sent / status) is granted to service_role and postgres only, with
--     nothing granted to authenticated anywhere in that migration.
--
-- There is no dealership-scoped reading of that boundary: the table has no
-- tenant column to scope BY, and the one tenant this deployment actually
-- serves (ALBA CARS) is not who the data is even about. Building an
-- `authenticated`-facing "for the caller's tenant" wrapper here would not be
-- a narrower version of what NX996 already refuses -- it would be exactly the
-- hole nexus_notification_outbox_never_end_users exists to keep closed,
-- re-opened by a different migration number. So PART 3 is a documented
-- refusal rather than code: no screens/notifications.js, no wrapper RPCs
-- over nexus_notification_outbox or nexus_sales_lead in this migration.
-- If a dealership-facing notification queue is wanted, NX996's own
-- migration already names the right shape for it: "a deliberate new table
-- with its own tenancy and its own RLS -- not a quiet ALTER that starts
-- mixing vendor prospects into a customer's data."
--
-- ===========================================================================
-- ON THE READ-ONLY SUBSCRIPTION GATE
-- ===========================================================================
-- `public.nexus_my_subscription()` does not exist in this database as of this
-- migration (checked live: zero rows in information_schema.routines for that
-- name). It is a different piece of work landing on a different branch. This
-- migration therefore cannot call it, cannot inspect a return shape that does
-- not exist yet, and does not attempt to guess one -- a SQL function guarded
-- against a composite type it cannot see would either fail to compile or
-- silently no-op, and neither is better than the honest gap this leaves. The
-- dashboard's read-only guard for these actions is implemented at the
-- CLIENT ONLY (apps/executive-dashboard/lib/data.js:
-- subscriptionAccessMode()), which calls the RPC if PostgREST reports it
-- exists (PGRST202 otherwise, treated as "no such gate yet") and disables the
-- write buttons with an explanation when it reports a non-active state. That
-- is a convenience, not a security boundary -- same as every other role check
-- in lib/data.js -- and the real enforcement, whenever nexus_my_subscription()
-- lands, belongs inside these functions or inside NX995/the scoring pipeline,
-- not bolted on from outside them.

begin;

-- ---------------------------------------------------------------------------
-- PART 1 . Retry a FAILED lead's score
-- ---------------------------------------------------------------------------
create or replace function public.nexus_my_lead_retry_scoring(p_lead_id integer)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenants uuid[];
  v_lead    public.leads%rowtype;
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    raise exception using errcode = 'NX001',
      message = 'Your account does not belong to an active dealership, so there is no lead here to retry.',
      detail  = 'NO_ACTIVE_DEALERSHIP';
  end if;
  if cardinality(v_tenants) > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account belongs to more than one dealership, so which one this lead belongs to is not something this call may guess.',
      detail  = 'DEALERSHIP_AMBIGUOUS';
  end if;

  select * into v_lead from public.leads l
   where l.id = p_lead_id and l.tenant_id = v_tenants[1];
  if not found then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no lead %s in a dealership your account belongs to.', p_lead_id),
      detail  = 'LEAD_NOT_FOUND_OR_NOT_YOURS';
  end if;
  if v_lead.scoring_state <> 'FAILED' then
    raise exception using errcode = 'NX001',
      message = format(
        'NX1005 REFUSED: lead %s is %s, not FAILED. A PENDING lead is already waiting for the next hourly rescore, and a SCORED lead is done -- retrying either would not do anything the pipeline is not already doing.',
        p_lead_id, v_lead.scoring_state),
      detail  = 'NOT_FAILED';
  end if;

  update public.leads l
     set scoring_state      = 'PENDING',
         scoring_attempts   = 0,
         scoring_last_error = null
   where l.id = p_lead_id
  returning l.* into v_lead;

  return v_lead;
end;
$$;

comment on function public.nexus_my_lead_retry_scoring(integer) is
  'Dealer-facing retry for a FAILED lead. Resets scoring_state to PENDING and '
  'scoring_attempts to 0 so the hourly rescore workflow (dCRmzWHCz7bniIBr) '
  'picks it up with a fresh attempt budget. Refuses a lead outside the '
  'caller''s own dealership(s) and a lead that is not currently FAILED.';

revoke all on function public.nexus_my_lead_retry_scoring(integer) from public, anon, authenticated;
grant execute on function public.nexus_my_lead_retry_scoring(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- PART 2 . Appointment wrappers -- request / offer / confirm / attend /
--          no-show / cancel, each scoped to the caller's own dealership
-- ---------------------------------------------------------------------------

-- The one caller identity string every wrapper below stamps onto NX995's own
-- p_actor -- the same `auth.jwt() ->> 'email'` idiom policy_06 and the other
-- named-actor migrations already use, so "who did this" reads the same way
-- here as everywhere else audited in this database.
create or replace function public.nexus_my_actor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
$$;

comment on function public.nexus_my_actor() is
  'The signed-in caller''s email, for stamping into an actor / booked_by / '
  'acknowledged_by column. Null when there is no JWT or no email claim on it '
  '-- callers coalesce it to something printable rather than assuming it is set.';

revoke all on function public.nexus_my_actor() from public, anon, authenticated;
grant execute on function public.nexus_my_actor() to authenticated;

-- Resolves the caller to exactly one active dealership or raises, mirroring
-- nexus_lead_record_manual's own tenant block verbatim. A shared helper
-- rather than six copies of the same six lines, so the refusal wording for
-- "no dealership" and "more than one" cannot drift between the six verbs.
create or replace function public.nexus_my_solo_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenants uuid[];
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    raise exception using errcode = 'NX001',
      message = 'Your account does not belong to an active dealership, so there is no diary to book this into.',
      detail  = 'NO_ACTIVE_DEALERSHIP';
  end if;
  if cardinality(v_tenants) > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account belongs to more than one dealership, so which one this visit belongs to is not something this call may guess.',
      detail  = 'DEALERSHIP_AMBIGUOUS';
  end if;
  return v_tenants[1];
end;
$$;

comment on function public.nexus_my_solo_tenant() is
  'The caller''s one active dealership, refused (not guessed) when there is '
  'none or more than one. Shared by the NX1005 appointment wrappers so the '
  'refusal wording cannot drift between them; mirrors nexus_lead_record_manual.';

revoke all on function public.nexus_my_solo_tenant() from public, anon, authenticated;
grant execute on function public.nexus_my_solo_tenant() to authenticated;

-- Finds or creates the `customer` row a lead's visit attaches to. Not part of
-- the public surface: called only from nexus_my_appointment_request, below.
create or replace function public.nexus_my_customer_for_lead(p_tenant uuid, p_lead public.leads)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text;
  v_email  text;
  v_id     uuid;
begin
  v_digits := nullif(regexp_replace(coalesce(p_lead.phone, ''), '\D', '', 'g'), '');
  v_email  := nullif(lower(btrim(coalesce(p_lead.email, ''))), '');
  -- leads.email is not always an email -- the router writes a synthetic
  -- `+digits@whatsapp.lead` key there for a WhatsApp-only lead (see
  -- screens/leads.js's KEY_SHAPE note). Only a value that actually looks like
  -- an address is treated as one here.
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_email := null;
  end if;
  if v_digits is null and v_email is null then
    raise exception using errcode = 'NX001',
      message = format(
        'NX1005 REFUSED: lead %s has neither a phone number nor a real email address, so no customer record can be attached to a visit for it.',
        p_lead.id),
      detail  = 'LEAD_HAS_NO_IDENTITY';
  end if;

  if v_digits is not null then
    select c.id into v_id from public.customer c
     where c.tenant_id = p_tenant and c.phone_digits = v_digits;
  end if;
  if v_id is null and v_email is not null then
    select c.id into v_id from public.customer c
     where c.tenant_id = p_tenant and c.email = v_email
     limit 1;
  end if;

  if v_id is not null then
    update public.customer c
       set last_seen_at = now(),
           display_name = coalesce(c.display_name, nullif(btrim(coalesce(p_lead.name, '')), ''))
     where c.id = v_id;
    return v_id;
  end if;

  begin
    insert into public.customer (tenant_id, display_name, phone_digits, email, first_seen_at, last_seen_at)
    values (p_tenant, nullif(btrim(coalesce(p_lead.name, '')), ''), v_digits, v_email, now(), now())
    returning id into v_id;
  exception when unique_violation then
    -- Lost a race with another request for the same phone number between the
    -- select above and this insert. The row that won is the right row.
    select c.id into v_id from public.customer c
     where c.tenant_id = p_tenant and c.phone_digits = v_digits;
  end;
  return v_id;
end;
$$;

comment on function public.nexus_my_customer_for_lead(uuid, public.leads) is
  'Finds the customer row for a lead by phone digits, then by a genuine email '
  'address, creating one (first-seen-here) if neither matches. Internal to '
  'nexus_my_appointment_request; never granted to authenticated directly.';

revoke all on function public.nexus_my_customer_for_lead(uuid, public.leads) from public, anon, authenticated;
grant execute on function public.nexus_my_customer_for_lead(uuid, public.leads) to service_role;

-- .. request ..................................................................
create or replace function public.nexus_my_appointment_request(
  p_lead_id       integer,
  p_channel       text default 'PHONE',
  p_notes         text default null,
  p_inventory_id  text default null)
returns table (appointment_id uuid, state text, requested_at timestamptz, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
  v_lead   public.leads%rowtype;
  v_cust   uuid;
begin
  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = v_tenant;
  if not found then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no lead %s in a dealership your account belongs to.', p_lead_id),
      detail  = 'LEAD_NOT_FOUND_OR_NOT_YOURS';
  end if;

  v_cust := public.nexus_my_customer_for_lead(v_tenant, v_lead);

  return query
    select * from public.nexus_appointment_request(
      v_tenant, v_cust, coalesce(nullif(btrim(p_channel), ''), 'PHONE'),
      p_lead_id, p_inventory_id, p_notes, public.nexus_my_actor());
end;
$$;

comment on function public.nexus_my_appointment_request(integer, text, text, text) is
  'Dealer-facing "Book visit" first step: resolves the caller to one '
  'dealership, verifies the lead belongs to it, finds-or-creates the '
  'customer row NX995 requires, and calls nexus_appointment_request(). '
  'Leaves the visit REQUESTED; call nexus_my_appointment_confirm() with a '
  'time to actually book it.';

revoke all on function public.nexus_my_appointment_request(integer, text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_request(integer, text, text, text) to authenticated;

-- .. offer .....................................................................
create or replace function public.nexus_my_appointment_offer_slots(
  p_appointment_id uuid,
  p_slots          timestamptz[])
returns table (appointment_id uuid, state text, offered_slots timestamptz[], action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
begin
  if not exists (select 1 from public.appointment a
                  where a.appointment_id = p_appointment_id and a.tenant_id = v_tenant) then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no appointment %s in a dealership your account belongs to.', p_appointment_id),
      detail  = 'APPOINTMENT_NOT_FOUND_OR_NOT_YOURS';
  end if;
  return query
    select * from public.nexus_appointment_offer_slots(p_appointment_id, p_slots, public.nexus_my_actor());
end;
$$;

comment on function public.nexus_my_appointment_offer_slots(uuid, timestamptz[]) is
  'Dealer-facing wrapper over nexus_appointment_offer_slots(): checks the '
  'appointment belongs to the caller''s own dealership before proposing '
  'times, then hands back NX995''s own result (or refusal) unchanged.';

revoke all on function public.nexus_my_appointment_offer_slots(uuid, timestamptz[]) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_offer_slots(uuid, timestamptz[]) to authenticated;

-- .. confirm ...................................................................
create or replace function public.nexus_my_appointment_confirm(
  p_appointment_id    uuid,
  p_starts_at         timestamptz,
  p_duration_minutes  integer default 45,
  p_assigned_to_id    uuid default null,
  p_location          text default null,
  p_resource          text default null)
returns table (appointment_id uuid, state text, starts_at timestamptz, ends_at timestamptz,
               confirmed_slot_was_offered boolean, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
begin
  if not exists (select 1 from public.appointment a
                  where a.appointment_id = p_appointment_id and a.tenant_id = v_tenant) then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no appointment %s in a dealership your account belongs to.', p_appointment_id),
      detail  = 'APPOINTMENT_NOT_FOUND_OR_NOT_YOURS';
  end if;
  -- Salesperson ownership is also enforced inside nexus_appointment_confirm
  -- itself (assigned_to_id must be a users row in the SAME tenant); repeated
  -- here would only be a second copy of the same rule to keep in step, so it
  -- is left to the one place that already owns it.
  return query
    select * from public.nexus_appointment_confirm(
      p_appointment_id, p_starts_at, p_duration_minutes, p_assigned_to_id,
      p_location, p_resource, public.nexus_my_actor());
end;
$$;

comment on function public.nexus_my_appointment_confirm(uuid, timestamptz, integer, uuid, text, text) is
  'Dealer-facing wrapper over nexus_appointment_confirm(): checks the '
  'appointment belongs to the caller''s own dealership, then hands the call '
  'through -- including the EXCLUDE USING gist double-booking refusal, '
  'returned verbatim rather than paraphrased.';

revoke all on function public.nexus_my_appointment_confirm(uuid, timestamptz, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_confirm(uuid, timestamptz, integer, uuid, text, text) to authenticated;

-- .. attend / no-show ..........................................................
-- Two one-argument doors over the one underlying verb
-- (nexus_appointment_mark_attended), because "did they walk in" is a button,
-- not a boolean parameter a rep types.
create or replace function public.nexus_my_appointment_attend(
  p_appointment_id uuid,
  p_reason         text default null)
returns table (appointment_id uuid, state text, closed_at timestamptz, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
begin
  if not exists (select 1 from public.appointment a
                  where a.appointment_id = p_appointment_id and a.tenant_id = v_tenant) then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no appointment %s in a dealership your account belongs to.', p_appointment_id),
      detail  = 'APPOINTMENT_NOT_FOUND_OR_NOT_YOURS';
  end if;
  return query
    select * from public.nexus_appointment_mark_attended(
      p_appointment_id, true, public.nexus_my_actor(), p_reason);
end;
$$;

comment on function public.nexus_my_appointment_attend(uuid, text) is
  'Dealer-facing "they walked in": wraps nexus_appointment_mark_attended(p_attended => true) '
  'after checking the appointment belongs to the caller''s own dealership.';

revoke all on function public.nexus_my_appointment_attend(uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_attend(uuid, text) to authenticated;

create or replace function public.nexus_my_appointment_no_show(
  p_appointment_id uuid,
  p_reason         text default null)
returns table (appointment_id uuid, state text, closed_at timestamptz, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
begin
  if not exists (select 1 from public.appointment a
                  where a.appointment_id = p_appointment_id and a.tenant_id = v_tenant) then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no appointment %s in a dealership your account belongs to.', p_appointment_id),
      detail  = 'APPOINTMENT_NOT_FOUND_OR_NOT_YOURS';
  end if;
  return query
    select * from public.nexus_appointment_mark_attended(
      p_appointment_id, false, public.nexus_my_actor(), p_reason);
end;
$$;

comment on function public.nexus_my_appointment_no_show(uuid, text) is
  'Dealer-facing "they did not walk in": wraps nexus_appointment_mark_attended(p_attended => false) '
  'after checking the appointment belongs to the caller''s own dealership.';

revoke all on function public.nexus_my_appointment_no_show(uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_no_show(uuid, text) to authenticated;

-- .. cancel ....................................................................
create or replace function public.nexus_my_appointment_cancel(
  p_appointment_id uuid,
  p_reason         text)
returns table (appointment_id uuid, state text, closed_at timestamptz, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.nexus_my_solo_tenant();
begin
  if not exists (select 1 from public.appointment a
                  where a.appointment_id = p_appointment_id and a.tenant_id = v_tenant) then
    raise exception using errcode = 'NX001',
      message = format('NX1005 REFUSED: no appointment %s in a dealership your account belongs to.', p_appointment_id),
      detail  = 'APPOINTMENT_NOT_FOUND_OR_NOT_YOURS';
  end if;
  return query
    select * from public.nexus_appointment_cancel(p_appointment_id, p_reason, public.nexus_my_actor());
end;
$$;

comment on function public.nexus_my_appointment_cancel(uuid, text) is
  'Dealer-facing wrapper over nexus_appointment_cancel(): checks the '
  'appointment belongs to the caller''s own dealership, then hands the call '
  'through, including NX995''s own "no reason given" refusal.';

revoke all on function public.nexus_my_appointment_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_my_appointment_cancel(uuid, text) to authenticated;

commit;
