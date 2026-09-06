-- CLAUDE.md, "The default-grant check": Supabase's default privileges grant
-- arwdDxtm DIRECTLY to anon AND authenticated on every new table in public.
-- Nothing in the CREATE TABLE diff shows it. Revoke from both roles AND from
-- PUBLIC -- a direct grant and a PUBLIC grant are separate ACL rows and
-- REVOKE ... FROM PUBLIC does not touch the direct one.
--
-- There is no reader for this table in the browser. app.js reads as
-- `authenticated`; nothing in apps/executive-dashboard selects from
-- channel_message_events, so revoking costs nothing today and closes the
-- TRUNCATE (`D`) grant that RLS would never have filtered.
revoke all on public.channel_message_events from anon, authenticated, public;
grant  all on public.channel_message_events to service_role;

alter table public.channel_message_events enable row level security;
alter table public.channel_message_events force row level security;

-- RLS is the second lock, not the first. Kept because CLAUDE.md's own history
-- is that a platform default-privilege or a later CREATE OR REPLACE can hand a
-- grant back with no grant-shaped diff to review.
drop policy if exists channel_message_events_deny_end_users on public.channel_message_events;
create policy channel_message_events_deny_end_users
  on public.channel_message_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists channel_message_events_service_role_all on public.channel_message_events;
create policy channel_message_events_service_role_all
  on public.channel_message_events
  as permissive
  for all
  to service_role
  using (true)
  with check (true);