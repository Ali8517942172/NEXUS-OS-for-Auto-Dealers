-- NX983 — The trigger function was born with EXECUTE granted to everyone.
--
-- Caught by this repository's own gate, ops/ci/function-grants.mjs, on the
-- migration written an hour earlier:
--
--   [rule 1] nx976: nexus_journey_on_lead_event_promoted() [trigger] —
--            missing a revoke naming `public`
--
-- The gate was right, and the live ACL says so:
--
--   proacl = =X/postgres | postgres=X/postgres
--            | authenticated=X/postgres | service_role=X/postgres
--
-- The leading `=X/` with nothing before the equals sign IS the grant to
-- PUBLIC. It is what Postgres gives every function at birth, and it is why
-- this project's rule is "say who may call it in the same migration that
-- creates it". NX976 granted to nobody and revoked from nobody, so PUBLIC's
-- birth grant simply stayed, and has_function_privilege('anon', ...) reads
-- true.
--
-- A zero-argument trigger function called directly errors out before it can
-- do anything, so this is not a live data exposure. It is worse in a quieter
-- way: the ACL is the thing an auditor reads, and an ACL that says "anyone"
-- while the author meant "the trigger" teaches the reader to discount what
-- the ACL says. A census that has to be interpreted is not a census.
--
-- Swept the rest of the schema while here: every other NEXUS function with a
-- bare PUBLIC grant — none. The only ones carrying `=X/` are pgvector and
-- pg_trgm, owned by supabase_admin, which is their normal shape.
--
-- Also tightened, deliberately and not because it was open: NX974 already
-- revoked PUBLIC from nexus_sales_lead_submit before NX975 revoked anon, and
-- the live ACL has no PUBLIC entry. But the gate reads one migration at a
-- time and cannot see across files, so NX975 read as if it left the door
-- open. Restating the full revoke here costs nothing, is idempotent, and
-- means the ACL a reader checks and the migration a reader checks now agree
-- without needing a second file to make sense of the first.

begin;

revoke all on function public.nexus_journey_on_lead_event_promoted()
  from public, anon, authenticated;
grant execute on function public.nexus_journey_on_lead_event_promoted()
  to service_role;

revoke all on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)
  to service_role;

-- nexus_intake.submit_sales_lead is the door anon actually uses; it is
-- unchanged and still granted. Restated here only so a reader of this file
-- does not conclude the public-facing path was just closed.
grant execute on function nexus_intake.submit_sales_lead(text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated, service_role;

do $verify$
begin
  if has_function_privilege('anon', 'public.nexus_journey_on_lead_event_promoted()', 'EXECUTE') then
    raise exception 'NX983: anon can still execute the journey trigger function. Rolling back.';
  end if;
  if has_function_privilege('authenticated', 'public.nexus_journey_on_lead_event_promoted()', 'EXECUTE') then
    raise exception 'NX983: authenticated can still execute the journey trigger function. Rolling back.';
  end if;
  if has_function_privilege('anon', 'public.nexus_sales_lead_submit(text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'NX983: anon can still execute the public-schema sales lead function. Rolling back.';
  end if;
  -- The door that must STAY open, asserted so a later tightening cannot close
  -- the marketing form by accident and call it hardening.
  if not has_function_privilege('anon', 'nexus_intake.submit_sales_lead(text,text,text,text,text,text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'NX983: anon lost the one door it is supposed to have. The marketing form would answer 503. Rolling back.';
  end if;
  raise notice 'NX983: the trigger function is service_role only, the public-schema submit function is service_role only, and nexus_intake.submit_sales_lead is still reachable by anon. A trigger fires as its trigger either way.';
end
$verify$;

commit;