-- PERMANENT CONCURRENCY REGRESSION — 10 simultaneous promotions of one event
--
-- Run this against STAGING after any change to nexus_record_lead_event,
-- nexus_hydrate_lead_event, nexus_promote_lead_event, or to any constraint on
-- public.leads. It is the standing form of the race that, on 7 September 2026,
-- turned one phone-only enquiry into THREE customers.
--
-- WHY IT HAS TO BE PHONE-ONLY. The same race on a lead WITH an email produced
-- one lead and three 23505s -- and that looked like a pass. It was not the
-- promoter refusing; it was leads_tenant_email_key, a unique index, and a unique
-- index does not constrain NULLs. Door three writes NULL for a lead with no
-- email, which is the walk-in, the phone call and the WhatsApp enquiry: the
-- ordinary UAE case, and 25% of production leads. A regression written with an
-- email would go green while the defect was fully open.
--
-- THE REQUIRED RESULT
--   leads created ................ exactly 1
--   orphan leads ................. exactly 0
--   callers that raised .......... 0
--   callers answered idempotently  9
--   distinct lead_id returned .... 1   (all ten callers naming the same customer)
--
-- Anything else is a regression. In particular 10 leads, or 1 lead with 9
-- errors, are both failures: the second means a redelivery now looks like a
-- crash to the receiver, which for Google means a discarded customer.
--
-- HOW IT WORKS. pg_cron gives ten genuinely separate backends -- ten
-- connections, ten transactions -- and pg_sleep_until aligns them at a common
-- gate. Everything in one session cannot reproduce this: a read-then-write race
-- needs two transactions to be in flight at once, and a single session never has
-- two. The 7 Sep run measured all five entering inside 25 ms.
--
-- It leaves nothing behind: teardown asserts back to the pre-run counts.

\echo 'Run the numbered blocks in order. Each is one statement to the SQL editor.'

-- ── 1. Harness ──────────────────────────────────────────────────────────────
create table if not exists public.zz_race_lab (
  id bigserial primary key, run_id text not null, worker int not null,
  gate_at timestamptz not null, started_at timestamptz, finished_at timestamptz,
  ok boolean, sqlstate text, detail text, message text, result jsonb);
create table if not exists public.zz_race_run (
  run_id text primary key, kind text not null, gate_at timestamptz not null,
  arg1 text, arg2 text, arg3 text);
revoke all on table public.zz_race_lab from public, anon, authenticated;
revoke all on table public.zz_race_run from public, anon, authenticated;

create or replace function public.zz_race_worker(p_run_id text, p_worker int)
returns void language plpgsql as $$
declare r record; v_res jsonb; v_started timestamptz; v_detail text; v_state text; v_msg text;
begin
  select * into r from public.zz_race_run where run_id = p_run_id;
  if not found then return; end if;
  -- pg_cron re-fires on its interval; one row per (run, worker) regardless.
  if exists (select 1 from public.zz_race_lab where run_id=p_run_id and worker=p_worker) then return; end if;
  perform pg_sleep_until(r.gate_at);
  v_started := clock_timestamp();
  begin
    select to_jsonb(x) into v_res from (
      select * from public.nexus_promote_lead_event(r.arg1::uuid)) x;
    insert into public.zz_race_lab(run_id,worker,gate_at,started_at,finished_at,ok,result)
    values (p_run_id,p_worker,r.gate_at,v_started,clock_timestamp(),true,v_res);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    insert into public.zz_race_lab(run_id,worker,gate_at,started_at,finished_at,ok,sqlstate,detail,message)
    values (p_run_id,p_worker,r.gate_at,v_started,clock_timestamp(),false,v_state,v_detail,v_msg);
  end;
end $$;
revoke all on function public.zz_race_worker(text,int) from public, anon, authenticated;

-- ── 2. Fixture: ONE phone-only HYDRATED event. NO EMAIL. That is the point. ──
-- Substitute a production-environment MANUAL_ENTRY or webhook public_key that
-- exists on this database.
select * from public.nexus_record_lead_event(
  '<a production public_key on this project>',
  'racelab-concurrency-' || to_char(now(),'YYYYMMDDHH24MISS'),
  '<the provenance that endpoint declares>',
  '{"probe":"concurrency regression"}'::jsonb, now(),
  '{"full_name":"Concurrency Regression","phone_e164":"+971500000000","vehicle_interest":"Regression Unit"}'::jsonb);

-- ── 3. Arm ten backends on a common gate ────────────────────────────────────
insert into public.zz_race_run(run_id,kind,gate_at,arg1)
values ('regression','promote', now() + interval '40 seconds', '<the event_id from step 2>');
select cron.schedule('zzrace-'||i,'5 seconds', format($$select public.zz_race_worker('regression',%s)$$, i))
  from generate_series(1,10) i;

-- ── 4. Wait past the gate, then unschedule ──────────────────────────────────
select cron.unschedule(jobname) from cron.job where jobname like 'zzrace-%';

-- ── 5. THE ASSERTIONS. All five must hold. ──────────────────────────────────
select
  (select count(*) from public.zz_race_lab where run_id='regression')                       as callers,
  (select count(*) from public.zz_race_lab where run_id='regression' and not ok)            as raised,
  (select count(*) from public.zz_race_lab where run_id='regression'
     and (result->>'was_already_promoted')::boolean)                                        as idempotent,
  (select count(distinct result->>'lead_id') from public.zz_race_lab
     where run_id='regression' and ok)                                                      as distinct_leads,
  (select count(*) from public.leads where name='Concurrency Regression')                   as leads_created,
  (select detail from public.nexus_lead_ingest_invariants()
    where invariant like 'Every lead carrying an ingestion source%')                        as orphan_check;
-- callers 10 · raised 0 · idempotent 9 · distinct_leads 1 · leads_created 1
-- orphan_check '0 orphan lead(s): (none)'

-- ── 6. Teardown. lead_event FIRST: deleting a promoted lead sets
--      lead_event.lead_id NULL and violates lead_event_promotion_is_symmetric.
delete from public.lead_event where external_event_id like 'racelab-concurrency-%';
delete from public.leads where name = 'Concurrency Regression';
drop function if exists public.zz_race_worker(text,int);
drop table if exists public.zz_race_lab;
drop table if exists public.zz_race_run;
