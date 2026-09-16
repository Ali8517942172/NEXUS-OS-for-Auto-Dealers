-- NX982 — Three tables full of customers were readable by every dealership.
--
-- Found 16 Sep 2026 while chasing a red in the dashboard's own quality gate.
-- The gate's check S4 says "the browser never says which dealership it is",
-- and it was failing on one line in lib/setup.js that filtered a read with
-- `tenant_id=eq.<id>`. Chasing WHY that filter was there found the real
-- defect, which is far worse than the lint it tripped:
--
--   relname                 rls_on  policies  authenticated may SELECT
--   customer                false   0         YES
--   conversation            false   0         YES
--   journey_step            false   0         YES
--
-- NX960 created these on 14 Sep with tenant_id columns and no row security.
-- Every other tenant-owned table in this database -- leads, lead_event,
-- inventory, channel_message_events -- carries RLS plus a deny-anon
-- restrictive policy. These three were born open, and `authenticated` reaches
-- them. A logged-in salesperson at dealership B could read dealership A's
-- customer list, their conversations, and the full journey trail of every
-- enquiry A has ever received.
--
-- The browser-side filter was the only thing hiding it, and the gate names
-- exactly why that is not a control: "a filter the browser applies is a
-- filter an operator can remove in devtools". It was never a boundary. It was
-- a habit that looked like one.
--
-- This closes it in the database, where the product claims it lives: "Rows
-- belonging to any other dealership are refused by the database, not filtered
-- here." That sentence has been on the tenant pill since the start. Until
-- this migration it was not true for these three tables.
--
-- The same shape as public.leads, deliberately, so there is one pattern to
-- read and one pattern to audit:
--   PERMISSIVE  ALL to authenticated  scoped by nexus_current_tenant_ids()
--   RESTRICTIVE ALL to anon           refusing everything
--   PERMISSIVE  ALL to service_role   because the receivers write as it

begin;

-- ── customer ──────────────────────────────────────────────────────────────
alter table public.customer enable row level security;
drop policy if exists customer_authenticated_all on public.customer;
drop policy if exists customer_deny_anon         on public.customer;
drop policy if exists customer_service_role_all  on public.customer;

create policy customer_authenticated_all on public.customer
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));
create policy customer_deny_anon on public.customer
  as restrictive for all to anon using (false) with check (false);
create policy customer_service_role_all on public.customer
  for all to service_role using (true) with check (true);

-- ── conversation ──────────────────────────────────────────────────────────
alter table public.conversation enable row level security;
drop policy if exists conversation_authenticated_all on public.conversation;
drop policy if exists conversation_deny_anon         on public.conversation;
drop policy if exists conversation_service_role_all  on public.conversation;

create policy conversation_authenticated_all on public.conversation
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));
create policy conversation_deny_anon on public.conversation
  as restrictive for all to anon using (false) with check (false);
create policy conversation_service_role_all on public.conversation
  for all to service_role using (true) with check (true);

-- ── journey_step ──────────────────────────────────────────────────────────
-- The evidence trail. It names a lead, a customer and a conversation, and it
-- says in plain sentences what happened to each. Readable across dealerships
-- it is not an audit trail, it is a competitor's briefing.
alter table public.journey_step enable row level security;
drop policy if exists journey_step_authenticated_all on public.journey_step;
drop policy if exists journey_step_deny_anon         on public.journey_step;
drop policy if exists journey_step_service_role_all  on public.journey_step;

create policy journey_step_authenticated_all on public.journey_step
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));
create policy journey_step_deny_anon on public.journey_step
  as restrictive for all to anon using (false) with check (false);
create policy journey_step_service_role_all on public.journey_step
  for all to service_role using (true) with check (true);

-- ── message_intent ────────────────────────────────────────────────────────
-- Not a leak: three columns of vocabulary (intent, promote_eligible,
-- meaning), no tenant_id, no customer, no dealership. It is switched on with
-- a stated read-everyone policy rather than left off, so that "RLS is off
-- here" never again has two possible meanings in this schema -- one of which
-- was the three tables above.
alter table public.message_intent enable row level security;
drop policy if exists message_intent_readable_by_signed_in on public.message_intent;
drop policy if exists message_intent_deny_anon             on public.message_intent;
drop policy if exists message_intent_service_role_all      on public.message_intent;

create policy message_intent_readable_by_signed_in on public.message_intent
  for select to authenticated using (true);
create policy message_intent_deny_anon on public.message_intent
  as restrictive for all to anon using (false) with check (false);
create policy message_intent_service_role_all on public.message_intent
  for all to service_role using (true) with check (true);

comment on table public.message_intent is
  'Lookup, not data: the twelve intents a message can carry and whether each '
  'may promote to a lead. No tenant owns a row here. RLS is on with a stated '
  'read-all policy so that an auditor never has to ask whether an off switch '
  'was a decision or an oversight.';

revoke all on public.customer       from public, anon;
revoke all on public.conversation   from public, anon;
revoke all on public.journey_step   from public, anon;
revoke all on public.message_intent from public, anon;

do $verify$
declare r record; n int := 0;
begin
  for r in
    select c.relname, c.relrowsecurity as rls,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as pols
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname in ('customer','conversation','journey_step','message_intent')
  loop
    if not r.rls then
      raise exception 'NX982: row security is still off for %. Rolling back.', r.relname;
    end if;
    if r.pols < 3 then
      raise exception 'NX982: % has only % policies; expected at least three. Rolling back.', r.relname, r.pols;
    end if;
    n := n + 1;
  end loop;
  if n <> 4 then
    raise exception 'NX982: checked % tables, expected 4. Rolling back.', n;
  end if;
  raise notice 'NX982: four tables closed. customer, conversation and journey_step are now scoped by nexus_current_tenant_ids(); message_intent is stated lookup. This is the DATABASE refusing, which is what the tenant pill has always claimed.';
end
$verify$;

commit;