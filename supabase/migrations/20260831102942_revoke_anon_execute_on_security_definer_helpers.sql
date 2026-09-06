-- The Supabase anon key sits in a PUBLIC GitHub repo (10 workflow JSON exports)
-- alongside the project ref. RLS correctly denies anon on every table, so the key
-- alone reads nothing. BUT these four helpers are SECURITY DEFINER -- they run as
-- postgres and bypass RLS -- and EXECUTE was granted to anon, reachable from the
-- open internet at /rest/v1/rpc/<name> with only that public key:
--   nexus_comm_keys_for_lead(email, phone) -> a lead's communication keys = exfiltration
--   nexus_lead_for_comm_key(key)           -> reverse lookup, enables enumeration
--   nexus_mark_first_response()            -> mutates SLA state
--   nexus_backfill_response_time()         -> bulk mutation
--
-- Verified before revoking: no workflow and no dashboard screen calls any of these
-- over /rest/v1/rpc -- the only RPCs used anywhere are match_documents,
-- search_rag_documents and recompute_inventory_derived. nexus_mark_first_response
-- is a trigger function on communication_logs; trigger execution does not consult
-- the invoking role's EXECUTE grant (that is checked at CREATE TRIGGER time), and
-- the inserts arrive as service_role, which keeps EXECUTE. Nothing breaks.
revoke execute on function public.nexus_backfill_response_time() from anon, authenticated;
revoke execute on function public.nexus_comm_keys_for_lead(p_email text, p_phone text) from anon, authenticated;
revoke execute on function public.nexus_lead_for_comm_key(p_key text) from anon, authenticated;
revoke execute on function public.nexus_mark_first_response() from anon, authenticated;