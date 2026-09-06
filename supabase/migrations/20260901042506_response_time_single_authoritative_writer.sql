-- leads.response_time_minutes had four defects that only fail together, so they
-- are fixed together.
--
-- 1. A BEFORE INSERT trigger on leads measured the first response at the moment
--    the lead row was created -- before any reply to that lead can exist. In
--    production the bot answers first and the router mints the lead row after,
--    so the trigger reliably found a reply from the PRE-LEAD conversation.
-- 2. greatest(0, ...) then turned the resulting negative interval into "answered
--    in 0 minutes", converting "I measured the wrong event" into "instant
--    service" -- a lie in the reassuring direction, which is why it went unseen.
-- 3. The correct writer (AFTER INSERT on communication_logs) already existed but
--    was permanently locked out: its guard is `response_time_minutes is null`,
--    and 0 is not null.
-- 4. nexus_comm_keys_for_lead GENERATES the '+<digits>@whatsapp.lead' key shape,
--    but nexus_lead_for_comm_key could only match it by exact equality on
--    leads.email -- so a lead with a real email address whose reply is filed
--    under that shape resolved to nothing.
--
-- Consequence on live data: all three leads read 0. within_sla counted every
-- lead, breached_sla was always 0, and v_needs_attention could never raise an
-- sla_breach -- the five-minute rule this product is built around was
-- structurally unenforceable. Lead 35 has never been replied to at all and the
-- column asserted instant service.

-- ------------------------------------------------------------------
-- 1. Symmetric key resolution, on the same last-9-digit rule the n8n
--    Resolve Lead Identity node uses. (defect 4)
-- ------------------------------------------------------------------
create or replace function public.nexus_lead_for_comm_key(p_key text)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_tail   text;
  v_id     integer;
  v_email  text;
  v_wcdig  text;
begin
  if v_raw is null then return null; end if;

  -- (a) Exact match on the email column. Covers a real address and the
  --     synthetic whatsapp.lead one when the router stored it AS the email.
  select id into v_id from public.leads
   where email = v_raw and coalesce(email, '') <> ''
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) Any key CARRYING a phone number resolves by its last 9 digits, against
  --     both the phone column and digits embedded in the email. '<digits>@c.us'
  --     and '+<digits>@whatsapp.lead' both qualify. '<lid>@lid' does NOT -- a
  --     LID is an opaque WhatsApp id whose digits would collide with a real
  --     number -- so it is excluded here and bridged in (c).
  if v_raw not like '%@lid' then
    v_digits := regexp_replace(split_part(v_raw, '@', 1), '[^0-9]', '', 'g');
    v_tail   := case when length(v_digits) >= 9 then right(v_digits, 9) end;
    if v_tail is not null then
      select id into v_id from public.leads
       where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
       order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  -- (c) '<lid>@lid' resolves only through whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    select lead_email into v_email from public.whatsapp_contacts
     where chat_id = v_raw and nullif(btrim(lead_email), '') is not null limit 1;
    if v_email is not null then
      select id into v_id from public.leads where email = v_email order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    select regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      into v_wcdig from public.whatsapp_contacts where chat_id = v_raw limit 1;
    if v_wcdig is not null and length(v_wcdig) >= 9 then
      v_tail := right(v_wcdig, 9);
      select id into v_id from public.leads
       where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
       order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$function$;

-- ------------------------------------------------------------------
-- 2. Retire the BEFORE INSERT writer. (defects 1, 2, 3)
--    A first-response time is not knowable at lead-insert time.
-- ------------------------------------------------------------------
drop trigger if exists trg_leads_backfill_response on public.leads;
drop function if exists public.nexus_backfill_response_time();

-- ------------------------------------------------------------------
-- 3. The sole authoritative writer: no clamp, no backward grace window.
-- ------------------------------------------------------------------
create or replace function public.nexus_mark_first_response()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_lead    integer;
  v_created timestamptz;
  v_at      timestamptz := coalesce(new.created_at, now());
  v_secs    numeric;
  v_prior   boolean;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;

  -- The meter must never break message logging.
  begin
    v_lead := public.nexus_lead_for_comm_key(new.lead_email);
    if v_lead is null then return new; end if;

    select l.created_at into v_created from public.leads l
     where l.id = v_lead and l.response_time_minutes is null;
    if v_created is null then return new; end if;   -- absent, or already measured

    v_secs := extract(epoch from (v_at - v_created));

    -- A reply BEFORE the lead row is one of two things: clock skew between n8n
    -- (Asia/Dubai) and Postgres, or a conversation that predates the lead. An
    -- inbound message already on file before this reply distinguishes them.
    -- Only the first is a genuine zero; the second is not this lead's clock and
    -- must stay unmeasured. NULL is the honest encoding of "wrong event" --
    -- the dashboard already renders it as not measured. Zero is reserved for a
    -- real sub-30-second reply.
    if v_secs < 0 then
      if v_secs < -90 then return new; end if;
      select exists (
        select 1 from public.communication_logs c
         where c.created_at < v_at
           and lower(coalesce(c.direction, '')) = 'inbound'
           and public.nexus_lead_for_comm_key(c.lead_email) = v_lead
      ) into v_prior;
      if v_prior then return new; end if;
      v_secs := 0;
    end if;

    update public.leads l
       set response_time_minutes = round(v_secs / 60.0)::integer
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

-- A negative reply time is now impossible by construction; say so.
alter table public.leads drop constraint if exists leads_response_time_nonneg;
alter table public.leads add constraint leads_response_time_nonneg
  check (response_time_minutes is null or response_time_minutes >= 0);

comment on function public.nexus_mark_first_response() is
'Sole authority for leads.response_time_minutes. Writes only over NULL (first reply wins). A reply predating the lead row leaves NULL unless it is clock skew with no prior inbound. Never clamps a negative interval to zero - that is what made every lead read 0.';