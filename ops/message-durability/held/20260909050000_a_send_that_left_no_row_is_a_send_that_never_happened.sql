-- A send that left no row is a send that never happened
-- =====================================================================
-- 9 September 2026. HELD — not applied to any project, not to production
-- `dsvuoovivysszdoiorch` and not to staging `wwspuxrbiyagnrnzgate`. It lives in
-- ops/message-durability/held/ and NOT in supabase/migrations/ on purpose: a
-- file in that folder is a statement that the change should be applied, and this
-- one has an unresolved cross-owner dependency (see BEFORE THIS MOVES, §1).
--
-- Measured basis: ops/message-durability/GAP-MEASURED.md (9 Sep 2026).
-- Design and the arguments for every decision: ops/message-durability/DESIGN.md.
-- Inbound half of the defect: ops/message-durability/P0-CLAIMED-NEVER-LOGGED.md.
-- Table shape it extends: ops/channel-events/WIRING-SPEC.md.
--
-- ---------------------------------------------------------------------
-- WHAT IS WRONG, measured on production today
-- ---------------------------------------------------------------------
--
--   * 0 of 142 communication_logs rows carry an external_message_id.
--   * 0 of 6 WhatsApp send call sites capture the provider's message id.
--   * 0 of 6 persist a send outcome as data.
--   * 1 of 6 (whatsapp_send_dashboard_reply → `Respond Send Failed`, a terminal
--     Set node) persists NOTHING when the send fails. Its own text says so:
--     "Nothing was sent and nothing was logged".
--   * 5 of 6 write an outbound "we said this" row EVEN WHEN THE SEND FAILED,
--     because onError:continueRegularOutput routes the error item down the same
--     main output the log node hangs off.
--   * channel_message_events (0 rows) requires external_message_id NOT NULL and
--     provider-id-shaped, so a rejected send CANNOT BE RECORDED AT ALL.
--   * channel_message_events has no append-only trigger, while its sibling
--     whatsapp_delivery_events does — and n8n's `Prune Dedupe Guard` already
--     DELETEs processed_messages older than 7 days, which erased one of the six
--     rows the P0 was written about (6 on 8 Sep, 5 on 9 Sep, and the invariant
--     goes green on its own around 15 Sep with nothing fixed).
--
-- ---------------------------------------------------------------------
-- THE VOCABULARY RULE, and why this file touches a table it does not own
-- ---------------------------------------------------------------------
--
-- ops/f2-tenant-rule/RECONCILIATION.md: a producer emitting
-- exact_year|model_only|weak against a consumer filtering {exact,strong} made a
-- structurally empty filter that was read for a week as "no good data" rather
-- than as a vocabulary mismatch. Two providers and four event types is the same
-- trap, doubled.
--
-- So: NO CHECK CONSTRAINT IN THIS FILE HOLDS A COPY OF A VOCABULARY. Every
-- allowed value lives in exactly one catalogue table and is enforced by FOREIGN
-- KEY, following the precedent this schema already sets with
--     lead_event.(origin_verified, provenance_counts_as_real)
--        -> lead_provenance_kind(kind, counts_as_real).
-- A writer emitting an unknown value gets 23503 at INSERT: the row is refused,
-- the caller sees the constraint name, and nothing silently vanishes from every
-- read. A writer emitting a known value with a contradictory classification also
-- gets 23503, because the classification travels with it in a composite key.
--
-- The five send outcomes already exist, in a CHECK on channel_send_directive
-- (csd_send_result_check) where nothing else in the database can see them. This
-- migration seeds the catalogue with THOSE EXACT SPELLINGS, then drops that
-- CHECK and replaces it with a foreign key. After this file, the five strings
-- exist in one place. That is the whole reason it reaches outside its own table.
--
-- ---------------------------------------------------------------------
-- THE TWO EVENT-TRIGGER GUARDS, and how this file survives them
-- ---------------------------------------------------------------------
--
-- Both are live, confirmed today:
--   nexus_guard_security_invoker_views  ddl_command_end -> nexus_require_security_invoker_views
--   nexus_guard_born_open_grants        ddl_command_end -> nexus_guard_born_open_grants
--
-- 1. nexus_require_security_invoker_views fires on the ddl_command_end of a
--    CREATE VIEW. `security_invoker = on` is therefore INLINED in every CREATE
--    VIEW below, as `create view … with (security_invoker = on) as …`. A
--    following `ALTER VIEW … SET (security_invoker = on)` is too late and the
--    CREATE aborts with 42501. There is no ALTER VIEW in this file.
--
-- 2. nexus_guard_born_open_grants fires on ddl_command_end for CREATE TABLE and
--    ALTER TABLE and, for anything in `public`, runs
--        revoke all on <obj> from anon;
--        revoke insert, update, delete, truncate on <obj> from authenticated;
--    This file contains ALTER TABLE on two tables. Their measured grants, plus
--    the one it deliberately does NOT alter, are:
--        channel_message_events   postgres, service_role : full set
--                                 authenticated, anon    : NOTHING
--        channel_send_directive   postgres, service_role : full set
--                                 authenticated, anon    : NOTHING
--        communication_logs       postgres, service_role : full set
--                                 authenticated          : SELECT
--                                 anon                   : NOTHING
--    so the guard's revokes are no-ops on the first two, and on the third it
--    revokes only write privileges `authenticated` does not hold. THE GUARD
--    STRIPS NOTHING LIVE HERE. Even so, §10 RE-ASSERTS every grant these tables
--    are meant to carry, after the last DDL statement, so the file is correct
--    even if a grant is added between now and the day it is applied.
--    THIS FILE DOES NOT ALTER communication_logs — see §8 for why that column is
--    deliberately absent — so only two ALTER TABLE targets exist.
--
--    ONE GRANT IS DELIBERATELY REDUCED, and it is not the guard doing it: §10
--    revokes UPDATE, DELETE and TRUNCATE on channel_message_events from
--    service_role. The append-only protection in §5d is a ROW trigger and
--    TRUNCATE does not fire row triggers, so leaving TRUNCATE granted would mean
--    the whole log could be erased by the same role that writes it. Both writers
--    are SECURITY DEFINER functions and run as the function owner, so they do
--    not consult service_role's grants; nothing loses a capability it uses.
--
-- ---------------------------------------------------------------------
-- BEFORE THIS MOVES TO supabase/migrations/
-- ---------------------------------------------------------------------
--
-- 1. §5 drops and replaces channel_message_events_cloud_requires_signature so
--    that an honest outbound Cloud row (origin_verified='unverified') is legal.
--    Today the constraint refuses the truth and accepts the lie
--    (origin_verified='hmac_sha256_x_hub' on a message nobody signed for us).
--    ops/channel-events/WIRING-SPEC.md §3.5 recommends exactly this ("Option A")
--    and says it is not that document's constraint to change. It is not this
--    one's either. THIS NEEDS THE SIGN-OFF OF WHOEVER OWNS THE CLOUD SIGNATURE
--    INVARIANT. Do not apply the file without it.
-- 2. Run it on staging `wwspuxrbiyagnrnzgate` first and prove the refusals
--    actually refuse. §11 gives seven statements and the SQLSTATE each must
--    raise. A guard nobody has seen go red is a guard nobody has tested.
-- 3. Confirm on the n8n box that no live workflow calls
--    nexus_record_channel_event with p_direction='outbound'. Under this file
--    such a call becomes 23503 rather than a bad row — loud, correct, and still
--    a behaviour change. The repository's exported workflows contain no such
--    call; the box was not read, and I am not permitted to read it.
-- 4. Nothing here writes a row of message data. It is DDL and catalogue seed
--    only. It changes no existing row: every table it alters holds 0 rows.
-- 5. **THIS FILE HAS NEVER BEEN PARSED BY A POSTGRES.** Both projects were
--    read-only to the agent that wrote it, so it was not run even inside an
--    aborted transaction. Treat the first staging run as a syntax check as well
--    as a behaviour check. Two constructs in it are worth watching in
--    particular: the foreign key onto the STORED GENERATED column
--    `provider_id_present` (permitted only with NO ACTION / RESTRICT referential
--    actions, which is why every FK here is ON DELETE RESTRICT), and the
--    reliance on the default NULLS DISTINCT behaviour of the existing UNIQUE
--    constraint once `external_message_id` becomes nullable.
--
-- ---------------------------------------------------------------------

begin;

-- =====================================================================
-- 1. The outcome vocabulary. ONE PLACE.
-- =====================================================================

create table if not exists public.channel_message_outcome (
  outcome                    text    primary key,
  -- Does an outcome of this kind come with a provider message id? This is the
  -- half of the claim a writer usually gets to assert unilaterally. Here it is
  -- FK-checked against reality (§5, provider_id_present).
  provider_id_expected       boolean not null,
  -- 'YES' | 'NO' | 'UNKNOWN'. Three values because "we called and cannot tell"
  -- is a real state and a boolean cannot say it.
  provider_accepted          text    not null,
  is_terminal                boolean not null,
  -- Does this outcome license the sentence "we contacted this customer"?
  -- Consumers JOIN this column. They do not hardcode a list of outcomes.
  counts_as_customer_contact boolean not null,
  -- Is this a loss the dealership should act on, as opposed to a decision?
  is_actionable_failure      boolean not null,
  meaning                    text    not null,
  what_would_change_it       text    not null,
  sort                       integer not null,
  constraint cmo_provider_accepted_check
    check (provider_accepted in ('YES','NO','UNKNOWN')),
  -- FK targets. A composite FK needs a matching unique on the referenced side.
  constraint cmo_outcome_provider_id_expected_key
    unique (outcome, provider_id_expected),
  constraint cmo_outcome_contact_key
    unique (outcome, counts_as_customer_contact),
  -- An outcome cannot both carry a provider id and claim the provider refused.
  constraint cmo_an_id_means_it_was_accepted
    check (not provider_id_expected or provider_accepted = 'YES'),
  -- Only a terminal outcome may license the contact claim.
  constraint cmo_only_terminal_counts_as_contact
    check (not counts_as_customer_contact or is_terminal)
);

comment on table public.channel_message_outcome is
  'The complete, single-source vocabulary of message-event outcomes. Referenced '
  'by foreign key from channel_message_events and channel_send_directive. Nothing '
  'anywhere may restate these values in a CHECK, an array literal or application '
  'code: a consumer selects by joining a property column (counts_as_customer_contact, '
  'is_actionable_failure, is_terminal), never by an IN list. See '
  'ops/f2-tenant-rule/RECONCILIATION.md for the week-long outage caused by two '
  'ends of one question spelling it differently.';

insert into public.channel_message_outcome
  (outcome, provider_id_expected, provider_accepted, is_terminal,
   counts_as_customer_contact, is_actionable_failure, meaning, what_would_change_it, sort)
values
  ('RECEIVED', true, 'YES', true, true, false,
   'An inbound message from the customer, whose provider id we hold.',
   'Nothing. This is the inbound terminal state.', 10),

  ('PENDING', false, 'UNKNOWN', false, false, false,
   'A send has been written ahead of the provider call and has not been settled. '
   'Written BEFORE the HTTP request leaves, so that a crash mid-send leaves a trace.',
   'A SEND_SETTLED row carrying the same attempt_id.', 20),

  ('ACCEPTED_BY_PROVIDER', true, 'YES', true, true, false,
   'The provider took the message and returned an id. Not proof of delivery — '
   'delivery is a later DELIVERY_STATUS event.',
   'Nothing; a delivery callback adds to it rather than changing it.', 30),

  ('REJECTED_BY_PROVIDER', false, 'NO', true, false, true,
   'The provider answered and refused. provider_error_code carries its reason.',
   'Fixing whatever the provider named and sending again, as a new attempt.', 40),

  ('TRANSPORT_ERROR', false, 'UNKNOWN', true, false, true,
   'We could not reach the provider, or it did not answer in time. The message '
   'may or may not have gone out; that is why provider_accepted is UNKNOWN.',
   'Reachability of the provider, then a new attempt.', 50),

  ('NOT_ATTEMPTED', false, 'NO', true, false, false,
   'A decision, not a failure: policy, messaging window, opt-out or capability '
   'said do not send. directive_id names the channel_send_directive row that decided.',
   'The condition the directive names in what_would_change_it.', 60),

  ('UNKNOWN_PROVIDER_OUTCOME', false, 'UNKNOWN', true, false, true,
   'A write-ahead attempt that was never settled and has been given up on by a '
   'reconciler. THIS IS THE ROW MOST SYSTEMS DROP. It is the honest answer to '
   '"did we contact this customer" when the honest answer is that we do not know.',
   'Reading the conversation in WhatsApp. Nothing in NEXUS can settle it.', 70),

  ('DELIVERED', true, 'YES', true, true, false,
   'The provider reported the message reached the customer''s device.',
   'Nothing.', 80),

  ('READ', true, 'YES', true, true, false,
   'The provider reported the customer opened it.', 'Nothing.', 90),

  ('FAILED_AFTER_ACCEPT', true, 'YES', true, false, true,
   'The provider accepted the message and later reported it failed. The id exists; '
   'the customer did not get it.',
   'The error the callback carried, then a new attempt.', 100)
on conflict (outcome) do nothing;

-- =====================================================================
-- 2. The event-type vocabulary. ONE PLACE.
-- =====================================================================

create table if not exists public.channel_message_event_type (
  event_type          text    primary key,
  -- Each event type belongs to exactly one direction, so (event_type, direction)
  -- is the composite that makes an inbound SEND_ATTEMPTED impossible.
  direction           text    not null,
  is_provider_reported boolean not null,
  meaning             text    not null,
  sort                integer not null,
  constraint cmet_direction_check check (direction in ('inbound','outbound')),
  constraint cmet_event_type_direction_key unique (event_type, direction)
);

comment on table public.channel_message_event_type is
  'The complete, single-source vocabulary of message event types. See the comment '
  'on channel_message_outcome: consumers join, they do not restate.';

insert into public.channel_message_event_type
  (event_type, direction, is_provider_reported, meaning, sort)
values
  ('MESSAGE_RECEIVED', 'inbound',  true,
   'A verified inbound message. One row per message per carrier.', 10),
  ('SEND_ATTEMPTED',   'outbound', false,
   'Written BEFORE the provider call. Carries attempt_id and no provider id.', 20),
  ('SEND_SETTLED',     'outbound', true,
   'Written after the provider answers, or after the caller gives up. Carries the '
   'same attempt_id and, if the send was accepted, the provider id.', 30),
  ('DELIVERY_STATUS',  'outbound', true,
   'A provider status callback about an already-settled outbound message.', 40)
on conflict (event_type) do nothing;

-- =====================================================================
-- 3. The legal (event_type, outcome) pairs. ONE PLACE.
--    This is what stops SEND_ATTEMPTED/DELIVERED and MESSAGE_RECEIVED/PENDING
--    without any CHECK constraint restating a literal.
-- =====================================================================

create table if not exists public.channel_message_event_outcome (
  event_type text not null references public.channel_message_event_type(event_type)
             on delete restrict,
  outcome    text not null references public.channel_message_outcome(outcome)
             on delete restrict,
  meaning    text not null,
  primary key (event_type, outcome)
);

comment on table public.channel_message_event_outcome is
  'Every combination of event type and outcome that may exist. A row in '
  'channel_message_events carries a composite foreign key onto this table, so an '
  'illegal pair is 23503 at INSERT rather than a row nobody''s filter matches.';

insert into public.channel_message_event_outcome (event_type, outcome, meaning) values
  ('MESSAGE_RECEIVED', 'RECEIVED',                 'The only inbound outcome.'),
  ('SEND_ATTEMPTED',   'PENDING',                  'The only attempt outcome. Write-ahead.'),
  ('SEND_SETTLED',     'ACCEPTED_BY_PROVIDER',     'Provider took it and named it.'),
  ('SEND_SETTLED',     'REJECTED_BY_PROVIDER',     'Provider answered no.'),
  ('SEND_SETTLED',     'TRANSPORT_ERROR',          'We never got an answer.'),
  ('SEND_SETTLED',     'NOT_ATTEMPTED',            'A decision not to send.'),
  ('SEND_SETTLED',     'UNKNOWN_PROVIDER_OUTCOME', 'A reconciler gave up on an unsettled attempt.'),
  ('DELIVERY_STATUS',  'DELIVERED',                'Provider callback: delivered.'),
  ('DELIVERY_STATUS',  'READ',                     'Provider callback: read.'),
  ('DELIVERY_STATUS',  'FAILED_AFTER_ACCEPT',      'Provider callback: failed after acceptance.')
on conflict (event_type, outcome) do nothing;

-- =====================================================================
-- 4. Catalogue grants and RLS.
--    These three tables are vocabulary, not tenant data. `authenticated` gets
--    SELECT deliberately: a dashboard that cannot READ the vocabulary is a
--    dashboard that will HARDCODE it, which is the f2 defect exactly.
-- =====================================================================

alter table public.channel_message_outcome       enable row level security;
alter table public.channel_message_event_type    enable row level security;
alter table public.channel_message_event_outcome enable row level security;

drop policy if exists cmo_read_all  on public.channel_message_outcome;
drop policy if exists cmet_read_all on public.channel_message_event_type;
drop policy if exists cmeo_read_all on public.channel_message_event_outcome;

create policy cmo_read_all  on public.channel_message_outcome
  for select to authenticated using (true);
create policy cmet_read_all on public.channel_message_event_type
  for select to authenticated using (true);
create policy cmeo_read_all on public.channel_message_event_outcome
  for select to authenticated using (true);

drop policy if exists cmo_service_all  on public.channel_message_outcome;
drop policy if exists cmet_service_all on public.channel_message_event_type;
drop policy if exists cmeo_service_all on public.channel_message_event_outcome;

create policy cmo_service_all  on public.channel_message_outcome
  for all to service_role using (true) with check (true);
create policy cmet_service_all on public.channel_message_event_type
  for all to service_role using (true) with check (true);
create policy cmeo_service_all on public.channel_message_event_outcome
  for all to service_role using (true) with check (true);

-- =====================================================================
-- 5. channel_message_events becomes the durability log.
--    The table holds 0 rows, so none of this rewrites data.
-- =====================================================================

-- 5a. A failed send has no provider id. Today the column is NOT NULL and
--     cme_extmsg_is_a_provider_id refuses anything that is not one, which is why
--     the row people actually need cannot exist.
--
--     The UNIQUE constraint channel_message_events_channel_direction_extmsg_key
--     IS DELIBERATELY LEFT ALONE. PostgreSQL's default NULLS DISTINCT means two
--     failed sends (both NULL) do not collide, while two deliveries of one
--     provider id still do — which is exactly the wanted behaviour. Keeping the
--     constraint by name also keeps nexus_record_channel_event's
--     `ON CONFLICT ON CONSTRAINT … DO NOTHING` working untouched, so the inbound
--     serialisation point that P0-CLAIMED-NEVER-LOGGED.md §3.2(c) depends on does
--     not move, and this file does not have to rewrite a SECURITY DEFINER
--     function whose source it would be re-deriving.

alter table public.channel_message_events
  alter column external_message_id drop not null;

alter table public.channel_message_events
  drop constraint if exists channel_message_events_extmsg_shape,
  drop constraint if exists cme_extmsg_is_a_provider_id;

alter table public.channel_message_events
  add constraint channel_message_events_extmsg_shape
    check (external_message_id is null
           or (external_message_id = btrim(external_message_id)
               and length(external_message_id) between 1 and 300)),
  -- Unchanged in substance from the constraint it replaces; only NULL-tolerant.
  -- Still refuses a per-attempt or per-delivery id masquerading as a message id.
  add constraint cme_extmsg_is_a_provider_id
    check (external_message_id is null
           or (external_message_id !~ '[[:space:]]'
               and length(external_message_id) >= 8
               and external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
               and external_message_id !~ '^[0-9]+$')),
  -- An inbound message always has a provider id. Only a send can lack one.
  add constraint cme_inbound_always_has_a_provider_id
    check (direction <> 'inbound' or external_message_id is not null);

-- 5b. The write-ahead columns.

alter table public.channel_message_events
  -- Defaults chosen so the existing inbound writer (nexus_record_channel_event,
  -- called by the Cloud receiver) keeps working with no change: it inserts an
  -- inbound row and gets MESSAGE_RECEIVED/RECEIVED. An OUTBOUND insert through
  -- that same function now fails 23503 on the (event_type, direction) foreign
  -- key, which is intended: outbound goes through §6's two functions.
  add column if not exists event_type text not null default 'MESSAGE_RECEIVED',
  add column if not exists outcome    text not null default 'RECEIVED',
  -- Ours, minted before the provider call. Never sent to the provider (neither
  -- WAHA nor Cloud accepts a client id today) and never confused with one.
  add column if not exists attempt_id uuid,
  add column if not exists attempt_no smallint not null default 1,
  add column if not exists requested_at timestamptz,
  add column if not exists settled_at   timestamptz,
  add column if not exists provider_error_code   text,
  add column if not exists provider_error_detail text,
  add column if not exists provider_http_status  smallint,
  add column if not exists directive_id uuid,
  add column if not exists recorded_by  text;

-- The generated column the writer cannot lie about. It is the second half of the
-- composite key onto channel_message_outcome, so "ACCEPTED_BY_PROVIDER with no
-- id" and "TRANSPORT_ERROR with an id" are both 23503.
alter table public.channel_message_events
  add column if not exists provider_id_present boolean
    generated always as (external_message_id is not null) stored;

alter table public.channel_message_events
  add constraint cme_event_type_matches_direction
    foreign key (event_type, direction)
    references public.channel_message_event_type(event_type, direction)
    on delete restrict,
  add constraint cme_event_type_outcome_is_legal
    foreign key (event_type, outcome)
    references public.channel_message_event_outcome(event_type, outcome)
    on delete restrict,
  -- ON DELETE RESTRICT only: PostgreSQL forbids a referencing generated column
  -- under CASCADE/SET NULL/SET DEFAULT.
  add constraint cme_outcome_agrees_about_the_provider_id
    foreign key (outcome, provider_id_present)
    references public.channel_message_outcome(outcome, provider_id_expected)
    on delete restrict,
  add constraint cme_directive_id_fkey
    foreign key (directive_id)
    references public.channel_send_directive(directive_id)
    on delete restrict;

alter table public.channel_message_events
  -- Every outbound row is an attempt or about one, so it carries our id.
  -- No inbound row does: there was no attempt.
  add constraint cme_outbound_carries_an_attempt_id
    check ((direction = 'outbound') = (attempt_id is not null)),
  add constraint cme_attempt_no_is_positive
    check (attempt_no >= 1),
  -- A settled row is settled at a time; an in-flight one is not.
  add constraint cme_settled_at_matches_terminality
    check (settled_at is null or settled_at >= coalesce(requested_at, settled_at)),
  add constraint cme_error_fields_are_outbound_only
    check ((provider_error_code is null and provider_error_detail is null
            and provider_http_status is null)
           or direction = 'outbound'),
  -- Provider error bodies echo request headers more often than anyone expects.
  -- Same rule as csd_credential_ref_is_not_a_secret on channel_send_directive.
  add constraint cme_error_detail_is_not_a_secret
    check (provider_error_detail is null
           or (length(provider_error_detail) <= 2000
               and provider_error_detail !~* '(eyJ[A-Za-z0-9_-]{10}|sk-[A-Za-z0-9]{10}|sb_secret_|sbp_|service_role)')),
  add constraint cme_error_code_shape
    check (provider_error_code is null
           or (length(provider_error_code) between 1 and 100
               and provider_error_code = btrim(provider_error_code))),
  add constraint cme_http_status_shape
    check (provider_http_status is null
           or provider_http_status between 100 and 599),
  add constraint cme_recorded_by_shape
    check (recorded_by is null
           or (length(recorded_by) between 1 and 120
               and recorded_by = btrim(recorded_by)));

-- One SEND_ATTEMPTED and one SEND_SETTLED per attempt, and no more.
-- This is the idempotency key for the case where the provider gives us nothing:
-- it absorbs OUR retries of the same logical send. It cannot absorb a
-- provider-side duplicate, and nothing can — see DESIGN.md §3, last paragraph.
create unique index if not exists channel_message_events_attempt_key
  on public.channel_message_events (tenant_id, attempt_id, event_type)
  where attempt_id is not null;

-- The predicate whatsapp_record_delivery_status should use once integration_id
-- is added to it (DESIGN.md §5) is served exactly by the existing unique index.
-- This one serves the reconciler: which attempts are still in flight.
create index if not exists channel_message_events_unsettled_idx
  on public.channel_message_events (tenant_id, requested_at)
  where event_type = 'SEND_ATTEMPTED';

-- 5c. The Cloud outbound constraint.
--     TODAY: `provider <> 'whatsapp_cloud' OR origin_verified = 'hmac_sha256_x_hub'`.
--     On an INBOUND Cloud row that is load-bearing and correct — Meta signed it.
--     On an OUTBOUND row it refuses the truth (origin_verified='unverified': we
--     made the call, nobody signed anything) and accepts the lie. Because
--     whatsapp_message_usage.event_id is a NOT NULL FK to this table, it also
--     makes recording the COST of a WhatsApp Cloud message impossible, forever.
--     ops/channel-events/WIRING-SPEC.md §3.5 recommends exactly this narrowing
--     and declines to make it. So does this file: see BEFORE THIS MOVES §1.
alter table public.channel_message_events
  drop constraint if exists channel_message_events_cloud_requires_signature;

alter table public.channel_message_events
  add constraint channel_message_events_cloud_requires_signature
    check (provider <> 'whatsapp_cloud'
           or direction <> 'inbound'
           or origin_verified = 'hmac_sha256_x_hub');

-- 5d. Append-only. channel_message_events had NO such trigger while its sibling
--     whatsapp_delivery_events did, and service_role holds UPDATE, DELETE and
--     TRUNCATE on it. Given that a scheduled n8n DELETE has already erased one
--     of the six rows the P0 was written about (from processed_messages), this
--     is not a theoretical protection.
--
--     An outcome is never edited. It is superseded by a later event row.

create or replace function public.channel_message_events_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception
    'channel_message_events is append-only: % is not permitted. A message''s '
    'state changes by writing a later event row (SEND_SETTLED, DELIVERY_STATUS), '
    'never by editing or removing an earlier one. A row here is the only evidence '
    'that a customer was or was not contacted.', tg_op
    using errcode = '42501';
  return null;
end
$$;

revoke all on function public.channel_message_events_append_only() from public, anon, authenticated;

drop trigger if exists channel_message_events_append_only on public.channel_message_events;
create trigger channel_message_events_append_only
  before update or delete on public.channel_message_events
  for each row execute function public.channel_message_events_append_only();

comment on table public.channel_message_events is
  'Append-only event log of every message NEXUS received or attempted to send, on '
  'every provider, with both outcomes. One row per inbound message; two per '
  'outbound send (SEND_ATTEMPTED written BEFORE the provider call, SEND_SETTLED '
  'after), plus one per provider delivery callback. Never updated, never deleted, '
  'never purged — a retention job that trims this table destroys the answer to '
  '"did you contact this customer?". Vocabulary lives in channel_message_outcome '
  'and channel_message_event_type; nothing may restate it.';

comment on column public.channel_message_events.attempt_id is
  'OURS, minted by the caller before the provider call. Never sent to the provider '
  '(no provider accepts a client id today) and never written to external_message_id. '
  'Absorbs our own retries of one logical send; it cannot absorb a provider-side '
  'duplicate and must not be described as if it could.';

comment on column public.channel_message_events.external_message_id is
  'The PROVIDER''s own message id, or NULL when the provider never gave us one — '
  'which is every rejected send, every transport error, and every write-ahead row. '
  'Never a per-delivery id (that is provider_delivery_ref) and never minted by us.';

-- =====================================================================
-- 6. The two write-ahead functions.
--    nexus_record_channel_event is NOT touched: it keeps serving inbound, and
--    its ON CONFLICT ON CONSTRAINT still resolves (§5a).
-- =====================================================================

create or replace function public.nexus_begin_channel_send(
  p_integration_id       uuid,
  p_customer_external_id text,
  p_message_kind         text default 'text',
  p_customer_phone       text default null,
  p_conversation_id      text default null,
  p_directive_id         uuid default null,
  p_attempt_no           smallint default 1,
  p_requested_by         text default null,
  p_attempt_id           uuid default null
)
returns table (attempt_id uuid, event_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant  uuid;
  v_ctype   text;
  v_status  text;
  v_attempt uuid := coalesce(p_attempt_id, gen_random_uuid());
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'nexus_begin_channel_send may only be called by service_role'
      using errcode = '42501';
  end if;

  select r.tenant_id, r.channel_type, r.status
    into v_tenant, v_ctype, v_status
    from public.channel_registry r
   where r.integration_id = p_integration_id;

  if v_tenant is null then
    raise exception 'No channel_registry row for integration_id %. A send cannot be '
                    'recorded against a carrier NEXUS does not know.', p_integration_id
      using errcode = '23503';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'Carrier % is %, not active.', p_integration_id, v_status
      using errcode = '22023';
  end if;

  return query
  insert into public.channel_message_events (
    tenant_id, integration_id,
    provider,
    channel_type, direction, event_type, outcome,
    external_message_id,
    customer_external_id, customer_phone, conversation_id,
    message_kind, origin_verified,
    attempt_id, attempt_no, directive_id, recorded_by,
    requested_at, received_at
  ) values (
    v_tenant, p_integration_id,
    case v_ctype when 'whatsapp_waha_session'          then 'waha'
                 when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
                 else v_ctype end,
    v_ctype, 'outbound', 'SEND_ATTEMPTED', 'PENDING',
    null,
    lower(btrim(p_customer_external_id)), p_customer_phone, p_conversation_id,
    p_message_kind, 'unverified',
    v_attempt, p_attempt_no, p_directive_id, p_requested_by,
    now(), now()
  )
  returning channel_message_events.attempt_id,
            channel_message_events.event_id,
            channel_message_events.tenant_id;
end
$$;

comment on function public.nexus_begin_channel_send(uuid,text,text,text,text,uuid,smallint,text,uuid) is
  'Write-ahead. Call this BEFORE the HTTP request to the provider and do not send '
  'if it fails. The row it writes is what stands if the process dies between the '
  'provider accepting and us recording it — the outbound form of the defect in '
  'ops/message-durability/P0-CLAIMED-NEVER-LOGGED.md. Returns the attempt_id to '
  'pass to nexus_settle_channel_send.';

create or replace function public.nexus_settle_channel_send(
  p_attempt_id           uuid,
  p_outcome              text,
  p_external_message_id  text default null,
  p_provider_error_code  text default null,
  p_provider_error_detail text default null,
  p_provider_http_status smallint default null,
  p_provider_delivery_ref text default null
)
returns table (event_id uuid, tenant_id uuid, outcome text, first_settle boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a public.channel_message_events%rowtype;
  v_existing uuid;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'nexus_settle_channel_send may only be called by service_role'
      using errcode = '42501';
  end if;

  select * into a
    from public.channel_message_events e
   where e.attempt_id = p_attempt_id and e.event_type = 'SEND_ATTEMPTED';

  if not found then
    raise exception 'No SEND_ATTEMPTED row for attempt_id %. A send is settled '
                    'against the write-ahead row that preceded it; settling one '
                    'that was never begun would record a send nobody attempted.',
                    p_attempt_id
      using errcode = '23503';
  end if;

  select e.event_id into v_existing
    from public.channel_message_events e
   where e.attempt_id = p_attempt_id and e.event_type = 'SEND_SETTLED';

  if v_existing is not null then
    -- Idempotent by construction: the table is append-only, so a second settle
    -- is answered, not written. first_settle = false is the caller's signal that
    -- a retry arrived after the first answer was already recorded.
    return query
      select e.event_id, e.tenant_id, e.outcome, false
        from public.channel_message_events e
       where e.event_id = v_existing;
    return;
  end if;

  return query
  insert into public.channel_message_events (
    tenant_id, integration_id, provider, channel_type, direction,
    event_type, outcome,
    external_message_id, provider_delivery_ref,
    customer_external_id, customer_phone, conversation_id,
    message_kind, origin_verified,
    attempt_id, attempt_no, directive_id, recorded_by,
    requested_at, settled_at, received_at,
    provider_error_code, provider_error_detail, provider_http_status
  ) values (
    a.tenant_id, a.integration_id, a.provider, a.channel_type, 'outbound',
    'SEND_SETTLED', p_outcome,
    p_external_message_id, p_provider_delivery_ref,
    a.customer_external_id, a.customer_phone, a.conversation_id,
    a.message_kind, 'unverified',
    a.attempt_id, a.attempt_no, a.directive_id, a.recorded_by,
    a.requested_at, now(), now(),
    p_provider_error_code, p_provider_error_detail, p_provider_http_status
  )
  returning channel_message_events.event_id,
            channel_message_events.tenant_id,
            channel_message_events.outcome,
            true;
end
$$;

comment on function public.nexus_settle_channel_send(uuid,text,text,text,text,smallint,text) is
  'Records what the provider actually did, including — especially — that it '
  'refused, that it never answered, or that we decided not to send. An unknown '
  'p_outcome is refused with 23503 by the composite foreign keys on '
  'channel_message_events; it never becomes a row that silently matches nobody''s '
  'filter. See ops/f2-tenant-rule/RECONCILIATION.md.';

revoke all on function public.nexus_begin_channel_send(uuid,text,text,text,text,uuid,smallint,text,uuid)
  from public, anon, authenticated;
revoke all on function public.nexus_settle_channel_send(uuid,text,text,text,text,smallint,text)
  from public, anon, authenticated;
grant execute on function public.nexus_begin_channel_send(uuid,text,text,text,text,uuid,smallint,text,uuid)
  to service_role;
grant execute on function public.nexus_settle_channel_send(uuid,text,text,text,text,smallint,text)
  to service_role;

-- =====================================================================
-- 7. channel_send_directive: one vocabulary, not two.
--    csd_send_result_check holds the same five strings in a CHECK where nothing
--    else can see them. Drop it; point the column at the catalogue instead.
--    The table holds 0 rows, so the FK validates trivially.
-- =====================================================================

alter table public.channel_send_directive
  drop constraint if exists csd_send_result_check;

alter table public.channel_send_directive
  add constraint csd_send_result_is_in_the_catalogue
    foreign key (send_result)
    references public.channel_message_outcome(outcome)
    on delete restrict;

comment on column public.channel_send_directive.send_result is
  'FK to channel_message_outcome. The five values this column used to enumerate '
  'in a CHECK now live in exactly one place, shared with channel_message_events.';

-- =====================================================================
-- 8. NOT IN THIS FILE, on purpose.
--    communication_logs.channel_event_id uuid -> channel_message_events(event_id)
--    is the join between the transcript and the ledger (DESIGN.md §8). It is
--    deliberately absent: shipping a column with no writer is exactly what
--    produced communication_logs.external_message_id — applied in the database,
--    armed in zero writers, 0 of 142 rows a month later. It lands with the n8n
--    change that populates it, and that migration must re-assert
--    `grant select on public.communication_logs to authenticated`, because
--    altering that table fires nexus_guard_born_open_grants.
-- =====================================================================

-- =====================================================================
-- 9. The view, and the invariant.
-- =====================================================================

-- security_invoker = on is INLINED. nexus_require_security_invoker_views fires
-- on the ddl_command_end of this CREATE VIEW; a following ALTER VIEW would be
-- too late and this statement would abort with 42501.
drop view if exists public.v_channel_send_unsettled;
create view public.v_channel_send_unsettled
  with (security_invoker = on) as
select a.tenant_id,
       a.integration_id,
       a.attempt_id,
       a.customer_external_id,
       a.customer_phone,
       a.message_kind,
       a.attempt_no,
       a.requested_at,
       now() - a.requested_at as age,
       a.directive_id,
       a.recorded_by
  from public.channel_message_events a
 where a.event_type = 'SEND_ATTEMPTED'
   and not exists (
     select 1 from public.channel_message_events s
      where s.attempt_id = a.attempt_id
        and s.event_type = 'SEND_SETTLED');

comment on view public.v_channel_send_unsettled is
  'Sends that were written ahead and never settled: we called the provider and do '
  'not know what happened. Each row is a customer somebody may or may not have '
  'been contacted about. Nothing may auto-resolve these by matching a delivery '
  'callback on recipient and time — that is a heuristic that invents a fact.';

create or replace function public.nexus_send_durability_invariants()
returns table (invariant text, status text, detail text)
language sql
stable
security invoker
set search_path = public
as $$
  select 'Every outbound send has a write-ahead row',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' settled or delivery row(s) with no SEND_ATTEMPTED sibling'
    from public.channel_message_events s
   where s.event_type in ('SEND_SETTLED','DELIVERY_STATUS')
     and not exists (select 1 from public.channel_message_events a
                      where a.attempt_id = s.attempt_id
                        and a.event_type = 'SEND_ATTEMPTED')
  union all
  select 'No send has been in flight for more than 15 minutes',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' unsettled attempt(s) older than 15 minutes: '
         || coalesce(string_agg(distinct customer_external_id, ', '), '(none)')
    from public.v_channel_send_unsettled
   where age > interval '15 minutes'
  union all
  select 'Every accepted send carries a provider message id',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' accepted row(s) with no provider id'
    from public.channel_message_events e
    join public.channel_message_outcome o on o.outcome = e.outcome
   where o.provider_id_expected and e.external_message_id is null
  union all
  select 'Every failed send is recorded, not merely absent',
         'INFO',
         coalesce((select string_agg(o.outcome || ': ' || c.n, ', ' order by o.sort)
                     from (select outcome, count(*)::text n
                             from public.channel_message_events
                            where event_type = 'SEND_SETTLED' group by 1) c
                     join public.channel_message_outcome o on o.outcome = c.outcome),
                  '(no settled send has ever been recorded)')
  union all
  -- The counter-test for the whole design. While this is FAIL, every other line
  -- above is PASS on an empty table and means nothing.
  select 'The log has ever been written',
         case when (select count(*) from public.channel_message_events) > 0
              then 'PASS' else 'FAIL' end,
         (select count(*) from public.channel_message_events)::text
         || ' row(s) in channel_message_events; '
         || (select count(*) from public.communication_logs
              where channel = 'whatsapp')::text
         || ' whatsapp communication_logs row(s) exist beside it';
$$;

comment on function public.nexus_send_durability_invariants() is
  'The outbound half. The inbound half is public.nexus_message_durability_invariants(), '
  'specified in ops/message-durability/P0-CLAIMED-NEVER-LOGGED.md §4.1 and not yet '
  'written. Note the last line: on an empty table every other check passes '
  'vacuously, so the gate reports "the log has ever been written" as its own '
  'invariant rather than letting NOT RUN read as PASS.';

revoke all on function public.nexus_send_durability_invariants() from public, anon, authenticated;
grant execute on function public.nexus_send_durability_invariants() to service_role;

-- =====================================================================
-- 10. Grants, re-asserted after the last DDL.
--     nexus_guard_born_open_grants fired on every CREATE TABLE and ALTER TABLE
--     above. Measured today, it strips nothing this file needs (see the header),
--     but these statements make that true by construction rather than by luck.
-- =====================================================================

-- channel_message_events is the one exception, and it is deliberate. The
-- append-only trigger is a ROW trigger, so TRUNCATE walks straight past it —
-- and service_role holds TRUNCATE on this table today. Append-only enforced by
-- a trigger while the caller can TRUNCATE is not append-only. So service_role
-- keeps SELECT and INSERT and loses UPDATE, DELETE and TRUNCATE here.
-- Nothing breaks: the only writers are SECURITY DEFINER functions, which run as
-- the function owner and do not consult service_role's grants at all.
grant select, insert, references, trigger on public.channel_message_events to service_role;
revoke update, delete, truncate on public.channel_message_events from service_role;

grant select, insert, update, delete, references, trigger, truncate
  on public.channel_send_directive   to service_role;
grant select, insert, update, delete, references, trigger, truncate
  on public.channel_message_outcome       to service_role;
grant select, insert, update, delete, references, trigger, truncate
  on public.channel_message_event_type    to service_role;
grant select, insert, update, delete, references, trigger, truncate
  on public.channel_message_event_outcome to service_role;

-- Vocabulary is readable by the dashboard. Tenant data is not.
grant select on public.channel_message_outcome       to authenticated;
grant select on public.channel_message_event_type    to authenticated;
grant select on public.channel_message_event_outcome to authenticated;
grant select on public.v_channel_send_unsettled      to service_role;

revoke all on public.channel_message_events        from anon;
revoke all on public.channel_message_outcome       from anon;
revoke all on public.channel_message_event_type    from anon;
revoke all on public.channel_message_event_outcome from anon;
revoke all on public.v_channel_send_unsettled      from anon, authenticated;
revoke insert, update, delete, truncate
  on public.channel_message_outcome, public.channel_message_event_type,
     public.channel_message_event_outcome
  from authenticated;

commit;

-- =====================================================================
-- 11. HOW THIS IS MADE TO FAIL ON PURPOSE
--     Run these on staging after applying. Each must raise. A guard nobody has
--     seen go red is a guard nobody has tested.
--     (<CARRIER> = a channel_registry.integration_id on that project.)
-- =====================================================================
--
-- (a) An unknown outcome must be refused, not silently stored:
--       select nexus_settle_channel_send('<attempt>', 'accepted');
--     EXPECT 23503 on cme_event_type_outcome_is_legal.
--     THIS IS THE f2 TEST. 'accepted' is how a second writer would plausibly
--     spell ACCEPTED_BY_PROVIDER, and under a CHECK-per-table design it would
--     have become a row that every consumer's filter quietly excluded.
--
-- (b) A claim that contradicts itself must be refused:
--       select nexus_settle_channel_send('<attempt>', 'ACCEPTED_BY_PROVIDER', null);
--     EXPECT 23503 on cme_outcome_agrees_about_the_provider_id — accepted, but
--     no id.
--       select nexus_settle_channel_send('<attempt>', 'TRANSPORT_ERROR', 'wamid.HBgM…');
--     EXPECT 23503 on the same constraint — no answer, but an id.
--
-- (c) The log must be append-only:
--       update public.channel_message_events set outcome = 'DELIVERED';
--       delete from public.channel_message_events;
--     EXPECT 42501 from channel_message_events_append_only, both times.
--
-- (d) An inbound row must still be writable by the untouched inbound path:
--       select * from nexus_record_channel_event(
--         '<CARRIER>', 'inbound', 'false_971500000000@c.us_3EB0TESTTESTTEST',
--         'shared_header', now(), '971500000000@c.us', '971500000000');
--     EXPECT one row, first_seen = true. Then run it again: first_seen = false,
--     no second row. The serialisation point P0 §3.2(c) depends on is unmoved.
--
-- (e) A settle without a begin must be refused:
--       select nexus_settle_channel_send(gen_random_uuid(), 'ACCEPTED_BY_PROVIDER', 'wamid.…');
--     EXPECT 23503 with the sentence about settling a send nobody attempted.
--
-- (f) The log must not be erasable around the trigger:
--       truncate public.channel_message_events;      -- as service_role
--     EXPECT 42501 permission denied (NOT the trigger — TRUNCATE never reaches a
--     row trigger, which is exactly why §10 revokes the privilege). Run this as
--     service_role specifically; as postgres it will succeed and prove nothing.
--
-- (g) The write-ahead row must survive a simulated crash:
--       select nexus_begin_channel_send('<CARRIER>', '971500000000@c.us');
--       -- do not settle
--       select attempt_id, age from v_channel_send_unsettled;
--     EXPECT exactly that attempt, visible, with a growing age. This is the row
--     that does not exist today and whose absence is the whole P0.
