-- One question -- "what happened to this customer?" -- and why it could not be
-- answered, measured before anything was built.
--
-- WHAT THE JOIN KEY ACTUALLY IS
--
-- There is no correlation id in this database. The link from a lead to what was
-- said to them is `communication_logs.lead_email` and `audit_log.lead_email`:
-- an EMAIL ADDRESS STRING. Not `lead_id`, not a foreign key. Measured on
-- production, 7 September 2026:
--
--   leads .................................................. 4
--   leads with NO email at all ............................. 1   (25%)
--   communication_logs ..................................... 120
--   ...whose lead_email matches no lead .................... 95   (79%)
--   audit_log .............................................. 843
--   ...with no lead_email at all ........................... 775  (92%)
--
-- Three consequences, and none of them is a missing feature:
--
--  * A lead with no email is UNLINKABLE. A UAE walk-in or a WhatsApp enquiry
--    routinely arrives with a phone number and no email, and for that customer
--    the messages and the audit trail cannot be attached to them at all.
--  * 92% of the audit trail is attached to nobody.
--  * Two enquiries from one person share an email and therefore collapse into
--    one history.
--
-- WHY THIS FUNCTION EXISTS RATHER THAN A CORRELATION COLUMN
--
-- The tidy fix is `leads.correlation_id`, or a `lead_id` foreign key on
-- `communication_logs`. Both are `ALTER TABLE` on tables the live dashboard
-- writes, which fires `nexus_guard_born_open_grants()` and strips those write
-- grants -- this repo has done that once already and had to re-grant two
-- screens. It is a change to make deliberately, with someone watching, and it
-- is written down as owed rather than done quietly here.
--
-- So this reads what exists and is HONEST ABOUT THE JOIN. The house rule it is
-- built on is the one this codebase has broken in six places: **a missing row
-- is not proof the event did not happen.** Rendering "0 messages" for a lead
-- whose only possible link is an email it does not have is not a fact, it is a
-- guess wearing a number. Every hop therefore carries how it was linked, and a
-- lead that cannot be linked gets a NOT_LINKABLE row saying so instead of an
-- empty list.

create or replace function public.nexus_lead_trace(p_lead_id integer)
returns table (
  hop_order        integer,
  hop              text,
  occurred_at      timestamptz,
  summary          text,
  linked_by        text,
  link_confidence  text,
  caveat           text
)
language sql
stable
security definer
set search_path to public, pg_catalog
as $function$
  with scope as (
    -- Every statement below joins through this, so the tenant predicate is
    -- present in each of them: SECURITY DEFINER bypasses the RLS that would
    -- otherwise carry it, and nexus_definer_scoping_audit() is watching.
    select l.id, l.tenant_id, l.name, l.email, l.phone, l.source, l.status, l.created_at,
           nullif(btrim(lower(l.email)), '') as join_key
      from public.leads l
     where l.id = p_lead_id
       and l.tenant_id in (select public.nexus_current_tenant_ids())
  )
  -- 1. the lead itself
  select 1, 'lead', s.created_at,
         'Lead ' || s.id || ' — ' || coalesce(s.name, '(no name)')
           || ', source ' || coalesce(s.source, '(none recorded)')
           || ', status ' || coalesce(s.status, '(none)'),
         'lead id', 'PRIMARY_KEY',
         case when s.join_key is null
              then 'This lead has NO EMAIL. Every link to messages and to the audit trail in '
                || 'this database is an email string, so nothing below can be attached to this '
                || 'customer — that is a property of the schema, not evidence that nothing '
                || 'happened.'
              else null end
    from scope s

  -- 2. how it arrived, which IS properly keyed
  union all
  select 2, 'arrival', e.received_at,
         'Arrived via ' || c.display_name || ' (' || e.source_key || '), phase ' || e.phase
           || coalesce(' — ' || e.disposition_reason, '')
           || case when e.environment = 'simulation' then ' [SIMULATION TRAFFIC]' else '' end,
         'lead_event.lead_id', 'FOREIGN_KEY', null
    from scope s
    join public.lead_event e on e.lead_id = s.id and e.tenant_id = s.tenant_id
    join public.lead_source_catalogue c on c.source_key = e.source_key

  -- 2b. and the honest absence: promoted leads predate the lead_event layer
  union all
  select 2, 'arrival', null::timestamptz,
         'No lead_event row is linked to this lead.',
         'lead_event.lead_id', 'NO_ROWS',
         'Either this lead predates the lead ingestion layer (leadingest_01 landed on '
         || '7 September 2026 and older leads were written directly by n8n), or it was '
         || 'created by a writer that does not record an arrival. It is not evidence that '
         || 'the customer never arrived.'
    from scope s
   where not exists (select 1 from public.lead_event e
                      where e.lead_id = s.id and e.tenant_id = s.tenant_id)

  -- 3. what was said, linked only by an email string
  union all
  select 3, 'communication', cl.created_at,
         upper(cl.direction) || ' ' || cl.channel || ' — '
           || left(regexp_replace(coalesce(cl.message, ''), '\s+', ' ', 'g'), 140),
         'communication_logs.lead_email = leads.email', 'EMAIL_STRING_MATCH',
         'Matched on an email string, not a key. Two enquiries from one person share this '
         || 'link and collapse into one history.'
    from scope s
    join public.communication_logs cl
      on cl.tenant_id = s.tenant_id
     and s.join_key is not null
     and nullif(btrim(lower(cl.lead_email)), '') = s.join_key

  union all
  select 3, 'communication', null::timestamptz,
         'Communications cannot be attached to this lead.',
         'communication_logs.lead_email', 'NOT_LINKABLE',
         'This lead has no email, and lead_email is the only link communication_logs '
         || 'carries — there is no lead_id on that table. Messages may well have been sent; '
         || 'this database cannot say which were to this person.'
    from scope s
   where s.join_key is null

  -- 4. what the system recorded doing, same weak link
  union all
  select 4, 'audit', a.logged_at,
         a.workflow || ' — ' || a.status || coalesce(': ' || left(a.summary, 120), ''),
         'audit_log.lead_email = leads.email', 'EMAIL_STRING_MATCH',
         '92% of audit_log rows on production carry no lead_email at all, so this trail is '
         || 'partial by construction even when it returns rows.'
    from scope s
    join public.audit_log a
      on a.tenant_id = s.tenant_id
     and s.join_key is not null
     and nullif(btrim(lower(a.lead_email)), '') = s.join_key

  union all
  select 4, 'audit', null::timestamptz,
         'The audit trail cannot be attached to this lead.',
         'audit_log.lead_email', 'NOT_LINKABLE',
         'This lead has no email, and lead_email is the only customer link audit_log '
         || 'carries. Work was almost certainly logged; none of it can be shown to be about '
         || 'this customer.'
    from scope s
   where s.join_key is null

  order by 1, 3 nulls last;
$function$;

comment on function public.nexus_lead_trace(integer) is
  'Everything this database can honestly say about one lead, hop by hop, with '
  'HOW each hop was linked on every row. There is no correlation id here: '
  'communication_logs and audit_log link to a customer by an EMAIL STRING, so a '
  'lead with no email gets a NOT_LINKABLE row rather than an empty list. '
  'Rendering "0 messages" for a customer whose only possible link is an email '
  'they do not have is a guess wearing a number, and this codebase has made '
  'that mistake in six places.';

revoke all on function public.nexus_lead_trace(integer) from public, anon;
grant execute on function public.nexus_lead_trace(integer) to authenticated, service_role;

-- The vendor-side measurement, so the gap is a number somebody can watch shrink
-- rather than a thing people remember being told once.
create or replace function public.nexus_trace_linkability_report()
returns table (metric text, value text, what_it_means text)
language sql
stable
security definer
set search_path to public, pg_catalog
as $function$
  select 'leads with no email', count(*) filter (where coalesce(btrim(email),'') = '')::text
         || ' of ' || count(*)::text,
         'Each of these is a customer whose messages and audit trail cannot be attached to '
         || 'them by any link this schema has.'
    from public.leads
  union all
  select 'communication_logs not attributable to a lead',
         (select count(*) from public.communication_logs cl
           where not exists (select 1 from public.leads l
                              where nullif(btrim(lower(l.email)),'') = nullif(btrim(lower(cl.lead_email)),'')))::text
         || ' of ' || (select count(*)::text from public.communication_logs),
         'Messages whose lead_email matches no lead. Some are genuinely not customers; the '
         || 'point is that this database cannot tell which.'
  union all
  select 'audit_log rows carrying no customer at all',
         (select count(*) from public.audit_log where coalesce(btrim(lead_email),'') = '')::text
         || ' of ' || (select count(*)::text from public.audit_log),
         'The audit trail is mostly about the system, not about a person. A "what happened '
         || 'to this customer" question cannot be answered from these rows.'
  union all
  select 'a real correlation id exists', 'no',
         'The fix is a lead_id foreign key on communication_logs, or a correlation id '
         || 'carried from the receiver through to the outbound message. Both are ALTER '
         || 'TABLE on tables the live dashboard writes, which fires '
         || 'nexus_guard_born_open_grants() and strips those grants. Owed, deliberately '
         || 'not done in passing.';
$function$;

comment on function public.nexus_trace_linkability_report() is
  'How much of this database can be attached to a customer at all. Vendor '
  'tooling: service_role only, and DELIBERATELY CROSS-TENANT -- it counts rows '
  'across every dealership, which is why it must never be granted to '
  'authenticated. It returns counts and no customer content: no name, no email, '
  'no message text, so it cannot become a way to read one dealership''s data '
  'from another. nexus_definer_scoping_audit() does not flag it because that '
  'audit only watches functions authenticated can reach; this exemption is a '
  'grant, not an oversight. Watch these numbers rather than trusting that '
  'somebody remembers the limitation.';

revoke all on function public.nexus_trace_linkability_report() from public, anon, authenticated;
grant execute on function public.nexus_trace_linkability_report() to service_role;

do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.nexus_lead_trace(integer)', 'execute') then
    raise exception 'anon can read a customer trace';
  end if;
  if has_function_privilege('authenticated', 'public.nexus_trace_linkability_report()', 'execute') then
    raise exception 'the linkability report is vendor tooling and reached the dealer plane';
  end if;
  -- SECURITY DEFINER, so the standing audit must be content with both.
  select count(*) into n from public.nexus_definer_scoping_audit()
   where function_name in ('nexus_lead_trace','nexus_trace_linkability_report')
     and verdict = 'REVIEW';
  if n > 0 then
    raise exception 'the new trace functions trip the definer scoping audit on % statement(s)', n;
  end if;
end $$;
