-- NX997 — A conversation could belong to three dealerships at once.
--
-- WHY THIS FILE EXISTS.
--
-- On staging wwspuxrbiyagnrnzgate, connected as service_role, this was
-- ACCEPTED with no error, no constraint and no trigger standing in the way:
--
--   a `conversation` row whose tenant_id was dealer B,
--   whose customer_id was dealer A's customer,
--   whose integration_id was dealer C's WhatsApp channel.
--
-- One row, three dealerships. The same probe put another dealer's user into
-- `leads.assigned_to_id` and that was accepted too. The only thing that
-- refused a cross-tenant write anywhere in the schema was `lead_event`, which
-- NX976 had given a trigger -- public.lead_event_guard_lead_tenant. That
-- trigger is the template for everything in this file.
--
-- WHY RLS DOES NOT SAVE US HERE. The ingest path runs as service_role, and
-- service_role has rolbypassrls. Every RLS policy NX982 and NX984 wrote is
-- switched off for the exact role that does the writing. A row-level policy
-- describes who may SELECT; it says nothing about whether a row is internally
-- coherent. Only a constraint or a trigger is evaluated for service_role, so a
-- constraint or a trigger is the only layer that actually holds the wall up.
--
-- NX995 already proved the shape of the fix on `appointment`: a composite
-- foreign key that carries tenant_id, pointing at a parent that has a
-- UNIQUE (tenant_id, <pk>). Postgres then refuses, in the storage engine,
-- to let a child cite a parent belonging to a different dealership. NX995
-- stopped at `appointment`. This file finishes the job on every other table
-- that carries tenant_id and references another tenant-scoped row.
--
-- THE THREE MECHANISMS, AND WHY EACH ONE IS USED WHERE IT IS.
--
--   1. COMPOSITE FOREIGN KEY -- preferred, used wherever the parent's
--      tenant_id is NOT NULL. Cheapest to reason about, enforced by the
--      storage engine, impossible to bypass, survives service_role.
--
--   2. TRIGGER (lead_event style) -- used ONLY where a composite FK would be
--      WRONG, not merely inconvenient. `policy_rule.tenant_id` is NULLABLE on
--      purpose: 6 of the 7 rules on staging are platform-global rules with
--      tenant_id IS NULL, shared by every dealership. A composite FK uses
--      MATCH SIMPLE, which would demand a parent row at (tenant_id, id) and
--      would therefore REFUSE every tenant that cites a global rule -- it
--      would break the policy engine outright. The trigger encodes the real
--      rule instead: a parent whose tenant_id IS NULL is platform-global and
--      allowed; a parent belonging to a *different* dealership is refused.
--
--   3. POLYMORPHIC TRIGGER -- `journey_step` references its subject through
--      (ref_table text, ref_id text). No foreign key can express that. The
--      trigger resolves ref_table against a fixed allow-list of tenant-scoped
--      tables and compares tenant_id.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO.
--
--   * It is ADDITIVE ONLY. It drops nothing and rewrites nothing. The existing
--     single-column foreign keys stay exactly where they are; the composite
--     keys are added ALONGSIDE them under new names. A single-column FK is not
--     wrong, it is merely insufficient, and removing it here would turn a
--     security fix into a schema migration with a blast radius.
--   * It does NOT touch `lead_event`'s existing trigger. That trigger keeps
--     working; NX997 adds a composite FK beside it as a second, cheaper layer.
--   * It does NOT close `communication_logs` or `audit_log` referentially,
--     because neither table contains a reference to close. See section 6.
--
-- SIZE. Measured on production dsvuoovivysszdoiorch 18 Sep 2026: conversation
-- 1 row, customer 1, leads 12, journey_step 16, communication_logs 399,
-- audit_log 1464. Every table in this migration is trivially small and every
-- constraint below builds and validates instantly. No table here is large and
-- no ACCESS EXCLUSIVE lock is held for a measurable period. Production was
-- also checked for pre-existing violations before this file was written:
-- conversation->customer 0, conversation->channel_registry 0,
-- leads->users 0. Nothing has to be cleaned up first.

begin;

-- ---------------------------------------------------------------------------
-- SECTION 1. Give every parent a UNIQUE (tenant_id, <pk>).
--
-- A composite foreign key needs a unique index on exactly the parent columns
-- it references. customer, leads, users and channel_registry already have one
-- (NX982 / NX995 added them). The rest are added here. These are pure
-- additions: (tenant_id, pk) is trivially unique wherever pk is already
-- unique, so none of these can fail on existing data.
-- ---------------------------------------------------------------------------

do $uniques$
declare
  r record;
  n int;
begin
  for r in
    select * from (values
      ('appointment',              'appointment_id',      'appointment_tenant_key'),
      ('purchase_history',         'id',                  'purchase_history_tenant_key'),
      ('inventory_actions',        'id',                  'inventory_actions_tenant_key'),
      ('lead_recovery_actions',    'id',                  'lead_recovery_actions_tenant_key'),
      ('channel_message_events',   'event_id',            'channel_message_events_tenant_key'),
      ('whatsapp_delivery_events', 'delivery_event_id',   'whatsapp_delivery_events_tenant_key'),
      ('whatsapp_templates',       'template_id',         'whatsapp_templates_tenant_key'),
      ('im_customer',              'customer_id',         'im_customer_tenant_key'),
      ('im_conversation',          'conversation_id',     'im_conversation_tenant_key'),
      ('im_opportunity',           'opportunity_id',      'im_opportunity_tenant_key')
    ) as t(tbl, pk, cname)
  loop
    -- The im_* identity-merge family exists on staging but not on production.
    -- Skip silently rather than fail, so one file runs unchanged on both.
    if to_regclass('public.' || r.tbl) is null then
      raise notice 'NX997: %  absent here, skipping its unique key.', r.tbl;
      continue;
    end if;

    select count(*) into n from pg_attribute
     where attrelid = ('public.' || r.tbl)::regclass
       and attname in ('tenant_id', r.pk) and attnum > 0 and not attisdropped;
    if n <> 2 then
      raise notice 'NX997: % lacks tenant_id or %, skipping.', r.tbl, r.pk;
      continue;
    end if;

    if exists (select 1 from pg_constraint
                where conrelid = ('public.' || r.tbl)::regclass and conname = r.cname) then
      continue;
    end if;

    execute format('alter table public.%I add constraint %I unique (tenant_id, %I)',
                   r.tbl, r.cname, r.pk);
    execute format($c$comment on constraint %I on public.%I is
      'NX997: lets a child cite this row by (tenant_id, %s) so the reference cannot cross a dealership boundary.'$c$,
      r.cname, r.tbl, r.pk);
  end loop;
end
$uniques$;

-- ---------------------------------------------------------------------------
-- SECTION 2. Composite foreign keys that carry tenant_id.
--
-- This is the NX995 mechanism applied everywhere it is correct. Each entry
-- adds a NEW constraint beside the existing single-column one. Because the FK
-- includes tenant_id on both sides, Postgres itself refuses a child row whose
-- parent belongs to a different dealership -- for every role, including
-- service_role, with RLS irrelevant.
--
-- MATCH SIMPLE (the default) is what we want: if the child's reference column
-- is NULL, the constraint is skipped. An unassigned lead stays legal.
-- ---------------------------------------------------------------------------

do $fks$
declare
  r record;
  n int;
  cols text[];
begin
  for r in
    select * from (values
      -- THE HOLE, exactly as the red team proved it ------------------------
      -- a conversation over another dealership's customer
      ('conversation','tenant_id, customer_id','customer','tenant_id, id',
       'conversation_customer_same_dealership'),
      -- a conversation carried on another dealership's channel. Note this
      -- reference had NO foreign key of any kind before NX997 -- not even a
      -- single-column one. integration_id was a bare uuid column.
      ('conversation','integration_id, tenant_id','channel_registry','integration_id, tenant_id',
       'conversation_channel_same_dealership'),
      -- a lead assigned to another dealership's salesperson
      ('leads','tenant_id, assigned_to_id','users','tenant_id, id',
       'leads_assigned_user_same_dealership'),

      -- lead_event already has the NX976 trigger; this is the cheaper second
      -- layer beside it, not a replacement for it.
      ('lead_event','tenant_id, lead_id','leads','tenant_id, id',
       'lead_event_lead_same_dealership'),

      -- staff membership must not grant a user in dealership A a seat in B
      ('tenant_members','tenant_id, staff_user_id','users','tenant_id, id',
       'tenant_members_staff_same_dealership'),

      -- append-only event tables must not narrate another dealership's parent
      ('appointment_event','tenant_id, appointment_id','appointment','tenant_id, appointment_id',
       'appointment_event_same_dealership'),
      ('inventory_action_events','tenant_id, action_id','inventory_actions','tenant_id, id',
       'inventory_action_events_same_dealership'),
      ('lead_recovery_action_events','tenant_id, action_id','lead_recovery_actions','tenant_id, id',
       'lead_recovery_action_events_same_dealership'),

      -- revenue attribution must not credit another dealership's sale
      ('inventory_actions','tenant_id, outcome_purchase_id','purchase_history','tenant_id, id',
       'inventory_actions_purchase_same_dealership'),
      ('lead_recovery_actions','tenant_id, outcome_purchase_id','purchase_history','tenant_id, id',
       'lead_recovery_actions_purchase_same_dealership'),

      -- WhatsApp billing and delivery must not bill one dealer for another's send
      ('whatsapp_delivery_events','tenant_id, event_id','channel_message_events','tenant_id, event_id',
       'wde_event_same_dealership'),
      ('whatsapp_message_usage','tenant_id, event_id','channel_message_events','tenant_id, event_id',
       'wmu_event_same_dealership'),
      ('whatsapp_message_usage','tenant_id, latest_status_delivery_event_id','whatsapp_delivery_events','tenant_id, delivery_event_id',
       'wmu_latest_status_same_dealership'),
      ('whatsapp_message_usage','tenant_id, provider_pricing_delivery_event_id','whatsapp_delivery_events','tenant_id, delivery_event_id',
       'wmu_pricing_same_dealership'),
      ('whatsapp_message_usage','tenant_id, template_id','whatsapp_templates','tenant_id, template_id',
       'wmu_template_same_dealership'),

      -- identity-merge family (staging only today, production later)
      ('im_conversation','tenant_id, customer_id','im_customer','tenant_id, customer_id',
       'im_conversation_customer_same_dealership'),
      ('im_identity','tenant_id, customer_id','im_customer','tenant_id, customer_id',
       'im_identity_customer_same_dealership'),
      ('im_opportunity','tenant_id, customer_id','im_customer','tenant_id, customer_id',
       'im_opportunity_customer_same_dealership'),
      ('im_customer','tenant_id, merged_into','im_customer','tenant_id, customer_id',
       'im_customer_merged_into_same_dealership'),
      ('im_identity_review','tenant_id, customer_a','im_customer','tenant_id, customer_id',
       'im_identity_review_a_same_dealership'),
      ('im_identity_review','tenant_id, customer_b','im_customer','tenant_id, customer_id',
       'im_identity_review_b_same_dealership'),
      ('im_merge_log','tenant_id, winner_id','im_customer','tenant_id, customer_id',
       'im_merge_log_winner_same_dealership'),
      ('im_merge_log','tenant_id, loser_id','im_customer','tenant_id, customer_id',
       'im_merge_log_loser_same_dealership'),
      ('im_conversation_opportunity','tenant_id, conversation_id','im_conversation','tenant_id, conversation_id',
       'im_co_conversation_same_dealership'),
      ('im_conversation_opportunity','tenant_id, opportunity_id','im_opportunity','tenant_id, opportunity_id',
       'im_co_opportunity_same_dealership')
    ) as t(child, child_cols, parent, parent_cols, cname)
  loop
    if to_regclass('public.' || r.child) is null or to_regclass('public.' || r.parent) is null then
      raise notice 'NX997: % or % absent here, skipping %.', r.child, r.parent, r.cname;
      continue;
    end if;

    if exists (select 1 from pg_constraint
                where conrelid = ('public.' || r.child)::regclass and conname = r.cname) then
      continue;
    end if;

    -- Every named child column must actually exist on this database.
    cols := string_to_array(replace(r.child_cols, ' ', ''), ',');
    select count(*) into n from pg_attribute
     where attrelid = ('public.' || r.child)::regclass
       and attname = any(cols) and attnum > 0 and not attisdropped;
    if n <> array_length(cols, 1) then
      raise notice 'NX997: % lacks one of (%), skipping %.', r.child, r.child_cols, r.cname;
      continue;
    end if;

    execute format('alter table public.%I add constraint %I foreign key (%s) references public.%I (%s)',
                   r.child, r.cname, r.child_cols, r.parent, r.parent_cols);
    execute format($c$comment on constraint %I on public.%I is
      'NX997: carries tenant_id into the reference, so a %s row can never cite a %s row belonging to another dealership. Enforced by the storage engine, so service_role''s rolbypassrls does not get around it.'$c$,
      r.cname, r.child, r.child, r.parent);
  end loop;
end
$fks$;

-- ---------------------------------------------------------------------------
-- SECTION 3. The lead_event-style trigger, for parents whose tenant_id is
-- NULLABLE by design.
--
-- policy_rule is the only such parent. Its NULL tenant_id means "this is a
-- platform-global rule that every dealership inherits" -- 6 of 7 rules on
-- staging are global. A composite FK would refuse those citations outright
-- and take the policy engine down with it, so the rule is expressed as a
-- trigger instead:
--
--     parent missing            -> refuse (dangling citation)
--     parent tenant_id IS NULL  -> allow  (platform-global rule)
--     parent tenant_id = mine   -> allow
--     parent tenant_id = theirs -> REFUSE
--
-- Parameterised through TG_ARGV so one function serves every such reference,
-- in the NX983 shape: SECURITY DEFINER, search_path pinned, EXECUTE revoked
-- from PUBLIC so a browser role cannot call it directly.
-- ---------------------------------------------------------------------------

create or replace function public.nexus_guard_same_tenant_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_parent   text := tg_argv[0];   -- parent table, public schema
  v_parentpk text := tg_argv[1];   -- parent key column
  v_childcol text := tg_argv[2];   -- child column holding the reference
  v_label    text := tg_argv[3];   -- human words for the error message
  v_ref      uuid;
  v_ptenant  uuid;
  v_found    boolean;
begin
  -- Pull the reference out of NEW by name.
  execute format('select ($1).%I', v_childcol) into v_ref using new;

  -- A null reference is not a cross-tenant reference. MATCH SIMPLE parity.
  if v_ref is null then return new; end if;

  -- A child with no tenant of its own is platform-authored; nothing to compare.
  if new.tenant_id is null then return new; end if;

  execute format('select p.tenant_id, true from public.%I p where p.%I = $1', v_parent, v_parentpk)
    into v_ptenant, v_found using v_ref;

  if not coalesce(v_found, false) then
    raise exception using errcode = 'NX001',
      message = v_label || ' cites ' || v_parent || ' ' || v_ref || ', which does not exist.',
      detail  = 'NX997_CROSS_TENANT_REF_MISSING_PARENT';
  end if;

  -- tenant_id IS NULL on the parent means a platform-global row. Allowed.
  if v_ptenant is not null and v_ptenant <> new.tenant_id then
    raise exception using errcode = 'NX001',
      message = v_label || ' belongs to one dealership and cites a ' || v_parent
                || ' row belonging to another.',
      detail  = 'NX997_CROSS_TENANT_REF';
  end if;

  return new;
end
$function$;

comment on function public.nexus_guard_same_tenant_ref() is
  'NX997: refuses a write whose referenced parent row belongs to a different dealership. Used where a composite foreign key would be wrong because the parent tenant_id is nullable by design (policy_rule global rules). Parameterised via TG_ARGV(parent_table, parent_key, child_column, label).';


-- ---------------------------------------------------------------------------
-- SECTION 4. journey_step: a polymorphic reference no foreign key can express.
--
-- journey_step points at its subject with (ref_table text, ref_id text).
-- Historical rows carry short opaque handles rather than uuids -- staging has
-- 4 rows whose ref_id is 2 characters long -- so the guard enforces ONLY when
-- ref_table names a known tenant-scoped table AND ref_id actually parses as a
-- uuid. Everything else passes through untouched, which is what keeps this
-- migration additive: no existing journey_step write becomes illegal.
--
-- A reference to a row that does not exist is NOT refused here. journey_step
-- is an evidence log, and refusing to record evidence because its subject was
-- since deleted would lose the audit trail. Only a reference to a row that
-- exists AND belongs to another dealership is refused.
-- ---------------------------------------------------------------------------

create or replace function public.nexus_journey_step_guard_ref_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pk      text;
  v_ref     uuid;
  v_ptenant uuid;
  v_found   boolean;
begin
  if new.ref_table is null or new.ref_id is null or new.tenant_id is null then
    return new;
  end if;

  -- Fixed allow-list. An unknown ref_table is not enforced, never guessed.
  v_pk := case lower(new.ref_table)
            when 'leads'                  then 'id'
            when 'customer'               then 'id'
            when 'conversation'           then 'id'
            when 'inventory'              then 'id'
            when 'appointment'            then 'appointment_id'
            when 'channel_registry'       then 'integration_id'
            when 'channel_message_events' then 'event_id'
            else null
          end;
  if v_pk is null then return new; end if;

  -- Legacy handles are not uuids and are not references. Let them be.
  begin
    v_ref := new.ref_id::uuid;
  exception when others then
    return new;
  end;

  execute format('select t.tenant_id, true from public.%I t where t.%I = $1',
                 lower(new.ref_table), v_pk)
    into v_ptenant, v_found using v_ref;

  -- Subject already gone: record the evidence anyway.
  if not coalesce(v_found, false) then return new; end if;

  if v_ptenant is not null and v_ptenant <> new.tenant_id then
    raise exception using errcode = 'NX001',
      message = 'Journey step belongs to one dealership and cites a '
                || new.ref_table || ' row belonging to another.',
      detail  = 'NX997_JOURNEY_STEP_CROSS_TENANT_REF';
  end if;

  return new;
end
$function$;

comment on function public.nexus_journey_step_guard_ref_tenant() is
  'NX997: journey_step references its subject polymorphically through (ref_table, ref_id), which no foreign key can express. Refuses a step that cites an existing row belonging to another dealership. Non-uuid ref_id and unknown ref_table pass through, so historical rows stay legal.';


-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- through default privileges, so "revoke from public" alone leaves a browser
-- role able to call a guard directly. NX983 found the same trap. Revoke from
-- the named roles too. Discovered by this migration's own verify block.
do $revoke$
declare r text; f text;
begin
  foreach f in array array['public.nexus_guard_same_tenant_ref()',
                           'public.nexus_journey_step_guard_ref_tenant()'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end
$revoke$;

-- ---------------------------------------------------------------------------
-- SECTION 5. Attach the triggers.
-- ---------------------------------------------------------------------------

do $triggers$
declare
  r record;
begin
  for r in
    select * from (values
      ('channel_send_directive','policy_applied_rule_id','policy_rule','id',
       'Channel send directive','nx997_csd_policy_rule_same_dealership'),
      ('policy_rule','supersedes_id','policy_rule','id',
       'Policy rule','nx997_policy_rule_supersedes_same_dealership'),
      ('policy_rule_event','rule_id','policy_rule','id',
       'Policy rule event','nx997_policy_rule_event_same_dealership'),
      ('whatsapp_message_usage','policy_rule_id','policy_rule','id',
       'WhatsApp message usage','nx997_wmu_policy_rule_same_dealership')
    ) as t(child, childcol, parent, parentpk, label, tname)
  loop
    if to_regclass('public.' || r.child) is null or to_regclass('public.' || r.parent) is null then
      raise notice 'NX997: % absent here, skipping trigger %.', r.child, r.tname;
      continue;
    end if;
    if not exists (select 1 from pg_attribute
                    where attrelid = ('public.' || r.child)::regclass
                      and attname = r.childcol and attnum > 0 and not attisdropped) then
      raise notice 'NX997: %.% absent, skipping trigger %.', r.child, r.childcol, r.tname;
      continue;
    end if;

    execute format('drop trigger if exists %I on public.%I', r.tname, r.child);
    execute format(
      'create trigger %I before insert or update on public.%I '
      || 'for each row execute function public.nexus_guard_same_tenant_ref(%L, %L, %L, %L)',
      r.tname, r.child, r.parent, r.parentpk, r.childcol, r.label);
  end loop;

  if to_regclass('public.journey_step') is not null then
    drop trigger if exists nx997_journey_step_ref_same_dealership on public.journey_step;
    create trigger nx997_journey_step_ref_same_dealership
      before insert or update on public.journey_step
      for each row execute function public.nexus_journey_step_guard_ref_tenant();
  end if;
end
$triggers$;

-- ---------------------------------------------------------------------------
-- SECTION 6. The two tables in the brief that CANNOT be closed this way, and
-- the honest reason why. This is documentation, not an omission.
--
-- communication_logs(id, lead_email text, channel, direction, message,
--                    created_at, sent_by text, tenant_id, external_message_id,
--                    channel_key, direction_key, evidence_state)
-- audit_log(id, workflow, status, lead_name, lead_email, lead_score, intent,
--           summary, logged_at, tenant_id)
--
-- Neither table holds a single uuid reference to another tenant-scoped row.
-- They are flat, denormalised evidence tables: they carry the customer's
-- EMAIL ADDRESS and the salesperson's NAME as text, not ids. There is no
-- reference for a composite key to carry and no parent for a trigger to
-- resolve. Their only tenant-scoped tie is tenant_id -> tenants, which is
-- already NOT NULL and already a foreign key; section 7 asserts that.
--
-- A guard on `lead_email` was considered and DELIBERATELY REJECTED. The
-- obvious rule -- "refuse if this email belongs to another dealership's lead"
-- -- is wrong in the UAE market this product serves, where a buyer shops four
-- dealerships in an afternoon. Dealer B legitimately messages a person who is
-- currently only a lead in dealer A's database. Enforcing it would refuse real
-- business to close a hole that does not exist, because an email address is
-- not a tenant-scoped row and copying one is not a tenancy breach.
--
-- `customer` is likewise not given a new constraint, for the opposite reason:
-- it is a PARENT, not a child. It has no reference to any other tenant-scoped
-- row -- its only foreign key is tenant_id -> tenants. It is protected by
-- already having UNIQUE (tenant_id, id), which is what lets `conversation`
-- and `appointment` cite it safely. Section 7 asserts that key still exists.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- SECTION 7. Verify or roll back.
-- ---------------------------------------------------------------------------

do $verify$
declare
  n int;
begin
  -- The hole the red team proved, closed in all three directions.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.conversation'::regclass and contype = 'f'
                    and conname = 'conversation_customer_same_dealership') then
    raise exception 'NX997: a conversation can still be opened over another dealership''s customer. Rolling back.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.conversation'::regclass and contype = 'f'
                    and conname = 'conversation_channel_same_dealership') then
    raise exception 'NX997: a conversation can still be carried on another dealership''s channel. Rolling back.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leads'::regclass and contype = 'f'
                    and conname = 'leads_assigned_user_same_dealership') then
    raise exception 'NX997: a lead can still be assigned to another dealership''s salesperson. Rolling back.';
  end if;

  -- Every composite key added must genuinely carry tenant_id on the child
  -- side. A key named "same_dealership" that does not include tenant_id is a
  -- lie that would be worse than no key at all.
  select count(*) into n
    from pg_constraint con
   where con.contype = 'f'
     and con.conname like '%same_dealership%'
     and not exists (
       select 1 from unnest(con.conkey) k
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
       where a.attname = 'tenant_id');
  if n <> 0 then
    raise exception 'NX997: % foreign key(s) claim to be tenant-scoped but do not carry tenant_id. Rolling back.', n;
  end if;

  -- The policy_rule guards must be triggers, never foreign keys -- a composite
  -- FK there would refuse every platform-global rule.
  select count(*) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where ns.nspname = 'public' and not t.tgisinternal
     and p.proname = 'nexus_guard_same_tenant_ref';
  if n < 3 then
    raise exception 'NX997: expected at least 3 nullable-parent tenant guards, found %. Rolling back.', n;
  end if;

  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'journey_step' and not t.tgisinternal
                    and t.tgname = 'nx997_journey_step_ref_same_dealership') then
    raise exception 'NX997: journey_step can still narrate another dealership''s row. Rolling back.';
  end if;

  -- Both guard functions must be SECURITY DEFINER with a pinned search_path,
  -- or they are a privilege-escalation route rather than a guard (NX983).
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('nexus_guard_same_tenant_ref','nexus_journey_step_guard_ref_tenant')
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%';
  if n <> 2 then
    raise exception 'NX997: guard functions are not both SECURITY DEFINER with a pinned search_path (found %). Rolling back.', n;
  end if;

  -- A browser role must not be able to call the guards directly.
  if has_function_privilege('anon', 'public.nexus_guard_same_tenant_ref()', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_guard_same_tenant_ref()', 'execute')
     or has_function_privilege('anon', 'public.nexus_journey_step_guard_ref_tenant()', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_journey_step_guard_ref_tenant()', 'execute')
  then
    raise exception 'NX997: a browser role can execute a tenancy guard function. Rolling back.';
  end if;

  -- Section 6's claims must stay true.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.customer'::regclass and contype = 'u'
                    and conname = 'customer_tenant_id_key') then
    raise exception 'NX997: customer lost UNIQUE (tenant_id, id); conversation could no longer cite it safely. Rolling back.';
  end if;

  select count(*) into n from pg_attribute
   where attrelid in ('public.communication_logs'::regclass, 'public.audit_log'::regclass)
     and attname = 'tenant_id' and attnotnull;
  if n <> 2 then
    raise exception 'NX997: communication_logs or audit_log allows a NULL tenant_id, which is the only tenancy tie either one has. Rolling back.';
  end if;

  select count(*) into n from pg_constraint where conname like '%same_dealership%' and contype = 'f';
  raise notice 'NX997: cross-tenant references are now refused. % tenant-carrying foreign keys, 2 guard functions, % nullable-parent triggers, 1 polymorphic journey_step trigger. communication_logs and audit_log carry no row reference to close -- see section 6 and ops/launch/CROSS-TENANT-GUARD.md.',
    n, (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where p.proname = 'nexus_guard_same_tenant_ref' and not t.tgisinternal);
end
$verify$;

commit;
