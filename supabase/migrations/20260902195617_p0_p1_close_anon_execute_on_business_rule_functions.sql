/* ═══════════════════════════════════════════════════════════════════════════
   P1 · anon holds EXECUTE on three functions that state business rules.

   BUSINESS RULE
   A signed-out visitor is not a customer of this product and must be able to
   reach nothing — not a row, and not a rule either. These three are SECURITY
   INVOKER, so RLS answers on the data path today and anon gets no dealership
   rows back. What anon could get is the rule itself:

     · nexus_lead_is_open(text)  — which pipeline statuses NEXUS counts as an
       open lead. Verified reachable as anon on 2 Sep 2026:
       nexus_lead_is_open('Qualified') = true, ('Closed Won') = false.
     · nexus_model_tokens(text)  — how NEXUS reduces a vehicle description to
       match a sale to a unit. Verified as anon:
       nexus_model_tokens('Range Rover Sport HSE 2023')
         = {range,rover,sport,hse}.
     · search_rag_documents(text, integer) — the two-argument overload. anon
       held EXECUTE on it (has_function_privilege = true). The three-argument
       overload did not. The two-argument one refuses today only because its
       body calls nexus_scoped_tenant_id(), which anon may not execute — it is
       held shut by an unrelated grant on a different function, not by any
       decision about this one. That is not a control; it is a coincidence with
       a maintenance window.

   Why this is worth a migration even though nothing leaks today: Supabase
   grants EXECUTE directly to anon and authenticated by default, and
   `REVOKE ... FROM PUBLIC` does not touch a direct grant. A later
   CREATE OR REPLACE that adds SECURITY DEFINER — for any good reason — turns
   each of these into a cross-tenant read, and the diff that does it contains
   no mention of a grant. Nothing would look wrong in review. CLAUDE.md records
   this exact shape opening a hole three times.

   Both PUBLIC and anon are revoked, because the `=X` entry in the ACL is a
   PUBLIC grant and removing anon alone would leave anon reaching it via PUBLIC.
   authenticated and service_role keep their explicit grants: the Profit
   Sentinel view calls nexus_model_tokens, the attention and metrics surfaces
   call nexus_lead_is_open, and both are security_invoker, so the reader needs
   EXECUTE in their own right.
   ═══════════════════════════════════════════════════════════════════════════ */

revoke execute on function public.nexus_lead_is_open(text)               from public, anon;
revoke execute on function public.nexus_model_tokens(text)               from public, anon;
revoke execute on function public.search_rag_documents(text, integer)    from public, anon;
revoke execute on function public.search_rag_documents(text, integer, uuid) from public, anon;

grant execute on function public.nexus_lead_is_open(text)                to authenticated, service_role;
grant execute on function public.nexus_model_tokens(text)                to authenticated, service_role;
grant execute on function public.search_rag_documents(text, integer)     to authenticated, service_role;
grant execute on function public.search_rag_documents(text, integer, uuid) to authenticated, service_role;

comment on function public.nexus_lead_is_open(text) is
  'Which pipeline statuses count as an open lead. One rule, one place - see '
  'INV-008. EXECUTE is revoked from PUBLIC and anon: a signed-out visitor may '
  'not read this dealership''s rules any more than its rows, and this function '
  'is one CREATE OR REPLACE away from being SECURITY DEFINER with no grant-shaped '
  'diff to notice.';

comment on function public.nexus_model_tokens(text) is
  'Reduces a free-text vehicle description to comparable tokens so a recorded '
  'sale can be offered against an inventory unit for a HUMAN to confirm. EXECUTE '
  'is revoked from PUBLIC and anon - it is how NEXUS matches, and that is the '
  'dealership''s business, not a visitor''s.';