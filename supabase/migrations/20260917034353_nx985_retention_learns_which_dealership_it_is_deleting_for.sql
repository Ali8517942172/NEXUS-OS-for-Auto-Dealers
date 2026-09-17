-- NX985 — Retention learns which dealership it is deleting for.
--
-- The nightly purge deletes with no tenant predicate. Today that is harmless
-- because there is one dealership; the night there are two it deletes both
-- dealerships' records from one schedule, and the destructive guard stops none
-- of it (Storage is outside Postgres, and neither processed_messages nor
-- kyc_documents was guarded until NX984 covered the second).
--
-- This is step one of Ali's stated order: give the purge a scoped RPC to call
-- BEFORE the guard goes on processed_messages. Reversed, the guard refuses a
-- live scheduled job the first night it runs, which looks like hardening and
-- reads as an outage.
--
-- NOTHING HERE CHANGES WHAT RUNS TONIGHT. These four functions are new and
-- nothing calls them yet. The workflow swap is a separate, owner-approved step.
--
-- Four design choices, each because the alternative has already bitten this
-- project:
--
-- 1. THE TENANT IS AN ARGUMENT, NOT AN AMBIENT DEFAULT. Not
--    nexus_scoped_tenant_id() -- that returns NULL the day a second dealership
--    exists, and a retention job that silently stops deleting is a compliance
--    failure that looks like success. The caller must name the dealership.
-- 2. DRY RUN IS THE DEFAULT. p_dry_run defaults true. An operator who forgets
--    the argument gets a report, not a deletion.
-- 3. DELETION AND CONFIRMATION ARE SEPARATE. The database cannot delete a file
--    from Storage. So it hands out what is due, the caller deletes the objects,
--    and only then marks rows purged -- and the marking refuses any id that
--    does not belong to the named dealership. Absence from a delete response is
--    NOT DELETED; nothing here treats it as done.
-- 4. EVERY CALL IS AUDITED, INCLUDING THE DRY RUNS. A retention decision nobody
--    can reconstruct is not a retention policy.
--
-- Measured before writing: processed_messages 173 rows, kyc_documents 9 rows
-- (all 9 with a storage_path, none carrying a tenant segment in that path --
-- see ops/destructive-scope/), 1 active dealership, earliest retain_until
-- 2 Sep 2033. Nothing is due for deletion for about seven years.

begin;

-- ── Preview. Counts only. Physically cannot delete anything. ───────────────
create or replace function public.nexus_retention_preview(p_tenant_id uuid)
returns table (category text, rows_due bigint, detail text)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
declare v_slug text;
begin
  select t.slug into v_slug from public.tenants t
   where t.id = p_tenant_id and t.status = 'active' and not t.is_quarantine;
  if v_slug is null then
    raise exception using errcode = 'P0001',
      message = 'NX985 REFUSED: no active dealership with that id. Retention never runs unnamed.';
  end if;

  category := 'KYC_DOCUMENTS_DUE';
  select count(*) into rows_due from public.kyc_documents k
   where k.tenant_id = p_tenant_id and k.storage_path is not null
     and k.purged_at is null and k.retain_until < current_date;
  detail := 'Identity documents past retain_until with a storage object still present, for ' || v_slug || '.';
  return next;

  category := 'KYC_ARCHIVE_GAPS';
  select count(*) into rows_due from public.kyc_documents k
   where k.tenant_id = p_tenant_id and k.storage_path is null and k.purged_at is null;
  detail := 'Rows with no storage object recorded. Not a deletion -- a gap that means the archive never happened.';
  return next;

  category := 'PROCESSED_MESSAGES_STALE_7D';
  select count(*) into rows_due from public.processed_messages m
   where m.tenant_id = p_tenant_id and m.processed_at < now() - interval '7 days';
  detail := 'Idempotency ledger entries older than seven days. Deleting another dealership''s entries re-opens duplicate processing for them.';
  return next;
end
$fn$;

-- ── The scoped prune. Dry by default. ─────────────────────────────────────
create or replace function public.nexus_prune_processed_messages(
  p_tenant_id  uuid,
  p_older_than interval default interval '7 days',
  p_dry_run    boolean  default true,
  p_reason     text     default null
) returns table (tenant_id uuid, rows_matched bigint, rows_deleted bigint, dry_run boolean)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare v_slug text; v_matched bigint; v_deleted bigint := 0;
begin
  select t.slug into v_slug from public.tenants t
   where t.id = p_tenant_id and t.status = 'active' and not t.is_quarantine;
  if v_slug is null then
    raise exception using errcode = 'P0001',
      message = 'NX985 REFUSED: no active dealership with that id. A prune with no dealership is a prune of everyone.';
  end if;
  if p_older_than is null or p_older_than < interval '1 day' then
    raise exception using errcode = 'P0001',
      message = 'NX985 REFUSED: an idempotency ledger younger than a day is the thing stopping today''s duplicates.';
  end if;

  select count(*) into v_matched from public.processed_messages m
   where m.tenant_id = p_tenant_id and m.processed_at < now() - p_older_than;

  if not p_dry_run then
    -- Deliberate, named, and scoped. Set so this keeps working on the day
    -- processed_messages joins the destructive guard -- which is the step
    -- AFTER the workflow is pointed here.
    perform set_config('nexus.destructive_write_is_deliberate',
                       'YES_I_HAVE_A_COPY_AND_I_MEAN_IT', true);
    delete from public.processed_messages m
     where m.tenant_id = p_tenant_id and m.processed_at < now() - p_older_than;
    get diagnostics v_deleted = row_count;
  end if;

  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Retention Prune', case when p_dry_run then 'DRY_RUN' else 'SUCCESS' end,
          format('processed_messages older than %s for %s: %s matched, %s deleted. %s',
                 p_older_than::text, v_slug, v_matched, v_deleted,
                 coalesce(p_reason, 'no reason given')),
          now(), p_tenant_id);

  tenant_id := p_tenant_id; rows_matched := v_matched;
  rows_deleted := v_deleted; dry_run := p_dry_run;
  return next;
end
$fn$;

-- ── What is due, so the caller can delete the objects it cannot. ──────────
create or replace function public.nexus_kyc_documents_due(p_tenant_id uuid)
returns table (id uuid, storage_path text, retain_until date)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
begin
  if not exists (select 1 from public.tenants t
                  where t.id = p_tenant_id and t.status = 'active' and not t.is_quarantine) then
    raise exception using errcode = 'P0001',
      message = 'NX985 REFUSED: no active dealership with that id.';
  end if;
  return query
    select k.id, k.storage_path, k.retain_until
      from public.kyc_documents k
     where k.tenant_id = p_tenant_id
       and k.storage_path is not null
       and k.purged_at is null
       and k.retain_until < current_date
     order by k.retain_until
     limit 500;
end
$fn$;

-- ── Mark purged, and refuse any id that is not this dealership's. ─────────
create or replace function public.nexus_kyc_mark_purged(
  p_tenant_id uuid,
  p_ids       uuid[],
  p_reason    text default null
) returns table (marked bigint, refused bigint)
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare v_slug text; v_marked bigint; v_total int := coalesce(array_length(p_ids, 1), 0);
begin
  select t.slug into v_slug from public.tenants t
   where t.id = p_tenant_id and t.status = 'active' and not t.is_quarantine;
  if v_slug is null then
    raise exception using errcode = 'P0001', message = 'NX985 REFUSED: no active dealership with that id.';
  end if;

  -- The tenant predicate is what makes a wrong id harmless rather than
  -- someone else's record marked as destroyed.
  update public.kyc_documents k
     set purged_at = now()
   where k.tenant_id = p_tenant_id
     and k.id = any(p_ids)
     and k.purged_at is null;
  get diagnostics v_marked = row_count;

  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Retention Mark Purged', 'SUCCESS',
          format('%s of %s ids marked purged for %s; %s were not this dealership''s or were already marked. %s',
                 v_marked, v_total, v_slug, v_total - v_marked, coalesce(p_reason, 'no reason given')),
          now(), p_tenant_id);

  marked := v_marked; refused := v_total - v_marked;
  return next;
end
$fn$;

revoke all on function public.nexus_retention_preview(uuid) from public, anon, authenticated;
revoke all on function public.nexus_prune_processed_messages(uuid,interval,boolean,text) from public, anon, authenticated;
revoke all on function public.nexus_kyc_documents_due(uuid) from public, anon, authenticated;
revoke all on function public.nexus_kyc_mark_purged(uuid,uuid[],text) from public, anon, authenticated;
grant execute on function public.nexus_retention_preview(uuid) to service_role;
grant execute on function public.nexus_prune_processed_messages(uuid,interval,boolean,text) to service_role;
grant execute on function public.nexus_kyc_documents_due(uuid) to service_role;
grant execute on function public.nexus_kyc_mark_purged(uuid,uuid[],text) to service_role;

commit;