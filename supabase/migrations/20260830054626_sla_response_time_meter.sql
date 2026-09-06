-- =============================================================================
-- NEXUS OS · sla_migration.sql
-- Defect 1 — leads.response_time_minutes is read by five consumers and written
--            by nobody. The five-minute rule has no meter.
--
-- Consumers (all read-only, none of them write it):
--   apps/executive-dashboard/screens/leads.js      SLA_MINUTES = 5 breach alert
--   apps/executive-dashboard/screens/overview.js   average-response KPI
--   apps/executive-dashboard/screens/team.js       per-rep "untouched" count
--   apps/executive-dashboard/lib/lead-drawer.js    "within SLA" / "breaches"
--   public.v_needs_attention                       kind = 'sla_breach'
--
-- WHY THE DATABASE AND NOT A WORKFLOW
--   The clock has to stop at the FIRST outbound message to a lead, whichever
--   workflow happens to send it. Today that can be the WhatsApp BDC agent, the
--   7-day drip, the KYC re-upload request, the dashboard's own reply endpoint,
--   the silence detector or the escalation agent — six writers to
--   communication_logs, each of which would need the same rule, and a seventh
--   added next month would silently not have it. One AFTER INSERT trigger on
--   communication_logs is the only place the rule can be stated once.
--
-- IDEMPOTENT. Every statement is create-or-replace / if-not-exists / drop-if-
-- exists-then-create. Safe to run twice. Section 6 (the historical back-fill)
-- only ever writes rows where response_time_minutes IS NULL, so re-running it
-- cannot move a value that has already been set.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- =============================================================================


-- ── 1. The column ────────────────────────────────────────────────────────────
-- It already exists on the live database (the dashboard selects it through
-- PostgREST and gets null rather than a 400). This is defensive only, so the
-- file can also be run against a rebuilt schema.
alter table public.leads
  add column if not exists response_time_minutes integer;

comment on column public.leads.response_time_minutes is
  'Minutes between the lead arriving (leads.created_at) and the FIRST genuine '
  'outbound message to that lead in communication_logs. Written once, by '
  'trigger, and never overwritten: it is the first-reply time, not the latest. '
  'NULL means UNMEASURED — not fast. A lead nobody has ever answered stays NULL '
  'forever, which is why the dashboard renders NULL as "Not measured" and never '
  'as a dash.';


-- ── 2. Identity ──────────────────────────────────────────────────────────────
-- The same customer is keyed three different ways across this system:
--
--   leads.email               a real address, OR the synthetic
--                             '+<digits>@whatsapp.lead' the Master Router's
--                             `Persist Lead (deterministic)` node writes when
--                             the lead arrived with a phone and no email.
--   communication_logs.lead_email
--                             a real address, OR a WhatsApp chat id
--                             ('<digits>@c.us' or '<number>@lid'), OR that same
--                             '+<digits>@whatsapp.lead'.
--   whatsapp_contacts.chat_id the bridge between the two, written by the BDC
--                             agent's `Upsert WhatsApp Contact` node.
--
-- '<number>@lid' is the case that defeats every arithmetic trick: a LID chat id
-- contains no phone digits at all, so the ONLY route from it to a lead is
-- whatsapp_contacts. That table is looked up through to_regclass so this file
-- still installs on a database that does not have it yet.

create or replace function public.nexus_lead_for_comm_key(p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_is_cus boolean;
  v_id     uuid;
  v_email  text;
  v_wcdig  text;
begin
  if v_raw is null then
    return null;
  end if;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_is_cus := v_raw like '%@c.us';

  -- (a) Exact match. Covers a real address and the synthetic whatsapp.lead one.
  select id into v_id
    from public.leads
   where email = v_raw
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) '<digits>@c.us' IS a phone number. Try the synthetic address the router
  --     would have minted from it, then the lead's own phone column.
  if v_is_cus and v_digits <> '' then
    select id into v_id
      from public.leads
     where email = '+' || v_digits || '@whatsapp.lead'
     order by created_at
     limit 1;
    if v_id is not null then return v_id; end if;

    select id into v_id
      from public.leads
     where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_digits
     order by created_at
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- (c) Anything else — in practice '<number>@lid' — only resolves through
  --     whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    execute 'select lead_email from public.whatsapp_contacts '
            'where chat_id = $1 and lead_email is not null limit 1'
       into v_email using v_raw;
    if v_email is not null then
      select id into v_id
        from public.leads
       where email = v_email
       order by created_at
       limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    execute 'select regexp_replace(coalesce(phone, ''''), ''[^0-9]'', '''', ''g'') '
            'from public.whatsapp_contacts where chat_id = $1 limit 1'
       into v_wcdig using v_raw;
    if v_wcdig is not null and v_wcdig <> '' then
      select id into v_id
        from public.leads
       where email = '+' || v_wcdig || '@whatsapp.lead'
          or regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_wcdig
       order by created_at
       limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$$;

-- The same identity set, built in the other direction: from a lead row to every
-- key communication_logs might have filed its messages under. Used by the
-- ordering-race trigger (section 4) and the back-fill (section 6) so neither has
-- to call the resolver once per log row.
create or replace function public.nexus_comm_keys_for_lead(p_email text, p_phone text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_keys   text[] := '{}';
  v_chats  text[] := '{}';
  v_digits text   := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_lead   text   := nullif(btrim(coalesce(p_email, '')), '');
  v_edig   text;
begin
  if v_lead is not null then
    v_keys := v_keys || v_lead;
    v_edig := regexp_replace(v_lead, '[^0-9]', '', 'g');
    if v_lead like '+%@whatsapp.lead' and v_edig <> '' then
      v_keys := v_keys || (v_edig || '@c.us');
      if v_digits = '' then v_digits := v_edig; end if;
    end if;
  end if;

  if v_digits <> '' then
    v_keys := v_keys || ('+' || v_digits || '@whatsapp.lead');
    v_keys := v_keys || (v_digits || '@c.us');
  end if;

  if to_regclass('public.whatsapp_contacts') is not null then
    execute 'select coalesce(array_agg(chat_id), ''{}''::text[]) from public.whatsapp_contacts '
            'where chat_id is not null and ('
            '  ($1 is not null and lead_email = $1) '
            '  or ($2 <> '''' and regexp_replace(coalesce(phone, ''''), ''[^0-9]'', '''', ''g'') = $2))'
       into v_chats using v_lead, v_digits;
    v_keys := v_keys || coalesce(v_chats, '{}'::text[]);
  end if;

  -- de-duplicate
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
    from unnest(v_keys) as k
   where k is not null and btrim(k) <> '';

  return v_keys;
end;
$$;


-- ── 3. What counts as "a reply" ──────────────────────────────────────────────
-- An outbound row in communication_logs is a reply only if a CUSTOMER could
-- have received it. Three kinds of row look outbound and are not:
--
--  · `Log Incoming Message` (WhatsApp BDC) writes
--        direction 'outbound', channel 'whatsapp',
--        message   '[system] Initial outreach requested by the Master Router'
--    at the moment the router ASKS for outreach — before anything is sent.
--    Counting it stops the clock on a message the customer never received.
--
--  · `Mark as Escalated` (Phase 6 · 12-Hour Silence Detector) writes
--        direction 'outbound', channel 'system',
--        message   '[SILENCE-ESCALATED] …'
--    This is the single most dangerous row in the table for this feature: it is
--    written precisely BECAUSE nobody has answered the customer, and it fires at
--    roughly the 12-hour mark. Counting it would stamp ~720 minutes onto exactly
--    the leads that were never answered at all, converting "unmeasured" into a
--    confident, wrong number — and it would do so on the worst cases only.
--
--  · anything on channel 'slack' — an internal post, not a customer message.
--
-- Hence: a real customer channel, and no internal bracket marker. The
-- '[KYC-REJECT] …' rows written by `Log KYC Re-ask` ARE replies and are counted:
-- that row carries the exact text that went to the customer's phone.
drop function if exists public.nexus_is_reply(text, text);
create or replace function public.nexus_is_reply(p_direction text, p_channel text, p_message text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_direction, '')) = 'outbound'
     and lower(coalesce(p_channel, ''))   in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$$;


-- ── 4. The meter ─────────────────────────────────────────────────────────────
-- Trigger A: an outbound message arrives -> stop the clock on its lead.
create or replace function public.nexus_mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;

  v_lead := public.nexus_lead_for_comm_key(new.lead_email);
  if v_lead is null then
    return new;   -- a message to somebody who is not (yet) a lead row
  end if;

  -- `response_time_minutes is null` makes this first-write-wins AND idempotent:
  -- the second, third and hundredth outbound message to the same lead all fall
  -- through here without touching the value.
  -- greatest(0, ...) absorbs clock skew between n8n (Asia/Dubai) and Postgres,
  -- and the case where a reply is logged in the same second the lead is created.
  update public.leads l
     set response_time_minutes =
           greatest(0, round(extract(epoch from (coalesce(new.created_at, now()) - l.created_at)) / 60.0))::integer
   where l.id = v_lead
     and l.response_time_minutes is null
     and l.created_at is not null;

  return new;
end;
$$;

drop trigger if exists trg_comm_logs_first_response on public.communication_logs;
create trigger trg_comm_logs_first_response
  after insert on public.communication_logs
  for each row
  when (lower(coalesce(new.direction, '')) = 'outbound')
  execute function public.nexus_mark_first_response();


-- Trigger B: the ordering race, and it is a real one.
-- The BDC agent answers an unknown WhatsApp number, logs the outbound reply, and
-- only THEN — at `New Lead Worth Scoring?` -> `Score New Lead (Master Router)` —
-- does a leads row get created. Trigger A ran while there was no lead to update,
-- so without this the very leads that were answered fastest would be the ones
-- left unmeasured.
create or replace function public.nexus_backfill_response_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys  text[];
  v_first timestamptz;
begin
  if new.response_time_minutes is not null or new.created_at is null then
    return new;
  end if;

  v_keys := public.nexus_comm_keys_for_lead(new.email, new.phone);
  if v_keys is null or array_length(v_keys, 1) is null then
    return new;
  end if;

  -- A five-minute grace window before created_at: the reply genuinely can be
  -- logged a few seconds before the lead row lands. Anything earlier than that
  -- belongs to some previous conversation and must not stop this lead's clock.
  select min(c.created_at) into v_first
    from public.communication_logs c
   where c.lead_email = any(v_keys)
     and c.created_at >= new.created_at - interval '5 minutes'
     and public.nexus_is_reply(c.direction, c.channel, c.message);

  if v_first is null then
    return new;
  end if;

  new.response_time_minutes :=
    greatest(0, round(extract(epoch from (v_first - new.created_at)) / 60.0))::integer;
  return new;
end;
$$;

drop trigger if exists trg_leads_backfill_response on public.leads;
create trigger trg_leads_backfill_response
  before insert on public.leads
  for each row
  execute function public.nexus_backfill_response_time();


-- ── 5. Indexes and grants ────────────────────────────────────────────────────
-- Partial index: the resolver's hot lookup is `leads.email = <key>` restricted to
-- rows that are still unmeasured. It shrinks towards nothing as leads get
-- measured, which is exactly the shape this workload wants.
create index if not exists idx_leads_unmeasured_email
  on public.leads (email)
  where response_time_minutes is null;

-- regexp_replace/4 is IMMUTABLE, so this expression is indexable. It backs the
-- phone-digits branch of the resolver.
create index if not exists idx_leads_phone_digits
  on public.leads ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')));

-- idx_comm_logs_lead_email already exists (supabase/create_missing_tables.sql).

revoke all on function public.nexus_lead_for_comm_key(text)        from public;
revoke all on function public.nexus_comm_keys_for_lead(text, text) from public;
revoke all on function public.nexus_mark_first_response()          from public;
revoke all on function public.nexus_backfill_response_time()       from public;
grant execute on function public.nexus_lead_for_comm_key(text)        to service_role;
grant execute on function public.nexus_comm_keys_for_lead(text, text) to service_role;


-- ── 6. Historical back-fill — OPTIONAL, run once, read the note first ────────
-- The task brief assumed history could not be recovered. Part of it can: every
-- outbound row communication_logs still holds is a first reply that was never
-- measured, and the identity map above can now attach it to its lead. What
-- CANNOT be recovered is anything the retention purge has already deleted, and
-- anything from before communication_logs existed — those leads stay NULL, and
-- NULL is the honest answer for them.
--
-- Guarded three ways: only rows that are NULL now, only replies (section 3),
-- and only messages at or after the lead arrived. Re-running it is a no-op.
-- Comment this block out if you would rather the meter only ever describe
-- traffic that arrived after the trigger was installed.
update public.leads l
   set response_time_minutes = s.mins
  from (
    select l2.id,
           greatest(0, round(extract(epoch from (min(c.created_at) - l2.created_at)) / 60.0))::integer as mins
      from public.leads l2
      join public.communication_logs c
        on c.lead_email = any(public.nexus_comm_keys_for_lead(l2.email, l2.phone))
     where l2.response_time_minutes is null
       and l2.created_at is not null
       and c.created_at >= l2.created_at - interval '5 minutes'
       and public.nexus_is_reply(c.direction, c.channel, c.message)
     group by l2.id, l2.created_at
  ) s
 where l.id = s.id
   and l.response_time_minutes is null;


-- ── 7. What this file deliberately does NOT do ───────────────────────────────
-- v_needs_attention is not defined anywhere in this repository (see
-- security/fix_rls.sql section 5), so its sla_breach branch is not touched here.
-- That leaves one gap open, and it is the worse half of the SLA question:
--
--   A lead that has been answered LATE now raises sla_breach.
--   A lead that has NEVER been answered still has response_time_minutes = NULL
--   and raises nothing at all.
--
-- Closing it means adding a second branch to that view, something like
--   response_time_minutes is null and created_at < now() - interval '5 minutes'
--   and status not in ('CONVERTED','LOST','DISQUALIFIED')
-- with its own kind, e.g. 'sla_unanswered'. Write it against the live view
-- definition, not against a guess at it.
-- =============================================================================