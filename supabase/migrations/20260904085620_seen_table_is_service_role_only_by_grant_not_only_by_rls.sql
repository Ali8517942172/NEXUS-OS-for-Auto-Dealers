-- Supabase's default privileges in the public schema granted `authenticated` ALL on
-- this table the moment it was created. The restrictive RLS policy already refuses
-- anon and authenticated, so nothing was reachable -- but every sibling table in
-- this layer is service_role-only by GRANT as well, and the grant is the lock that
-- still holds if RLS is ever disabled on the table. Read back with pg_attribute.attacl
-- as well as relacl: a column-level grant is invisible to relacl alone.
revoke all on public.whatsapp_customer_message_seen from anon, authenticated, public;
grant all on public.whatsapp_customer_message_seen to service_role;