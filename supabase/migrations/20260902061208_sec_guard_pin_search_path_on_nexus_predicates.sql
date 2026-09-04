-- BUSINESS RULE
-- Every function in schema public must have a pinned search_path, so that no
-- caller-controlled search_path can change which objects the function resolves.
-- These three are SECURITY INVOKER and IMMUTABLE (not SECURITY DEFINER, so they were
-- never a privilege-escalation path) but they are EXECUTE-able by `anon` and are
-- load-bearing inside v_conversations, v_customer_360, v_lead_messages,
-- v_needs_attention and v_workflow_health. Pinning them closes the linter's
-- function_search_path_mutable WARN and matches public.nexus_lead_is_open, which
-- already uses search_path = ''.
--
-- '' is safe here: pg_catalog is always implicitly searched first, so the built-in
-- operators and functions these bodies use still resolve, and the one cross-function
-- call (nexus_is_reply -> nexus_is_message) is already schema-qualified.
-- Bodies are NOT modified.

ALTER FUNCTION public.nexus_is_message(text, text, text)      SET search_path = '';
ALTER FUNCTION public.nexus_is_reply(text, text, text)        SET search_path = '';
ALTER FUNCTION public.nexus_outcome_class(text, text, text)   SET search_path = '';
