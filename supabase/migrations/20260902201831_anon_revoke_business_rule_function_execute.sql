-- BUSINESS RULE: a function that encodes a NEXUS business rule must not be
-- executable by the public anon key. None of these reads a tenant-owned table
-- today, which is why the linter does not flag them — but the rule they encode
-- is the dealership's, and the danger is not today's body. It is that a later
-- `CREATE OR REPLACE FUNCTION` adding SECURITY DEFINER, or widening the body to
-- read a table, would open an anon-reachable hole with NO grant-shaped diff to
-- review: the grant is already there. That is precisely how the RAG search
-- functions, the tenancy helpers and action_write_audit were opened.
--
-- WHAT WAS ACTUALLY OPEN (measured, per pg_proc.proacl):
--   All four carried BOTH `=X/postgres` (PUBLIC) AND `anon=X/postgres` (direct).
--   Revoking only from PUBLIC would have left the direct anon grant standing —
--   the exact shape that kept one of these open last time. Both are revoked.
--   All four are prosecdef=false today; this migration changes no body.
--
-- nexus_is_message / nexus_is_reply / nexus_outcome_class:
--   pure IMMUTABLE SQL over their own arguments, SET search_path = '', zero
--   table access. nexus_is_message defines what counts as a real customer
--   message (inbound/outbound on whatsapp|email|sms, excluding '[system]%' and
--   '[SILENCE-%' machine traffic); nexus_outcome_class defines how a workflow
--   run is classified SUCCESS/PARTIAL/FAILURE/ESCALATED/NO_RESULT. Those are
--   reporting truths the dashboard renders.
--
-- CALLERS CHECKED BEFORE REVOKING — every one keeps working:
--   views (all security_invoker, so they execute as the CALLER):
--     nexus_is_message     -> v_conversations, v_customer_360, v_lead_messages
--     nexus_outcome_class  -> v_needs_attention, v_workflow_health,
--                             v_inventory_action_timeline
--   functions (all SECURITY DEFINER owned by postgres, which keeps postgres=X):
--     action_decide, capture_daily_metrics, nexus_mark_first_response
--   nexus_is_reply has no caller in any view or function.
--   The security_invoker callers are read by `authenticated` (dashboard) and
--   `service_role` (n8n). BOTH KEEP EXECUTE below — only anon and PUBLIC lose
--   it — so no caller loses a privilege it uses.

revoke execute on function
  public.nexus_is_message(text, text, text),
  public.nexus_is_reply(text, text, text),
  public.nexus_outcome_class(text, text, text)
from anon, public;

-- nexus_require_security_invoker_views() — the event-trigger function behind
-- `nexus_guard_security_invoker_views`, which is the control that closed the
-- 2 Sep 2026 leak (views that were NOT security_invoker let the anon key read
-- every customer). Revoking its grants CANNOT disarm it, for three independent
-- reasons, each checked rather than assumed:
--
--  1. It RETURNS event_trigger. PostgreSQL refuses to invoke such a function
--     through normal SQL at all, whoever holds EXECUTE. There is no direct-call
--     surface for the grant to protect.
--  2. Event triggers are fired by the event-trigger machinery on DDL, which
--     does not perform an EXECUTE permission check on the function at fire
--     time; the privilege is checked when the event trigger is CREATED. The
--     trigger already exists and is enabled (evtenabled='O'), owned by postgres.
--  3. Nothing that would lose the grant can fire it anyway: `anon` and
--     `authenticated` hold only USAGE on schema public, not CREATE, so neither
--     can execute CREATE VIEW / ALTER VIEW / ALTER TABLE — the only events this
--     trigger listens for. Migrations run as postgres, which keeps postgres=X.
--
-- Proven empirically either side of this migration: `CREATE VIEW` without
-- security_invoker is rejected with 'NEXUS SECURITY GATE ...' both before and
-- after, and `CREATE VIEW ... WITH (security_invoker=true)` still succeeds.
revoke execute on function
  public.nexus_require_security_invoker_views()
from anon, public;

-- Same drift stopper as for tables: without this, the next function created in
-- public is born with EXECUTE granted to anon by Supabase's default privileges,
-- and the check has to be remembered by a human every single time.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
