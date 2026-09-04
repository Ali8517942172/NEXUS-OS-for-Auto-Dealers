-- =====================================================================
-- NEXUS OS - CRM synchronisation fix, schema prerequisites
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Apply BEFORE OPERATIONS_erpsync.json and OPERATIONS_customer360.json.
-- Every statement is idempotent and additive; nothing is dropped or
-- rewritten, so this is safe to run on a live database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. wf_108 ERP Sync - the Bitrix crosswalk and the sync watermark.
--
--    bitrix_lead_id is the most authoritative identity key we can have:
--    an id we ourselves confirmed after a successful write. It survives
--    the customer changing phone number, which no lookup can.
--
--    crm_synced_at does two jobs. It is the watermark 'Fetch HOT Leads
--    from Supabase' filters on (replacing returnAll:true over the whole
--    HOT backlog), and it is the timestamp 'Build Update Payload'
--    compares against Bitrix's DATE_MODIFY to decide whether a human has
--    touched the record since our last push.
--
--    Both are stamped ONLY by 'Link Back to Supabase', and only on a
--    SUCCESS verdict. A failed sync leaves them alone so the next run
--    picks the lead up again.
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists bitrix_lead_id text;
alter table public.leads add column if not exists crm_synced_at  timestamptz;

comment on column public.leads.bitrix_lead_id is
  'Bitrix24 CRM lead ID, written by wf_108 after a confirmed create/update. '
  'Primary identity key on the next sync - checked before any duplicate probe.';
comment on column public.leads.crm_synced_at is
  'Last CONFIRMED push to Bitrix24. Null or stale = eligible for the next ERP '
  'sync run. Also the "our data is this old" side of the Bitrix DATE_MODIFY '
  'comparison in Build Update Payload.';

-- The exact shape of the new fetch: status = HOT, watermark, newest first.
create index if not exists idx_leads_status_crm_synced
  on public.leads (status, crm_synced_at, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Customer 360 - stop the schema from asserting a count nobody read.
--
--    'Transform & Unify' now OMITS a count it could not measure, and
--    PostgREST leaves a column that is absent from the request body
--    exactly as it found it -- ON UPDATE. On INSERT an absent column
--    falls back to its DEFAULT, and the default here was literally 0.
--    So a brand-new profile whose Gmail read had failed would still be
--    born asserting "0 emails". Dropping the default makes the unknown
--    case NULL, which is the honest value and the one the dashboard can
--    distinguish from a real zero.
--
--    Existing rows are NOT touched: dropping a default never rewrites
--    stored data. Rows that already hold a wrongly-written 0 are dealt
--    with in RISKS.md section 4.
-- ---------------------------------------------------------------------
alter table public.customer_360_profiles alter column total_emails         drop default;
alter table public.customer_360_profiles alter column total_slack_messages drop default;

comment on column public.customer_360_profiles.total_emails is
  'Emails seen for this customer at the last successful Gmail read, capped at '
  '20 by the source node. NULL = not measured (read failed, or the customer has '
  'no real email address). NULL is NOT zero.';
comment on column public.customer_360_profiles.total_slack_messages is
  'Slack mentions at the last successful search, capped at 20 by the source '
  'node. NULL = not measured. NULL is NOT zero.';

-- customer_id is a single key space (the v_customer_directory UUID) as of
-- this fix. The unique constraint on_conflict=customer_id depends on
-- already exists via `customer_id text unique`; assert it rather than
-- assume it.
create unique index if not exists customer_360_profiles_customer_id_uidx
  on public.customer_360_profiles (customer_id);