-- ===========================================================================
-- rbac_04_leads_writes_by_role
--
-- Measured on staging BEFORE this migration, role authenticated, rolled back:
--
--   sales      reassign a lead belonging to ANOTHER rep -> NO ERROR, 1 row
--   technician UPDATE leads.status AND leads.ai_score   -> NO ERROR, 1 row
--
-- The second one is worth naming separately. ai_score and
-- response_time_minutes are not opinions a person is entitled to hold: the
-- first is the router's, the second is written by nexus_mark_first_response
-- and is the only thing behind within_sla / breached_sla on Team Performance.
-- Any signed-in user could type over both. That is a figure with two
-- derivations, which NEXUS_INVARIANTS forbids, arriving through a privilege
-- nobody meant to grant.
--
-- COLUMN GRANT -- what a dashboard user may write at all. The list below is
-- the customer-facing business record: who they are, how to reach them, what
-- they want, what they will spend, where they are in the pipeline, and whose
-- lead it is. Everything else on this table is machine-owned and is now
-- refused by GRANT with 42501:
--
--   id, source, created_at, tenant_id       identity and provenance
--   ai_score                                 the router's judgement
--   response_time_minutes                    the SLA measurement itself
--   escalated_at                             stamped by action_decide()
--   bitrix_lead_id, crm_synced_at            the CRM sync's own bookkeeping
--
-- None of those are written by the dashboard today -- the only live lead write
-- in the shipped bundle is lib/lead-drawer.js sending assigned_to_id and
-- assigned_to -- so withholding them costs a working screen nothing. n8n is
-- service_role and is not affected by any column grant here.
--
-- RLS -- WHO may write WHICH ROW, from tenant_members.role:
--
--   owner / admin / manager   any lead at their dealership, including
--                             reassigning it. Reassignment is a management
--                             act: it moves commission and it moves
--                             accountability for the 5-minute rule.
--   sales / member            only leads whose assigned_to_id is one of their
--                             own public.users rows -- and, because the same
--                             predicate is in WITH CHECK, the row has to still
--                             be theirs afterwards. So a rep works their own
--                             pipeline and cannot hand a lead to anybody,
--                             themselves included.
--   technician                no lead writes. In neither branch, so refused.
--
-- The USING half alone would have stopped "reassign someone else's lead". It
-- would NOT have stopped a rep reassigning their OWN lead to a colleague, or
-- to nobody. WITH CHECK is what closes that, and it is the difference between
-- "may not take" and "may not give".
--
-- The link is tenant_members.staff_user_id, which is NULLABLE. A sales login
-- that was never linked to a staff row matches no lead and can edit none.
-- That is the safe direction for a link somebody forgot to make, and it is a
-- support question rather than a silent grant.
--
-- WHAT THIS COSTS THE ONE LIVE USER: nothing. ALBA CARS has one
-- tenant_members row, role = 'owner', staff_user_id linked to Ali Asgher.
-- ===========================================================================

revoke insert, update, delete, truncate on public.leads from authenticated;

grant select on public.leads to authenticated;

grant update (name, email, phone, status, vehicle_interest, budget_aed, assigned_to, assigned_to_id)
  on public.leads to authenticated;

drop policy if exists leads_role_update on public.leads;
create policy leads_role_update on public.leads
  as restrictive for update to authenticated
  using (
        tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin','manager']::text[]))
     or (
            tenant_id in (select public.nexus_tenant_ids_for_roles(array['sales','member']::text[]))
        and assigned_to_id is not null
        and assigned_to_id in (select public.nexus_my_staff_user_ids())
        )
  )
  with check (
        tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin','manager']::text[]))
     or (
            tenant_id in (select public.nexus_tenant_ids_for_roles(array['sales','member']::text[]))
        and assigned_to_id is not null
        and assigned_to_id in (select public.nexus_my_staff_user_ids())
        )
  );

comment on column public.leads.assigned_to_id is
  'Whose lead this is, as a public.users id. Reassignment is an owner/admin/manager act: '
  'the leads_role_update policy puts this column inside both USING and WITH CHECK for a '
  'sales or member login, so such a login can only touch a lead already theirs and can '
  'only leave it theirs.';

comment on column public.leads.ai_score is
  'The router''s score. authenticated holds no UPDATE privilege on this column -- a PATCH '
  'naming it is refused 42501 by GRANT. It has one derivation and a dashboard user is not '
  'it.';

comment on column public.leads.response_time_minutes is
  'Written by nexus_mark_first_response and nothing else, and it is the only input to '
  'within_sla / breached_sla on Team Performance. authenticated holds no UPDATE privilege '
  'on it, so nobody can improve their own SLA figure by typing over the measurement.';