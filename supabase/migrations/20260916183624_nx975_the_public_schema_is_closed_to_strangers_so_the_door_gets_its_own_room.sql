-- NX975 — The public schema is closed to strangers, so the door gets its own room.
--
-- NX974 granted anon EXECUTE on public.nexus_sales_lead_submit and the call
-- still answered 401 "permission denied for schema public". Measured cause:
--   has_schema_privilege('anon','public','USAGE') = false
-- and that is not an oversight. This database revoked it on purpose after anon
-- was found reading customer rows on 2 Sep 2026. Granting USAGE on public back
-- to anon to make one form work would undo that fix for every object in the
-- schema, present and future, and rest the whole boundary on RLS never having
-- a gap again.
--
-- So the marketing form gets its own room instead. anon may enter exactly one
-- schema, which contains exactly one function and no tables. public stays shut.
-- The function is SECURITY DEFINER, so it reaches public.nexus_sales_lead as
-- its owner; the caller never needs -- and never gets -- a privilege there.
--
-- PostgREST must also be told this schema exists: Supabase Dashboard ->
-- Project Settings -> API -> Exposed schemas must list `nexus_intake`, and the
-- request must carry `Content-Profile: nexus_intake`. Until that setting is
-- saved this function is unreachable over HTTP and the form still answers 503,
-- which is the honest answer while it is true.

begin;

create schema if not exists nexus_intake;

comment on schema nexus_intake is
  'The only schema an unauthenticated stranger may enter. It holds functions '
  'that accept something from the open internet and nothing else -- no tables, '
  'no views, no data at rest. Anything added here is reachable by anyone who '
  'can load the website, so add nothing here that would not be safe on a '
  'billboard.';

revoke all on schema nexus_intake from public, anon, authenticated;
grant usage on schema nexus_intake to anon, authenticated, service_role;
-- USAGE lets them call what is granted. CREATE would let them add their own.
revoke create on schema nexus_intake from public, anon, authenticated;

-- A thin wrapper. The validation, the flood guard and the idempotency all stay
-- in public.nexus_sales_lead_submit (NX974); this only carries the call across
-- the schema boundary, so there is one place to read the rules and one place
-- to change them.
create or replace function nexus_intake.submit_sales_lead(
  p_submission_id text,
  p_full_name     text,
  p_phone_e164    text default null,
  p_email         text default null,
  p_dealership    text default null,
  p_stock_size    text default null,
  p_message       text default null,
  p_attribution   jsonb default '{}'::jsonb,
  p_ip_country    text default null
) returns table (submission_id text, was_duplicate boolean, received_at timestamptz)
language sql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $fn$
  select * from public.nexus_sales_lead_submit(
    p_submission_id, p_full_name, p_phone_e164, p_email, p_dealership,
    p_stock_size, p_message, p_attribution, p_ip_country);
$fn$;

comment on function nexus_intake.submit_sales_lead(text,text,text,text,text,text,text,jsonb,text) is
  'The marketing site''s only reach into this database. Inserts one NEXUS '
  'sales prospect and returns only what it was handed. It cannot read the '
  'table it writes to, cannot see a dealership, and cannot be used to '
  'enumerate anything. Called with the PUBLISHABLE key, never service_role.';

-- Default EXECUTE on a new function goes to PUBLIC. Take it back first, then
-- hand it out deliberately -- the born-open shape this project has been bitten
-- by before.
revoke all on function nexus_intake.submit_sales_lead(text,text,text,text,text,text,text,jsonb,text)
  from public;
grant execute on function nexus_intake.submit_sales_lead(text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated, service_role;

-- anon's execute on the public-schema original is now dead weight: it cannot
-- reach the schema to use it. Removed so the grant list does not imply a door
-- that is bricked up.
revoke execute on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)
  from anon;

commit;