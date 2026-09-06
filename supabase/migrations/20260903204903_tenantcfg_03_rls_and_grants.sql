-- tenantcfg_03_rls_and_grants
--
-- READ:  a dealership reads its own row, and only its own row.
-- WRITE: a dealership writes NOTHING. This is an operator path, like
--        channel_registry. The argument, in full, is in the table comment
--        below so it is arguable rather than assumed.
--
-- Supabase default privileges grant anon and authenticated ALL privileges
-- (arwdDxtm, including TRUNCATE, which no policy filters) on everything created
-- in public. Nobody writes those grants and nothing in the migration diff shows
-- them, so every object created in tenantcfg_01 is revoked explicitly here -
-- from anon, authenticated AND public, because a direct grant and a PUBLIC
-- grant are separate ACL rows and revoking one leaves the other.

alter table public.tenant_configuration          enable row level security;
alter table public.tenant_capability             enable row level security;
alter table public.tenant_configuration_default  enable row level security;
alter table public.tenant_capability_catalogue   enable row level security;

-- ── anon: nothing, twice over. Restrictive policy AND no grant. ────────────
drop policy if exists tenant_configuration_deny_anon on public.tenant_configuration;
create policy tenant_configuration_deny_anon on public.tenant_configuration
  as restrictive for all to anon using (false) with check (false);

drop policy if exists tenant_capability_deny_anon on public.tenant_capability;
create policy tenant_capability_deny_anon on public.tenant_capability
  as restrictive for all to anon using (false) with check (false);

drop policy if exists tenant_configuration_default_deny_anon on public.tenant_configuration_default;
create policy tenant_configuration_default_deny_anon on public.tenant_configuration_default
  as restrictive for all to anon using (false) with check (false);

drop policy if exists tenant_capability_catalogue_deny_anon on public.tenant_capability_catalogue;
create policy tenant_capability_catalogue_deny_anon on public.tenant_capability_catalogue
  as restrictive for all to anon using (false) with check (false);

-- ── service_role: the operator and the workflow identity. ──────────────────
drop policy if exists tenant_configuration_service_role_all on public.tenant_configuration;
create policy tenant_configuration_service_role_all on public.tenant_configuration
  for all to service_role using (true) with check (true);

drop policy if exists tenant_capability_service_role_all on public.tenant_capability;
create policy tenant_capability_service_role_all on public.tenant_capability
  for all to service_role using (true) with check (true);

drop policy if exists tenant_configuration_default_service_role_all on public.tenant_configuration_default;
create policy tenant_configuration_default_service_role_all on public.tenant_configuration_default
  for all to service_role using (true) with check (true);

drop policy if exists tenant_capability_catalogue_service_role_all on public.tenant_capability_catalogue;
create policy tenant_capability_catalogue_service_role_all on public.tenant_capability_catalogue
  for all to service_role using (true) with check (true);

-- ── authenticated: SELECT, own tenant only, on the two tenant-scoped tables.
--    Note the shape: tenant_id IN (select nexus_current_tenant_ids()), copied
--    from channel_registry and inventory_profit_settings so there is one
--    tenant predicate in this database and not three dialects of one.
drop policy if exists tenant_configuration_authenticated_read on public.tenant_configuration;
create policy tenant_configuration_authenticated_read on public.tenant_configuration
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists tenant_capability_authenticated_read on public.tenant_capability;
create policy tenant_capability_authenticated_read on public.tenant_capability
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

-- tenant_configuration_default and tenant_capability_catalogue get NO
-- authenticated policy and NO authenticated grant. They are shipped vocabulary
-- and a signed-in user has every right to see them - but a PERMISSIVE
-- SELECT USING (true) policy is exactly the shape QUALITY_GATE check L2 fails
-- on, and adding a name to its exemption map is the owner's decision, not this
-- migration's. So they reach the dashboard through the SECURITY DEFINER
-- resolvers in tenantcfg_04 instead, which is a narrower surface anyway: the
-- resolver returns the default JOINED to the dealership's own value, which is
-- the only form a screen actually needs.

-- ── Grants. Revoke first, from all three grantees, then grant deliberately. ─
revoke all on public.tenant_configuration         from anon, authenticated, public;
revoke all on public.tenant_capability            from anon, authenticated, public;
revoke all on public.tenant_configuration_default from anon, authenticated, public;
revoke all on public.tenant_capability_catalogue  from anon, authenticated, public;

grant select on public.tenant_configuration to authenticated;
grant select on public.tenant_capability    to authenticated;

grant all on public.tenant_configuration         to service_role;
grant all on public.tenant_capability            to service_role;
grant all on public.tenant_configuration_default to service_role;
grant all on public.tenant_capability_catalogue  to service_role;

-- Functions created in tenantcfg_01 arrive with EXECUTE granted directly to
-- anon and authenticated. The shape validators are only ever evaluated by the
-- writer, and the only writer is service_role.
--
-- Read that narrowly: the DESIGNED lock keeping authenticated out of these
-- tables is the absent INSERT/UPDATE/DELETE grant above, not this revoke. A
-- CHECK function a caller cannot execute is an INCIDENTAL lock, and CLAUDE.md
-- records what happened last time an incidental lock was mistaken for a
-- designed one.
revoke all on function public.nexus_is_business_hours(jsonb)      from anon, authenticated, public;
revoke all on function public.nexus_is_followup_policy(jsonb)     from anon, authenticated, public;
revoke all on function public.nexus_is_approval_rules(jsonb)      from anon, authenticated, public;
revoke all on function public.tenant_configuration_validate()     from anon, authenticated, public;
revoke all on function public.tenant_capability_touch()           from anon, authenticated, public;

grant execute on function public.nexus_is_business_hours(jsonb)   to service_role;
grant execute on function public.nexus_is_followup_policy(jsonb)  to service_role;
grant execute on function public.nexus_is_approval_rules(jsonb)   to service_role;

comment on policy tenant_configuration_authenticated_read on public.tenant_configuration is
  'SELECT only, own tenant only. There is deliberately NO authenticated write policy. Three reasons, and the third is the one that decides it: (1) nothing in the shipped bundle writes this table - grep dbWrite across lib/ and screens/ finds two direct table writes, inventory and leads, and neither is this - so a write grant today opens a lock nothing is using; (2) the provenance CHECKs on the four governed columns are meaningless if the person whose performance is judged against a setting can also set it and sign their own attestation; (3) approval_rules decides whether software may act without a human, and capabilities decide whether a screen may claim a data source exists - a dealership that can self-grant SERVICE_HISTORY gets fabricated service data, which is the precise failure this design is built to prevent. THE CONSEQUENCE, stated so the owner can overrule it: until a settings screen and an operator RPC exist, changing a greeting or an opening hour is a support ticket. tone, business_hours, brand_name, default_language and timezone are marked who_decides = DEALERSHIP in tenant_configuration_default and are the natural first candidates for self-service; approval_rules and capabilities are marked OPERATOR and should stay that way.';