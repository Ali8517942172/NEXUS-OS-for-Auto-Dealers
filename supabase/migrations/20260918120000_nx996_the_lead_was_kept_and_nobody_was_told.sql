-- NX996 — The lead was kept and nobody was told.
--
-- Measured 18 Sep 2026 on production dsvuoovivysszdoiorch:
--
--   POST /api/lead                            -> 200 {"ok":true,"stored":true,
--                                                     "notified":false}
--   select count(*) from nexus_sales_lead      -> 4
--   select count(*) ... contacted_at is null   -> 4
--   tables matching outbox|notification|queue  -> 0
--
-- So the durable write NX974 built works: four dealerships asked NEXUS for an
-- audit and all four rows are in the database. And all four are still sitting
-- there untouched, because the only thing that was ever going to tell a human
-- was a live HTTP call to a mail provider inside the request, and that call
-- has not worked since the Resend account was removed (apps/marketing-site/
-- api/lead.js lines 29-33, 179-213). The receiver answers `notified: false`
-- honestly and then forgets, in the same breath, that anybody needs telling.
--
-- A notification that exists only as an in-flight HTTP call has the same
-- lifetime as the request that made it. Two things were tangled together and
-- this migration separates them:
--
--   STORING the lead        -- already durable, already correct, untouched here
--   TELLING somebody        -- until now, not durable at all
--
-- After this migration the second one is a row. A row survives a dead mail
-- provider, a redeploy, an expired key and a serverless function that was
-- killed mid-flight. Nothing about the queue can lose the lead, because the
-- queue is written AFTER the lead and its failure is swallowed on purpose
-- (see nexus_sales_lead_enqueue_notification below).
--
-- WHAT THIS DELIBERATELY IS NOT:
--
--   * It is NOT a sender. There is no mail provider, no WhatsApp call, no
--     Slack webhook, no API key and no column that could hold one. Nothing in
--     this migration transmits anything to anybody. The transport does not
--     exist, and building a queue is the honest half of the job that can be
--     done without inventing the half that cannot.
--   * It does NOT run itself. No cron, no scheduler, no background worker.
--     Rows become claimable and then wait. A PENDING notification with no
--     worker stays PENDING forever, which is why the read accessor says so
--     in words rather than showing a reassuring number.
--   * It does NOT backdate. The four stranded leads are enqueued below so
--     they are in the queue the day a sender exists, but nothing here marks
--     them contacted or pretends anybody was told.
--
-- NO TENANT, ANYWHERE IN THIS FILE. `nexus_sales_lead` is NEXUS's own vendor
-- pipeline and sits outside the tenant model on purpose (NX974). A dealership
-- owner enquiring about buying NEXUS is a prospect for the vendor and is never
-- a car buyer belonging to a dealership. So this outbox has no tenant_id, no
-- reference to `tenants`, and no path to `leads`, `lead_event`, `appointment`
-- or any other tenant table. The day a dealership's own notifications need a
-- queue, that is a deliberate new table with its own tenancy and its own RLS
-- -- not a quiet ALTER that starts mixing vendor prospects into a customer's
-- data.
--
-- NO SECOND COPY OF THE PROSPECT. The outbox holds no name, no phone number,
-- no email address and no message body. It points at the lead. Whatever
-- eventually sends the notification reads the details from nexus_sales_lead
-- at send time. One copy of a prospect's contact details is enough, and a
-- queue that is also a mailing list is a second thing to leak.

begin;

-- ── The vocabulary ────────────────────────────────────────────────────────
-- A lookup, not data. Five words, each with the plain sentence it means, so
-- that "RETRYING" has exactly one reading in this database and in whatever
-- screen ends up showing it.
create table if not exists public.notification_state (
  state           text primary key,
  meaning         text not null,
  is_live         boolean not null,
  is_terminal     boolean not null,
  needs_attention boolean not null,
  sort_order      int not null
);

insert into public.notification_state
  (state, meaning, is_live, is_terminal, needs_attention, sort_order) values
  ('PENDING',
   'Written down and waiting. Nobody has tried to send it yet. Today nobody ever will, because no sender exists.',
   true,  false, true,  1),
  ('RETRYING',
   'A send was attempted and failed, and there are attempts left. next_attempt_at says when it may be claimed again.',
   true,  false, true,  2),
  ('SENT',
   'Something reported that it handed this to a transport. That is a claim by the sender, not proof a human read it.',
   false, false, false, 3),
  ('FAILED',
   'Every attempt was used up and none worked. Nothing will pick this up again. A person has to look at last_error_detail.',
   false, true,  true,  4),
  ('ACKNOWLEDGED',
   'A human confirmed they actually received it. This is the only state in which the prospect is genuinely known about.',
   false, true,  false, 5)
on conflict (state) do update
  set meaning         = excluded.meaning,
      is_live         = excluded.is_live,
      is_terminal     = excluded.is_terminal,
      needs_attention = excluded.needs_attention,
      sort_order      = excluded.sort_order;

comment on table public.notification_state is
  'The five words a queued notification can be in, each with the sentence it '
  'means. A lookup: no tenant owns a row here and no prospect appears in it. '
  'RLS is on with a stated service-role policy so that "RLS is off here" never '
  'has two possible readings in this schema.';
comment on column public.notification_state.is_live is
  'Whether a worker would pick this row up. PENDING and RETRYING are live; the '
  'other three are finished with, one way or another.';
comment on column public.notification_state.needs_attention is
  'Whether a person should be looking at rows in this state. PENDING counts, '
  'because a queue nobody drains is the exact problem this migration exists '
  'to make visible rather than to hide.';

alter table public.notification_state enable row level security;
drop policy if exists notification_state_service_role_all  on public.notification_state;
drop policy if exists notification_state_never_end_users   on public.notification_state;
create policy notification_state_service_role_all on public.notification_state
  for all to service_role using (true) with check (true);
-- Restrictive, so no later permissive policy can re-open it by accident.
create policy notification_state_never_end_users on public.notification_state
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.notification_state from public, anon, authenticated;
grant  all on public.notification_state to service_role;

-- ── The machine itself, as data ───────────────────────────────────────────
-- Every legal move, one row each. The write functions read this table rather
-- than carrying the rules in seven separate if-statements, so a refusal can
-- quote the machine and the machine has exactly one definition.
create table if not exists public.notification_transition (
  from_state text not null references public.notification_state(state),
  to_state   text not null references public.notification_state(state),
  verb       text not null,
  primary key (from_state, to_state)
);

insert into public.notification_transition (from_state, to_state, verb) values
  ('PENDING',  'SENT',         'nexus_notification_mark_sent'),
  ('PENDING',  'RETRYING',     'nexus_notification_mark_failed'),
  ('PENDING',  'FAILED',       'nexus_notification_mark_failed'),
  ('RETRYING', 'SENT',         'nexus_notification_mark_sent'),
  ('RETRYING', 'RETRYING',     'nexus_notification_mark_failed'),
  ('RETRYING', 'FAILED',       'nexus_notification_mark_failed'),
  ('SENT',     'ACKNOWLEDGED', 'nexus_notification_acknowledge')
on conflict (from_state, to_state) do update set verb = excluded.verb;

comment on table public.notification_transition is
  'Every move the outbox state machine allows, as data. FAILED and '
  'ACKNOWLEDGED appear only as destinations: they are terminal, so a '
  'notification that exhausted its attempts cannot be quietly marked sent, and '
  'an acknowledged one cannot be re-opened. There is no PENDING -> '
  'ACKNOWLEDGED row either -- a notification nobody tried to send cannot have '
  'been received. Claiming is deliberately absent: a claim is not a state '
  'change, it is a lease, and a claimed row is still PENDING or RETRYING '
  'because nothing has happened to it yet.';

alter table public.notification_transition enable row level security;
drop policy if exists notification_transition_service_role_all on public.notification_transition;
drop policy if exists notification_transition_never_end_users  on public.notification_transition;
create policy notification_transition_service_role_all on public.notification_transition
  for all to service_role using (true) with check (true);
create policy notification_transition_never_end_users on public.notification_transition
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.notification_transition from public, anon, authenticated;
grant  all on public.notification_transition to service_role;

-- ── The outbox ────────────────────────────────────────────────────────────
create table if not exists public.nexus_notification_outbox (
  notification_id   uuid primary key default gen_random_uuid(),
  -- The pointer, and the only thing here that knows who the prospect is.
  -- on delete restrict: nexus_sales_lead carries the NX900 delete guard
  -- anyway, and this says the same thing a second time.
  sales_lead_id     uuid not null references public.nexus_sales_lead(id) on delete restrict,
  channel           text not null default 'EMAIL',
  state             text not null default 'PENDING' references public.notification_state(state),
  -- What the notification is FOR, in one word. Not a subject line: a subject
  -- line would have to contain the prospect, and the prospect lives in one
  -- place only.
  reason            text not null default 'NEW_SALES_LEAD',
  attempt_count     int  not null default 0,
  max_attempts      int  not null default 5,
  -- When a worker may next claim this. Set forward by every failure (backoff)
  -- and by every claim (the lease), so a worker that dies mid-send does not
  -- strand the row -- it becomes claimable again when the lease runs out.
  next_attempt_at   timestamptz not null default now(),
  claimed_at        timestamptz,
  claimed_by        text,
  last_error_code   text,
  last_error_detail text,
  sent_at           timestamptz,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint nexus_notification_outbox_channel_is_known
    check (channel in ('EMAIL','WHATSAPP','SLACK')),
  constraint nexus_notification_outbox_reason_is_known
    check (reason in ('NEW_SALES_LEAD')),
  constraint nexus_notification_outbox_attempts_sane
    check (attempt_count >= 0 and max_attempts between 1 and 20
           and attempt_count <= max_attempts),
  -- SENT has to be able to say when. So does ACKNOWLEDGED.
  constraint nexus_notification_outbox_sent_has_a_time
    check (state not in ('SENT','ACKNOWLEDGED') or sent_at is not null),
  constraint nexus_notification_outbox_ack_has_a_time
    check (state <> 'ACKNOWLEDGED' or acknowledged_at is not null),
  -- A failure that cannot say what went wrong teaches nobody anything.
  constraint nexus_notification_outbox_failure_has_an_error
    check (state not in ('FAILED','RETRYING') or last_error_code is not null),
  -- Nothing can have been attempted zero times and also have failed.
  constraint nexus_notification_outbox_failure_was_attempted
    check (state not in ('FAILED','RETRYING','SENT') or attempt_count > 0)
);

comment on table public.nexus_notification_outbox is
  'One row per "somebody needs to be told about this NEXUS sales enquiry". '
  'Written durably at the moment the lead lands, so that telling a human '
  'stops being an in-flight HTTP call with the lifetime of a serverless '
  'request. Holds NO name, phone number, email address or message body -- it '
  'points at nexus_sales_lead and whatever sends reads the details there, so '
  'the queue never becomes a second copy of the prospect. Has NO tenant_id '
  'and no reference to any tenant table: this is NEXUS''s own vendor '
  'pipeline (NX974) and a vendor prospect must never be filed into a '
  'dealership''s data. Nothing drains this table today -- there is no sender.';
comment on column public.nexus_notification_outbox.channel is
  'How this would be sent, if anything could send it. EMAIL, WHATSAPP and '
  'SLACK are the three NEXUS already speaks elsewhere. None of them has a '
  'sender wired to this queue, and this column holds no credential, endpoint '
  'or key of any kind.';
comment on column public.nexus_notification_outbox.state is
  'One of the five words in notification_state. Moved only by the four state '
  'verbs below, only by service_role, and only along a row that exists in '
  'notification_transition.';
comment on column public.nexus_notification_outbox.next_attempt_at is
  'The earliest moment a worker may claim this row. Pushed forward by an '
  'exponential backoff on failure and by a five-minute lease on claim. The '
  'lease is why a worker that is killed mid-send loses the row rather than '
  'locking it forever.';
comment on column public.nexus_notification_outbox.claimed_by is
  'Free text naming whatever claimed this -- a worker or script name typed by '
  'whoever wires the sender. Not an auth user id: nothing that runs against '
  'this queue is a signed-in person, and pretending otherwise would put an '
  'identity on a row that never had one.';
comment on column public.nexus_notification_outbox.sent_at is
  'When a sender REPORTED handing this to a transport. Not proof of delivery '
  'and not proof anybody read it -- that is what ACKNOWLEDGED is for.';
comment on column public.nexus_notification_outbox.acknowledged_by is
  'Who confirmed they actually got it, as free text. The only field in this '
  'table that means a human definitely knows about the prospect.';

-- One live notification per lead per channel. Partial, so a notification that
-- has run out of attempts can be re-raised deliberately as a new row -- the
-- failed one stays where it is, and that is the point.
create unique index if not exists nexus_notification_outbox_one_live_per_lead_channel
  on public.nexus_notification_outbox (sales_lead_id, channel)
  where state in ('PENDING','RETRYING');
-- The claim query's index: live rows, oldest due first.
create index if not exists nexus_notification_outbox_claimable_idx
  on public.nexus_notification_outbox (channel, next_attempt_at)
  where state in ('PENDING','RETRYING');
create index if not exists nexus_notification_outbox_state_idx
  on public.nexus_notification_outbox (state, created_at desc);
create index if not exists nexus_notification_outbox_lead_idx
  on public.nexus_notification_outbox (sales_lead_id);

alter table public.nexus_notification_outbox enable row level security;
drop policy if exists nexus_notification_outbox_service_role_all on public.nexus_notification_outbox;
drop policy if exists nexus_notification_outbox_never_end_users  on public.nexus_notification_outbox;
create policy nexus_notification_outbox_service_role_all on public.nexus_notification_outbox
  for all to service_role using (true) with check (true);
-- Shaped exactly like nexus_sales_lead (NX974): a dealership's signed-in staff
-- have no business reading the vendor's pipeline, and anon has no business
-- anywhere near it. Restrictive, so nothing can re-open it later by accident.
create policy nexus_notification_outbox_never_end_users on public.nexus_notification_outbox
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.nexus_notification_outbox from public, anon, authenticated;
grant  all on public.nexus_notification_outbox to service_role;

-- ── The history, append-only ──────────────────────────────────────────────
create table if not exists public.notification_attempt (
  attempt_id      uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.nexus_notification_outbox(notification_id) on delete restrict,
  attempt_no      int  not null,
  event           text not null,
  from_state      text,
  to_state        text,
  worker          text,
  error_code      text,
  error_detail    text,
  occurred_at     timestamptz not null default now(),
  constraint notification_attempt_event_is_known check (event in (
    'ENQUEUED','CLAIMED','SENT','FAILED','RETRY_SCHEDULED','ACKNOWLEDGED'))
);

comment on table public.notification_attempt is
  'Append-only history of everything that happened to a queued notification, '
  'one row per event. Exists because the outbox row is overwritten by the next '
  'attempt and therefore can never answer "how many times did this fail, and '
  'with what, before it went out" -- which is the first question asked the '
  'first time a sender misbehaves. UPDATE is refused outright by a trigger; '
  'DELETE and TRUNCATE go through the NX900 destructive-write guard. Holds no '
  'prospect data: an id, a word, a count, an error string and a time.';
comment on column public.notification_attempt.error_detail is
  'The transport''s own words about what went wrong, truncated. Whoever wires '
  'a sender must not put a credential, token or authorization header in here '
  '-- an error log is not a place for a secret.';

create index if not exists notification_attempt_notification_time_idx
  on public.notification_attempt (notification_id, occurred_at desc);
create index if not exists notification_attempt_event_time_idx
  on public.notification_attempt (event, occurred_at desc);

create or replace function public.nexus_notification_attempt_is_append_only()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
begin
  raise exception using errcode = 'P0001',
    message = 'NX996 APPEND_ONLY_REFUSED: notification_attempt records what happened, so it cannot be edited into something else.',
    detail  = 'An UPDATE here would rewrite the answer to "how many times did this fail before it went out".',
    hint    = 'Insert a correcting attempt row instead. The wrong one stays, and that is the point.';
end
$fn$;

comment on function public.nexus_notification_attempt_is_append_only() is
  'Refuses every UPDATE on notification_attempt. No escape hatch, unlike the '
  'NX900 delete guard: a delivery history you can quietly edit is not '
  'evidence, and this table exists only to be evidence.';

revoke all on function public.nexus_notification_attempt_is_append_only() from public, anon, authenticated;

drop trigger if exists nexus_notification_attempt_refuse_update on public.notification_attempt;
create trigger nexus_notification_attempt_refuse_update
  before update on public.notification_attempt
  for each row execute function public.nexus_notification_attempt_is_append_only();

alter table public.notification_attempt enable row level security;
drop policy if exists notification_attempt_service_role_all on public.notification_attempt;
drop policy if exists notification_attempt_never_end_users  on public.notification_attempt;
create policy notification_attempt_service_role_all on public.notification_attempt
  for all to service_role using (true) with check (true);
create policy notification_attempt_never_end_users on public.notification_attempt
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.notification_attempt from public, anon, authenticated;
grant  all on public.notification_attempt to service_role;

-- ── The destructive-write guard (NX900 / NX950 / NX984 / NX990 / NX995) ───
-- Everything that touches this queue runs as service_role, which carries
-- rolbypassrls, so RLS is never consulted for it and this guard is the only
-- thing between a worker's mistake and the record of who was never told.
drop trigger if exists nexus_notification_outbox_refuse_delete   on public.nexus_notification_outbox;
drop trigger if exists nexus_notification_outbox_refuse_truncate on public.nexus_notification_outbox;
create trigger nexus_notification_outbox_refuse_delete
  before delete on public.nexus_notification_outbox
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_notification_outbox_refuse_truncate
  before truncate on public.nexus_notification_outbox
  for each statement execute function public.nexus_refuse_destructive_write();

drop trigger if exists nexus_notification_attempt_refuse_delete   on public.notification_attempt;
drop trigger if exists nexus_notification_attempt_refuse_truncate on public.notification_attempt;
create trigger nexus_notification_attempt_refuse_delete
  before delete on public.notification_attempt
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_notification_attempt_refuse_truncate
  before truncate on public.notification_attempt
  for each statement execute function public.nexus_refuse_destructive_write();

-- ── One refusal, written once ─────────────────────────────────────────────
-- Every illegal move is refused in the same words, and the words quote the
-- machine rather than restating it. If notification_transition changes, the
-- error message changes with it and cannot drift out of date.
create or replace function public.nexus_notification_refuse_transition(
  p_notification_id uuid,
  p_from            text,
  p_to              text,
  p_verb            text
) returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
declare v_legal text;
begin
  select coalesce(
           string_agg(t.to_state || ' (via ' || t.verb || ')', ', ' order by t.to_state),
           'none -- ' || p_from || ' is where a notification stops')
    into v_legal
    from public.notification_transition t
   where t.from_state = p_from;

  raise exception using errcode = 'P0001',
    message = format(
      'NX996 REFUSED: %s cannot move notification %s from %s to %s. Legal moves from %s: %s.',
      p_verb, p_notification_id, p_from, p_to, p_from, v_legal),
    detail  = format('The state machine is data, not code: select * from public.notification_transition where from_state = %L.', p_from),
    hint    = 'A notification that ran out of attempts, or that a human already acknowledged, is finished. Enqueue a new one instead of rewriting the old one.';
end
$fn$;

comment on function public.nexus_notification_refuse_transition(uuid, text, text, text) is
  'The single place an illegal state move is refused. Reads '
  'notification_transition to list what WAS allowed, so the error teaches the '
  'caller the machine instead of just saying no.';

revoke all on function public.nexus_notification_refuse_transition(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexus_notification_refuse_transition(uuid, text, text, text)
  to service_role;

-- ── The write path: service_role only, five verbs ─────────────────────────
-- Never anon, never authenticated. anon may already call
-- nexus_sales_lead_submit (NX974) and that is the one door it gets; it must
-- not also be able to enqueue work, claim work, or declare that somebody was
-- told when nobody was.

-- enqueue ------------------------------------------------------------------
create or replace function public.nexus_notification_enqueue(
  p_sales_lead_id uuid,
  p_channel       text default 'EMAIL',
  p_reason        text default 'NEW_SALES_LEAD'
) returns table (
  notification_id uuid,
  state           text,
  was_duplicate   boolean,
  evidence        text
)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now  timestamptz := now();
  v_ch   text := upper(btrim(coalesce(p_channel, 'EMAIL')));
  v_id   uuid;
  v_st   text;
begin
  if not exists (select 1 from public.nexus_sales_lead s where s.id = p_sales_lead_id) then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: no NEXUS sales lead with that id, so this notification would be about nobody.';
  end if;

  -- One LIVE notification per lead per channel. A second enqueue while one is
  -- still pending is the same person being told twice about the same enquiry.
  select o.notification_id, o.state into v_id, v_st
    from public.nexus_notification_outbox o
   where o.sales_lead_id = p_sales_lead_id
     and o.channel = v_ch
     and o.state in ('PENDING','RETRYING')
   limit 1;

  if found then
    notification_id := v_id;
    state           := v_st;
    was_duplicate   := true;
    evidence        := 'Already queued on ' || v_ch || ' and still ' || v_st ||
                       '. Not queued a second time -- one enquiry, one notification.';
    return next;
    return;
  end if;

  insert into public.nexus_notification_outbox (sales_lead_id, channel, reason)
  values (p_sales_lead_id, v_ch, p_reason)
  returning nexus_notification_outbox.notification_id into v_id;

  insert into public.notification_attempt
    (notification_id, attempt_no, event, from_state, to_state)
  values (v_id, 0, 'ENQUEUED', null, 'PENDING');

  notification_id := v_id;
  state           := 'PENDING';
  was_duplicate   := false;
  evidence        := 'Queued on ' || v_ch || '. Nothing sends it: no transport is wired to this queue, '
                     'so it will stay PENDING until one exists. The lead itself is safe either way.';
  return next;
end
$fn$;

comment on function public.nexus_notification_enqueue(uuid, text, text) is
  'Puts one "somebody needs to be told" row in the outbox for a NEXUS sales '
  'lead. Idempotent while a notification for that lead and channel is still '
  'live, so a retrying submission does not queue the same enquiry twice. Sends '
  'nothing. service_role only.';

-- The bridge: storing a lead and telling somebody, kept apart --------------
-- AFTER INSERT, and the whole body is wrapped in an exception block that
-- swallows everything. This is deliberate and is the single most important
-- line in the migration: if the outbox is broken, misconfigured, or dropped,
-- the lead INSERT must still commit. A notification failure can lose a
-- notification. It can never lose a lead.
create or replace function public.nexus_sales_lead_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
begin
  begin
    perform public.nexus_notification_enqueue(new.id, 'EMAIL', 'NEW_SALES_LEAD');
  exception when others then
    -- Swallowed on purpose. Raised as a warning so it lands in the Postgres
    -- log where an operator can find it, and NOT re-raised, because
    -- re-raising here would roll back the prospect along with the queue row.
    raise warning 'NX996: could not enqueue a notification for sales lead % (%): %',
      new.id, sqlstate, sqlerrm;
  end;
  return null;
end
$fn$;

comment on function public.nexus_sales_lead_enqueue_notification() is
  'Queues a notification the moment a NEXUS sales lead is stored. Swallows '
  'every error it meets: the lead is the thing that must survive, and a queue '
  'that can roll back an INSERT has re-tangled the two concerns this migration '
  'exists to separate. Failures surface as Postgres warnings, and as a lead '
  'with no outbox row -- which nexus_notification_status() reports by name.';

revoke all on function public.nexus_sales_lead_enqueue_notification() from public, anon, authenticated;

drop trigger if exists nexus_sales_lead_enqueue_notification on public.nexus_sales_lead;
create trigger nexus_sales_lead_enqueue_notification
  after insert on public.nexus_sales_lead
  for each row execute function public.nexus_sales_lead_enqueue_notification();

-- claim --------------------------------------------------------------------
create or replace function public.nexus_notification_claim(
  p_worker        text,
  p_channel       text default null,
  p_limit         int  default 10,
  p_lease_seconds int  default 300
) returns table (
  notification_id  uuid,
  sales_lead_id    uuid,
  channel          text,
  reason           text,
  attempt_no       int,
  max_attempts     int,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now    timestamptz := now();
  v_worker text := nullif(btrim(coalesce(p_worker, '')), '');
  v_ch     text := nullif(upper(btrim(coalesce(p_channel, ''))), '');
begin
  if v_worker is null then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: a claim with no worker name cannot be traced back to anything when it goes wrong.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: claim a batch between 1 and 200. A worker that claims everything owns everything, including its own crash.';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: the lease must be between 30 seconds and one hour. Shorter duplicates sends; longer strands rows behind a dead worker.';
  end if;

  return query
  with due as (
    select o.notification_id
      from public.nexus_notification_outbox o
     where o.state in ('PENDING','RETRYING')
       and o.next_attempt_at <= v_now
       and o.attempt_count < o.max_attempts
       and (v_ch is null or o.channel = v_ch)
     order by o.next_attempt_at, o.created_at
     limit p_limit
     for update skip locked
  ),
  claimed as (
    update public.nexus_notification_outbox o
       set attempt_count   = o.attempt_count + 1,
           claimed_at      = v_now,
           claimed_by      = v_worker,
           -- The lease. Push the row out of reach for the length of one send;
           -- if the worker dies without reporting, it comes back by itself.
           next_attempt_at = v_now + make_interval(secs => p_lease_seconds),
           updated_at      = v_now
     where o.notification_id in (select d.notification_id from due d)
    returning o.notification_id, o.sales_lead_id, o.channel, o.reason,
              o.state, o.attempt_count, o.max_attempts, o.next_attempt_at
  ),
  -- Unreferenced on purpose: a data-modifying CTE always runs to completion.
  logged as (
    insert into public.notification_attempt
      (notification_id, attempt_no, event, from_state, to_state, worker)
    select c.notification_id, c.attempt_count, 'CLAIMED', c.state, c.state, v_worker
      from claimed c
    returning notification_attempt.attempt_id
  )
  select c.notification_id, c.sales_lead_id, c.channel, c.reason,
         c.attempt_count, c.max_attempts, c.next_attempt_at
    from claimed c
   order by c.notification_id;
end
$fn$;

comment on function public.nexus_notification_claim(text, text, int, int) is
  'Leases up to p_limit due notifications to a named worker: bumps the attempt '
  'count, stamps who took them, and pushes next_attempt_at forward by the '
  'lease so a worker that dies mid-send releases its rows instead of holding '
  'them forever. FOR UPDATE SKIP LOCKED, so two workers never take the same '
  'row. Claiming is NOT a state change -- a claimed row is still PENDING or '
  'RETRYING, because nothing has happened to it yet. Returns the lead id and '
  'nothing about the prospect: the sender reads those from nexus_sales_lead. '
  'service_role only.';

-- mark_sent ----------------------------------------------------------------
create or replace function public.nexus_notification_mark_sent(
  p_notification_id uuid,
  p_worker          text default null,
  p_detail          text default null
) returns table (
  notification_id uuid,
  state           text,
  sent_at         timestamptz,
  attempt_count   int,
  evidence        text
)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now  timestamptz := now();
  v_prev text;
  v_att  int;
begin
  select o.state, o.attempt_count into v_prev, v_att
    from public.nexus_notification_outbox o
   where o.notification_id = p_notification_id
   for update;
  if not found then
    raise exception using errcode = 'P0001',
      message = format('NX996 REFUSED: no notification %s in the outbox.', p_notification_id);
  end if;

  if not exists (select 1 from public.notification_transition t
                  where t.from_state = v_prev and t.to_state = 'SENT') then
    perform public.nexus_notification_refuse_transition(
      p_notification_id, v_prev, 'SENT', 'nexus_notification_mark_sent');
  end if;

  if v_att < 1 then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: this notification was never claimed, so nothing can have sent it. Claim it first.';
  end if;

  update public.nexus_notification_outbox o
     set state           = 'SENT',
         sent_at         = v_now,
         claimed_at      = null,
         claimed_by      = null,
         last_error_code = null,
         updated_at      = v_now
   where o.notification_id = p_notification_id;

  insert into public.notification_attempt
    (notification_id, attempt_no, event, from_state, to_state, worker, error_detail)
  values (p_notification_id, v_att, 'SENT', v_prev, 'SENT',
          nullif(btrim(coalesce(p_worker,'')), ''), left(btrim(coalesce(p_detail,'')), 2000));

  notification_id := p_notification_id;
  state           := 'SENT';
  sent_at         := v_now;
  attempt_count   := v_att;
  evidence        := 'A sender reported handing this to a transport on attempt ' || v_att ||
                     '. That is the sender''s word, not proof a human read it -- it stays SENT '
                     'until somebody acknowledges it.';
  return next;
end
$fn$;

comment on function public.nexus_notification_mark_sent(uuid, text, text) is
  'Records that a sender reported handing one notification to a transport. '
  'Refuses a row that was never claimed, and refuses any move the state '
  'machine does not contain -- notably FAILED -> SENT, so an exhausted '
  'notification cannot be quietly declared delivered. Proves nothing about '
  'delivery; that is what acknowledge is for. service_role only.';

-- mark_failed --------------------------------------------------------------
create or replace function public.nexus_notification_mark_failed(
  p_notification_id uuid,
  p_error_code      text,
  p_error_detail    text default null,
  p_worker          text default null
) returns table (
  notification_id uuid,
  state           text,
  attempt_count   int,
  attempts_left   int,
  next_attempt_at timestamptz,
  evidence        text
)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now   timestamptz := now();
  v_prev  text;
  v_att   int;
  v_max   int;
  v_code  text := nullif(btrim(coalesce(p_error_code,'')), '');
  v_to    text;
  v_next  timestamptz;
  v_backoff_secs int;
begin
  if v_code is null then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: a failure with no error code teaches nobody anything. Say what went wrong.';
  end if;

  select o.state, o.attempt_count, o.max_attempts into v_prev, v_att, v_max
    from public.nexus_notification_outbox o
   where o.notification_id = p_notification_id
   for update;
  if not found then
    raise exception using errcode = 'P0001',
      message = format('NX996 REFUSED: no notification %s in the outbox.', p_notification_id);
  end if;
  if v_att < 1 then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: this notification was never claimed, so nothing can have failed to send it. Claim it first.';
  end if;

  -- Attempts are spent, not counted down: the claim already burned one.
  v_to := case when v_att >= v_max then 'FAILED' else 'RETRYING' end;

  if not exists (select 1 from public.notification_transition t
                  where t.from_state = v_prev and t.to_state = v_to) then
    perform public.nexus_notification_refuse_transition(
      p_notification_id, v_prev, v_to, 'nexus_notification_mark_failed');
  end if;

  -- Exponential backoff, capped at an hour. 1st failure waits 1 minute, then
  -- 2, 4, 8, 16 -- long enough that a provider outage is not hammered, short
  -- enough that a prospect is not left a day cold by a transient 500.
  v_backoff_secs := least(3600, (60 * power(2, greatest(0, v_att - 1)))::int);
  v_next := case when v_to = 'RETRYING' then v_now + make_interval(secs => v_backoff_secs)
                 else v_now end;

  update public.nexus_notification_outbox o
     set state             = v_to,
         last_error_code   = v_code,
         last_error_detail = left(btrim(coalesce(p_error_detail,'')), 2000),
         next_attempt_at   = v_next,
         claimed_at        = null,
         claimed_by        = null,
         updated_at        = v_now
   where o.notification_id = p_notification_id;

  insert into public.notification_attempt
    (notification_id, attempt_no, event, from_state, to_state, worker, error_code, error_detail)
  values (p_notification_id, v_att,
          case when v_to = 'RETRYING' then 'RETRY_SCHEDULED' else 'FAILED' end,
          v_prev, v_to, nullif(btrim(coalesce(p_worker,'')), ''),
          v_code, left(btrim(coalesce(p_error_detail,'')), 2000));

  notification_id := p_notification_id;
  state           := v_to;
  attempt_count   := v_att;
  attempts_left   := greatest(0, v_max - v_att);
  next_attempt_at := v_next;
  evidence        := case when v_to = 'RETRYING'
    then 'Attempt ' || v_att || ' of ' || v_max || ' failed with ' || v_code ||
         '. Claimable again in ' || (v_backoff_secs / 60) || ' minute(s) -- if anything is running to claim it.'
    else 'All ' || v_max || ' attempts are spent and the last failed with ' || v_code ||
         '. Nothing will pick this up again. A person has to read last_error_detail and decide.'
  end;
  return next;
end
$fn$;

comment on function public.nexus_notification_mark_failed(uuid, text, text, text) is
  'Records that one send attempt failed, and decides what that means: RETRYING '
  'with an exponential backoff while attempts remain, FAILED once they are '
  'spent. Refuses a blank error code and refuses a row that was never claimed. '
  'FAILED is terminal -- re-raising a dead notification is a new enqueue, so '
  'the failure stays on the record. service_role only.';

-- acknowledge --------------------------------------------------------------
create or replace function public.nexus_notification_acknowledge(
  p_notification_id  uuid,
  p_acknowledged_by  text
) returns table (
  notification_id uuid,
  state           text,
  acknowledged_at timestamptz,
  evidence        text
)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now  timestamptz := now();
  v_prev text;
  v_att  int;
  v_who  text := nullif(btrim(coalesce(p_acknowledged_by,'')), '');
begin
  if v_who is null then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: an acknowledgement with nobody''s name on it is not an acknowledgement.';
  end if;

  select o.state, o.attempt_count into v_prev, v_att
    from public.nexus_notification_outbox o
   where o.notification_id = p_notification_id
   for update;
  if not found then
    raise exception using errcode = 'P0001',
      message = format('NX996 REFUSED: no notification %s in the outbox.', p_notification_id);
  end if;

  if not exists (select 1 from public.notification_transition t
                  where t.from_state = v_prev and t.to_state = 'ACKNOWLEDGED') then
    perform public.nexus_notification_refuse_transition(
      p_notification_id, v_prev, 'ACKNOWLEDGED', 'nexus_notification_acknowledge');
  end if;

  update public.nexus_notification_outbox o
     set state           = 'ACKNOWLEDGED',
         acknowledged_at = v_now,
         acknowledged_by = left(v_who, 160),
         updated_at      = v_now
   where o.notification_id = p_notification_id;

  insert into public.notification_attempt
    (notification_id, attempt_no, event, from_state, to_state, worker)
  values (p_notification_id, v_att, 'ACKNOWLEDGED', v_prev, 'ACKNOWLEDGED', left(v_who, 160));

  notification_id := p_notification_id;
  state           := 'ACKNOWLEDGED';
  acknowledged_at := v_now;
  evidence        := left(v_who, 160) || ' confirmed they received it. This is the only state in '
                     'which somebody is known to actually know about the prospect.';
  return next;
end
$fn$;

comment on function public.nexus_notification_acknowledge(uuid, text) is
  'Records that a named human confirmed they actually received the '
  'notification. Only legal from SENT: a notification nobody tried to send '
  'cannot have been received, and one that failed outright certainly was not. '
  'Refuses an anonymous acknowledgement. service_role only.';

revoke all on function public.nexus_notification_enqueue(uuid, text, text)              from public, anon, authenticated;
revoke all on function public.nexus_notification_claim(text, text, int, int)            from public, anon, authenticated;
revoke all on function public.nexus_notification_mark_sent(uuid, text, text)            from public, anon, authenticated;
revoke all on function public.nexus_notification_mark_failed(uuid, text, text, text)    from public, anon, authenticated;
revoke all on function public.nexus_notification_acknowledge(uuid, text)                from public, anon, authenticated;
grant execute on function public.nexus_notification_enqueue(uuid, text, text)           to service_role;
grant execute on function public.nexus_notification_claim(text, text, int, int)         to service_role;
grant execute on function public.nexus_notification_mark_sent(uuid, text, text)         to service_role;
grant execute on function public.nexus_notification_mark_failed(uuid, text, text, text) to service_role;
grant execute on function public.nexus_notification_acknowledge(uuid, text)             to service_role;

-- ── The read path ─────────────────────────────────────────────────────────
-- service_role only, and NOT granted to authenticated -- deliberately. The
-- rows behind this accessor are NEXUS's own vendor pipeline (NX974). A
-- dealership's signed-in staff have no business reading who else is thinking
-- about buying NEXUS, so this is shaped for an owner-side console running with
-- a server-side key, not for the tenant dashboard. There is no such screen
-- today; see ops/launch/NOTIFICATION-STATUS.md.
create or replace function public.nexus_notification_status(p_hours int default 168)
returns table (
  state                    text,
  meaning                  text,
  needs_attention          boolean,
  notification_count       bigint,
  oldest_created_at        timestamptz,
  oldest_age_hours         numeric,
  earliest_next_attempt_at timestamptz,
  last_error_code          text,
  evidence                 text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_now   timestamptz := now();
  v_since timestamptz;
  v_senders int := 0;   -- Nothing is wired to this queue. Stated, not guessed.
begin
  if p_hours is null or p_hours < 1 or p_hours > 8760 then
    raise exception using errcode = 'P0001',
      message = 'NX996 REFUSED: ask for a window between 1 hour and one year.';
  end if;
  v_since := v_now - make_interval(hours => p_hours);

  return query
  with agg as (
    select k.state as st, k.meaning as mn, k.needs_attention as na, k.sort_order as so,
           count(o.notification_id)                              as n,
           min(o.created_at)                                     as oldest,
           min(o.next_attempt_at) filter (where k.is_live)        as nxt,
           (array_agg(o.last_error_code order by o.updated_at desc)
              filter (where o.last_error_code is not null))[1]    as err
      from public.notification_state k
      left join public.nexus_notification_outbox o
             on o.state = k.state and o.created_at >= v_since
     group by k.state, k.meaning, k.needs_attention, k.sort_order
  )
  select u.state, u.meaning, u.needs_attention, u.notification_count,
         u.oldest_created_at, u.oldest_age_hours, u.earliest_next_attempt_at,
         u.last_error_code, u.evidence
    from (
  select
    agg.st, agg.mn, agg.na, agg.n, agg.oldest,
    round(extract(epoch from (v_now - agg.oldest)) / 3600.0, 1),
    agg.nxt, agg.err,
    case
      when agg.n = 0 then 'None in the last ' || p_hours || ' hour(s).'
      when agg.st = 'PENDING' then
        agg.n || ' enquiry(ies) written down and nobody told. ' ||
        case when v_senders = 0
             then 'No sender is wired to this queue, so these will not move on their own -- they are waiting for something that does not exist yet.'
             else 'Waiting for a worker.' end
      when agg.st = 'RETRYING' then
        agg.n || ' failing and re-queued, last error ' || coalesce(agg.err, 'unrecorded') ||
        '. Next due ' || coalesce(to_char(agg.nxt at time zone 'Asia/Dubai', 'DD Mon HH24:MI'), 'unknown') || ' Dubai time.'
      when agg.st = 'SENT' then
        agg.n || ' handed to a transport and not yet confirmed by a human. SENT is the sender''s claim, not a receipt.'
      when agg.st = 'FAILED' then
        agg.n || ' gave up entirely, last error ' || coalesce(agg.err, 'unrecorded') ||
        '. Nothing will retry these. Each one is a dealership that asked for an audit and was never answered.'
      when agg.st = 'ACKNOWLEDGED' then
        agg.n || ' confirmed received by a named human.'
      else agg.n || ' in ' || agg.st || '.'
    end,
    agg.so
  from agg

  union all

  -- Not a notification state. This row counts NEXUS sales leads that have NO
  -- outbox row at all, which is exactly what a swallowed enqueue failure looks
  -- like from the outside. It belongs on the same screen as the five states
  -- because it is the one failure mode the queue itself cannot report.
  select
    'NO_NOTIFICATION',
    'Sales leads with no outbox row at all. Not a notification state -- these are enquiries the queue never heard about.',
    true,
    count(*),
    min(s.received_at),
    round(extract(epoch from (v_now - min(s.received_at))) / 3600.0, 1),
    null::timestamptz,
    null::text,
    case when count(*) = 0
         then 'Every sales lead in the window has a notification row.'
         else count(*) || ' sales lead(s) arrived with no notification queued. Either they predate this outbox, '
              'or the enqueue was swallowed to protect the lead (which is the correct trade and still needs a human).'
    end,
    99
  from public.nexus_sales_lead s
  where s.received_at >= v_since
    and not exists (select 1 from public.nexus_notification_outbox o
                     where o.sales_lead_id = s.id)
    ) u (state, meaning, needs_attention, notification_count, oldest_created_at,
         oldest_age_hours, earliest_next_attempt_at, last_error_code, evidence, sort_order)
   -- The five states in their stated order, then the row that is not a state.
   order by u.sort_order;
end
$fn$;

comment on function public.nexus_notification_status(int) is
  'The honest state of the notification queue: one row per state with counts, '
  'ages, the next due time and the last error, plus a NO_NOTIFICATION row '
  'counting sales leads the queue never heard about. Says in words that '
  'nothing drains this queue, because a screen showing "4 PENDING" without '
  'that sentence reads like progress. service_role only -- the rows behind it '
  'are NEXUS''s own vendor pipeline and are not a dealership''s to read.';

revoke all on function public.nexus_notification_status(int) from public, anon, authenticated;
grant execute on function public.nexus_notification_status(int) to service_role;

-- ── The leads that are already stranded ───────────────────────────────────
-- Four of them on production at the time of writing, all with contacted_at
-- IS NULL. They get a queue row so they are in the queue the day a sender
-- exists. Nothing here marks them contacted and nothing pretends anybody was
-- told: they land as PENDING, exactly like the truth.
do $backfill$
declare r record; n int := 0;
begin
  for r in
    select s.id from public.nexus_sales_lead s
     where s.contacted_at is null
       and not exists (select 1 from public.nexus_notification_outbox o
                        where o.sales_lead_id = s.id and o.channel = 'EMAIL')
     order by s.received_at
  loop
    perform public.nexus_notification_enqueue(r.id, 'EMAIL', 'NEW_SALES_LEAD');
    n := n + 1;
  end loop;
  raise notice 'NX996: enqueued % previously stranded sales lead(s). They are queued, not sent.', n;
end
$backfill$;

-- ── Verify, or roll the whole thing back ──────────────────────────────────
do $verify$
declare n int;
begin
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('notification_state','notification_transition',
                       'nexus_notification_outbox','notification_attempt')
     and c.relrowsecurity;
  if n <> 4 then
    raise exception 'NX996: expected RLS enabled on 4 tables, found %. Rolling back.', n;
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('notification_state','notification_transition',
                        'nexus_notification_outbox','notification_attempt')
     and grantee in ('anon','authenticated','PUBLIC');
  if n <> 0 then
    raise exception 'NX996: anon, authenticated or PUBLIC holds % grant(s) on the outbox tables. Rolling back.', n;
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where ns.nspname = 'public' and not t.tgisinternal
     and p.proname = 'nexus_refuse_destructive_write'
     and c.relname in ('nexus_notification_outbox','notification_attempt');
  if n <> 4 then
    raise exception 'NX996: expected 4 destructive-write guard triggers, found %. Rolling back.', n;
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and c.relname = 'notification_attempt'
     and p.proname = 'nexus_notification_attempt_is_append_only';
  if n <> 1 then
    raise exception 'NX996: the attempt history is editable -- append-only trigger missing. Rolling back.';
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and c.relname = 'nexus_sales_lead'
     and p.proname = 'nexus_sales_lead_enqueue_notification';
  if n <> 1 then
    raise exception 'NX996: a stored lead would still tell nobody -- enqueue trigger missing. Rolling back.';
  end if;

  select count(*) into n from public.notification_state;
  if n <> 5 then raise exception 'NX996: expected 5 states, found %. Rolling back.', n; end if;
  select count(*) into n from public.notification_transition;
  if n <> 7 then raise exception 'NX996: expected 7 legal transitions, found %. Rolling back.', n; end if;

  -- No browser role may touch the queue in any direction.
  if has_function_privilege('anon',          'public.nexus_notification_enqueue(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_notification_claim(text,text,int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_notification_mark_sent(uuid,text,text)', 'execute')
     or has_function_privilege('anon',          'public.nexus_notification_mark_failed(uuid,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_notification_acknowledge(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_notification_status(int)', 'execute')
  then
    raise exception 'NX996: a browser role can reach the notification queue. Rolling back.';
  end if;

  -- The boundary NX974 drew, restated as a test: nothing in this outbox may
  -- point at a tenant.
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('nexus_notification_outbox','notification_attempt')
     and column_name in ('tenant_id','dealership_id');
  if n <> 0 then
    raise exception 'NX996: the vendor outbox grew a tenant column. A NEXUS prospect is not a dealership customer. Rolling back.';
  end if;

  raise notice 'NX996: a stored lead now leaves a durable notification row. 4 tables, 5 write verbs, 1 read accessor, 5 guard triggers plus the enqueue trigger, append-only history. Nothing sends anything -- see ops/launch/NOTIFICATION-STATUS.md.';
end
$verify$;

commit;
