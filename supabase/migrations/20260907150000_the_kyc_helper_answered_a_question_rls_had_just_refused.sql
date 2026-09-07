-- A KYC storage helper answered, for any path a caller cared to name, the exact
-- question row-level security had just refused to answer.
--
-- WHAT WAS MEASURED ON PRODUCTION, 7 September 2026
--
-- public.nexus_kyc_object_tenant(text) is SECURITY DEFINER and was granted to
-- `authenticated`. It takes a storage path and returns the tenant_id of the
-- kyc_documents row holding it. Run as a signed-in account belonging to NO
-- dealership at all:
--
--   dealerships this account belongs to ............ 0
--   rows it can SELECT from public.kyc_documents ... 0     <- RLS works
--   nexus_kyc_object_tenant(<a real kyc path>) ..... fff6a2b5-… <- and this
--   nexus_kyc_object_tenant('kyc/999999/nope') ..... NULL   <- clean control
--
-- So RLS refused every row and the helper handed back the owning dealership
-- anyway, plus a yes/no on whether any document exists at that path. Two
-- disclosures, both cross-tenant: existence, and ownership.
--
-- HOW ENUMERABLE IS IT, MEASURED RATHER THAN ASSUMED
--
-- All three storage paths are 35 characters, begin `kyc`, contain NO uuid, and
-- carry a small integer segment: the shape is kyc/<id>/<file>. So the path space
-- is walkable, not guessable-in-principle. Today production holds one
-- dealership, so nothing crosses a tenant boundary yet. NEXUS is sold
-- multi-tenant; the second dealership is what turns this from a shape into a
-- leak, and the data behind those paths is passports and Emirates IDs.
--
-- WHY THE GRANT CANNOT SIMPLY BE REVOKED
--
-- It is load-bearing. Policy `kyc_objects_staff_read` on storage.objects, FOR
-- SELECT TO authenticated, calls this function in its USING clause, and Postgres
-- evaluates a policy expression as the QUERYING role. Revoke the grant and every
-- KYC document read breaks. That is why this is not a stray grant to delete; it
-- is a designed grant whose side effect was never priced.
--
-- THE FIX: MAKE THE FUNCTION UNABLE TO SAY ANYTHING THE CALLER DID NOT ALREADY KNOW
--
-- Replace "whose is this?" with "may I read this?". The new function encodes the
-- ENTIRE policy predicate and returns a boolean. A caller invoking it directly
-- learns only whether they may read an object -- which they could establish by
-- attempting the read. The oracle collapses to nothing.
--
-- The old function stays for service_role, which legitimately needs the mapping,
-- and loses its grant to authenticated. Both are asserted below.

create or replace function public.nexus_kyc_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- SECURITY DEFINER for the same reason as before: the policy must be able to
  -- tell "belongs to someone else" from "belongs to nobody", and a caller
  -- restricted by RLS cannot. What changed is the ANSWER. This returns only
  -- whether THIS caller may read THIS object, so calling it directly reveals
  -- nothing a read attempt would not.
  --
  -- The inner select is NULL when no dealership claims the object, which is the
  -- unattributed case, and coalesce hands that to the quarantine-tenant branch.
  -- It is never NULL for a claimed object, because kyc_documents.tenant_id is
  -- NOT NULL -- so false here always means "claimed by someone who is not you".
  select coalesce(
    (select k.tenant_id in (select public.nexus_current_tenant_ids())
       from public.kyc_documents k
      where k.storage_path = p_name
      order by k.created_at
      limit 1),
    exists (
      select 1 from public.tenants t
       where t.is_unattributed_default
         and t.status = 'active'
         and t.id in (select public.nexus_current_tenant_ids())
    )
  );
$$;

comment on function public.nexus_kyc_object_readable(text) is
  'May the CALLER read this kyc-documents storage object? Encodes the whole of '
  'policy kyc_objects_staff_read so the policy needs no other helper. Replaces '
  'nexus_kyc_object_tenant(text) in that policy, which returned the OWNING '
  'tenant to any signed-in account and was therefore an existence-and-ownership '
  'oracle over passport and Emirates ID scans -- measured on production, from an '
  'account belonging to zero dealerships, on 7 September 2026.';

revoke all on function public.nexus_kyc_object_readable(text) from public, anon;
-- authenticated MUST hold this: a policy expression is evaluated as the
-- querying role, and this function is that policy.
grant execute on function public.nexus_kyc_object_readable(text) to authenticated, service_role;

drop policy if exists kyc_objects_staff_read on storage.objects;

create policy kyc_objects_staff_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and public.nexus_kyc_object_readable(name)
  );

-- The mapping function keeps existing -- service_role genuinely needs "whose is
-- this?" -- and loses the grant that made it an oracle. `public` is named as
-- well as the roles: a revoke that omits it leaves the bare PUBLIC entry behind
-- and every role keeps reaching the function. That is the defect
-- 20260907140000 was written about, three days after it was made.
revoke all on function public.nexus_kyc_object_tenant(text) from public, anon, authenticated;
grant execute on function public.nexus_kyc_object_tenant(text) to service_role;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('authenticated', 'public.nexus_kyc_object_tenant(text)', 'execute') then
    bad := array_append(bad, 'authenticated can still call the ownership oracle');
  end if;
  if has_function_privilege('anon', 'public.nexus_kyc_object_tenant(text)', 'execute') then
    bad := array_append(bad, 'anon can still call the ownership oracle');
  end if;
  if not has_function_privilege('service_role', 'public.nexus_kyc_object_tenant(text)', 'execute') then
    bad := array_append(bad, 'service_role lost the mapping it needs');
  end if;
  -- and the replacement must be reachable by the role that evaluates the policy,
  -- or every KYC document read breaks silently
  if not has_function_privilege('authenticated', 'public.nexus_kyc_object_readable(text)', 'execute') then
    bad := array_append(bad, 'authenticated cannot evaluate the new policy, so KYC reads are broken');
  end if;
  if has_function_privilege('anon', 'public.nexus_kyc_object_readable(text)', 'execute') then
    bad := array_append(bad, 'anon can execute the new policy helper');
  end if;
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'objects' and p.polname = 'kyc_objects_staff_read'
       and pg_get_expr(p.polqual, p.polrelid) like '%nexus_kyc_object_readable%'
  ) then
    bad := array_append(bad, 'the storage policy does not use the new helper');
  end if;
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'objects'
       and pg_get_expr(p.polqual, p.polrelid) like '%nexus_kyc_object_tenant%'
  ) then
    bad := array_append(bad, 'some storage policy still calls the ownership oracle');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'kyc storage scoping is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
