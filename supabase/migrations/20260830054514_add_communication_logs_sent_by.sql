-- =====================================================================
-- NEXUS OS — communication_logs.sent_by
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Target project: dsvuoovivysszdoiorch
-- Safe to re-run. Additive only. No existing row is read or rewritten.
--
-- WHAT THIS FIXES
--   `communication_logs` is (id, lead_email, channel, direction, message,
--   created_at). Every outbound WhatsApp message — the AI BDC agent's replies,
--   the drip campaign, the KYC re-asks, the silence escalations, AND a sales
--   rep typing into the dashboard — lands in the same shape. Nothing in the
--   database or the UI can tell a bot outbound from a human outbound.
--
--   The consequence is not cosmetic. `whatsapp_bdc_ai_agent` -> `Reply
--   Eligibility` decides whether to answer purely on matched_lead / direction /
--   a keyword hit. It never looks at what was already sent. So a rep can type
--   "I can do 78,000 final", the customer replies "ok", and the bot — seeing
--   matched_lead = true — runs the negotiation agent and quotes its own number
--   on the same WhatsApp line, seconds later, contradicting the rep
--   mid-negotiation. The bot cannot go quiet for a human because it cannot see
--   that a human was there.
--
--   `whatsapp_send_dashboard_reply` -> `Prepare Send` ALREADY computes the
--   sender (`sent_by`, from the verified Supabase JWT) and then throws it away:
--   `Log Outbound` writes only {lead_email, channel, direction, message}. This
--   migration gives that value somewhere to go.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The column.
--
-- NULLABLE, and deliberately WITHOUT a default.
--
-- The obvious alternative is `default 'bot' not null`, which on PostgreSQL 11+
-- is metadata-only (attmissingval) and would NOT rewrite the table — so the
-- objection to it is not performance, it is honesty. Historical outbound rows
-- are overwhelmingly bot-sent: of the five writers of this table today, four
-- (whatsapp_bdc_ai_agent, 7_day_warm_lead_drip_campaign,
-- kyc_aml_document_auditor..., phase_6_12_hour_silence_detector) are automated,
-- and only whatsapp_send_dashboard_reply is a person. But "overwhelmingly" is
-- not "entirely": every dashboard reply a rep has ever sent is in there too,
-- and stamping them all 'bot' would be the database asserting something it does
-- not know. NULL means exactly what is true — "written before 30 Aug 2026, and
-- nobody recorded who sent it".
--
-- It also costs nothing to leave them NULL, because nothing reads them. The
-- suppression rule looks at a 30-minute / 12-hour window; every NULL row is
-- older than the moment this column shipped, so no NULL row can ever fall
-- inside that window. Backfilling would be guessing at data that will never be
-- queried.
--
-- CRITICALLY: NULL must NOT be treated as "human". The BDC agent's own
-- `Log Conversation` writes a NULL sent_by until OPERATIONS_bdc.json is
-- applied; if NULL counted as human the bot would read its own last reply as a
-- colleague's and mute itself for 30 minutes after every message it sent.
-- The check therefore uses `sent_by=not.in.(bot,drip,...)`, and in SQL
-- `NULL NOT IN (...)` is NULL, i.e. not matched. That is the intended
-- behaviour, not an accident of three-valued logic.
-- ---------------------------------------------------------------------
alter table public.communication_logs
  add column if not exists sent_by text;

comment on column public.communication_logs.sent_by is
  'Who produced an OUTBOUND message. Reserved automation tokens: bot (whatsapp_bdc_ai_agent), '
  'drip, kyc, system, router, outreach, silence. Anything else is a person — in practice the '
  'lowercased email of the Supabase user whose JWT authorised the dashboard send, or the literal '
  '"dashboard" when that user has no email. NULL = unrecorded: either an INBOUND row (the customer '
  'sent it; `direction` already says so) or any row written before 30 Aug 2026. '
  'Readers must treat NULL as "not a human", never as "human". '
  'Any NEW automated writer MUST add itself to the reserved list here AND to the not.in.(...) '
  'filter in whatsapp_bdc_ai_agent -> Human Reply Check, or its messages will be mistaken for a '
  'sales rep and will silence the bot for 30 minutes each time.';


-- ---------------------------------------------------------------------
-- 2. No new index — and the reasoning, because "add an index" is the reflex.
--
-- The one new query is (whatsapp_bdc_ai_agent -> Human Reply Check):
--
--   select created_at, sent_by, message, lead_email
--     from communication_logs
--    where lead_email in (<2..6 keys for one person>)
--      and direction   = 'outbound'
--      and sent_by not in ('bot','drip','kyc','system','router','outreach','silence')
--      and created_at >= now() - interval '24 hours'
--    order by created_at desc
--    limit 1;
--
-- `idx_comm_logs_lead_email` (supabase/create_missing_tables.sql) already
-- serves the leading predicate, and the leading predicate is the selective one:
-- it reduces the table to ONE person. The largest thread in this system is
-- 66 messages (conversations.js header, 24 Aug: "46 messages under his email
-- and 20 under his LID"). Filtering 66 rows on three more predicates is free.
-- A composite or partial index here would add write cost to every insert on the
-- hot path — the BDC agent inserts twice per inbound message — and buy nothing
-- measurable.
--
-- WHEN TO REVISIT: if communication_logs passes roughly a million rows, or if a
-- single thread passes a few thousand messages, add the partial index below.
-- It is left commented out on purpose: shipping an index "just in case" is how
-- a table ends up with six of them and nobody remembering which query needs
-- which.
--
--   create index if not exists idx_comm_logs_human_recent
--     on public.communication_logs (lead_email, created_at desc)
--     where direction = 'outbound' and sent_by is not null;
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 3. No CHECK constraint — also on purpose.
--
-- A `check (sent_by is null or sent_by = 'bot' or sent_by like '%@%')` would
-- document the vocabulary in the schema, which is attractive. It is not worth
-- it here: every writer of this table logs with onError = continueRegularOutput
-- (whatsapp_bdc_ai_agent -> Log Conversation, Log Incoming Message;
-- whatsapp_send_dashboard_reply -> Log Outbound). A future workflow writing an
-- unforeseen token would get a 400, the node would swallow it, and the message
-- would be delivered to the customer with NO row in the conversation history —
-- silent data loss, which is strictly worse than a slightly untidy column.
-- The vocabulary is enforced by the COMMENT above and by code review.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 4. RLS and grants — nothing to change, but confirm rather than assume.
--
-- security/fix_rls.sql grants `authenticated` a table-level SELECT plus a
-- `for select using (true)` policy on communication_logs. A TABLE-level grant
-- automatically covers columns added later, so the dashboard can read sent_by
-- with no further grant. A COLUMN-level grant would NOT, and the new column
-- would come back as a PostgREST 400 ("column communication_logs.sent_by does
-- not exist" is what it looks like from the browser). Verify with query (b)
-- below before touching conversations.js.
--
-- Writes stay service_role-only. n8n uses service_role and bypasses RLS, so the
-- workflow changes need no policy work at all.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 5. Verification. Run these AFTER the alter, and again after the workflows.
-- ---------------------------------------------------------------------

-- (a) The column exists, is nullable, has no default.
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'communication_logs'
--      and column_name  = 'sent_by';
--   -- expect: sent_by | text | YES | (null)

-- (b) `authenticated` can actually SELECT the new column (see §4).
--   select has_column_privilege('authenticated', 'public.communication_logs', 'sent_by', 'SELECT');
--   -- expect: true. If false, run:
--   --   grant select (sent_by) on public.communication_logs to authenticated;

-- (c) Nothing was rewritten: every pre-existing row is NULL, and the count is
--     unchanged from before the migration.
--   select count(*) as total,
--          count(sent_by) as stamped,
--          count(*) filter (where sent_by is null) as unrecorded
--     from public.communication_logs;
--   -- immediately after this migration: stamped = 0.

-- (d) After BOTH workflow operation sets are applied, send one dashboard reply
--     and let the bot answer one message. Then:
--   select sent_by, direction, count(*), max(created_at)
--     from public.communication_logs
--    where created_at > now() - interval '1 hour'
--    group by 1, 2 order by 4 desc;
--   -- expect a row with sent_by = '<the rep's supabase email>' / outbound,
--   -- and a row with sent_by = 'bot' / outbound. If the rep's send still shows
--   -- NULL, OPERATIONS_send.json did not apply.

-- (e) The identity trap (see DESIGN.md part 3 and RISKS.md R1). Lists every
--     distinct key one WhatsApp number's messages are filed under. If a single
--     person's rows span keys the check does not build, the check will return
--     nothing and the bot will talk over the rep.
--   select lead_email, direction, count(*), min(created_at), max(created_at)
--     from public.communication_logs
--    where channel = 'whatsapp'
--    group by 1, 2
--    order by max(created_at) desc
--    limit 50;