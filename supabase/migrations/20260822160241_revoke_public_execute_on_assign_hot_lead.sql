-- The previous migration revoked EXECUTE on assign_hot_lead() from anon and
-- authenticated, which did nothing: Postgres grants EXECUTE to PUBLIC on every
-- new function, and both roles inherit it from there. The advisor caught it —
-- the function was still callable as `POST /rest/v1/rpc/assign_hot_lead` by
-- anyone, signed in or not.
--
-- It is a trigger function. Nothing should ever call it directly, and calling it
-- outside a trigger context would error anyway, but a SECURITY DEFINER function
-- reachable from the public API is not something to leave standing on that
-- reasoning. Revoke from PUBLIC, which is the grant that actually exists.
revoke execute on function public.assign_hot_lead() from public;
revoke execute on function public.assign_hot_lead() from anon, authenticated;

-- Same belt-and-braces for the other two SECURITY DEFINER functions, in case
-- the PUBLIC grant is what is holding them open too.
revoke execute on function public.recompute_inventory_derived() from public;
revoke execute on function public.capture_daily_metrics() from public;