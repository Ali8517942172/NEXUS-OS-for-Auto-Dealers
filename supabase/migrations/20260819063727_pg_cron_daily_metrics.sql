-- `capture_daily_metrics()` has existed for weeks and nothing has ever called
-- it, so `daily_metrics` is empty and there is no history to trend. It is pure
-- SQL and idempotent (ON CONFLICT (snapshot_date) DO UPDATE), so it does not
-- belong on the e2-micro at all — that box is unreachable as this is written,
-- which is exactly the argument for keeping SQL-only jobs inside Supabase.
create extension if not exists pg_cron with schema extensions;

-- 19:50 UTC = 23:50 Asia/Dubai, i.e. end of the local business day.
select cron.unschedule('nexus-daily-metrics')
where exists (select 1 from cron.job where jobname = 'nexus-daily-metrics');

select cron.schedule(
  'nexus-daily-metrics',
  '50 19 * * *',
  $$select public.capture_daily_metrics();$$
);