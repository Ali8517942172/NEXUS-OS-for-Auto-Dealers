-- =====================================================================
-- STAGING-MODEL.sql
-- Ran against STAGING wwspuxrbiyagnrnzgate on 2026-09-09. Never against
-- production dsvuoovivysszdoiorch.
--
-- Every object is prefixed im_ so the whole model can be found and dropped.
-- Teardown is at the bottom of this file.
--
-- This is NOT a migration and must not be turned into one. Owner's constraint:
-- "Customer -> Conversation -> Opportunity ko abhi code mat karwao."
--
-- Three resolver generations are kept deliberately: v1 is the naive design that
-- the BREAK-LOG attacks, v2 is a repair that introduced its own regression, v3
-- is the current best. All three still exist on staging so the failures in
-- BREAK-LOG.md can be re-run.
--
-- CONSTRAINTS OF THE STAGING DATABASE, learned the hard way:
--   * event trigger nexus_guard_security_invoker_views fires on the CREATE's own
--     ddl_command_end and raises 42501 -- so (security_invoker = on) must be
--     INLINE on CREATE VIEW. A following ALTER VIEW is too late.
--     CREATE OR REPLACE VIEW resets reloptions, so restate it every time.
--   * event trigger nexus_guard_born_open_grants revokes anon/authenticated
--     write grants on every new object. CREATE TABLE is preferred over
--     ALTER TABLE for that reason.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NORMALISATION
-- ---------------------------------------------------------------------

-- v1: naive. KEPT because BREAK-LOG attack 1b depends on it failing.
-- Defect: split_part(:,1) destroys "ph: 052..." / "Tel: +971..."
-- Defect: "052 664 7253 ext 4" silently becomes +9715266472534
create or replace function public.im_normalize_phone(p_raw text, p_default_cc text default '971')
returns text language plpgsql immutable as $$
declare d text; begin
  if p_raw is null then return null; end if;
  d := split_part(p_raw, ':', 1);
  d := regexp_replace(d, '[^0-9]', '', 'g');
  if d = '' then return null; end if;
  if left(d,2) = '00' then d := substr(d,3); end if;
  if left(d,1) = '0' then d := p_default_cc || substr(d,2); end if;
  if length(d) = 9 and left(d,1) = '5' then d := p_default_cc || d; end if;
  if length(d) < 8 or length(d) > 15 then return null; end if;
  return '+' || d;
end $$;

-- v2: "longest digit run". Fixed the colon, BROKE space-separated numbers
-- ("052 664 7253" -> longest run is "7253"). Kept as a record of the wrong turn.
create or replace function public.im_normalize_phone_v2(p_raw text, p_default_cc text default '971')
returns table(value_norm text, quality text) language plpgsql immutable as $$
declare runs text[]; d text; n int;
begin
  if p_raw is null or btrim(p_raw)='' then return query select null::text,'NO_INPUT'; return; end if;
  select array_agg(m[1] order by length(m[1]) desc) into runs from regexp_matches(p_raw,'[0-9]+','g') m;
  if runs is null then return query select null::text,'NO_DIGITS'; return; end if;
  n := array_length(runs,1); d := runs[1];
  if left(d,2)='00' then d := substr(d,3); end if;
  if left(d,1)='0'  then d := p_default_cc || substr(d,2); end if;
  if length(d)=9 and left(d,1)='5' then d := p_default_cc || d; end if;
  if length(d) < 9 or length(d) > 15 then
    return query select null::text,'UNPARSEABLE_len'||length(d); return; end if;
  return query select '+'||d, case when n>1 then 'AMBIGUOUS_MULTIRUN' else 'CLEAN' end;
end $$;

-- v3: CURRENT. Verified correct on 13 inputs (see BREAK-LOG attack 1).
create or replace function public.im_normalize_phone_v3(p_raw text, p_default_cc text default '971')
returns table(value_norm text, quality text) language plpgsql immutable as $$
declare s text; d text; extra boolean := false;
begin
  if p_raw is null or btrim(p_raw)='' then return query select null::text,'NO_INPUT'; return; end if;
  s := p_raw;
  -- WAHA device suffix: strip ':NN' ONLY when it directly follows a long digit run
  s := regexp_replace(s, '([0-9]{8,15}):[0-9]{1,3}', '\1', 'g');
  -- extension tails
  s := regexp_replace(s, '(?:ext|extn|x|#)[.: ]*[0-9]{1,5}\s*$', '', 'i');
  -- two numbers in one field: keep the first, flag the arrival
  extra := s ~ '[0-9][^0-9]*[/,;][^0-9]*[0-9]' or s ~* '[0-9]\s+or\s+[0-9]';
  if extra then s := regexp_replace(s, '\s*(?:[/,;]|\sor\s).*$', '', 'i'); end if;
  d := regexp_replace(s, '[^0-9]', '', 'g');
  if d = '' then return query select null::text,'NO_DIGITS'; return; end if;
  if left(d,2)='00' then d := substr(d,3); end if;
  if left(d,1)='0'  then d := p_default_cc || substr(d,2); end if;
  if length(d)=9 and left(d,1)='5' then d := p_default_cc || d; end if;
  if length(d) < 9 or length(d) > 15 then
    return query select null::text,'UNPARSEABLE_len'||length(d); return; end if;
  return query select '+'||d, case when extra then 'TRUNCATED_MULTI' else 'CLEAN' end;
end $$;

-- An email is an identity key only if it is actually an email. On production,
-- 4 of 5 leads.email values are not: '', '.invalid', or minted @whatsapp.lead.
create or replace function public.im_norm_email(p_raw text) returns text language sql immutable as $$
  select case
    when p_raw is null then null
    when btrim(p_raw) = '' then null
    when lower(p_raw) ~ '@(whatsapp\.lead|c\.us|lid)$' then null
    when lower(p_raw) ~ '\.invalid$' then null
    when lower(btrim(p_raw)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then null
    else lower(btrim(p_raw)) end;
$$;

-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

create table public.im_customer (
  customer_id   uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  display_name  text,
  status        text not null default 'active' check (status in ('active','merged_away')),
  merged_into   uuid references public.im_customer(customer_id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint im_customer_merge_consistent check ((status='merged_away') = (merged_into is not null)),
  constraint im_customer_no_self_merge     check (merged_into is distinct from customer_id)
);

create table public.im_identity (
  identity_id  uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  customer_id  uuid not null references public.im_customer(customer_id) on delete restrict,
  kind         text not null check (kind in ('phone','email','wa_lid','wa_chat','instagram','anon')),
  value_norm   text not null,
  value_raw    text,
  is_shared    boolean not null default false,
  confidence   text not null default 'asserted' check (confidence in ('verified','asserted','inferred')),
  source       text,
  created_at   timestamptz not null default now()
);
create unique index im_identity_unique_exclusive
  on public.im_identity (tenant_id, kind, value_norm) where is_shared = false;
create index im_identity_by_customer on public.im_identity (tenant_id, customer_id);

-- Added after BREAK-LOG attack 2c: "shared" is a fact about the KEY for the
-- tenant, not about one identity row.
create table public.im_shared_key (
  tenant_id uuid not null references public.tenants(id),
  kind text not null, value_norm text not null,
  declared_at timestamptz not null default now(), reason text,
  primary key (tenant_id, kind, value_norm)
);

create table public.im_conversation (
  conversation_id uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  customer_id     uuid not null references public.im_customer(customer_id),
  channel         text not null check (channel in ('whatsapp','email','walk_in','phone_call','instagram','web_form')),
  external_thread_key text,
  opened_at       timestamptz not null default now(),
  last_activity_at timestamptz,
  closed_at       timestamptz,
  status          text not null default 'open' check (status in ('open','closed'))
);
create unique index im_conversation_thread_key
  on public.im_conversation (tenant_id, channel, external_thread_key) where external_thread_key is not null;

create table public.im_opportunity (
  opportunity_id uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id),
  customer_id    uuid not null references public.im_customer(customer_id),
  kind           text not null check (kind in ('new_purchase','used_purchase','trade_in','service','finance')),
  stage          text not null default 'open',
  outcome        text check (outcome in ('won','lost','abandoned')),
  vehicle_interest text,
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  constraint im_opportunity_outcome_consistent check ((closed_at is null) = (outcome is null))
);

-- Many-to-many so an opportunity can move between conversations mid-life
-- (BREAK-LOG attack 5) without losing where it has been.
create table public.im_conversation_opportunity (
  conversation_id uuid not null references public.im_conversation(conversation_id) on delete cascade,
  opportunity_id  uuid not null references public.im_opportunity(opportunity_id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id),
  linked_at       timestamptz not null default now(),
  unlinked_at     timestamptz,
  primary key (conversation_id, opportunity_id)
);

create table public.im_merge_log (
  merge_id      uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  winner_id     uuid not null references public.im_customer(customer_id),
  loser_id      uuid not null references public.im_customer(customer_id),
  reason        text,
  merged_at     timestamptz not null default now(),
  moved_identities    uuid[] not null default '{}',
  moved_conversations uuid[] not null default '{}',
  moved_opportunities uuid[] not null default '{}',
  reversed_at   timestamptz
);

create table public.im_identity_review (
  review_id   uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  reason      text not null,
  key_kind    text, key_value text,
  customer_a  uuid references public.im_customer(customer_id),
  customer_b  uuid references public.im_customer(customer_id),
  detail      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Capture table for the pg_cron concurrency attack (BREAK-LOG attack 7).
create table public.im_race_result (
  id bigserial primary key, arm text, fired_at timestamptz, pid int,
  customer_id uuid, verdict text, sqlstate text, errmsg text
);

-- Added after BREAK-LOG attack 5b: an opportunity may only be linked to a
-- conversation belonging to the SAME customer. Same composite-FK shape
-- lead_event already uses.
create unique index im_conversation_id_customer on public.im_conversation (conversation_id, customer_id);
create unique index im_opportunity_id_customer  on public.im_opportunity  (opportunity_id, customer_id);
alter table public.im_conversation_opportunity add column customer_id uuid;
update public.im_conversation_opportunity co
   set customer_id = (select v.customer_id from public.im_conversation v
                       where v.conversation_id = co.conversation_id);
alter table public.im_conversation_opportunity alter column customer_id set not null;
alter table public.im_conversation_opportunity
  add constraint im_co_conv_same_customer foreign key (conversation_id, customer_id)
      references public.im_conversation (conversation_id, customer_id),
  add constraint im_co_opp_same_customer  foreign key (opportunity_id, customer_id)
      references public.im_opportunity  (opportunity_id, customer_id);

-- ---------------------------------------------------------------------
-- 3. RLS. Tenant-scoped only -- see BREAK-LOG attack 2: RLS cannot help when
--    both humans are in the same tenant.
-- ---------------------------------------------------------------------
alter table public.im_customer                enable row level security;
alter table public.im_identity                enable row level security;
alter table public.im_conversation            enable row level security;
alter table public.im_opportunity             enable row level security;
alter table public.im_conversation_opportunity enable row level security;
alter table public.im_merge_log               enable row level security;
alter table public.im_identity_review         enable row level security;
alter table public.im_shared_key              enable row level security;

create policy im_customer_tenant     on public.im_customer                for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_identity_tenant     on public.im_identity                for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_conversation_tenant on public.im_conversation            for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_opportunity_tenant  on public.im_opportunity             for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_convopp_tenant      on public.im_conversation_opportunity for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_merge_log_tenant    on public.im_merge_log               for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_review_tenant       on public.im_identity_review         for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy im_shared_key_tenant   on public.im_shared_key              for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

-- ---------------------------------------------------------------------
-- 4. VIEWS. (security_invoker = on) MUST be inline -- the guard raises 42501
--    on the CREATE itself. Restated on every CREATE OR REPLACE.
-- ---------------------------------------------------------------------
create or replace view public.im_v_customer_360 with (security_invoker = on) as
select c.customer_id, c.tenant_id, c.display_name, c.status, c.merged_into,
  (select count(*) from public.im_identity i where i.customer_id=c.customer_id) as identity_count,
  (select count(*) from public.im_conversation v where v.customer_id=c.customer_id) as conversation_count,
  (select count(*) from public.im_opportunity o where o.customer_id=c.customer_id and o.closed_at is null) as open_opportunities,
  (select string_agg(i.kind||':'||i.value_norm||case when i.is_shared then ' (shared)' else '' end, ', '
                     order by i.kind, i.value_norm)
     from public.im_identity i where i.customer_id=c.customer_id) as identities
from public.im_customer c
where c.status = 'active';        -- added after attack 6: merged-away rows were ghosting the directory

create view public.im_v_conversation_thread with (security_invoker = on) as
select v.conversation_id, v.tenant_id, v.customer_id, v.channel, v.external_thread_key,
       v.status, v.opened_at,
       (select string_agg(o.kind||'/'||o.stage, ', ')
          from public.im_conversation_opportunity co
          join public.im_opportunity o on o.opportunity_id = co.opportunity_id
         where co.conversation_id = v.conversation_id and co.unlinked_at is null) as live_opportunities
from public.im_conversation v;

-- ---------------------------------------------------------------------
-- 5. RESOLVERS
-- ---------------------------------------------------------------------

-- v1 -- DELIBERATELY NAIVE. Read-then-write, no locking, phone treated as an
-- exclusive key, no anon path. Kept so BREAK-LOG attacks 1b/2/2b/3b/7 re-run.
create or replace function public.im_resolve_customer_v1(
  p_tenant uuid, p_phone text default null, p_email text default null,
  p_wa_lid text default null, p_instagram text default null, p_name text default null)
returns table(customer_id uuid, verdict text) language plpgsql as $$
declare v_keys text[][] := '{}'; v_ph text; v_em text; v_hits uuid[]; v_cust uuid; k text[];
begin
  v_ph := public.im_normalize_phone(p_phone);
  v_em := public.im_norm_email(p_email);
  if v_ph        is not null then v_keys := v_keys || array[array['phone', v_ph]]; end if;
  if v_em        is not null then v_keys := v_keys || array[array['email', v_em]]; end if;
  if p_wa_lid    is not null then v_keys := v_keys || array[array['wa_lid', p_wa_lid]]; end if;
  if p_instagram is not null then v_keys := v_keys || array[array['instagram', lower(p_instagram)]]; end if;
  if array_length(v_keys,1) is null then
    return query select null::uuid,'REFUSED_NO_IDENTIFIER'::text; return; end if;

  select array_agg(distinct i.customer_id) into v_hits from public.im_identity i
   where i.tenant_id = p_tenant
     and (i.kind, i.value_norm) in (select v_keys[g][1], v_keys[g][2] from generate_subscripts(v_keys,1) g);

  if v_hits is null then
    insert into public.im_customer (tenant_id, display_name) values (p_tenant, p_name)
      returning public.im_customer.customer_id into v_cust;
    foreach k slice 1 in array v_keys loop
      insert into public.im_identity (tenant_id, customer_id, kind, value_norm, value_raw)
      values (p_tenant, v_cust, k[1], k[2], coalesce(p_phone,p_email,p_wa_lid,p_instagram));
    end loop;
    return query select v_cust,'CREATED'::text; return;
  elsif array_length(v_hits,1) = 1 then
    v_cust := v_hits[1];
    foreach k slice 1 in array v_keys loop
      insert into public.im_identity (tenant_id, customer_id, kind, value_norm, value_raw)
      select p_tenant, v_cust, k[1], k[2], null
      where not exists (select 1 from public.im_identity i
                        where i.tenant_id=p_tenant and i.kind=k[1] and i.value_norm=k[2]);
    end loop;
    return query select v_cust,'MATCHED'::text; return;
  else
    return query select null::uuid,'AMBIGUOUS_'||array_length(v_hits,1)||'_CUSTOMERS'; return;
  end if;
end $$;

-- v1 with the read->write window made observable, so the TOCTOU race does not
-- depend on microsecond luck. Logic identical to v1; only a pause was added.
create or replace function public.im_resolve_customer_v1_racewindow(
  p_tenant uuid, p_phone text, p_name text, p_window_s numeric default 2)
returns table(customer_id uuid, verdict text) language plpgsql as $$
declare v_ph text; v_hits uuid[]; v_cust uuid;
begin
  v_ph := public.im_normalize_phone(p_phone);
  select array_agg(distinct i.customer_id) into v_hits from public.im_identity i
   where i.tenant_id=p_tenant and i.kind='phone' and i.value_norm=v_ph;
  perform pg_sleep(p_window_s);
  if v_hits is null then
    insert into public.im_customer (tenant_id, display_name) values (p_tenant, p_name)
      returning public.im_customer.customer_id into v_cust;
    insert into public.im_identity (tenant_id, customer_id, kind, value_norm, value_raw)
      values (p_tenant, v_cust,'phone', v_ph, p_phone);
    return query select v_cust,'CREATED'::text;
  else
    return query select v_hits[1],'MATCHED'::text;
  end if;
end $$;

-- v2 -- first repair. Advisory locks, strong/weak keys, anon mint, is_shared
-- flag ON THE ROW. That last choice is the regression documented in attack 2c.
-- Body is identical to v3 below except that it consults im_identity.is_shared
-- instead of the im_shared_key registry. Kept on staging; not reproduced here
-- to keep this file readable -- fetch it with pg_get_functiondef if needed.

-- v3 -- CURRENT.
create or replace function public.im_resolve_customer_v3(
  p_tenant uuid, p_phone text default null, p_email text default null,
  p_wa_lid text default null, p_instagram text default null, p_name text default null,
  p_allow_anon boolean default false, p_window_s numeric default 0)
returns table(customer_id uuid, verdict text, detail text) language plpgsql as $$
#variable_conflict use_column
declare
  v_ph text; v_q text; v_em text;
  v_strong text[][] := '{}'; v_all text[][];
  k text[]; v_hits uuid[]; v_cust uuid; v_conflict text; v_shared boolean;
begin
  select n.value_norm, n.quality into v_ph, v_q from public.im_normalize_phone_v3(p_phone) n;
  v_em := public.im_norm_email(p_email);
  -- STRONG keys are account-bound: one human owns them.
  if v_em        is not null then v_strong := v_strong || array[array['email', v_em]]; end if;
  if p_wa_lid    is not null then v_strong := v_strong || array[array['wa_lid', p_wa_lid]]; end if;
  if p_instagram is not null then v_strong := v_strong || array[array['instagram', lower(btrim(p_instagram,'@'))]]; end if;
  v_all := v_strong;
  -- WEAK key: a phone is shareable. Families and switchboards exist.
  if v_ph is not null then v_all := v_all || array[array['phone', v_ph]]; end if;

  -- A human on the forecourt with no phone and no email is still a customer.
  if array_length(v_all,1) is null then
    if not p_allow_anon then return query select null::uuid,'REFUSED_NO_IDENTIFIER'::text,null::text; return; end if;
    insert into public.im_customer (tenant_id, display_name) values (p_tenant, p_name)
      returning im_customer.customer_id into v_cust;
    insert into public.im_identity (tenant_id, customer_id, kind, value_norm, confidence, source)
      values (p_tenant, v_cust,'anon', gen_random_uuid()::text,'inferred','anon-mint');
    return query select v_cust,'CREATED_ANON'::text,'anon key minted'::text; return;
  end if;

  -- Serialise every writer carrying the same key BEFORE the read. This is what
  -- turns attack 7 from a lost lead into a clean MATCHED.
  foreach k slice 1 in array v_all loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||'|'||k[1]||'|'||k[2],0));
  end loop;
  if p_window_s > 0 then perform pg_sleep(p_window_s); end if;

  -- a key in the shared registry never resolves anybody, for anybody, ever
  select array_agg(distinct i.customer_id) into v_hits
    from public.im_identity i join public.im_customer c on c.customer_id=i.customer_id
   where i.tenant_id=p_tenant and c.status='active'
     and (i.kind,i.value_norm) in (select v_all[g][1], v_all[g][2] from generate_subscripts(v_all,1) g)
     and not exists (select 1 from public.im_shared_key s
                     where s.tenant_id=p_tenant and s.kind=i.kind and s.value_norm=i.value_norm);

  if v_hits is not null and array_length(v_hits,1) > 1 then
    insert into public.im_identity_review (tenant_id, reason, customer_a, customer_b, detail)
    values (p_tenant,'AMBIGUOUS_MULTI_CUSTOMER', v_hits[1], v_hits[2],
            'matched '||array_length(v_hits,1)||' customers');
    return query select null::uuid,'AMBIGUOUS_REVIEW'::text,'matched '||array_length(v_hits,1)||' customers'; return;
  end if;

  if v_hits is null then
    insert into public.im_customer (tenant_id, display_name) values (p_tenant, p_name)
      returning im_customer.customer_id into v_cust;
  else
    v_cust := v_hits[1];
    -- Matched on the weak key alone, but the arrival's strong key contradicts
    -- what the matched customer already holds -> two humans behind one number.
    if array_length(v_strong,1) is not null then
      select string_agg(i.kind||':'||i.value_norm,', ') into v_conflict from public.im_identity i
       where i.customer_id=v_cust and i.kind in ('email','wa_lid','instagram')
         and (i.kind,i.value_norm) not in (select v_strong[g][1], v_strong[g][2] from generate_subscripts(v_strong,1) g);
      if v_conflict is not null and not exists (
           select 1 from public.im_identity i where i.customer_id=v_cust
            and (i.kind,i.value_norm) in (select v_strong[g][1], v_strong[g][2] from generate_subscripts(v_strong,1) g)) then
        insert into public.im_shared_key (tenant_id, kind, value_norm, reason)
          values (p_tenant,'phone', v_ph,'strong keys disagreed across arrivals') on conflict do nothing;
        update public.im_identity ii set is_shared=true
         where ii.tenant_id=p_tenant and ii.kind='phone' and ii.value_norm=v_ph;
        insert into public.im_customer (tenant_id, display_name) values (p_tenant, p_name)
          returning im_customer.customer_id into v_cust;
        insert into public.im_identity (tenant_id, customer_id, kind, value_norm, is_shared, source)
          values (p_tenant, v_cust,'phone', v_ph, true,'shared-number');
        foreach k slice 1 in array v_strong loop
          insert into public.im_identity (tenant_id, customer_id, kind, value_norm, source)
            values (p_tenant, v_cust, k[1], k[2],'split');
        end loop;
        insert into public.im_identity_review (tenant_id, reason, key_kind, key_value, customer_a, customer_b, detail)
          values (p_tenant,'SHARED_PHONE_SPLIT','phone', v_ph, v_hits[1], v_cust, v_conflict);
        return query select v_cust,'CREATED_SPLIT_SHARED_PHONE'::text, v_conflict; return;
      end if;
    end if;
  end if;

  foreach k slice 1 in array v_all loop
    select exists (select 1 from public.im_shared_key s
                   where s.tenant_id=p_tenant and s.kind=k[1] and s.value_norm=k[2]) into v_shared;
    insert into public.im_identity (tenant_id, customer_id, kind, value_norm, value_raw, is_shared, source)
    select p_tenant, v_cust, k[1], k[2], p_phone, v_shared, coalesce(v_q,'')
    where not exists (select 1 from public.im_identity i
                      where i.tenant_id=p_tenant and i.customer_id=v_cust and i.kind=k[1] and i.value_norm=k[2]);
  end loop;
  return query select v_cust, case when v_hits is null then 'CREATED' else 'MATCHED' end, v_q;
end $$;

-- ---------------------------------------------------------------------
-- 6. MERGE / UN-MERGE
-- ---------------------------------------------------------------------
create or replace function public.im_merge_customers(p_winner uuid, p_loser uuid, p_reason text default null)
returns uuid language plpgsql as $$
declare v_t uuid; v_ids uuid[]; v_cv uuid[]; v_op uuid[]; v_merge uuid;
begin
  select tenant_id into v_t from public.im_customer where customer_id = p_winner;
  select array_agg(identity_id)     into v_ids from public.im_identity     where customer_id = p_loser;
  select array_agg(conversation_id) into v_cv  from public.im_conversation where customer_id = p_loser;
  select array_agg(opportunity_id)  into v_op  from public.im_opportunity  where customer_id = p_loser;
  update public.im_identity     set customer_id = p_winner where customer_id = p_loser;
  update public.im_conversation set customer_id = p_winner where customer_id = p_loser;
  update public.im_opportunity  set customer_id = p_winner where customer_id = p_loser;
  update public.im_customer set status='merged_away', merged_into = p_winner, updated_at = now()
   where customer_id = p_loser;
  insert into public.im_merge_log (tenant_id, winner_id, loser_id, reason,
         moved_identities, moved_conversations, moved_opportunities)
  values (v_t, p_winner, p_loser, p_reason, coalesce(v_ids,'{}'), coalesce(v_cv,'{}'), coalesce(v_op,'{}'))
  returning merge_id into v_merge;
  return v_merge;
end $$;

-- KNOWN DEFECT (BREAK-LOG attack 6): orphaned_since_merge counts stranded
-- IDENTITIES only. In the recorded run it reported 1 when the true figure was 3
-- (1 identity + 1 conversation + 1 opportunity). NOT FIXED.
create or replace function public.im_unmerge_customer(p_merge uuid)
returns table(restored_identities int, restored_conversations int, restored_opportunities int,
              orphaned_since_merge int) language plpgsql as $$
declare m record; v_orphan int;
begin
  select * into m from public.im_merge_log where merge_id = p_merge and reversed_at is null;
  if not found then raise exception 'merge % not found or already reversed', p_merge; end if;
  select count(*) into v_orphan from public.im_identity i
   where i.customer_id = m.winner_id and not (i.identity_id = any(m.moved_identities))
     and i.created_at > m.merged_at;
  update public.im_identity     set customer_id = m.loser_id where identity_id     = any(m.moved_identities);
  update public.im_conversation set customer_id = m.loser_id where conversation_id = any(m.moved_conversations);
  update public.im_opportunity  set customer_id = m.loser_id where opportunity_id  = any(m.moved_opportunities);
  update public.im_customer set status='active', merged_into=null, updated_at=now() where customer_id = m.loser_id;
  update public.im_merge_log set reversed_at = now() where merge_id = p_merge;
  return query select coalesce(array_length(m.moved_identities,1),0),
                      coalesce(array_length(m.moved_conversations,1),0),
                      coalesce(array_length(m.moved_opportunities,1),0), v_orphan;
end $$;

-- ---------------------------------------------------------------------
-- 7. CONCURRENCY HARNESS (BREAK-LOG attack 7)
-- Two parallel MCP tool calls are NOT concurrent -- the harness runs them
-- sequentially (measured 3.4s and 5.0s apart). pg_cron starts all jobs due on a
-- tick in separate background workers, which is a real race.
-- ---------------------------------------------------------------------
create or replace function public.im_race_arm(p_arm text, p_phone text, p_name text, p_window numeric)
returns void language plpgsql as $$
declare v_cid uuid; v_v text; v_fired timestamptz := clock_timestamp();
begin
  select r.customer_id, r.verdict into v_cid, v_v
    from public.im_resolve_customer_v3('11111111-1111-4111-8111-111111111111'::uuid,
         p_phone, null, null, null, p_name, false, p_window) r;
  insert into public.im_race_result(arm,fired_at,pid,customer_id,verdict)
  values (p_arm||' [v3]', v_fired, pg_backend_pid(), v_cid, v_v);
exception when others then
  insert into public.im_race_result(arm,fired_at,pid,sqlstate,errmsg)
  values (p_arm||' [v3]', v_fired, pg_backend_pid(), sqlstate, sqlerrm);
end $$;

-- how it was run (both jobs on the same minute, then unscheduled):
--   select cron.schedule('im_race_a','58 3 9 9 *',
--     $x$select public.im_race_arm('ARM_A_whatsapp','+971503332222','Zayed via WhatsApp',3)$x$);
--   select cron.schedule('im_race_b','58 3 9 9 *',
--     $x$select public.im_race_arm('ARM_B_webform','0503332222','Zayed via web form',3)$x$);
--   select cron.unschedule('im_race_a'), cron.unschedule('im_race_b');

-- =====================================================================
-- TEARDOWN -- everything this file created, staging only.
-- =====================================================================
-- select cron.unschedule(jobname) from cron.job where jobname like 'im\_%';
-- drop view if exists public.im_v_conversation_thread;
-- drop view if exists public.im_v_customer_360;
-- drop table if exists public.im_race_result;
-- drop table if exists public.im_identity_review;
-- drop table if exists public.im_merge_log;
-- drop table if exists public.im_conversation_opportunity;
-- drop table if exists public.im_opportunity;
-- drop table if exists public.im_conversation;
-- drop table if exists public.im_shared_key;
-- drop table if exists public.im_identity;
-- drop table if exists public.im_customer;
-- drop function if exists public.im_race_arm(text,text,text,numeric);
-- drop function if exists public.im_unmerge_customer(uuid);
-- drop function if exists public.im_merge_customers(uuid,uuid,text);
-- drop function if exists public.im_resolve_customer_v3(uuid,text,text,text,text,text,boolean,numeric);
-- drop function if exists public.im_resolve_customer_v2(uuid,text,text,text,text,text,boolean,numeric);
-- drop function if exists public.im_resolve_customer_v1_racewindow(uuid,text,text,numeric);
-- drop function if exists public.im_resolve_customer_v1(uuid,text,text,text,text,text);
-- drop function if exists public.im_norm_email(text);
-- drop function if exists public.im_normalize_phone_v3(text,text);
-- drop function if exists public.im_normalize_phone_v2(text,text);
-- drop function if exists public.im_normalize_phone(text,text);
