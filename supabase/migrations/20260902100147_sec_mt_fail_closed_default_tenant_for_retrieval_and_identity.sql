
-- BUSINESS RULE
-- "Which dealership is this for?" has exactly two honest answers: the one the
-- caller is a member of, or -- while ALBA CARS is the only dealership on the
-- box -- the one holding is_unattributed_default. It must never be answered by
-- the default flag once a second dealership exists, because then the flag is
-- not an attribution, it is a guess, and the guess is always ALBA.
--
-- Proven on 2 Sep 2026 with three synthetic dealerships live: called as
-- service_role (which is how n8n calls it, with no auth.uid()),
-- search_rag_documents() returned ALBA CARS' Warranty Policy and Sales
-- Compensation Policy to a caller with no tenant context whatsoever. Its own
-- "cannot tell whose knowledge base this is: answer nothing" guard never fired,
-- because nexus_default_tenant_id() never returns NULL while the flag is set.
-- The same dead guard sits in nexus_lead_for_comm_key(p_key) and
-- nexus_comm_keys_for_lead(p_email, p_phone).
--
-- nexus_scoped_tenant_id() is that guard made real. It is deliberately NOT
-- used as the column DEFAULT on the 15 tenant tables -- n8n's inserts must keep
-- landing somewhere rather than becoming NULL-tenant rows that no signed-in
-- user can see.
--
-- With one active dealership every behaviour below is byte-identical to today.
-- On the day a second dealership is onboarded, these three entry points return
-- nothing instead of returning ALBA's data. That is a visible outage in the
-- Ask-AI and identity paths and it is meant to be: n8n must be changed to pass
-- the tenant explicitly (search_rag_documents(q, limit, p_tenant) and the
-- existing 2-arg nexus_lead_for_comm_key / 3-arg nexus_comm_keys_for_lead)
-- before dealership #2 goes live.

create or replace function public.nexus_scoped_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default and t.status = 'active'
        and (select count(*) from public.tenants w where w.status = 'active') = 1));
$$;

revoke all on function public.nexus_scoped_tenant_id() from public;
grant execute on function public.nexus_scoped_tenant_id() to authenticated, service_role;

-- Tenant-explicit retrieval: the shape n8n must move to.
create or replace function public.search_rag_documents(q text, match_limit integer, p_tenant uuid)
returns table(id integer, doc_title text, section text, content text,
              source_file text, page_number integer, rank real, match_type text)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  cleaned text; terms text[]; tq tsquery; v_tenant uuid := p_tenant;
begin
  -- SECURITY INVOKER on purpose: an authenticated caller naming someone else's
  -- tenant still gets nothing, because rag_documents RLS applies to them.
  -- service_role is BYPASSRLS, so for n8n this argument IS the whole boundary.
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
$function$;

revoke all on function public.search_rag_documents(text, integer, uuid) from public;
grant execute on function public.search_rag_documents(text, integer, uuid) to authenticated, service_role;

-- The wired call site (n8n's rpc/search_rag_documents sends q + match_limit only).
create or replace function public.search_rag_documents(q text, match_limit integer default 6)
returns table(id integer, doc_title text, section text, content text,
              source_file text, page_number integer, rank real, match_type text)
language sql
stable
set search_path to 'public'
as $function$
  select * from public.search_rag_documents(q, match_limit, public.nexus_scoped_tenant_id());
$function$;

-- Identity resolution: same dead guard, same fix.
create or replace function public.nexus_lead_for_comm_key(p_key text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.nexus_lead_for_comm_key(p_key, public.nexus_scoped_tenant_id());
$function$;

create or replace function public.nexus_comm_keys_for_lead(p_email text, p_phone text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.nexus_comm_keys_for_lead(p_email, p_phone, public.nexus_scoped_tenant_id());
$function$;
