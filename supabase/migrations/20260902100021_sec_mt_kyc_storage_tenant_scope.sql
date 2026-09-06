
-- BUSINESS RULE
-- A customer's KYC image (passport / Emirates ID) belongs to the dealership
-- that collected it, and to nobody else. Until now the only policy on the
-- bucket was `bucket_id = 'kyc-documents'` for role `authenticated`, which is
-- not a tenant test at all: any signed-in user of any dealership -- and any
-- signed-in user belonging to no dealership -- could list and download every
-- KYC image in the bucket. Proven on 2 Sep 2026: a member of a synthetic
-- second dealership read all 11 of ALBA CARS' KYC objects, and the object
-- paths themselves carry the customer's WhatsApp id.
--
-- An object is now readable only by the dealership that owns the
-- kyc_documents row pointing at it. Objects that no kyc_documents row claims
-- (uploaded before the KYC table recorded storage_path) cannot be attributed
-- from the object alone, so they follow the same rule the rest of the system
-- uses for unattributed data: they belong to the tenant holding
-- is_unattributed_default, and to no one else.
--
-- service_role (n8n) is BYPASSRLS and is unaffected; uploads still happen only
-- as service_role because no INSERT policy exists for authenticated.

create or replace function public.nexus_kyc_object_tenant(p_name text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- SECURITY DEFINER on purpose: the caller must not be able to see other
  -- tenants' kyc_documents rows, but the policy must still be able to tell
  -- "this object belongs to someone else" apart from "this object belongs to
  -- nobody". Returns NULL only when no dealership claims the object at all.
  select k.tenant_id
    from public.kyc_documents k
   where k.storage_path = p_name
   order by k.created_at
   limit 1;
$$;

revoke all on function public.nexus_kyc_object_tenant(text) from public;
grant execute on function public.nexus_kyc_object_tenant(text) to authenticated, service_role;

drop policy if exists kyc_objects_staff_read on storage.objects;

create policy kyc_objects_staff_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (
      public.nexus_kyc_object_tenant(name) in (select public.nexus_current_tenant_ids())
      or (
        public.nexus_kyc_object_tenant(name) is null
        and exists (
          select 1 from public.tenants t
           where t.is_unattributed_default
             and t.status = 'active'
             and t.id in (select public.nexus_current_tenant_ids())
        )
      )
    )
  );
