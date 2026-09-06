-- NEXUS OS multi-tenancy, step 5 of 6: the logic that routed AROUND tenancy.
--
-- RLS alone is not isolation. Five SECURITY DEFINER routines run as postgres
-- (BYPASSRLS) and each of them read the whole database by design. Left alone
-- they would have assigned dealership B's hot lead to dealership A's rep, and
-- answered B's customer out of A's policy documents. Every one is scoped here.
--
-- The pattern used throughout is SELF-ARMING: while exactly one active tenant
-- exists, an unresolvable tenant means "the only one there is" and behaviour is
-- byte-identical to today. The moment a second active tenant exists, the same
-- code refuses to guess.
set local lock_timeout = '5s';

-- ── daily_metrics: one snapshot per dealership per day ────────────────────
-- Was PRIMARY KEY (snapshot_date) -- a single global row per day, which two
-- dealerships would overwrite for each other. Replaced by a UNIQUE INDEX
-- rather than a composite primary key so that tenant_id stays NULLABLE, in
-- line with every other table in this migration set. The only writer is
-- capture_daily_metrics() below, called by pg_cron job 1 at 19:50 UTC; no n8n
-- workflow references this table (checked against all 21 workflow JSONs).
alter table public.daily_metrics drop constraint if exists daily_metrics_pkey;
create unique index if not exists daily_metrics_tenant_snapshot_key
  on public.daily_metrics (tenant_id, snapshot_date);
comment on table public.daily_metrics is
  'One snapshot per tenant per day. Has a UNIQUE INDEX on (tenant_id, snapshot_date) '
  'and deliberately no primary key: a composite PK would force tenant_id NOT NULL, '
  'which this migration set does not enforce anywhere.';

-- ── the identity resolver, scoped ─────────────────────────────────────────
-- New EXPLICIT-TENANT overload. Distinct arity with no default, so the
-- existing 1-argument call sites stay unambiguous.
create or replace function public.nexus_lead_for_comm_key(p_key text, p_tenant uuid)
returns integer language plpgsql stable security definer
set search_path to 'public' as $fn$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;  v_tail text;  v_id integer;
  v_email  text;  v_wcdig text; v_people integer;
begin
  if v_raw is null then return null; end if;
  -- Refuse to guess across dealerships. With one tenant this never fires.
  if p_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return null;
  end if;

  select id into v_id from public.leads
   where email = v_raw and coalesce(email,'') <> ''
     and (p_tenant is null or tenant_id = p_tenant)
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  if v_raw not like '%@lid' then
    v_digits := regexp_replace(split_part(v_raw,'@',1), '[^0-9]', '', 'g');
    v_tail   := case when length(v_digits) >= 9 then right(v_digits,9) end;
    if v_tail is not null then
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email,''))),''),
                                     'lead:' || l.id::text))
        into v_people from public.leads l
       where (p_tenant is null or l.tenant_id = p_tenant)
         and (right(regexp_replace(coalesce(l.phone,''), '[^0-9]','','g'),9) = v_tail
           or right(regexp_replace(split_part(coalesce(l.email,''),'@',1), '[^0-9]','','g'),9) = v_tail);
      if coalesce(v_people,0) > 1 then return null; end if;   -- ambiguous: refuse
      if v_people = 1 then
        select id into v_id from public.leads
         where (p_tenant is null or tenant_id = p_tenant)
           and (right(regexp_replace(coalesce(phone,''), '[^0-9]','','g'),9) = v_tail
             or right(regexp_replace(split_part(coalesce(email,''),'@',1), '[^0-9]','','g'),9) = v_tail)
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  select lead_email into v_email from public.whatsapp_contacts
   where chat_id = v_raw and nullif(btrim(lead_email),'') is not null
     and (p_tenant is null or tenant_id = p_tenant) limit 1;
  if v_email is not null then
    select id into v_id from public.leads
     where email = v_email and (p_tenant is null or tenant_id = p_tenant)
     order by created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  select regexp_replace(coalesce(phone,''), '[^0-9]','','g') into v_wcdig
    from public.whatsapp_contacts
   where chat_id = v_raw and (p_tenant is null or tenant_id = p_tenant) limit 1;
  if v_wcdig is not null and length(v_wcdig) >= 9 then
    v_tail := right(v_wcdig,9);
    select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email,''))),''),
                                   'lead:' || l.id::text))
      into v_people from public.leads l
     where (p_tenant is null or l.tenant_id = p_tenant)
       and (right(regexp_replace(coalesce(l.phone,''), '[^0-9]','','g'),9) = v_tail
         or right(regexp_replace(split_part(coalesce(l.email,''),'@',1), '[^0-9]','','g'),9) = v_tail);
    if coalesce(v_people,0) > 1 then return null; end if;
    if v_people = 1 then
      select id into v_id from public.leads
       where (p_tenant is null or tenant_id = p_tenant)
         and (right(regexp_replace(coalesce(phone,''), '[^0-9]','','g'),9) = v_tail
           or right(regexp_replace(split_part(coalesce(email,''),'@',1), '[^0-9]','','g'),9) = v_tail)
       order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$fn$;

-- The original 1-argument signature is preserved for every existing caller and
-- now delegates with the caller's own tenant.
create or replace function public.nexus_lead_for_comm_key(p_key text)
returns integer language sql stable security definer
set search_path to 'public' as $fn$
  select public.nexus_lead_for_comm_key(p_key, public.nexus_default_tenant_id());
$fn$;

create or replace function public.nexus_comm_keys_for_lead(p_email text, p_phone text, p_tenant uuid)
returns text[] language plpgsql stable security definer
set search_path to 'public' as $fn$
declare
  v_keys text[] := '{}'; v_chats text[] := '{}';
  v_digits text := regexp_replace(coalesce(p_phone,''), '[^0-9]','','g');
  v_lead text := nullif(btrim(coalesce(p_email,'')),''); v_edig text;
begin
  if p_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return '{}'::text[];
  end if;
  if v_lead is not null then
    v_keys := v_keys || v_lead;
    v_edig := regexp_replace(v_lead, '[^0-9]','','g');
    if v_lead like '+%@whatsapp.lead' and v_edig <> '' then
      v_keys := v_keys || (v_edig || '@c.us');
      if v_digits = '' then v_digits := v_edig; end if;
    end if;
  end if;
  if v_digits <> '' then
    v_keys := v_keys || ('+' || v_digits || '@whatsapp.lead') || (v_digits || '@c.us');
  end if;
  select coalesce(array_agg(chat_id), '{}'::text[]) into v_chats
    from public.whatsapp_contacts
   where chat_id is not null
     and (p_tenant is null or tenant_id = p_tenant)
     and ((v_lead is not null and lead_email = v_lead)
       or (v_digits <> '' and regexp_replace(coalesce(phone,''), '[^0-9]','','g') = v_digits));
  v_keys := v_keys || coalesce(v_chats, '{}'::text[]);
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
    from unnest(v_keys) as k where k is not null and btrim(k) <> '';
  return v_keys;
end;
$fn$;

create or replace function public.nexus_comm_keys_for_lead(p_email text, p_phone text)
returns text[] language sql stable security definer
set search_path to 'public' as $fn$
  select public.nexus_comm_keys_for_lead(p_email, p_phone, public.nexus_default_tenant_id());
$fn$;

-- ── round-robin assignment must not cross dealerships ─────────────────────
create or replace function public.assign_hot_lead()
returns trigger language plpgsql security definer
set search_path to 'public' as $fn$
declare pick record;
begin
  if coalesce(new.status,'') <> 'HOT' or new.assigned_to_id is not null then
    return new;
  end if;

  select u.id, u.name into pick
  from public.users u
  left join public.leads l
    on l.assigned_to_id = u.id
   and l.status = 'HOT'
   and (new.id is null or l.id <> new.id)
   and l.tenant_id is not distinct from new.tenant_id
  -- The whole point of this line: a HOT lead is only ever handed to a rep of
  -- the same dealership. Without it, tenant B's lead lands on tenant A's desk
  -- and tenant A reads B's customer name in their own queue.
  where u.tenant_id is not distinct from new.tenant_id
    and coalesce(u.status,'') <> 'pending_invite'
    and coalesce(u.role,'') in ('senior_rep','sales_rep','manager')
  group by u.id, u.name, u.role
  order by count(l.id) asc,
           case u.role when 'senior_rep' then 0 when 'manager' then 1 else 2 end,
           u.name
  limit 1;

  if found then
    new.assigned_to_id := pick.id;
    if new.assigned_to is null or new.assigned_to = '' then
      new.assigned_to := pick.name;
    end if;
  end if;
  return new;
end;
$fn$;

-- ── the response-time meter resolves within the message's own tenant ──────
create or replace function public.nexus_mark_first_response()
returns trigger language plpgsql security definer
set search_path to 'public' as $fn$
declare
  v_lead integer; v_created timestamptz;
  v_at timestamptz := coalesce(new.created_at, now());
  v_secs numeric; v_prior boolean;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;
  begin
    -- new.tenant_id, not a session default: the row itself says whose it is.
    v_lead := public.nexus_lead_for_comm_key(new.lead_email, new.tenant_id);
    if v_lead is null then return new; end if;

    select l.created_at into v_created from public.leads l
     where l.id = v_lead and l.response_time_minutes is null
       and l.tenant_id is not distinct from new.tenant_id;
    if v_created is null then return new; end if;

    v_secs := extract(epoch from (v_at - v_created));

    if v_secs < 0 then
      if v_secs < -90 then return new; end if;
      select exists (
        select 1 from public.communication_logs c
         where c.created_at < v_at
           and c.tenant_id is not distinct from new.tenant_id
           and lower(coalesce(c.direction,'')) = 'inbound'
           and public.nexus_lead_for_comm_key(c.lead_email, new.tenant_id) = v_lead
      ) into v_prior;
      if v_prior then return new; end if;
      v_secs := 0;
    end if;

    update public.leads l
       set response_time_minutes = round(v_secs / 60.0)::integer
     where l.id = v_lead
       and l.tenant_id is not distinct from new.tenant_id
       and l.response_time_minutes is null
       and l.created_at is not null;
  exception when others then
    raise warning 'nexus_mark_first_response skipped for %: % (%)',
      new.lead_email, sqlerrm, sqlstate;
  end;
  return new;
end;
$fn$;

-- ── RAG must not answer one dealership out of another's documents ─────────
-- Signature unchanged, so the n8n RPC call (POST /rest/v1/rpc/search_rag_documents
-- with {q, match_limit}) keeps working byte-for-byte. Scoping happens inside.
create or replace function public.search_rag_documents(q text, match_limit integer default 6)
returns table(id integer, doc_title text, section text, content text,
              source_file text, page_number integer, rank real, match_type text)
language plpgsql stable set search_path to 'public' as $fn$
declare
  cleaned text; terms text[]; tq tsquery; v_tenant uuid;
begin
  -- authenticated callers are already filtered by RLS; this matters for
  -- service_role (n8n), which is BYPASSRLS and would otherwise read every
  -- dealership's policy documents and quote them back to a customer.
  v_tenant := public.nexus_default_tenant_id();
  if v_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return;   -- cannot tell whose knowledge base this is: answer nothing
  end if;

  cleaned := btrim(regexp_replace(lower(coalesce(q,'')), '[^a-z0-9\s]', ' ', 'g'));
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));
  if length(cleaned) < 3 then return; end if;

  tq := websearch_to_tsquery('english', cleaned);
  if tq is not null and numnode(tq) > 0 then
    return query
      select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
             ts_rank_cd(d.search_vector, tq)::real, 'fts_all'::text
        from public.rag_documents d
       where d.search_vector @@ tq
         and (v_tenant is null or d.tenant_id = v_tenant)
       order by ts_rank_cd(d.search_vector, tq) desc, d.id
       limit match_limit;
    if found then return; end if;
  end if;

  select array_agg(distinct t) into terms
    from unnest(string_to_array(cleaned,' ')) as t where length(t) > 2;

  if terms is not null and array_length(terms,1) > 0 then
    tq := to_tsquery('english', array_to_string(terms,' | '));
    if tq is not null and numnode(tq) > 0 then
      return query
        select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
               ts_rank_cd(d.search_vector, tq)::real, 'fts_any'::text
          from public.rag_documents d
         where d.search_vector @@ tq
           and (v_tenant is null or d.tenant_id = v_tenant)
         order by ts_rank_cd(d.search_vector, tq) desc, d.id
         limit match_limit;
      if found then return; end if;
    end if;
  end if;

  if terms is null or array_length(terms,1) is null then return; end if;

  return query
    with scored as (
      select d.id as did, sum(s.sim) as total, count(*) as matched_terms
        from public.rag_documents d
        cross join lateral (
          select word_similarity(t, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,'')) as sim
            from unnest(terms) as t where length(t) >= 4
        ) s
       where s.sim > 0.5
         and (v_tenant is null or d.tenant_id = v_tenant)
       group by d.id
    )
    select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
           (sc.total / greatest(array_length(terms,1),1))::real, 'trigram'::text
      from scored sc join public.rag_documents d on d.id = sc.did
     order by sc.matched_terms desc, sc.total desc, d.id
     limit match_limit;
end;
$fn$;

-- ── the daily snapshot, per dealership ────────────────────────────────────
-- Every rule string (INV-008) is carried over verbatim; only the grouping is new.
create or replace function public.capture_daily_metrics()
returns void language sql security definer set search_path to 'public' as $fn$
  insert into daily_metrics as d (tenant_id, snapshot_date, open_leads, open_leads_rule,
    hot_leads, warm_leads, cold_leads, avg_response_minutes, pipeline_aed,
    pipeline_aed_rule, units_at_risk, holding_cost_aed, workflow_runs,
    workflow_failures, workflow_failures_rule, workflow_failures_canonical)
  select tn.id, current_date,
    (select count(*) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'nexus_lead_is_open',
    (select count(*) from leads where tenant_id = tn.id and upper(status)='HOT'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='WARM'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='COLD'),
    (select round(avg(response_time_minutes)::numeric,2) from leads
      where tenant_id = tn.id and response_time_minutes is not null),
    (select sum(budget_aed) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'open_leads_null_when_unknown',
    (select count(*) from inventory where tenant_id = tn.id and aging_alert='CRITICAL'),
    (select coalesce(sum(holding_cost_accrued),0) from inventory where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE'),
    'nexus_outcome_class',
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE')
  from tenants tn
  where tn.status = 'active'
  on conflict (tenant_id, snapshot_date) do update set
    open_leads=excluded.open_leads, open_leads_rule=excluded.open_leads_rule,
    hot_leads=excluded.hot_leads, warm_leads=excluded.warm_leads,
    cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, pipeline_aed_rule=excluded.pipeline_aed_rule,
    units_at_risk=excluded.units_at_risk, holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$fn$;

-- Privileges match what each function had before this migration.
revoke all on function public.nexus_lead_for_comm_key(text, uuid) from public, anon, authenticated;
revoke all on function public.nexus_comm_keys_for_lead(text, text, uuid) from public, anon, authenticated;
grant execute on function public.nexus_lead_for_comm_key(text, uuid) to service_role;
grant execute on function public.nexus_comm_keys_for_lead(text, text, uuid) to service_role;
grant execute on function public.search_rag_documents(text, integer) to anon, authenticated, service_role;