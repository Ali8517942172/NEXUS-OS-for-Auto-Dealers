-- tenantcfg_07_pin_search_path
--
-- get_advisors raised function_search_path_mutable on the five helpers created
-- in tenantcfg_01. None is SECURITY DEFINER, so none is the classic
-- privilege-escalation shape - but two of them are CHECK-constraint bodies and
-- one is a BEFORE trigger, i.e. they run inside somebody else's transaction with
-- that session's search_path. A schema earlier on the path could shadow a
-- function or an operator they depend on and quietly change what the constraint
-- accepts, with no constraint-shaped diff to review. Pin them.

alter function public.nexus_is_business_hours(jsonb)  set search_path to 'public', 'pg_catalog';
alter function public.nexus_is_followup_policy(jsonb) set search_path to 'public', 'pg_catalog';
alter function public.nexus_is_approval_rules(jsonb)  set search_path to 'public', 'pg_catalog';
alter function public.tenant_configuration_validate() set search_path to 'public', 'pg_catalog';
alter function public.tenant_capability_touch()       set search_path to 'public', 'pg_catalog';