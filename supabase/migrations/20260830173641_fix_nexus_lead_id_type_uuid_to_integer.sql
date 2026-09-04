-- URGENT CORRECTION to this morning's SLA-meter migration.
--
-- nexus_lead_for_comm_key() was declared RETURNS uuid and assigns into a uuid
-- variable, but public.leads.id is INTEGER. The moment a lookup actually
-- matched a lead, the assignment raised 22P02 "invalid input syntax for type
-- uuid". That function is called from nexus_mark_first_response(), an AFTER
-- INSERT trigger on communication_logs — so the error propagated out of the
-- trigger and ABORTED THE INSERT.
--
-- The blast radius is the whole business: every inbound and outbound WhatsApp
-- message is written to communication_logs, and that table is also the bot's
-- conversation memory. A failing insert would have started dropping messages
-- the next time a known customer was replied to. It was introduced today by
-- the SLA migration and had not yet been triggered.
--
-- Both functions are recreated with integer. Nothing else changes. Dropping
-- first is required because the return type cannot be altered in place.
drop trigger if exists trg_comm_logs_first_response on public.communication_logs;
drop function if exists public.nexus_mark_first_response();
drop function if exists public.nexus_lead_for_comm_key(text);

create function public.nexus_lead_for_comm_key(p_key text)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_is_cus boolean;
  v_id     integer;
  v_email  text;
  v_wcdig  text;
begin
  if v_raw is null then
    return null;
  end if;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_is_cus := v_raw like '%@c.us';

  -- (a) Exact match. Covers a real address and the synthetic whatsapp.lead one.
  select id into v_id from public.leads
   where email = v_raw order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) '<digits>@c.us' IS a phone number. Try the synthetic address the router
  --     would have minted from it, then the lead's own phone column.
  if v_is_cus and v_digits <> '' then
    select id into v_id from public.leads
     where email = '+' || v_digits || '@whatsapp.lead' order by created_at limit 1;
    if v_id is not null then return v_id; end if;

    select id into v_id from public.leads
     where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_digits
     order by created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- (c) Anything else — in practice '<number>@lid' — only resolves through
  --     whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    execute 'select lead_email from public.whatsapp_contacts '
            'where chat_id = $1 and lead_email is not null limit 1'
       into v_email using v_raw;
    if v_email is not null then
      select id into v_id from public.leads
       where email = v_email order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    execute 'select regexp_replace(coalesce(phone, ''''), ''[^0-9]'', '''', ''g'') '
            'from public.whatsapp_contacts where chat_id = $1 limit 1'
       into v_wcdig using v_raw;
    if v_wcdig is not null and v_wcdig <> '' then
      select id into v_id from public.leads
       where email = '+' || v_wcdig || '@whatsapp.lead'
          or regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_wcdig
       order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$function$;

create function public.nexus_mark_first_response()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead integer;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;

  -- Never let the meter break message logging. This trigger measures a
  -- statistic; communication_logs carries the actual conversation and is the
  -- bot's memory. If anything in here fails, the message must still land.
  begin
    v_lead := public.nexus_lead_for_comm_key(new.lead_email);
    if v_lead is null then
      return new;   -- a message to somebody who is not (yet) a lead row
    end if;

    -- `response_time_minutes is null` makes this first-write-wins AND
    -- idempotent: the second and hundredth outbound message to the same lead
    -- fall through without touching the value.
    -- greatest(0, ...) absorbs clock skew between n8n (Asia/Dubai) and Postgres,
    -- and the case where a reply is logged in the same second as the lead row.
    update public.leads l
       set response_time_minutes =
             greatest(0, round(extract(epoch from (coalesce(new.created_at, now()) - l.created_at)) / 60.0))::integer
     where l.id = v_lead
       and l.response_time_minutes is null
       and l.created_at is not null;
  exception when others then
    raise warning 'nexus_mark_first_response skipped for %: % (%)',
      new.lead_email, sqlerrm, sqlstate;
  end;

  return new;
end;
$function$;

create trigger trg_comm_logs_first_response
after insert on public.communication_logs
for each row execute function public.nexus_mark_first_response();

revoke all on function public.nexus_lead_for_comm_key(text) from public;
revoke all on function public.nexus_mark_first_response() from public;
grant execute on function public.nexus_lead_for_comm_key(text) to service_role;