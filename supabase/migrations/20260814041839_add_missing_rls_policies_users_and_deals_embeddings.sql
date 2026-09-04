-- public.users and public.deals_embeddings had RLS ENABLED with ZERO policies.
-- In Postgres that means "deny everything", not "allow everything".
-- v_team_performance is a security_invoker view, so it read users as the
-- browser's authenticated role and got 0 rows back: the entire Team screen
-- rendered "Team members 0 / Nothing here yet" while 4 users existed.
-- Same story for deals_embeddings, which the new Deals screen reads.
--
-- Grants match the model already used by leads/inventory/competitors: any
-- signed-in user of this dealership can read and maintain the roster.
-- DELETE is deliberately withheld on users — removing a row orphans the
-- assigned_to_id on every lead that person owns.

create policy users_authenticated_read on public.users
  for select to authenticated using (true);
create policy users_authenticated_insert on public.users
  for insert to authenticated with check (true);
create policy users_authenticated_update on public.users
  for update to authenticated using (true) with check (true);
create policy users_service_role_all on public.users
  for all to service_role using (true) with check (true);

create policy deals_embeddings_authenticated_read on public.deals_embeddings
  for select to authenticated using (true);
create policy deals_embeddings_service_role_all on public.deals_embeddings
  for all to service_role using (true) with check (true);