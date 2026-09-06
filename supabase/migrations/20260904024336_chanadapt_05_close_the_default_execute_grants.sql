-- Supabase's default privileges grant EXECUTE directly to anon AND
-- authenticated on every new function in public. REVOKE ... FROM PUBLIC does
-- not remove a direct grant, so revoke from all three, every time.
revoke execute on function public.nexus_whatsapp_cloud_canonical_events(jsonb)
  from anon, authenticated, public;
revoke execute on function public.nexus_record_channel_event(
    uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text)
  from anon, authenticated, public;

grant execute on function public.nexus_whatsapp_cloud_canonical_events(jsonb)
  to service_role;
grant execute on function public.nexus_record_channel_event(
    uuid, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text)
  to service_role;