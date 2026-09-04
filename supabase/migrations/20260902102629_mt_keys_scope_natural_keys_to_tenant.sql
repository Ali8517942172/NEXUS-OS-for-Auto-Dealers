-- ─────────────────────────────────────────────────────────────────────────────
-- mt_keys: natural business keys become unique PER DEALERSHIP, not globally.
--
-- BUSINESS RULE
--   A key that identifies a thing *in the world outside one dealership* — a
--   customer's email address, their WhatsApp chat id, a WhatsApp message id, a
--   stock number, a deal reference — is not unique across dealerships and must
--   never be treated as if it were. Two dealerships can serve the same human
--   being and can number their own stock however they like. Only a key this
--   system itself generates (`id uuid`/`id serial`) is globally unique, because
--   only that key means "this row", not "this thing in the world".
--
--   Before this migration, a global UNIQUE on a natural key had three effects,
--   all bad, and none of them a mere error message:
--     1. CROSS-TENANT WRITE. An upsert keyed on the natural key would find the
--        OTHER dealership's row and UPDATE it. Dealership two's inbound message
--        would silently overwrite dealership one's customer record.
--     2. EXISTENCE ORACLE. Where it errored instead, the duplicate-key message
--        names a row the caller has no right to know exists.
--     3. OPERATIONAL BREAKAGE. The second dealership's write path simply fails.
--
--   `daily_metrics (tenant_id, snapshot_date)` and
--   `tenant_members (tenant_id, auth_user_id)` were already built this way and
--   are the pattern followed here.
--
-- SCOPE OF THIS MIGRATION
--   Every change below is safe against the CURRENTLY DEPLOYED n8n workflows,
--   verified against the SQL PostgREST actually emitted (pg_stat_statements)
--   rather than against what the workflow JSON appears to ask for.
--
--   Three keys are DELIBERATELY NOT SWAPPED here — leads.email,
--   customer_360_profiles.customer_id and deals_embeddings.deal_id. Those three
--   workflows pin the conflict target in the URL (`?on_conflict=<col>`), and
--   Postgres cannot infer a UNIQUE(tenant_id, col) index from `ON CONFLICT
--   (col)` — it raises 42P10 "there is no unique or exclusion constraint
--   matching the ON CONFLICT specification". Dropping those indexes now would
--   stop inbound lead capture dead. Instead the tenant-scoped index is CREATED
--   here so the n8n owner can switch the URL to `?on_conflict=tenant_id,<col>`
--   against an index that already exists; the global index is dropped in a
--   follow-up migration once that switch is live. Neither table is ever left
--   without uniqueness protection.
--
-- ORDERING
--   Every statement either creates the replacement before dropping the original,
--   or swaps both in a single ALTER TABLE. The whole migration is one
--   transaction holding ACCESS EXCLUSIVE on each table it touches, so no
--   concurrent writer can observe a moment without uniqueness protection.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenant_id NOT NULL where it now carries a key ─────────────────────────
-- A composite PRIMARY KEY requires it. For the plain UNIQUE indexes it is what
-- makes them bind at all: NULLs are distinct in Postgres, so UNIQUE(tenant_id,
-- email) with a NULL tenant_id would let the same address in twice and silently
-- lose the protection this migration exists to add.
-- Safe today: all eight columns carry DEFAULT nexus_default_tenant_id() and
-- every existing row is populated (0 NULLs at time of writing). If the
-- `is_unattributed_default` tenant flag is ever cleared, that default returns
-- NULL and these writes will fail loudly instead of filing rows that no
-- signed-in user can see — a visible outage in place of silent data loss.
alter table public.leads                 alter column tenant_id set not null;
alter table public.users                 alter column tenant_id set not null;
alter table public.inventory             alter column tenant_id set not null;
alter table public.whatsapp_contacts     alter column tenant_id set not null;
alter table public.processed_messages    alter column tenant_id set not null;
alter table public.customer_360_profiles alter column tenant_id set not null;
alter table public.deals_embeddings      alter column tenant_id set not null;
alter table public.purchase_history      alter column tenant_id set not null;

-- ── 2. inventory.id — a hand-assigned stock number, not a surrogate ──────────
-- `id` is text with NO default and holds values like 'NX-1001'. It is the
-- dealership's own stock number; dealership two will have an NX-1001 of its own.
-- Nothing writes inventory through PostgREST and no foreign key references it,
-- so the primary key can be swapped outright.
alter table public.inventory
  drop constraint inventory_pkey,
  add  constraint inventory_pkey primary key (tenant_id, id);
create index if not exists inventory_id_idx on public.inventory (id);

-- ── 3. whatsapp_contacts.chat_id — the customer's WhatsApp JID ──────────────
-- The same person messaging two dealerships presents the same chat_id. The BDC
-- workflow upserts with `Prefer: resolution=merge-duplicates` and NO on_conflict
-- parameter, so PostgREST derives the conflict target from the PRIMARY KEY.
-- Proven by probe (see mt_keys_probe_*): PostgREST emits the FULL composite key
-- — ON CONFLICT("k", "tenant_id") — even when tenant_id is absent from the body
-- and supplied by the column DEFAULT, and the upsert resolves correctly.
-- This therefore needs NO n8n change.
-- Was a cross-tenant WRITE, not merely a collision: dealership two's inbound
-- message would have overwritten dealership one's contact row.
alter table public.whatsapp_contacts
  drop constraint whatsapp_contacts_pkey,
  add  constraint whatsapp_contacts_pkey primary key (tenant_id, chat_id);
create index if not exists whatsapp_contacts_chat_id_idx on public.whatsapp_contacts (chat_id);

-- ── 4. processed_messages.message_id — the inbound de-duplication guard ─────
-- 'Claim Message Id' posts with resolution=ignore-duplicates and no on_conflict;
-- PostgREST emitted ON CONFLICT("message_id") DO NOTHING from the primary key
-- (364 calls observed) and will emit the composite key after this change. The
-- claim semantics are unchanged: a repeat within the same dealership still
-- returns an empty representation, which is what the guard reads. Verified
-- against the live API on the probe table.
alter table public.processed_messages
  drop constraint processed_messages_pkey,
  add  constraint processed_messages_pkey primary key (tenant_id, message_id);
create index if not exists processed_messages_message_id_idx on public.processed_messages (message_id);

-- ── 5. purchase_history.deal_id — partial, and never actually inferred ──────
-- Stays PARTIAL (`where deal_id is not null`) because a purchase recorded
-- without a derived deal id must still be allowed, and NULLs would otherwise
-- collide. Postgres CANNOT infer a partial index for ON CONFLICT — probed and
-- confirmed: `ON CONFLICT (tenant_id, deal_id)` against this index raises 42P10.
-- That is not a problem here, because the live path never names it: 'Record
-- Purchase' sends no on_conflict, so PostgREST emits ON CONFLICT("id") from the
-- surrogate primary key — a freshly generated uuid that can never collide. The
-- idempotency this index provides is therefore delivered as a duplicate-key
-- ERROR on a repeat post, not as a silent ignore. That behaviour is unchanged
-- by this migration; it is recorded here because the dashboard's deal-form
-- comment asserts the opposite and is wrong.
create unique index purchase_history_tenant_deal_id_key
  on public.purchase_history (tenant_id, deal_id) where deal_id is not null;
drop index public.purchase_history_deal_id_key;
create index if not exists purchase_history_deal_id_idx on public.purchase_history (deal_id);

-- ── 6. users.email — dealership staff, not a global person registry ─────────
-- Nothing writes users through PostgREST. The ONLY writer is
-- nexus_onboard_dealership(), a database function replaced below in this same
-- transaction, so the swap and its sole caller move together.
create unique index users_tenant_email_key on public.users (tenant_id, email);
alter table public.users drop constraint users_email_key;
create index if not exists users_email_idx on public.users (email);

-- ── 7. Tenant-scoped indexes ADDED for the three n8n-pinned keys ────────────
-- The global originals stay until the workflows switch their on_conflict target.
-- Adding these is free of behavioural risk: they are strictly implied by the
-- global uniqueness that still stands, and `ON CONFLICT (email)` cannot infer a
-- two-column index, so the live router keeps resolving against leads_email_key
-- exactly as it does today.
create unique index leads_tenant_email_key
  on public.leads (tenant_id, email);
create unique index customer_360_profiles_tenant_customer_id_key
  on public.customer_360_profiles (tenant_id, customer_id);
create unique index deals_embeddings_tenant_deal_id_key
  on public.deals_embeddings (tenant_id, deal_id);

-- customer_360_profiles carried TWO identical UNIQUE(customer_id) indexes —
-- the constraint-backed customer_360_profiles_customer_id_key and a bare
-- duplicate. Dropping the bare one removes redundancy only; the constraint
-- index remains and uniqueness is unchanged at every instant.
drop index public.customer_360_profiles_customer_id_uidx;

-- ── 8. The onboarding function follows users.email ──────────────────────────
-- Body reproduced from pg_get_functiondef immediately before this migration.
-- TWO changes, both consequences of section 6:
--   * `on conflict (email)` becomes `on conflict (tenant_id, email)`. Without
--     this the function raises 42P10 — and this is the very function used to
--     onboard the second dealership.
--   * The DO UPDATE action is now a no-op that exists solely so RETURNING
--     yields the row. The old action (`set tenant_id = coalesce(...)`) is
--     meaningless once tenant_id is part of the conflict target, and it papered
--     over a real defect: onboarding a second dealership whose owner email
--     already existed in `users` did NOT create a staff row for them. It matched
--     dealership one's row, kept dealership one's tenant_id, and returned that
--     id — so dealership two's tenant_members.staff_user_id pointed at a member
--     of dealership one. Each dealership now gets its own staff row.
create or replace function public.nexus_onboard_dealership(
  p_slug        text,
  p_name        text,
  p_owner_email text,
  p_owner_role  text default 'owner'
) returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_tenant uuid; v_auth uuid; v_staff uuid;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'nexus_onboard_dealership: slug is required';
  end if;

  -- tenants.slug is unique GLOBALLY and correctly so: it is the tenant
  -- registry itself, not a tenant-scoped table.
  insert into public.tenants (slug, name, status, is_unattributed_default)
  values (lower(btrim(p_slug)), coalesce(nullif(btrim(p_name),''), p_slug), 'active', false)
  on conflict (slug) do update set name = excluded.name
  returning id into v_tenant;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_owner_email));
  if v_auth is null then
    raise exception
      'nexus_onboard_dealership: no auth.users row for %. Create the login in Supabase Auth first, then re-run.',
      p_owner_email;
  end if;

  -- Staff directory row, so the rep appears on the team screen and can be
  -- assigned leads. users.email is now unique PER DEALERSHIP
  -- (users_tenant_email_key), so one person can be staff at two dealerships and
  -- holds a separate row at each.
  insert into public.users (name, email, role, status, tenant_id)
  values (split_part(p_owner_email,'@',1), lower(btrim(p_owner_email)), 'manager', 'online', v_tenant)
  on conflict (tenant_id, email) do update set email = excluded.email
  returning id into v_staff;

  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, v_auth, coalesce(p_owner_role,'owner'), v_staff)
  on conflict (tenant_id, auth_user_id) do update
    set role = excluded.role, staff_user_id = coalesce(public.tenant_members.staff_user_id, excluded.staff_user_id);

  return v_tenant;
end;
$fn$;

-- PostgREST caches the schema, including the primary keys it derives upsert
-- conflict targets from. Supabase reloads on DDL via an event trigger; this is
-- belt and braces so the new composite keys take effect immediately.
notify pgrst, 'reload schema';
